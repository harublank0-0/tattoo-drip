# Studio Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Claude implements this plan test-first; the user reviews the result.

**Goal:** Owners edit the studio profile, the deposit defaults and a list of payment methods (Fonepay, eSewa, Khalti, bank, cash) with QR images; artists get 404.

**Architecture:** A named `role` middleware guards a nested `/t/:tenant/settings` route group. Profile and deposit fields are new `tenants` columns written through `TenancyService`. Payment methods are a new `payments` module: a `payment_methods` table, a pure `checkPaymentMethod` rule function, and `PaymentMethodService`, which owns the QR file lifecycle through `ImageService`. Thin controllers render three Inertia pages inside the existing `SettingsLayout`.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18, VineJS, Inertia + React, shadcn/ui, Japa (`@japa/api-client`, `@japa/assert`).

**Spec:** `docs/superpowers/specs/2026-10-08-tat-26-studio-settings-design.md`

## Global Constraints

- Owners only: every `/t/:tenant/settings…` route runs `auth` → `tenant` → `role({ allow: ["owner"] })`. A disallowed role gets `E_ROUTE_NOT_FOUND` (404), never 403.
- Services scope every query by tenant. No `tenant_id` in validators; never read a tenant id from the body, query string or headers. Every `:id` loads through `PaymentMethodService.findFor(tenant, id)`.
- Form fields are camelCase (`contactPhone`, `showOnDepositPage`, `removeQr`), like `fullName` on signup.
- Phone numbers are stored in E.164, with +977 when no country code is given.
- Column limits: `intro` 1000, `contact_phone` 16, `contact_email` 254, `address` 300, social URLs 500 (https only), `default_deposit_percent` smallint 0–100 or null, `deposit_policy` 2000; `label` 80, `account_name` 120, `account_number` 64, `bank_name` 120, `qr_image_key` 255.
- QR images use purpose `payment_qr`. If a save fails, delete the new key; when a QR is replaced or removed, delete the old key after the save commits; soft delete keeps the file.
- User-facing rule messages are exactly: "Upload your Fonepay QR code.", "Add a QR code or your eSewa ID." / "…your Khalti ID.", "Enter the bank's name.", "Enter the name on the account.", "Enter the account number.", "Cash can't be paid on the deposit page.", "<Kind> doesn't take a QR code."
- Classes that use `@inject()` import their dependencies as values, with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Run `node ace codegen` (from `apps/platform`) after adding routes, controllers or pages, and `node ace migration:run` after a migration. Commit `.adonisjs/` and `database/schema.ts` with the change.
- Run tests as `PORT=3402 node ace test …` from `apps/platform` (another dev server holds 3333).
- Commits: Conventional Commits with scope `platform`, a `Refs: TAT-26` line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A non-UUID id in a payments URL** (`/settings/payments/abc/edit`): 404 from the router's uuid matcher, not a 500 from Postgres. Test in Task 6.
- **A method deleted in another tab, then edited, moved or deleted:** 404, because `findFor` skips soft-deleted rows. Tests in Tasks 6 and 7.
- **Clearing an optional profile field:** stored as null, not `""`. Test in Task 3.
- **A phone number typed the local way** (`98-1234-5678`, `01 4123456`): stored in E.164. Tests in Tasks 2 and 3.
- **Two methods with the same position** (added at the same moment): they still move, because `move` renumbers the whole list. Test in Task 5.

---

### Task 1: Profile and deposit columns, and `TenancyService` writes

**Files:**
- Create: `apps/platform/database/migrations/1791560000000_add_profile_to_tenants_table.ts`
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts`
- Modify (generated): `apps/platform/database/schema.ts`
- Create: `apps/platform/tests/helpers/tenants.ts`
- Test: `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts` (new group at the end)

**Interfaces:**
- Produces: `TenantProfile` and `DepositSettings` types and `TenancyService.updateProfile(tenant: Tenant, input: TenantProfile): Promise<Tenant>` / `updateDepositSettings(tenant: Tenant, input: DepositSettings): Promise<Tenant>`; new `Tenant` attributes `intro`, `contactPhone`, `contactEmail`, `address`, `instagramUrl`, `facebookUrl`, `tiktokUrl`, `websiteUrl` (`string | null`), `defaultDepositPercent` (`number | null`), `depositPolicy` (`string | null`); test helpers `studioWithOwner(slug?, name?)` and `artistIn(tenant, email?)`.

- [ ] **Step 1: Write the migration and run it**

```ts
// apps/platform/database/migrations/1791560000000_add_profile_to_tenants_table.ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The studio's public profile and deposit defaults (TAT-26).
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("intro", 1000).nullable();
			// E.164, e.g. +9779812345678 (see database/README.md).
			table.string("contact_phone", 16).nullable();
			table.string("contact_email", 254).nullable();
			table.string("address", 300).nullable();
			table.string("instagram_url", 500).nullable();
			table.string("facebook_url", 500).nullable();
			table.string("tiktok_url", 500).nullable();
			table.string("website_url", 500).nullable();
			// Null: no default; the artist sets the deposit on each quote.
			table
				.smallint("default_deposit_percent")
				.nullable()
				.checkBetween([0, 100], "tenants_default_deposit_percent_range");
			table.string("deposit_policy", 2000).nullable();
		});
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"intro",
				"contact_phone",
				"contact_email",
				"address",
				"instagram_url",
				"facebook_url",
				"tiktok_url",
				"website_url",
				"default_deposit_percent",
				"deposit_policy",
			);
		});
	}
}
```

Run: `cd apps/platform && node ace migration:run`
Expected: the migration runs, and `database/schema.ts` now lists the new columns in `TenantSchema` (`defaultDepositPercent: number | null`).

- [ ] **Step 2: Add the shared test helpers**

```ts
// apps/platform/tests/helpers/tenants.ts
import User from "#models/user";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";

/**
 * A fresh studio and its owner. The owner's email comes from the slug, so
 * one test can set up several studios.
 */
export async function studioWithOwner(slug = "black-needle", name = "Black Needle") {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type: "studio",
		name,
		slug,
		timezone: "Asia/Kathmandu",
	});
	return { owner, tenant };
}

/**
 * A user with the artist role in `tenant`.
 */
export async function artistIn(tenant: Tenant, email = "artist@example.com") {
	const user = await User.create({ email, password: "secret-password" });
	await TenantMembership.create({
		tenantId: tenant.id,
		userId: user.id,
		role: "artist",
	});
	return user;
}
```

- [ ] **Step 3: Write the failing service tests**

Append to `tests/functional/tenancy/tenancy_service.spec.ts` (add the imports at the top if missing: `Tenant` from `#modules/tenancy/models/tenant`, `TenancyService`, `testUtils`, and `studioWithOwner` from `#tests/helpers/tenants`):

```ts
const profile = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: "https://blackneedle.example",
};

test.group("TenancyService profile and deposits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("updateProfile saves every profile field and keeps slug and type", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await new TenancyService().updateProfile(tenant, profile);

		const saved = await Tenant.findOrFail(tenant.id);
		for (const [key, value] of Object.entries(profile)) {
			assert.deepEqual(saved[key as keyof typeof profile], value, key);
		}
		assert.equal(saved.slug, "black-needle");
		assert.equal(saved.type, "studio");
	});

	test("updateProfile with nulls clears the fields", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const tenancy = new TenancyService();
		await tenancy.updateProfile(tenant, profile);

		await tenancy.updateProfile(tenant, {
			...profile,
			intro: null,
			contactPhone: null,
			instagramUrl: null,
		});

		const saved = await Tenant.findOrFail(tenant.id);
		assert.isNull(saved.intro);
		assert.isNull(saved.contactPhone);
		assert.isNull(saved.instagramUrl);
	});

	test("updateDepositSettings saves and clears the default", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const tenancy = new TenancyService();

		await tenancy.updateDepositSettings(tenant, {
			defaultDepositPercent: 30,
			depositPolicy: "Deposits hold your date.",
		});
		let saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.defaultDepositPercent, 30);
		assert.equal(saved.depositPolicy, "Deposits hold your date.");

		await tenancy.updateDepositSettings(tenant, {
			defaultDepositPercent: null,
			depositPolicy: null,
		});
		saved = await Tenant.findOrFail(tenant.id);
		assert.isNull(saved.defaultDepositPercent);
		assert.isNull(saved.depositPolicy);
	});

	test("the database refuses a deposit over 100%", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await assert.rejects(() =>
			new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: 101,
				depositPolicy: null,
			}),
		);
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/tenancy/tenancy_service.spec.ts`
Expected: FAIL. `updateProfile` and `updateDepositSettings` don't exist (TypeScript error or "is not a function").

- [ ] **Step 5: Implement the two methods**

In `app/modules/tenancy/services/tenancy_service.ts`, add the types after `NewTenant`:

```ts
/**
 * The studio's public profile. Slug and type are not part of it: the slug
 * changes with aliases (TAT-24), the type never.
 */
export type TenantProfile = {
	name: string;
	timezone: string;
	intro: string | null;
	contactPhone: string | null;
	contactEmail: string | null;
	address: string | null;
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	websiteUrl: string | null;
};

/**
 * Defaults for the deposit page (TAT-65). A null percentage means the
 * artist sets the deposit on each quote.
 */
export type DepositSettings = {
	defaultDepositPercent: number | null;
	depositPolicy: string | null;
};
```

and these methods in the class, after `createTenant`:

```ts
	/**
	 * Saves the studio's public profile. Null clears a field.
	 */
	async updateProfile(tenant: Tenant, input: TenantProfile): Promise<Tenant> {
		tenant.merge(input);
		await tenant.save();
		return tenant;
	}

	/**
	 * Saves the deposit defaults shown on the deposit page.
	 */
	async updateDepositSettings(
		tenant: Tenant,
		input: DepositSettings,
	): Promise<Tenant> {
		tenant.merge(input);
		await tenant.save();
		return tenant;
	}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/tenancy/tenancy_service.spec.ts`
Expected: PASS (all old and new tests).

- [ ] **Step 7: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform/database apps/platform/app/modules/tenancy/services/tenancy_service.ts apps/platform/tests/helpers/tenants.ts apps/platform/tests/functional/tenancy/tenancy_service.spec.ts
git commit -m "feat(platform): add studio profile and deposit columns" -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Phone numbers and the profile and deposit validators

**Files:**
- Create: `apps/platform/app/validators/phone.ts`
- Modify: `apps/platform/app/modules/tenancy/validators/tenant.ts`
- Test: `apps/platform/tests/unit/validators/phone.spec.ts`
- Test: `apps/platform/tests/unit/modules/tenancy/profile_validators.spec.ts`

**Interfaces:**
- Consumes: `ianaTimezone` (already in `tenant.ts`), `TenantProfile`, `DepositSettings` (Task 1).
- Produces: `normalizePhone(value: string): string | undefined`, the vine rule `phoneNumber()` (`#validators/phone`), `updateProfileValidator` (output matches `TenantProfile`) and `updateDepositSettingsValidator` (output matches `DepositSettings`) in `#modules/tenancy/validators/tenant`.

- [ ] **Step 1: Write the failing phone tests**

```ts
// apps/platform/tests/unit/validators/phone.spec.ts
import { test } from "@japa/runner";
import { normalizePhone } from "#validators/phone";

test.group("normalizePhone", () => {
	for (const [input, expected] of [
		["9812345678", "+9779812345678"],
		["98-1234-5678", "+9779812345678"],
		["01 4123456", "+97714123456"],
		["+977 981 234 5678", "+9779812345678"],
		["00977 9812345678", "+9779812345678"],
		["+1 (415) 555-0100", "+14155550100"],
	] as const) {
		test(`"${input}" becomes ${expected}`, ({ assert }) => {
			assert.equal(normalizePhone(input), expected);
		});
	}

	for (const input of [
		"",
		"12345",
		"98123456781234567",
		"call me",
		"+0 123 456 789",
	]) {
		test(`"${input}" is not a phone number`, ({ assert }) => {
			assert.isUndefined(normalizePhone(input));
		});
	}
});
```

- [ ] **Step 2: Write the failing validator tests**

```ts
// apps/platform/tests/unit/modules/tenancy/profile_validators.spec.ts
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	updateDepositSettingsValidator,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";

/**
 * What the body parser hands over: empty fields are already null
 * (convertEmptyStringsToNull).
 */
const profile = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: null,
};

/**
 * The fields a validator rejects, or [] if it passes.
 */
async function rejectedFields(
	validator: { validate: (data: unknown) => Promise<unknown> },
	data: unknown,
) {
	try {
		await validator.validate(data);
		return [];
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return (error.messages as { field: string }[]).map(({ field }) => field);
		}
		throw error;
	}
}

test.group("updateProfileValidator", () => {
	test("accepts a profile and stores the phone in E.164", async ({ assert }) => {
		const output = await updateProfileValidator.validate(profile);

		assert.equal(output.contactPhone, "+9779812345678");
		assert.isNull(output.facebookUrl);
	});

	test("stores the canonical time zone name", async ({ assert }) => {
		const output = await updateProfileValidator.validate({
			...profile,
			timezone: "asia/katmandu",
		});

		assert.equal(output.timezone, "Asia/Kathmandu");
	});

	test("drops slug, type and tenantId", async ({ assert }) => {
		const output = await updateProfileValidator.validate({
			...profile,
			slug: "stolen",
			type: "independent",
			tenantId: "0199c0de-0000-7000-8000-000000000001",
		});

		assert.notProperty(output, "slug");
		assert.notProperty(output, "type");
		assert.notProperty(output, "tenantId");
	});

	for (const [field, value] of [
		["name", "B"],
		["timezone", "Mars/Olympus_Mons"],
		["intro", "x".repeat(1001)],
		["contactPhone", "12345"],
		["contactEmail", "not-an-email"],
		["address", "x".repeat(301)],
		["instagramUrl", "http://instagram.com/blackneedle"],
		["websiteUrl", "blackneedle.example"],
	] as const) {
		test(`rejects ${field} = "${value.slice(0, 40)}"`, async ({ assert }) => {
			assert.deepEqual(
				await rejectedFields(updateProfileValidator, {
					...profile,
					[field]: value,
				}),
				[field],
			);
		});
	}
});

test.group("updateDepositSettingsValidator", () => {
	test("accepts a whole percentage sent as text", async ({ assert }) => {
		const output = await updateDepositSettingsValidator.validate({
			defaultDepositPercent: "30",
			depositPolicy: "Deposits hold your date.",
		});

		assert.strictEqual(output.defaultDepositPercent, 30);
	});

	test("accepts 0, 100 and no default", async ({ assert }) => {
		for (const value of [0, 100, null]) {
			const output = await updateDepositSettingsValidator.validate({
				defaultDepositPercent: value,
				depositPolicy: null,
			});
			assert.strictEqual(output.defaultDepositPercent, value);
		}
	});

	for (const value of ["101", "-1", "12.5", "half"]) {
		test(`rejects a deposit of "${value}"`, async ({ assert }) => {
			assert.deepEqual(
				await rejectedFields(updateDepositSettingsValidator, {
					defaultDepositPercent: value,
					depositPolicy: null,
				}),
				["defaultDepositPercent"],
			);
		});
	}

	test("rejects a policy over 2000 characters", async ({ assert }) => {
		assert.deepEqual(
			await rejectedFields(updateDepositSettingsValidator, {
				defaultDepositPercent: null,
				depositPolicy: "x".repeat(2001),
			}),
			["depositPolicy"],
		);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test unit --files=tests/unit/validators/phone.spec.ts --files=tests/unit/modules/tenancy/profile_validators.spec.ts`
Expected: FAIL. `#validators/phone`, `updateProfileValidator` and `updateDepositSettingsValidator` don't exist.

- [ ] **Step 4: Implement the phone rule**

```ts
// apps/platform/app/validators/phone.ts
import vine from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";

/**
 * Nepal, where the pilot studios are (database/README.md).
 */
const DEFAULT_COUNTRY_CODE = "977";
const E164 = /^\+[1-9]\d{7,14}$/;
/** A Nepali number without the trunk 0: 8-digit landline to 10-digit mobile. */
const NEPALI_NATIONAL = /^\d{8,10}$/;

/**
 * A phone number in E.164 form ("+9779812345678"), or undefined if it
 * can't be one. Spaces, dashes, dots and brackets are dropped; "00" starts
 * an international number; a number without a country code is Nepali,
 * with its trunk 0 dropped. It checks the shape only, not numbering plans.
 */
export function normalizePhone(value: string): string | undefined {
	const compact = value.replace(/[\s\-.()]/g, "");
	if (compact.startsWith("+")) {
		return E164.test(compact) ? compact : undefined;
	}
	if (compact.startsWith("00")) {
		const international = `+${compact.slice(2)}`;
		return E164.test(international) ? international : undefined;
	}
	const national = compact.replace(/^0/, "");
	return NEPALI_NATIONAL.test(national)
		? `+${DEFAULT_COUNTRY_CODE}${national}`
		: undefined;
}

/**
 * Accepts a phone number the way people type it and stores it in E.164.
 */
export const phoneNumber = vine.createRule(
	(value: unknown, _, field: FieldContext) => {
		const phone = typeof value === "string" ? normalizePhone(value) : undefined;
		if (!phone) {
			field.report(
				"Enter a phone number, like 9812345678 or +977 1 4123456.",
				"phoneNumber",
				field,
			);
			return;
		}
		field.mutate(phone, field);
	},
);
```

- [ ] **Step 5: Implement the two validators**

In `app/modules/tenancy/validators/tenant.ts`, add the import `import { phoneNumber } from "#validators/phone";` and append:

```ts
/**
 * A full link to a profile or site. https only: the storefront links to it.
 */
const httpsUrl = () =>
	vine
		.string()
		.trim()
		.maxLength(500)
		.url({ protocols: ["https"], require_protocol: true });

/**
 * The studio profile form. Every field is sent; an empty one arrives as
 * null and clears the column. Slug and type can't be changed here.
 */
export const updateProfileValidator = vine.create({
	name: vine.string().trim().minLength(2).maxLength(120),
	timezone: vine.string().trim().use(ianaTimezone()),
	intro: vine.string().trim().maxLength(1000).nullable(),
	contactPhone: vine.string().trim().use(phoneNumber()).nullable(),
	contactEmail: vine.string().trim().maxLength(254).email().nullable(),
	address: vine.string().trim().maxLength(300).nullable(),
	instagramUrl: httpsUrl().nullable(),
	facebookUrl: httpsUrl().nullable(),
	tiktokUrl: httpsUrl().nullable(),
	websiteUrl: httpsUrl().nullable(),
});

updateProfileValidator.messagesProvider = new SimpleMessagesProvider(
	{ url: "Enter a full link that starts with https://" },
	{
		name: "business name",
		timezone: "time zone",
		contactPhone: "phone number",
		contactEmail: "email",
	},
);

/**
 * The deposit defaults on the Payments settings page.
 */
export const updateDepositSettingsValidator = vine.create({
	defaultDepositPercent: vine
		.number()
		.withoutDecimals()
		.range([0, 100])
		.nullable(),
	depositPolicy: vine.string().trim().maxLength(2000).nullable(),
});

const DEPOSIT_PERCENT_MESSAGE = "Enter a whole number from 0 to 100.";
updateDepositSettingsValidator.messagesProvider = new SimpleMessagesProvider({
	"defaultDepositPercent.number": DEPOSIT_PERCENT_MESSAGE,
	"defaultDepositPercent.withoutDecimals": DEPOSIT_PERCENT_MESSAGE,
	"defaultDepositPercent.range": DEPOSIT_PERCENT_MESSAGE,
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/platform && PORT=3402 node ace test unit --files=tests/unit/validators/phone.spec.ts --files=tests/unit/modules/tenancy/profile_validators.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform/app/validators/phone.ts apps/platform/app/modules/tenancy/validators/tenant.ts apps/platform/tests/unit/validators/phone.spec.ts apps/platform/tests/unit/modules/tenancy/profile_validators.spec.ts
git commit -m "feat(platform): validate the studio profile and deposit settings" -m "Phone numbers are stored in E.164, with +977 when no country code is given." -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Owner-only settings and the profile page

**Files:**
- Create: `apps/platform/app/middleware/role_middleware.ts`
- Modify: `apps/platform/start/kernel.ts` (named middleware)
- Create: `apps/platform/app/controllers/studio_profile_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Create: `apps/platform/inertia/hooks/use-tenant.ts`
- Create: `apps/platform/inertia/pages/settings/profile.tsx`
- Create (shadcn): `apps/platform/inertia/components/ui/textarea.tsx`
- Modify: `apps/platform/inertia/layouts/settings.tsx`
- Modify: `apps/platform/inertia/layouts/app.tsx`
- Modify (generated): `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Test: `apps/platform/tests/functional/tenancy/studio_profile.spec.ts`

**Interfaces:**
- Consumes: `TenancyService.updateProfile` (Task 1), `updateProfileValidator`, `TIMEZONES` (Task 2), `tenantContext` (`#middleware/tenant_middleware`), `studioWithOwner`, `artistIn` (Task 1).
- Produces: `middleware.role({ allow: MembershipRole[] })`; the nested settings route group (Tasks 6 and 7 add routes to it); route names `tenant.settings`, `tenant.settings.profile`, `tenant.settings.profile.update`; `useTenant()` from `~/hooks/use-tenant`; the `Textarea` component; `settingsNav()` in `inertia/layouts/settings.tsx` (Task 6 adds Payments).

- [ ] **Step 1: Write the failing route-guard test**

In `tests/functional/tenancy/tenant_routes.spec.ts`, add this test after "every /t/:tenant route runs auth, then the tenant check":

```ts
	test("every settings route runs auth, then the tenant check, then owners only", ({
		assert,
	}) => {
		const routes = Object.values(router.toJSON())
			.flat()
			.filter(({ pattern }) => /^\/t\/:tenant\/settings(\/|$)/.test(pattern));
		assert.isNotEmpty(routes);

		for (const route of routes) {
			const entries = [...route.middleware.all()].map((entry) =>
				typeof entry === "function" ? undefined : entry,
			);
			const names = entries.map((entry) => entry?.name);
			const auth = names.indexOf("auth");
			const tenant = names.indexOf("tenant");
			const role = names.indexOf("role");
			assert.isAtLeast(auth, 0, route.pattern);
			assert.isAbove(tenant, auth, route.pattern);
			assert.isAbove(role, tenant, route.pattern);
			assert.deepEqual(entries[role]?.args, { allow: ["owner"] }, route.pattern);
		}
	});
```

- [ ] **Step 2: Write the failing access and profile tests**

```ts
// apps/platform/tests/functional/tenancy/studio_profile.spec.ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * The form as the browser sends it: empty fields are "".
 */
const form = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
};

test.group("Studio settings access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner opens the profile page with the current profile", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get("/t/black-needle/settings/profile")
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/profile");
		assert.equal(response.inertiaProps.profile.name, "Black Needle");
		assert.isNull(response.inertiaProps.profile.intro);
		assert.include(response.inertiaProps.timezones, "Asia/Kathmandu");
	});

	test("/settings opens the profile page", async ({ client }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get("/t/black-needle/settings")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle/settings/profile");
	});

	test("an artist gets 404 on every profile route", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		for (const request of [
			client.get("/t/black-needle/settings"),
			client.get("/t/black-needle/settings/profile"),
			client.put("/t/black-needle/settings/profile").form(form),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.equal((await Tenant.findOrFail(tenant.id)).name, "Black Needle");
	});
});

test.group("Saving the studio profile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner saves the profile, with the phone in E.164", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/profile")
			.form(form)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle/settings/profile");
		response.assertFlashMessage("success", "Profile saved.");
		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.name, "Black Needle Tattoo");
		assert.equal(saved.contactPhone, "+9779812345678");
		assert.equal(saved.instagramUrl, "https://instagram.com/blackneedle");
	});

	test("an emptied field is stored as null", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.put("/t/black-needle/settings/profile")
			.form(form)
			.withCsrfToken()
			.loginAs(owner);

		await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, intro: "", instagramUrl: "" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await Tenant.findOrFail(tenant.id);
		assert.isNull(saved.intro);
		assert.isNull(saved.instagramUrl);
	});

	test("an http:// link comes back as a field error", async ({ client }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, instagramUrl: "http://instagram.com/blackneedle" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"instagramUrl",
			"Enter a full link that starts with https://",
		);
	});

	test("slug, type and tenantId in the body are ignored", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, slug: "stolen", type: "independent", tenantId: "x" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.slug, "black-needle");
		assert.equal(saved.type, "studio");
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/tenancy/tenant_routes.spec.ts --files=tests/functional/tenancy/studio_profile.spec.ts`
Expected: FAIL. The guard test fails on `assert.isNotEmpty(routes)`; the profile tests get 404s from the router.

- [ ] **Step 4: Add the role middleware and register it**

```ts
// apps/platform/app/middleware/role_middleware.ts
import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { tenantContext } from "#middleware/tenant_middleware";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * Lets only members with one of the allowed roles through, e.g.
 * `middleware.role({ allow: ["owner"] })`. Everyone else gets the same 404
 * as an unknown URL, like the tenant middleware, so a URL never reveals
 * that a page exists. Use after the tenant middleware: tenantContext()
 * throws without it.
 */
export default class RoleMiddleware {
	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: { allow: MembershipRole[] },
	) {
		const { membership } = tenantContext(ctx);
		if (!options.allow.includes(membership.role)) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
```

In `start/kernel.ts`, add to `router.named({...})`:

```ts
	role: () => import("#middleware/role_middleware"),
```

- [ ] **Step 5: Add the controller**

```ts
// apps/platform/app/controllers/studio_profile_controller.ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	TIMEZONES,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";

/**
 * The studio's public profile, edited by its owners.
 */
@inject()
export default class StudioProfileController {
	constructor(private tenancy: TenancyService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);

		return ctx.inertia.render("settings/profile", {
			profile: {
				name: tenant.name,
				timezone: tenant.timezone,
				intro: tenant.intro,
				contactPhone: tenant.contactPhone,
				contactEmail: tenant.contactEmail,
				address: tenant.address,
				instagramUrl: tenant.instagramUrl,
				facebookUrl: tenant.facebookUrl,
				tiktokUrl: tenant.tiktokUrl,
				websiteUrl: tenant.websiteUrl,
			},
			timezones: TIMEZONES,
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(updateProfileValidator);

		await this.tenancy.updateProfile(tenant, input);

		ctx.session.flash("success", "Profile saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.profile", { tenant: tenant.slug });
	}
}
```

- [ ] **Step 6: Add the page and its pieces**

Add the shadcn textarea, then format: `cd apps/platform && pnpm dlx shadcn@latest add textarea && cd ../.. && pnpm format:fix`

```ts
// apps/platform/inertia/hooks/use-tenant.ts
import { usePage } from "@inertiajs/react";

/**
 * The current tenant (the shared `tenant` prop) on a /t/:tenant page.
 * Throws anywhere else, so a page can't build URLs without a tenant.
 */
export function useTenant() {
	const { tenant } = usePage().props;
	if (!tenant) {
		throw new Error("useTenant() only works on /t/:tenant pages");
	}
	return tenant;
}
```

```tsx
// apps/platform/inertia/pages/settings/profile.tsx
import { Form } from "@adonisjs/inertia/react";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Profile = {
	name: string;
	timezone: string;
	intro: string | null;
	contactPhone: string | null;
	contactEmail: string | null;
	address: string | null;
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	websiteUrl: string | null;
};

const SOCIAL_LINKS = [
	{
		name: "instagramUrl",
		label: "Instagram",
		placeholder: "https://instagram.com/yourstudio",
	},
	{
		name: "facebookUrl",
		label: "Facebook",
		placeholder: "https://facebook.com/yourstudio",
	},
	{
		name: "tiktokUrl",
		label: "TikTok",
		placeholder: "https://tiktok.com/@yourstudio",
	},
	{ name: "websiteUrl", label: "Website", placeholder: "https://yourstudio.com" },
] as const;

export default function StudioProfile({
	profile,
	timezones,
}: {
	profile: Profile;
	timezones: string[];
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.settings.profile.update"
			routeParams={{ tenant: tenant.slug }}
		>
			{({ errors, processing }) => (
				<>
					<Section title="Business">
						<FieldGroup>
							<Field data-invalid={!!errors.name}>
								<FieldLabel htmlFor="name">Business name</FieldLabel>
								<Input
									id="name"
									name="name"
									autoComplete="organization"
									defaultValue={profile.name}
									aria-invalid={!!errors.name}
								/>
								{errors.name && <FieldError>{errors.name}</FieldError>}
							</Field>

							<Field data-invalid={!!errors.timezone}>
								<FieldLabel htmlFor="timezone">Time zone</FieldLabel>
								<Select name="timezone" defaultValue={profile.timezone}>
									<SelectTrigger
										id="timezone"
										className="w-full"
										aria-invalid={!!errors.timezone}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{timezones.map((zone) => (
											<SelectItem key={zone} value={zone}>
												{zone.replaceAll("_", " ")}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<FieldDescription>
									Session times and reminders use this time zone.
								</FieldDescription>
								{errors.timezone && <FieldError>{errors.timezone}</FieldError>}
							</Field>

							<Field data-invalid={!!errors.intro}>
								<FieldLabel htmlFor="intro">Intro</FieldLabel>
								<Textarea
									id="intro"
									name="intro"
									rows={4}
									maxLength={1000}
									defaultValue={profile.intro ?? ""}
									placeholder="What you tattoo, and what clients can expect."
									aria-invalid={!!errors.intro}
								/>
								<FieldDescription>
									Shown on your booking page. Up to 1000 characters.
								</FieldDescription>
								{errors.intro && <FieldError>{errors.intro}</FieldError>}
							</Field>
						</FieldGroup>
					</Section>

					<Section
						title="Contact"
						description="Shown on your booking page so clients can reach you."
					>
						<FieldGroup>
							<Field data-invalid={!!errors.contactPhone}>
								<FieldLabel htmlFor="contactPhone">Phone</FieldLabel>
								<Input
									id="contactPhone"
									name="contactPhone"
									type="tel"
									autoComplete="tel"
									defaultValue={profile.contactPhone ?? ""}
									placeholder="98XXXXXXXX"
									aria-invalid={!!errors.contactPhone}
								/>
								<FieldDescription>
									Nepali numbers don&apos;t need +977.
								</FieldDescription>
								{errors.contactPhone && (
									<FieldError>{errors.contactPhone}</FieldError>
								)}
							</Field>

							<Field data-invalid={!!errors.contactEmail}>
								<FieldLabel htmlFor="contactEmail">Email</FieldLabel>
								<Input
									id="contactEmail"
									name="contactEmail"
									type="email"
									autoComplete="email"
									defaultValue={profile.contactEmail ?? ""}
									aria-invalid={!!errors.contactEmail}
								/>
								{errors.contactEmail && (
									<FieldError>{errors.contactEmail}</FieldError>
								)}
							</Field>

							<Field data-invalid={!!errors.address}>
								<FieldLabel htmlFor="address">Address</FieldLabel>
								<Textarea
									id="address"
									name="address"
									rows={2}
									maxLength={300}
									autoComplete="street-address"
									defaultValue={profile.address ?? ""}
									aria-invalid={!!errors.address}
								/>
								{errors.address && <FieldError>{errors.address}</FieldError>}
							</Field>
						</FieldGroup>
					</Section>

					<Section title="Social links">
						<FieldGroup>
							{SOCIAL_LINKS.map((link) => (
								<Field key={link.name} data-invalid={!!errors[link.name]}>
									<FieldLabel htmlFor={link.name}>{link.label}</FieldLabel>
									<Input
										id={link.name}
										name={link.name}
										type="url"
										defaultValue={profile[link.name] ?? ""}
										placeholder={link.placeholder}
										aria-invalid={!!errors[link.name]}
									/>
									{errors[link.name] && (
										<FieldError>{errors[link.name]}</FieldError>
									)}
								</Field>
							))}
						</FieldGroup>
					</Section>

					<Button type="submit" className="mt-6" disabled={processing}>
						{processing ? "Saving…" : "Save profile"}
					</Button>
				</>
			)}
		</Form>
	);
}

StudioProfile.layout = [AppLayout, SettingsLayout];
```

Replace `inertia/layouts/settings.tsx` with:

```tsx
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Store } from "lucide-react";
import type { ReactNode } from "react";
import NavLink, { type NavItem } from "~/components/nav_link";
import Page from "~/components/page";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * The studio settings pages, listed in the sidebar. Add an entry for each
 * new settings page; links point at the current tenant.
 */
function settingsNav(tenantSlug: string): NavItem[] {
	const params = { tenant: tenantSlug };
	return [
		{
			label: "Studio profile",
			route: "tenant.settings.profile",
			params,
			icon: Store,
		},
	];
}

/**
 * Renders the settings heading, a sidebar of links and a card holding the
 * current page. Nest it under the app layout from each settings page:
 *
 * `Profile.layout = [AppLayout, SettingsLayout]`
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	const { tenant } = usePage().props;
	const items = tenant ? settingsNav(tenant.slug) : [];

	return (
		<Page
			title="Studio settings"
			description="Your studio's public details and how clients pay you."
		>
			<div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6">
				<nav
					className="flex gap-1 overflow-x-auto md:flex-col"
					aria-label="Settings"
				>
					{items.map(({ label, route, params, icon: Icon }) => (
						<NavLink
							key={label}
							route={route}
							params={params}
							className={cn(
								buttonVariants({ variant: "ghost", size: "sm" }),
								"justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
							)}
						>
							{Icon && <Icon data-icon="inline-start" />}
							{label}
						</NavLink>
					))}
				</nav>
				<Card>
					<CardContent>{children}</CardContent>
				</Card>
			</div>
		</Page>
	);
}
```

In `inertia/layouts/app.tsx`, import `Settings` from `lucide-react` and replace `tenantNav` and its call:

```tsx
/**
 * Navigation inside a tenant. Add an entry here for every new area of the
 * dashboard; links point at the current tenant (/t/:tenant/...).
 */
function tenantNav(tenant: { slug: string; role: string }): NavItem[] {
	const params = { tenant: tenant.slug };
	const items: NavItem[] = [
		{
			label: "Dashboard",
			route: "tenant.dashboard",
			params,
			exact: true,
			icon: House,
		},
	];
	// Owners only; the server 404s anyone else.
	if (tenant.role === "owner") {
		items.push({
			label: "Settings",
			route: "tenant.settings",
			params,
			icon: Settings,
		});
	}
	return items;
}
```

and `const nav = tenant ? tenantNav(tenant) : [];`.

- [ ] **Step 7: Add the routes and regenerate**

Run `cd apps/platform && node ace codegen` first so `controllers.StudioProfile` exists. Then, in `start/routes.ts`, replace the `/t/:tenant` group with:

```ts
/**
 * Pages of one tenant. The tenant middleware checks the user's membership
 * on every request and 404s anyone else; read the tenant with
 * tenantContext(ctx). Every tenant route goes in this group (a test checks).
 */
router
	.group(() => {
		router.on("/").renderInertia("dashboard", {}).as("tenant.dashboard");

		/**
		 * Studio settings, owners only: artists get the same 404 as an
		 * unknown URL. Every settings route goes in this group (a test
		 * checks).
		 */
		router
			.group(() => {
				router.on("/").redirect("tenant.settings.profile").as("tenant.settings");
				router
					.get("profile", [controllers.StudioProfile, "show"])
					.as("tenant.settings.profile");
				router
					.put("profile", [controllers.StudioProfile, "update"])
					.as("tenant.settings.profile.update");
			})
			.prefix("/settings")
			.use(middleware.role({ allow: ["owner"] }));
	})
	.prefix("/t/:tenant")
	.use([middleware.auth(), middleware.tenant()]);
```

Run `node ace codegen` again for the route names.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/tenancy/tenant_routes.spec.ts --files=tests/functional/tenancy/studio_profile.spec.ts`
Expected: PASS.

Run: `cd apps/platform && pnpm typecheck`
Expected: no errors. If `inertia.render("settings/profile", …)` complains about prop types, make the controller's object match the page's `Profile` type exactly. Don't loosen the page type.

- [ ] **Step 9: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform
git commit -m "feat(platform): owner-only studio settings with the profile page" -m "A named role middleware 404s members without an allowed role, like the tenant check. TAT-30 reuses it." -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `payments` module: table, model and kind rules

**Files:**
- Create: `apps/platform/database/migrations/1791560000001_create_payment_methods_table.ts`
- Modify (generated): `apps/platform/database/schema.ts`
- Create: `apps/platform/app/modules/payments/models/payment_method.ts`
- Create: `apps/platform/app/modules/payments/rules.ts`
- Create: `apps/platform/app/modules/payments/errors.ts`
- Test: `apps/platform/tests/unit/modules/payments/rules.spec.ts`

**Interfaces:**
- Produces:
  - `PAYMENT_METHOD_KINDS`, `type PaymentMethodKind`, and the `PaymentMethod` model with `withSoftDeletes`. Its attributes are `id`, `tenantId`, `kind`, `label`, `accountName`, `accountNumber`, `bankName`, `qrImageKey`, `showOnDepositPage`, `position`, `createdAt`, `updatedAt` and `deletedAt`.
  - In `#modules/payments/rules`: `type DetailField = "accountName" | "accountNumber" | "bankName"`, `type PaymentMethodState`, `type RuleViolation = { field: "qr" | DetailField | "showOnDepositPage"; message: string }`, `KIND_NAMES`, `kindDetails(kind, input): Record<DetailField, string | null>` and `checkPaymentMethod(state): RuleViolation[]`.
  - `PaymentMethodRuleError` with `violations: RuleViolation[]` (`#modules/payments/errors`).

- [ ] **Step 1: Write the migration and run it**

```ts
// apps/platform/database/migrations/1791560000001_create_payment_methods_table.ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The ways a studio gets paid (TAT-26). Which fields each kind needs is
 * checked by PaymentMethodService, not here.
 */
export default class extends BaseSchema {
	protected tableName = "payment_methods";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table
				.enum("kind", ["fonepay", "esewa", "khalti", "bank", "cash"])
				.notNullable();
			table.string("label", 80).notNullable();
			table.string("account_name", 120).nullable();
			// The bank account number, or the eSewa/Khalti wallet ID.
			table.string("account_number", 64).nullable();
			table.string("bank_name", 120).nullable();
			table.string("qr_image_key", 255).nullable();
			table.boolean("show_on_deposit_page").notNullable().defaultTo(false);
			table.integer("position").notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			// A tenant's methods, in the owner's order.
			table.index(["tenant_id", "position"]);
		});
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
```

Run: `cd apps/platform && node ace migration:run`
Expected: `database/schema.ts` gains `PaymentMethodSchema`.

- [ ] **Step 2: Add the model and the error**

```ts
// apps/platform/app/modules/payments/models/payment_method.ts
import { compose } from "@adonisjs/core/helpers";
import { PaymentMethodSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const PAYMENT_METHOD_KINDS = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
	"cash",
] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/**
 * A way the studio gets paid. Read and change methods through
 * PaymentMethodService, not from other modules directly.
 */
export default class PaymentMethod extends compose(
	PaymentMethodSchema,
	withSoftDeletes,
) {
	declare kind: PaymentMethodKind;
}
```

```ts
// apps/platform/app/modules/payments/errors.ts
import type { RuleViolation } from "#modules/payments/rules";

/**
 * A payment method that breaks its kind's rules (see checkPaymentMethod).
 * Each violation's message is written for the user: show it as a field
 * error on its field.
 */
export class PaymentMethodRuleError extends Error {
	constructor(readonly violations: RuleViolation[]) {
		super(violations.map(({ message }) => message).join(" "));
		this.name = "PaymentMethodRuleError";
	}
}
```

- [ ] **Step 3: Write the failing rule tests**

```ts
// apps/platform/tests/unit/modules/payments/rules.spec.ts
import { test } from "@japa/runner";
import {
	checkPaymentMethod,
	kindDetails,
	type PaymentMethodState,
} from "#modules/payments/rules";

const none = {
	accountName: null,
	accountNumber: null,
	bankName: null,
	hasQr: false,
	showOnDepositPage: false,
};
const bankDetails = {
	bankName: "Nabil Bank",
	accountName: "Black Needle Pvt. Ltd.",
	accountNumber: "0123456789",
};

test.group("checkPaymentMethod", () => {
	const cases: [string, PaymentMethodState, string[]][] = [
		["fonepay with a QR", { ...none, kind: "fonepay", hasQr: true }, []],
		[
			"fonepay with a QR, on the deposit page",
			{ ...none, kind: "fonepay", hasQr: true, showOnDepositPage: true },
			[],
		],
		["fonepay without a QR", { ...none, kind: "fonepay" }, ["qr"]],
		["esewa with only a QR", { ...none, kind: "esewa", hasQr: true }, []],
		[
			"esewa with only a wallet ID",
			{ ...none, kind: "esewa", accountNumber: "9812345678" },
			[],
		],
		["esewa with neither", { ...none, kind: "esewa" }, ["qr"]],
		[
			"khalti with only a wallet ID",
			{ ...none, kind: "khalti", accountNumber: "9812345678" },
			[],
		],
		["khalti with neither", { ...none, kind: "khalti" }, ["qr"]],
		["bank with every detail", { ...none, kind: "bank", ...bankDetails }, []],
		[
			"bank with every detail and a QR",
			{ ...none, kind: "bank", ...bankDetails, hasQr: true },
			[],
		],
		[
			"bank with nothing",
			{ ...none, kind: "bank" },
			["bankName", "accountName", "accountNumber"],
		],
		[
			"bank without an account number",
			{ ...none, kind: "bank", ...bankDetails, accountNumber: null },
			["accountNumber"],
		],
		["cash", { ...none, kind: "cash" }, []],
		[
			"cash on the deposit page",
			{ ...none, kind: "cash", showOnDepositPage: true },
			["showOnDepositPage"],
		],
		["cash with a QR", { ...none, kind: "cash", hasQr: true }, ["qr"]],
	];

	for (const [name, state, fields] of cases) {
		test(name, ({ assert }) => {
			assert.deepEqual(
				checkPaymentMethod(state).map(({ field }) => field),
				fields,
			);
		});
	}

	test("messages name the kind", ({ assert }) => {
		assert.deepEqual(checkPaymentMethod({ ...none, kind: "esewa" }), [
			{ field: "qr", message: "Add a QR code or your eSewa ID." },
		]);
		assert.deepEqual(checkPaymentMethod({ ...none, kind: "fonepay" }), [
			{ field: "qr", message: "Upload your Fonepay QR code." },
		]);
		assert.deepEqual(
			checkPaymentMethod({ ...none, kind: "cash", hasQr: true }),
			[{ field: "qr", message: "Cash doesn't take a QR code." }],
		);
	});
});

test.group("kindDetails", () => {
	const everything = {
		accountName: "Black Needle",
		accountNumber: "0123456789",
		bankName: "Nabil Bank",
	};

	test("fonepay and cash keep no details", ({ assert }) => {
		for (const kind of ["fonepay", "cash"] as const) {
			assert.deepEqual(kindDetails(kind, everything), {
				accountName: null,
				accountNumber: null,
				bankName: null,
			});
		}
	});

	test("esewa and khalti keep the wallet ID and account name", ({ assert }) => {
		for (const kind of ["esewa", "khalti"] as const) {
			assert.deepEqual(kindDetails(kind, everything), {
				accountName: "Black Needle",
				accountNumber: "0123456789",
				bankName: null,
			});
		}
	});

	test("bank keeps every detail, and missing ones become null", ({
		assert,
	}) => {
		assert.deepEqual(kindDetails("bank", everything), everything);
		assert.deepEqual(kindDetails("bank", {}), {
			accountName: null,
			accountNumber: null,
			bankName: null,
		});
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test unit --files=tests/unit/modules/payments/rules.spec.ts`
Expected: FAIL. `#modules/payments/rules` doesn't exist.

- [ ] **Step 5: Implement the rules**

```ts
// apps/platform/app/modules/payments/rules.ts
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";

export type DetailField = "accountName" | "accountNumber" | "bankName";
const DETAIL_FIELDS: DetailField[] = ["accountName", "accountNumber", "bankName"];

export const KIND_NAMES: Record<PaymentMethodKind, string> = {
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
	bank: "Bank transfer",
	cash: "Cash",
};

/**
 * The details each kind keeps. eSewa and Khalti keep their wallet ID in
 * accountNumber, so that column is always "the number a client pays to".
 */
const KIND_FIELDS: Record<PaymentMethodKind, readonly DetailField[]> = {
	fonepay: [],
	esewa: ["accountNumber", "accountName"],
	khalti: ["accountNumber", "accountName"],
	bank: ["bankName", "accountName", "accountNumber"],
	cash: [],
};

const QR_KINDS: readonly PaymentMethodKind[] = ["fonepay", "esewa", "khalti", "bank"];

/**
 * A payment method as it will be saved: after a new upload, with a QR
 * that's kept, or with one that's removed.
 */
export type PaymentMethodState = {
	kind: PaymentMethodKind;
	accountName: string | null;
	accountNumber: string | null;
	bankName: string | null;
	hasQr: boolean;
	showOnDepositPage: boolean;
};

export type RuleViolation = {
	field: "qr" | DetailField | "showOnDepositPage";
	message: string;
};

/**
 * The kind's own details from `input`; the others are null, so a row
 * never hides details its kind doesn't show.
 */
export function kindDetails(
	kind: PaymentMethodKind,
	input: Partial<Record<DetailField, string | null>>,
): Record<DetailField, string | null> {
	const kept = KIND_FIELDS[kind];
	const details = {} as Record<DetailField, string | null>;
	for (const field of DETAIL_FIELDS) {
		details[field] = kept.includes(field) ? (input[field] ?? null) : null;
	}
	return details;
}

/**
 * Every rule the method breaks, with a message for the user. Empty means
 * it can be saved.
 */
export function checkPaymentMethod(state: PaymentMethodState): RuleViolation[] {
	const violations: RuleViolation[] = [];
	const name = KIND_NAMES[state.kind];

	if (state.hasQr && !QR_KINDS.includes(state.kind)) {
		violations.push({ field: "qr", message: `${name} doesn't take a QR code.` });
	}

	switch (state.kind) {
		case "fonepay":
			if (!state.hasQr) {
				violations.push({ field: "qr", message: "Upload your Fonepay QR code." });
			}
			break;
		case "esewa":
		case "khalti":
			if (!state.hasQr && !state.accountNumber) {
				violations.push({
					field: "qr",
					message: `Add a QR code or your ${name} ID.`,
				});
			}
			break;
		case "bank":
			if (!state.bankName) {
				violations.push({ field: "bankName", message: "Enter the bank's name." });
			}
			if (!state.accountName) {
				violations.push({
					field: "accountName",
					message: "Enter the name on the account.",
				});
			}
			if (!state.accountNumber) {
				violations.push({
					field: "accountNumber",
					message: "Enter the account number.",
				});
			}
			break;
		case "cash":
			if (state.showOnDepositPage) {
				violations.push({
					field: "showOnDepositPage",
					message: "Cash can't be paid on the deposit page.",
				});
			}
			break;
	}

	return violations;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/platform && PORT=3402 node ace test unit --files=tests/unit/modules/payments/rules.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform/database apps/platform/app/modules/payments apps/platform/tests/unit/modules/payments
git commit -m "feat(platform): add payment methods and their kind rules" -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `PaymentMethodService` with the QR file lifecycle

**Files:**
- Create: `apps/platform/app/modules/payments/services/payment_method_service.ts`
- Modify: `apps/platform/tests/helpers/images.ts` (add `uploadOf`)
- Test: `apps/platform/tests/functional/payments/payment_method_service.spec.ts`

**Interfaces:**
- Consumes: `PaymentMethod`, `PaymentMethodKind`, `kindDetails`, `checkPaymentMethod`, `PaymentMethodRuleError` (Task 4); `ImageService` (`store`, `delete`); `studioWithOwner` (Task 1); `testImages`.
- Produces:
  - Types: `Upload = Pick<MultipartFile, "tmpPath">`; `NewPaymentMethod = { kind; label; accountName?; accountNumber?; bankName?; showOnDepositPage?; qr? }`; `PaymentMethodChanges = Omit<NewPaymentMethod, "kind"> & { removeQr?: boolean }`.
  - `list(tenant): Promise<PaymentMethod[]>` and `findFor(tenant, id): Promise<PaymentMethod>` (throws `E_ROW_NOT_FOUND`).
  - `create(tenant, input: NewPaymentMethod): Promise<PaymentMethod>` and `update(tenant, method, input: PaymentMethodChanges): Promise<PaymentMethod>`.
  - `move(tenant, method, direction: "up" | "down"): Promise<void>` and `delete(tenant, method): Promise<void>`.
  - The test helper `uploadOf(data: Buffer): Promise<{ tmpPath: string }>`.

- [ ] **Step 1: Add the upload helper**

Append to `tests/helpers/images.ts` (with imports `import { randomUUID } from "node:crypto";`, `import { mkdir, writeFile } from "node:fs/promises";`, `import app from "@adonisjs/core/services/app";`):

```ts
/**
 * What the body parser hands a service: the upload written to a temp file,
 * under tmp/storage, which the test hooks clear.
 */
export async function uploadOf(data: Buffer) {
	await mkdir(app.tmpPath("storage/uploads"), { recursive: true });
	const tmpPath = app.tmpPath("storage/uploads", randomUUID());
	await writeFile(tmpPath, data);
	return { tmpPath };
}
```

- [ ] **Step 2: Write the failing service tests**

```ts
// apps/platform/tests/functional/payments/payment_method_service.spec.ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import { PaymentMethodRuleError } from "#modules/payments/errors";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * ImageService that remembers every key it stored, so a test can check
 * that a file from a failed save was removed.
 */
class RecordingImageService extends ImageService {
	keys: string[] = [];

	override async store(...args: Parameters<ImageService["store"]>) {
		const stored = await super.store(...args);
		this.keys.push(stored.key);
		return stored;
	}
}

function makeService() {
	const images = new RecordingImageService();
	return { images, methods: new PaymentMethodService(images) };
}

const qr = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

async function violationsOf(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (error) {
		if (error instanceof PaymentMethodRuleError) {
			return error.violations.map(({ field }) => field);
		}
		throw error;
	}
	throw new Error("expected a PaymentMethodRuleError");
}

const labels = (methods: PaymentMethod[]) => methods.map(({ label }) => label);

test.group("PaymentMethodService files", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the QR on the public disk and keeps its key", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});

		assert.match(
			method.qrImageKey ?? "",
			new RegExp(`^tenants/${tenant.id}/payment_qr/`),
		);
		assert.isTrue(await exists(method.qrImageKey ?? ""));
		assert.equal(method.position, 0);
		assert.isFalse(method.showOnDepositPage);
	});

	test("create checks the rules before storing anything", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();

		assert.deepEqual(
			await violationsOf(() =>
				methods.create(tenant, { kind: "fonepay", label: "Fonepay" }),
			),
			["qr"],
		);
		assert.deepEqual(
			await violationsOf(() =>
				methods.create(tenant, {
					kind: "cash",
					label: "Cash",
					showOnDepositPage: true,
				}),
			),
			["showOnDepositPage"],
		);
		assert.isEmpty(images.keys);
	});

	test("a failed create leaves no file behind", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();

		// Over the column's 80 characters: Postgres rejects the insert.
		await assert.rejects(() =>
			methods.create(tenant, {
				kind: "fonepay",
				label: "x".repeat(81),
				qr: await qr(),
			}),
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await exists(images.keys[0]));
	});

	test("only the kind's own details are saved", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		const method = await methods.create(tenant, {
			kind: "esewa",
			label: "eSewa",
			accountNumber: "9812345678",
			bankName: "Nabil Bank",
		});

		assert.equal(method.accountNumber, "9812345678");
		assert.isNull(method.bankName);
	});

	test("an edit without a new upload keeps the QR", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		await methods.update(tenant, method, { label: "Fonepay (Nabil)" });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.label, "Fonepay (Nabil)");
		assert.equal(saved.qrImageKey, key);
		assert.isTrue(await exists(key));
	});

	test("replacing a QR deletes the old file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";

		await methods.update(tenant, method, { label: "Fonepay", qr: await qr() });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.notEqual(saved.qrImageKey, oldKey);
		assert.isTrue(await exists(saved.qrImageKey ?? ""));
		assert.isFalse(await exists(oldKey));
	});

	test("removing a bank QR deletes its file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "bank",
			label: "Bank transfer",
			bankName: "Nabil Bank",
			accountName: "Black Needle",
			accountNumber: "0123456789",
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		await methods.update(tenant, method, {
			label: "Bank transfer",
			bankName: "Nabil Bank",
			accountName: "Black Needle",
			accountNumber: "0123456789",
			removeQr: true,
		});

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.isNull(saved.qrImageKey);
		assert.isFalse(await exists(key));
	});

	test("removing a Fonepay QR is refused and keeps the file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		assert.deepEqual(
			await violationsOf(() =>
				methods.update(tenant, method, { label: "Fonepay", removeQr: true }),
			),
			["qr"],
		);

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.qrImageKey, key);
		assert.isTrue(await exists(key));
	});

	test("a failed edit keeps the old QR and removes the new upload", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";

		await assert.rejects(() =>
			methods.update(tenant, method, {
				label: "x".repeat(81),
				qr: await qr(),
			}),
		);

		const newKey = images.keys[1];
		assert.isFalse(await exists(newKey));
		assert.isTrue(await exists(oldKey));
		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.qrImageKey, oldKey);
	});

	test("soft delete keeps the file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});

		await methods.delete(tenant, method);

		assert.isNull(await PaymentMethod.find(method.id));
		assert.isTrue(await exists(method.qrImageKey ?? ""));
	});
});

test.group("PaymentMethodService lists and order", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const cash = (label: string) => ({ kind: "cash" as const, label });

	test("list and findFor only see the tenant's live methods", async ({
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { tenant: redInk } = await studioWithOwner("red-ink", "Red Ink");
		const { methods } = makeService();
		const kept = await methods.create(blackNeedle, cash("Kept"));
		const deleted = await methods.create(blackNeedle, cash("Deleted"));
		const theirs = await methods.create(redInk, cash("Theirs"));
		await methods.delete(blackNeedle, deleted);

		assert.deepEqual(labels(await methods.list(blackNeedle)), ["Kept"]);
		assert.equal((await methods.findFor(blackNeedle, kept.id)).id, kept.id);
		await assert.rejects(() => methods.findFor(blackNeedle, theirs.id));
		await assert.rejects(() => methods.findFor(blackNeedle, deleted.id));
	});

	test("a new method goes last", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		await methods.create(tenant, cash("A"));
		await methods.create(tenant, cash("B"));
		await methods.create(tenant, cash("C"));

		assert.deepEqual(labels(await methods.list(tenant)), ["A", "B", "C"]);
	});

	test("move swaps with the nearest live neighbour", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));
		const c = await methods.create(tenant, cash("C"));
		await methods.delete(tenant, b);

		await methods.move(tenant, c, "up");
		assert.deepEqual(labels(await methods.list(tenant)), ["C", "A"]);

		await methods.move(tenant, await methods.findFor(tenant, c.id), "down");
		assert.deepEqual(labels(await methods.list(tenant)), ["A", "C"]);
	});

	test("moving past either end changes nothing", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const a = await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));

		await methods.move(tenant, a, "up");
		await methods.move(tenant, b, "down");

		assert.deepEqual(labels(await methods.list(tenant)), ["A", "B"]);
	});

	test("methods that share a position still move", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));
		// Two adds at the same moment can get the same position.
		await PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.update({ position: 5 });

		await methods.move(tenant, b, "up");

		assert.deepEqual(labels(await methods.list(tenant)), ["B", "A"]);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payment_method_service.spec.ts`
Expected: FAIL. `#modules/payments/services/payment_method_service` doesn't exist.

- [ ] **Step 4: Implement the service**

```ts
// apps/platform/app/modules/payments/services/payment_method_service.ts
import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import db from "@adonisjs/lucid/services/db";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { PaymentMethodRuleError } from "#modules/payments/errors";
import PaymentMethod, {
	type PaymentMethodKind,
} from "#modules/payments/models/payment_method";
import {
	checkPaymentMethod,
	kindDetails,
	type PaymentMethodState,
} from "#modules/payments/rules";
import type Tenant from "#modules/tenancy/models/tenant";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

export type NewPaymentMethod = {
	kind: PaymentMethodKind;
	label: string;
	accountName?: string | null;
	accountNumber?: string | null;
	bankName?: string | null;
	showOnDepositPage?: boolean;
	qr?: Upload;
};

/**
 * An edit. The kind is fixed; without `qr` or `removeQr` the stored QR
 * stays.
 */
export type PaymentMethodChanges = Omit<NewPaymentMethod, "kind"> & {
	removeQr?: boolean;
};

const QR = "payment_qr";

/**
 * The way to read and change a studio's payment methods. Every call is
 * scoped to the tenant. Kind rules come from checkPaymentMethod; QR files
 * are stored through ImageService and cleaned up here.
 */
@inject()
export default class PaymentMethodService {
	constructor(private images: ImageService) {}

	/**
	 * The tenant's live methods, in the owner's order.
	 */
	async list(tenant: TenantRef): Promise<PaymentMethod[]> {
		return PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.orderBy("position", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's live method with this id. An unknown id, a deleted method
	 * and another tenant's method all throw E_ROW_NOT_FOUND (a 404), so
	 * callers can't tell them apart.
	 */
	async findFor(tenant: TenantRef, id: string): Promise<PaymentMethod> {
		return PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * Adds a method at the end of the list. Throws PaymentMethodRuleError
	 * before storing anything if it breaks its kind's rules.
	 */
	async create(
		tenant: TenantRef,
		input: NewPaymentMethod,
	): Promise<PaymentMethod> {
		const details = kindDetails(input.kind, input);
		const showOnDepositPage = input.showOnDepositPage ?? false;
		assertRules({
			kind: input.kind,
			...details,
			hasQr: !!input.qr,
			showOnDepositPage,
		});

		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		try {
			return await db.transaction(async (trx) => {
				const last = await trx
					.from("payment_methods")
					.where("tenant_id", tenant.id)
					.whereNull("deleted_at")
					.max("position as max")
					.first();
				return PaymentMethod.create(
					{
						tenantId: tenant.id,
						kind: input.kind,
						label: input.label,
						...details,
						showOnDepositPage,
						qrImageKey: qr?.key ?? null,
						// The first method gets 0. Ties from two adds at once are
						// harmless: move() renumbers.
						position: (last?.max ?? -1) + 1,
					},
					{ client: trx },
				);
			});
		} catch (error) {
			if (qr) await this.images.delete(QR, qr.key);
			throw error;
		}
	}

	/**
	 * Saves an edit. A new `qr` replaces the stored one; `removeQr` drops
	 * it. The old file is deleted once the row is saved.
	 */
	async update(
		tenant: TenantRef,
		method: PaymentMethod,
		input: PaymentMethodChanges,
	): Promise<PaymentMethod> {
		if (method.tenantId !== tenant.id) {
			throw new Error(`Payment method ${method.id} belongs to another tenant`);
		}
		const details = kindDetails(method.kind, input);
		const showOnDepositPage = input.showOnDepositPage ?? false;
		const oldKey = method.qrImageKey;
		const keepsQr = !!oldKey && !input.qr && !input.removeQr;
		assertRules({
			kind: method.kind,
			...details,
			hasQr: !!input.qr || keepsQr,
			showOnDepositPage,
		});

		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		const newKey = qr ? qr.key : keepsQr ? oldKey : null;
		try {
			method.merge({
				label: input.label,
				...details,
				showOnDepositPage,
				qrImageKey: newKey,
			});
			await method.save();
		} catch (error) {
			if (qr) await this.images.delete(QR, qr.key);
			throw error;
		}

		if (oldKey && oldKey !== newKey) await this.images.delete(QR, oldKey);
		return method;
	}

	/**
	 * Swaps the method with its live neighbour. The whole list is renumbered
	 * from 0 in the new order, so gaps from deletes and ties from two adds
	 * at once fix themselves. Past either end, nothing changes.
	 */
	async move(
		tenant: TenantRef,
		method: PaymentMethod,
		direction: "up" | "down",
	): Promise<void> {
		await db.transaction(async (trx) => {
			const methods = await PaymentMethod.query({ client: trx })
				.where("tenant_id", tenant.id)
				.orderBy("position", "asc")
				.orderBy("id", "asc")
				.forUpdate();
			const from = methods.findIndex(({ id }) => id === method.id);
			const to = direction === "up" ? from - 1 : from + 1;
			if (from === -1 || to < 0 || to >= methods.length) return;

			[methods[from], methods[to]] = [methods[to], methods[from]];
			for (const [position, each] of methods.entries()) {
				if (each.position === position) continue;
				each.position = position;
				await each.save();
			}
		});
	}

	/**
	 * Soft-deletes the method. Its QR file stays, like every soft-deleted
	 * record's files.
	 */
	async delete(tenant: TenantRef, method: PaymentMethod): Promise<void> {
		if (method.tenantId !== tenant.id) {
			throw new Error(`Payment method ${method.id} belongs to another tenant`);
		}
		await method.softDelete();
	}
}

function assertRules(state: PaymentMethodState) {
	const violations = checkPaymentMethod(state);
	if (violations.length > 0) throw new PaymentMethodRuleError(violations);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payment_method_service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform/app/modules/payments apps/platform/tests/helpers/images.ts apps/platform/tests/functional/payments
git commit -m "feat(platform): add PaymentMethodService" -m "Stores QR codes through ImageService, removes a new file if the save fails and the old one after a replace, and keeps files on soft delete." -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Payments page: deposits, list, reorder and delete

**Files:**
- Create: `apps/platform/app/controllers/deposit_settings_controller.ts`
- Create: `apps/platform/app/controllers/payment_methods_controller.ts`
- Create: `apps/platform/app/modules/payments/validators/payment_method.ts` (move validator only here; Task 7 adds the rest)
- Modify: `apps/platform/start/routes.ts`
- Create: `apps/platform/inertia/components/payment_methods.ts`
- Create: `apps/platform/inertia/pages/settings/payments.tsx`
- Modify: `apps/platform/inertia/layouts/settings.tsx` (Payments link)
- Modify (generated): `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/payments/payments_page.spec.ts`

**Interfaces:**
- Consumes: `PaymentMethodService` (Task 5); `TenancyService.updateDepositSettings` (Task 1); `updateDepositSettingsValidator` (Task 2); the settings route group, `useTenant`, `Textarea`, `settingsNav` (Task 3).
- Produces:
  - Route names `tenant.settings.payments`, `tenant.settings.deposits.update`, `tenant.settings.payments.move` and `tenant.settings.payments.destroy`.
  - `PaymentMethodsController` with `index`, `move`, `destroy` and a private `toProps(method)`.
  - `movePaymentMethodValidator`.
  - From `~/components/payment_methods`: the `PaymentMethodProps` type, `kindCopy(kind)`, `fieldLabel(kind, field)` and `type DetailField`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/platform/tests/functional/payments/payments_page.spec.ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import Tenant from "#modules/tenancy/models/tenant";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const methods = new PaymentMethodService(new ImageService());
const cash = (label: string) => ({ kind: "cash" as const, label });
const labels = (list: PaymentMethod[]) => list.map(({ label }) => label);

test.group("Payments page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the deposit settings and the methods in order", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			showOnDepositPage: true,
			qr: await uploadOf(await testImages.png()),
		});
		await methods.create(tenant, cash("Cash"));

		const response = await client
			.get("/t/black-needle/settings/payments")
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/payments");
		const props = response.inertiaProps;
		assert.deepEqual(props.deposits, {
			defaultDepositPercent: null,
			depositPolicy: null,
		});
		assert.deepEqual(
			props.methods.map((method: { label: string }) => method.label),
			["Fonepay", "Cash"],
		);
		assert.isTrue(props.methods[0].showOnDepositPage);
		assert.match(
			new URL(props.methods[0].qrUrl).pathname,
			/^\/uploads\/tenants\//,
		);
		assert.isNull(props.methods[1].qrUrl);
	});

	test("an owner saves the deposit settings", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/deposits")
			.form({ defaultDepositPercent: "30", depositPolicy: "Holds your date." })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/settings/payments");
		response.assertFlashMessage("success", "Deposit settings saved.");
		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.defaultDepositPercent, 30);
		assert.equal(saved.depositPolicy, "Holds your date.");
	});

	test("a deposit over 100% comes back as a field error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/deposits")
			.form({ defaultDepositPercent: "101", depositPolicy: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"defaultDepositPercent",
			"Enter a whole number from 0 to 100.",
		);
	});

	test("an owner moves a method up", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));

		const response = await client
			.post(`/t/black-needle/settings/payments/${b.id}/move`)
			.form({ direction: "up" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/settings/payments");
		assert.deepEqual(labels(await methods.list(tenant)), ["B", "A"]);
	});

	test("an owner deletes a method", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, cash("Cash"));

		const response = await client
			.delete(`/t/black-needle/settings/payments/${method.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", '"Cash" deleted.');
		assert.isEmpty(await methods.list(tenant));
		assert.isNotNull(
			(await PaymentMethod.withTrashed().where("id", method.id).firstOrFail())
				.deletedAt,
		);
	});
});

test.group("Payments page access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist gets 404 on every payments route", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const method = await methods.create(tenant, cash("Cash"));
		const base = "/t/black-needle/settings";

		for (const request of [
			client.get(`${base}/payments`),
			client.put(`${base}/deposits`).form({ defaultDepositPercent: "50" }),
			client.post(`${base}/payments/${method.id}/move`).form({ direction: "up" }),
			client.delete(`${base}/payments/${method.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.deepEqual(labels(await methods.list(tenant)), ["Cash"]);
		assert.isNull((await Tenant.findOrFail(tenant.id)).defaultDepositPercent);
	});

	test("another tenant's owner gets 404 on a method, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		await methods.create(blackNeedle, cash("A"));
		const b = await methods.create(blackNeedle, cash("B"));

		for (const request of [
			client.post(`/t/red-ink/settings/payments/${b.id}/move`).form({ direction: "up" }),
			client.delete(`/t/red-ink/settings/payments/${b.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		assert.deepEqual(labels(await methods.list(blackNeedle)), ["A", "B"]);
	});

	test("a deleted method gets 404", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, cash("Cash"));
		await methods.delete(tenant, method);

		for (const request of [
			client.post(`/t/black-needle/settings/payments/${method.id}/move`).form({ direction: "up" }),
			client.delete(`/t/black-needle/settings/payments/${method.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("an id that isn't a UUID gets 404, not a server error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.delete("/t/black-needle/settings/payments/not-a-uuid")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(404);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payments_page.spec.ts`
Expected: FAIL with 404s from the router (no routes yet).

- [ ] **Step 3: Add the move validator and the controllers**

```ts
// apps/platform/app/modules/payments/validators/payment_method.ts
import vine from "@vinejs/vine";

export const movePaymentMethodValidator = vine.create({
	direction: vine.enum(["up", "down"] as const),
});
```

```ts
// apps/platform/app/controllers/deposit_settings_controller.ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { updateDepositSettingsValidator } from "#modules/tenancy/validators/tenant";

/**
 * The deposit defaults on the Payments settings page, owners only.
 */
@inject()
export default class DepositSettingsController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(
			updateDepositSettingsValidator,
		);

		await this.tenancy.updateDepositSettings(tenant, input);

		ctx.session.flash("success", "Deposit settings saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}
}
```

```ts
// apps/platform/app/controllers/payment_methods_controller.ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type PaymentMethod from "#modules/payments/models/payment_method";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { movePaymentMethodValidator } from "#modules/payments/validators/payment_method";

/**
 * The studio's payment methods, managed by its owners. Every :id loads
 * through findFor(tenant, id), so another tenant's method is a 404.
 */
@inject()
export default class PaymentMethodsController {
	constructor(
		private methods: PaymentMethodService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const methods = await this.methods.list(tenant);

		return ctx.inertia.render("settings/payments", {
			deposits: {
				defaultDepositPercent: tenant.defaultDepositPercent,
				depositPolicy: tenant.depositPolicy,
			},
			methods: await Promise.all(methods.map((method) => this.toProps(method))),
		});
	}

	async move(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);
		const { direction } = await ctx.request.validateUsing(
			movePaymentMethodValidator,
		);

		await this.methods.move(tenant, method, direction);

		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);

		await this.methods.delete(tenant, method);

		ctx.session.flash("success", `"${method.label}" deleted.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	/**
	 * What the pages get for one method, with its QR's public URL.
	 */
	private async toProps(method: PaymentMethod) {
		return {
			id: method.id,
			kind: method.kind,
			label: method.label,
			accountName: method.accountName,
			accountNumber: method.accountNumber,
			bankName: method.bankName,
			showOnDepositPage: method.showOnDepositPage,
			qrUrl: method.qrImageKey
				? await this.images.url("payment_qr", method.qrImageKey)
				: null,
		};
	}
}
```

- [ ] **Step 4: Add the routes**

Run `cd apps/platform && node ace codegen` so the new controllers are in `#generated/controllers`. Then add these routes inside the settings group in `start/routes.ts`, after the profile routes:

```ts
				router
					.get("payments", [controllers.PaymentMethods, "index"])
					.as("tenant.settings.payments");
				router
					.put("deposits", [controllers.DepositSettings, "update"])
					.as("tenant.settings.deposits.update");
				router
					.post("payments/:id/move", [controllers.PaymentMethods, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.move");
				router
					.delete("payments/:id", [controllers.PaymentMethods, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.destroy");
```

Run `node ace codegen`.

- [ ] **Step 5: Add the page**

```ts
// apps/platform/inertia/components/payment_methods.ts
/**
 * A payment method as the settings pages get it.
 */
export type PaymentMethodProps = {
	id: string;
	kind: string;
	label: string;
	accountName: string | null;
	accountNumber: string | null;
	bankName: string | null;
	showOnDepositPage: boolean;
	qrUrl: string | null;
};

export type DetailField = "bankName" | "accountName" | "accountNumber";

type KindCopy = {
	name: string;
	description: string;
	/** The detail inputs to show, in order. */
	fields: DetailField[];
	qr: "required" | "optional" | "none";
	/** Whether it can be shown on the deposit page. */
	depositPage: boolean;
};

/**
 * Wording and inputs for each kind. The server decides what's valid
 * (app/modules/payments/rules.ts); this only picks what to show. A kind
 * without copy here still shows, with its raw value as the name.
 */
const KINDS: Record<string, KindCopy> = {
	fonepay: {
		name: "Fonepay",
		description: "Your Fonepay merchant QR code.",
		fields: [],
		qr: "required",
		depositPage: true,
	},
	esewa: {
		name: "eSewa",
		description: "Your eSewa QR code or eSewa ID.",
		fields: ["accountNumber", "accountName"],
		qr: "optional",
		depositPage: true,
	},
	khalti: {
		name: "Khalti",
		description: "Your Khalti QR code or Khalti ID.",
		fields: ["accountNumber", "accountName"],
		qr: "optional",
		depositPage: true,
	},
	bank: {
		name: "Bank transfer",
		description: "Account details, with a QR code if your bank gives one.",
		fields: ["bankName", "accountName", "accountNumber"],
		qr: "optional",
		depositPage: true,
	},
	cash: {
		name: "Cash",
		description: "Paid in person at the studio.",
		fields: [],
		qr: "none",
		depositPage: false,
	},
};

export function kindCopy(kind: string): KindCopy {
	return (
		KINDS[kind] ?? {
			name: kind,
			description: "",
			fields: [],
			qr: "optional",
			depositPage: true,
		}
	);
}

/**
 * The label for a detail input. eSewa and Khalti call the number an ID.
 */
export function fieldLabel(kind: string, field: DetailField): string {
	if (field === "accountNumber" && (kind === "esewa" || kind === "khalti")) {
		return `${kindCopy(kind).name} ID`;
	}
	return {
		bankName: "Bank name",
		accountName: "Account name",
		accountNumber: "Account number",
	}[field];
}
```

```tsx
// apps/platform/inertia/pages/settings/payments.tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import {
	ArrowDown,
	ArrowUp,
	Banknote,
	Pencil,
	Plus,
	Trash2,
	Wallet,
} from "lucide-react";
import { urlFor } from "~/client";
import {
	kindCopy,
	type PaymentMethodProps,
} from "~/components/payment_methods";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

export default function Payments({
	deposits,
	methods,
}: {
	deposits: { defaultDepositPercent: number | null; depositPolicy: string | null };
	methods: PaymentMethodProps[];
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<>
			<Section
				title="Deposits"
				description="Shown to clients on the deposit page."
			>
				<Form route="tenant.settings.deposits.update" routeParams={params}>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.defaultDepositPercent}>
								<FieldLabel htmlFor="defaultDepositPercent">
									Default deposit
								</FieldLabel>
								<div className="flex items-center gap-2">
									<Input
										id="defaultDepositPercent"
										name="defaultDepositPercent"
										type="number"
										inputMode="numeric"
										min={0}
										max={100}
										step={1}
										className="w-24"
										defaultValue={deposits.defaultDepositPercent ?? ""}
										aria-invalid={!!errors.defaultDepositPercent}
									/>
									<span className="text-sm text-muted-foreground">
										% of the quote
									</span>
								</div>
								<FieldDescription>
									Leave empty to set the deposit on each quote.
								</FieldDescription>
								{errors.defaultDepositPercent && (
									<FieldError>{errors.defaultDepositPercent}</FieldError>
								)}
							</Field>

							<Field data-invalid={!!errors.depositPolicy}>
								<FieldLabel htmlFor="depositPolicy">Deposit policy</FieldLabel>
								<Textarea
									id="depositPolicy"
									name="depositPolicy"
									rows={4}
									maxLength={2000}
									defaultValue={deposits.depositPolicy ?? ""}
									placeholder="Deposits hold your date and come off the final price."
									aria-invalid={!!errors.depositPolicy}
								/>
								{errors.depositPolicy && (
									<FieldError>{errors.depositPolicy}</FieldError>
								)}
							</Field>

							<div>
								<Button type="submit" disabled={processing}>
									{processing ? "Saving…" : "Save deposit settings"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>

			<Section
				title="Payment methods"
				description="How clients pay you. The deposit page lists the marked ones in this order."
			>
				{methods.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Wallet />
							</EmptyMedia>
							<EmptyTitle>No payment methods yet</EmptyTitle>
							<EmptyDescription>
								Add your Fonepay, eSewa or Khalti QR code, or your bank
								details, so clients can pay their deposit.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link
								route="tenant.settings.payments.create"
								routeParams={params}
								className={buttonVariants()}
							>
								<Plus data-icon="inline-start" />
								Add a payment method
							</Link>
						</EmptyContent>
					</Empty>
				) : (
					<div className="flex flex-col gap-3">
						{methods.map((method, index) => (
							<MethodRow
								key={method.id}
								method={method}
								tenantSlug={tenant.slug}
								first={index === 0}
								last={index === methods.length - 1}
							/>
						))}
						<div>
							<Link
								route="tenant.settings.payments.create"
								routeParams={params}
								className={buttonVariants({ variant: "outline" })}
							>
								<Plus data-icon="inline-start" />
								Add a payment method
							</Link>
						</div>
					</div>
				)}
			</Section>
		</>
	);
}

function MethodRow({
	method,
	tenantSlug,
	first,
	last,
}: {
	method: PaymentMethodProps;
	tenantSlug: string;
	first: boolean;
	last: boolean;
}) {
	const params = { tenant: tenantSlug, id: method.id };
	const details = [method.bankName, method.accountName, method.accountNumber]
		.filter(Boolean)
		.join(" · ");

	const move = (direction: "up" | "down") =>
		router.post(
			urlFor("tenant.settings.payments.move", params),
			{ direction },
			{ preserveScroll: true },
		);
	const remove = () => {
		if (window.confirm(`Delete "${method.label}"? Clients won't see it any more.`)) {
			router.delete(urlFor("tenant.settings.payments.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
			{method.qrUrl ? (
				<img
					src={method.qrUrl}
					alt={`${method.label} QR code`}
					className="size-16 rounded-md border bg-white object-contain"
				/>
			) : (
				<div className="flex size-16 items-center justify-center rounded-md border bg-muted text-muted-foreground">
					<Banknote />
				</div>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{method.label}</span>
					<Badge variant="secondary">{kindCopy(method.kind).name}</Badge>
					{method.showOnDepositPage && (
						<Badge variant="outline">On deposit page</Badge>
					)}
				</div>
				{details && (
					<p className="truncate text-sm text-muted-foreground">{details}</p>
				)}
			</div>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Move ${method.label} up`}
					disabled={first}
					onClick={() => move("up")}
				>
					<ArrowUp />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Move ${method.label} down`}
					disabled={last}
					onClick={() => move("down")}
				>
					<ArrowDown />
				</Button>
				<Link
					route="tenant.settings.payments.edit"
					routeParams={params}
					aria-label={`Edit ${method.label}`}
					className={buttonVariants({ variant: "ghost", size: "icon" })}
				>
					<Pencil />
				</Link>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Delete ${method.label}`}
					onClick={remove}
				>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

Payments.layout = [AppLayout, SettingsLayout];
```

This page links to `tenant.settings.payments.create` and `tenant.settings.payments.edit`, which Task 7 adds. So that typecheck passes in this task, register those two GET routes now, pointing at `PaymentMethods.create` / `edit`, and add stub actions that Task 7 replaces:

```ts
	// Task 7 replaces these two with the form page.
	async create({ response }: HttpContext) {
		return response.notFound();
	}

	async edit({ response }: HttpContext) {
		return response.notFound();
	}
```

```ts
				router
					.get("payments/new", [controllers.PaymentMethods, "create"])
					.as("tenant.settings.payments.create");
				router
					.get("payments/:id/edit", [controllers.PaymentMethods, "edit"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.edit");
```

In `inertia/layouts/settings.tsx`, import `Wallet` from `lucide-react` and add to `settingsNav`:

```tsx
		{
			label: "Payments",
			route: "tenant.settings.payments",
			params,
			icon: Wallet,
		},
```

Run `node ace codegen`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payments_page.spec.ts --files=tests/functional/tenancy/tenant_routes.spec.ts`
Expected: PASS, including the route guard, which now also covers the payments routes.

Run: `cd apps/platform && pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform
git commit -m "feat(platform): add the payments settings page" -m "Deposit defaults, the list of payment methods, reordering and delete." -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Adding and editing a payment method

**Files:**
- Modify: `apps/platform/app/modules/payments/validators/payment_method.ts`
- Modify: `apps/platform/app/controllers/payment_methods_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Create (shadcn): `apps/platform/inertia/components/ui/checkbox.tsx`
- Create: `apps/platform/inertia/pages/settings/payment_method_form.tsx`
- Modify (generated): `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/payments/payment_method_form.spec.ts`

**Interfaces:**
- Consumes: `PaymentMethodService.create/update/findFor`, `PaymentMethodRuleError` (Tasks 4–5); `InvalidImageError`; `imageFile()`; `PAYMENT_METHOD_KINDS`; `PaymentMethodsController.toProps` and the `create`/`edit` routes (Task 6); `kindCopy`, `fieldLabel`, `PaymentMethodProps` (Task 6).
- Produces: `createPaymentMethodValidator`, `updatePaymentMethodValidator`; route names `tenant.settings.payments.store` and `tenant.settings.payments.update`; the page `settings/payment_method_form` with props `{ kinds: string[]; method: PaymentMethodProps | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/platform/tests/functional/payments/payment_method_form.spec.ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const methods = new PaymentMethodService(new ImageService());
const base = "/t/black-needle/settings/payments";
const bank = {
	label: "Bank transfer",
	bankName: "Nabil Bank",
	accountName: "Black Needle Pvt. Ltd.",
	accountNumber: "0123456789",
};

test.group("Adding a payment method", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form lists the kinds", async ({ client, assert }) => {
		const { owner } = await studioWithOwner();

		const response = await client.get(`${base}/new`).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/payment_method_form");
		assert.deepEqual(response.inertiaProps.kinds, [
			"fonepay",
			"esewa",
			"khalti",
			"bank",
			"cash",
		]);
		assert.isNull(response.inertiaProps.method);
	});

	test("an owner adds Fonepay with a QR code", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay", showOnDepositPage: "on" })
			.file("qr", await testImages.png(), { filename: "qr.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Fonepay" added.');
		const [method] = await methods.list(tenant);
		assert.equal(method.kind, "fonepay");
		assert.isTrue(method.showOnDepositPage);
		assert.isTrue(await drive.use("public").exists(method.qrImageKey ?? ""));
	});

	test("a file that isn't an image comes back as a field error on qr", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay" })
			.file("qr", await testImages.gif(), { filename: "qr.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "qr");
		assert.isEmpty(await methods.list(tenant));
	});

	test("Fonepay without a QR code comes back as a field error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "qr", "Upload your Fonepay QR code.");
	});

	test("a bank without details gets an error on each missing field", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "bank", label: "Bank transfer" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "bankName", "Enter the bank's name.");
		assertValidationError(response, "accountName");
		assertValidationError(response, "accountNumber");
	});
});

test.group("Editing a payment method", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form shows the method", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, { kind: "bank", ...bank });

		const response = await client
			.get(`${base}/${method.id}/edit`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		assert.equal(response.inertiaProps.method.id, method.id);
		assert.equal(response.inertiaProps.method.bankName, "Nabil Bank");
	});

	test("saving without a new upload keeps the QR", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await uploadOf(await testImages.png()),
		});

		const response = await client
			.put(`${base}/${method.id}`)
			.fields({ label: "Fonepay (Nabil)" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.label, "Fonepay (Nabil)");
		assert.equal(saved.qrImageKey, method.qrImageKey);
	});

	test("an owner removes a bank QR", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "bank",
			...bank,
			qr: await uploadOf(await testImages.png()),
		});

		await client
			.put(`${base}/${method.id}`)
			.fields({ ...bank, removeQr: "on" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.isNull(saved.qrImageKey);
	});

	test("a kind in the body is ignored", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, { kind: "cash", label: "Cash" });

		await client
			.put(`${base}/${method.id}`)
			.fields({ label: "Cash", kind: "fonepay" })
			.withCsrfToken()
			.loginAs(owner);

		assert.equal((await PaymentMethod.findOrFail(method.id)).kind, "cash");
	});
});

test.group("Payment method form access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist gets 404 on the add and edit routes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const method = await methods.create(tenant, { kind: "cash", label: "Cash" });

		for (const request of [
			client.get(`${base}/new`),
			client.post(base).fields({ kind: "cash", label: "Sneaky" }),
			client.get(`${base}/${method.id}/edit`),
			client.put(`${base}/${method.id}`).fields({ label: "Sneaky" }),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.deepEqual(
			(await methods.list(tenant)).map(({ label }) => label),
			["Cash"],
		);
	});

	test("another tenant's owner gets 404 editing a method, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		const method = await methods.create(blackNeedle, { kind: "cash", label: "Cash" });

		for (const request of [
			client.get(`/t/red-ink/settings/payments/${method.id}/edit`),
			client.put(`/t/red-ink/settings/payments/${method.id}`).fields({ label: "Mine" }),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		assert.equal((await PaymentMethod.findOrFail(method.id)).label, "Cash");
	});

	test("a deleted method gets 404 on edit and update", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, { kind: "cash", label: "Cash" });
		await methods.delete(tenant, method);

		for (const request of [
			client.get(`${base}/${method.id}/edit`),
			client.put(`${base}/${method.id}`).fields({ label: "Back" }),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payment_method_form.spec.ts`
Expected: FAIL. The `new` and `edit` stubs return 404, and `POST`/`PUT` have no routes.

- [ ] **Step 3: Add the validators**

Replace `app/modules/payments/validators/payment_method.ts` with:

```ts
import vine from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";

/**
 * The input's shape only. Which details a kind needs, and whether it may
 * show on the deposit page, is PaymentMethodService's job (rules.ts): when
 * editing, it depends on the QR already stored. The form only sends the
 * kind's own inputs, so every detail is optional here.
 */
const details = () => ({
	label: vine.string().trim().minLength(1).maxLength(80),
	accountName: vine.string().trim().maxLength(120).nullable().optional(),
	accountNumber: vine.string().trim().maxLength(64).nullable().optional(),
	bankName: vine.string().trim().maxLength(120).nullable().optional(),
	showOnDepositPage: vine.boolean().optional(),
	qr: imageFile().optional(),
});

export const createPaymentMethodValidator = vine.create({
	kind: vine.enum(PAYMENT_METHOD_KINDS),
	...details(),
});

/**
 * No kind: it's fixed once the method exists.
 */
export const updatePaymentMethodValidator = vine.create({
	...details(),
	removeQr: vine.boolean().optional(),
});

export const movePaymentMethodValidator = vine.create({
	direction: vine.enum(["up", "down"] as const),
});
```

- [ ] **Step 4: Replace the stubs with the real actions**

In `payment_methods_controller.ts`:
- Add imports: `import { errors } from "@vinejs/vine";`, `import { InvalidImageError } from "#modules/media/errors";`, `import { PaymentMethodRuleError } from "#modules/payments/errors";`.
- Change `import type PaymentMethod from …` to `import type PaymentMethod from "#modules/payments/models/payment_method";` plus `import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";`.
- Extend the validator import with `createPaymentMethodValidator` and `updatePaymentMethodValidator`.
- Replace the two stubs with:

```ts
	async create({ inertia }: HttpContext) {
		return inertia.render("settings/payment_method_form", {
			kinds: [...PAYMENT_METHOD_KINDS],
			method: null,
		});
	}

	async store(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(createPaymentMethodValidator);

		const method = await asFieldErrors(() => this.methods.create(tenant, input));

		ctx.session.flash("success", `"${method.label}" added.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	async edit(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);

		return ctx.inertia.render("settings/payment_method_form", {
			kinds: [...PAYMENT_METHOD_KINDS],
			method: await this.toProps(method),
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		// Load first: another tenant's id is a 404 even with a bad body.
		const method = await this.methods.findFor(tenant, ctx.params.id);
		const input = await ctx.request.validateUsing(updatePaymentMethodValidator);

		await asFieldErrors(() => this.methods.update(tenant, method, input));

		ctx.session.flash("success", `"${method.label}" saved.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}
```

and, at the bottom of the file:

```ts
/**
 * Turns the service's rule errors and an unusable image into field
 * errors, so the form shows them next to their inputs.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof PaymentMethodRuleError) {
			throw new errors.E_VALIDATION_ERROR(
				error.violations.map(({ field, message }) => ({
					field,
					message,
					rule: "paymentMethod",
				})),
			);
		}
		if (error instanceof InvalidImageError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "qr", message: error.message, rule: "image" },
			]);
		}
		throw error;
	}
}
```

- [ ] **Step 5: Add the routes**

In the settings group of `start/routes.ts`, next to the other payments routes:

```ts
				router
					.post("payments", [controllers.PaymentMethods, "store"])
					.as("tenant.settings.payments.store");
				router
					.put("payments/:id", [controllers.PaymentMethods, "update"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.update");
```

- [ ] **Step 6: Add the form page**

Add the shadcn checkbox, then format: `cd apps/platform && pnpm dlx shadcn@latest add checkbox && cd ../.. && pnpm format:fix`

```tsx
// apps/platform/inertia/pages/settings/payment_method_form.tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import {
	fieldLabel,
	kindCopy,
	type PaymentMethodProps,
} from "~/components/payment_methods";
import Section from "~/components/section";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Errors = Partial<Record<string, string>>;

/**
 * Adds a payment method (`method` is null) or edits one. The kind is
 * picked when adding and fixed after that.
 */
export default function PaymentMethodForm({
	kinds,
	method,
}: {
	kinds: string[];
	method: PaymentMethodProps | null;
}) {
	const tenant = useTenant();

	if (method) {
		return (
			<Section title="Edit payment method">
				<Form
					route="tenant.settings.payments.update"
					routeParams={{ tenant: tenant.slug, id: method.id }}
				>
					{({ errors, processing }) => (
						<MethodFields
							kinds={kinds}
							method={method}
							errors={errors}
							processing={processing}
							tenantSlug={tenant.slug}
						/>
					)}
				</Form>
			</Section>
		);
	}

	return (
		<Section title="Add a payment method">
			<Form
				route="tenant.settings.payments.store"
				routeParams={{ tenant: tenant.slug }}
			>
				{({ errors, processing }) => (
					<MethodFields
						kinds={kinds}
						method={null}
						errors={errors}
						processing={processing}
						tenantSlug={tenant.slug}
					/>
				)}
			</Form>
		</Section>
	);
}

function MethodFields({
	kinds,
	method,
	errors,
	processing,
	tenantSlug,
}: {
	kinds: string[];
	method: PaymentMethodProps | null;
	errors: Errors;
	processing: boolean;
	tenantSlug: string;
}) {
	const [kind, setKind] = useState(method?.kind ?? kinds[0]);
	const [label, setLabel] = useState(method?.label ?? kindCopy(kinds[0]).name);
	// The label follows the kind until the owner edits it.
	const [labelTouched, setLabelTouched] = useState(method !== null);
	const copy = kindCopy(kind);

	return (
		<FieldGroup>
			{method ? (
				<Field>
					<FieldLabel>Kind</FieldLabel>
					<p className="text-sm">{copy.name}</p>
					<FieldDescription>
						To change the kind, delete this method and add a new one.
					</FieldDescription>
				</Field>
			) : (
				<FieldSet data-invalid={!!errors.kind}>
					<FieldLegend variant="label">Kind</FieldLegend>
					<RadioGroup
						name="kind"
						value={kind}
						onValueChange={(value) => {
							setKind(value);
							if (!labelTouched) setLabel(kindCopy(value).name);
						}}
					>
						{kinds.map((value) => (
							<FieldLabel key={value} htmlFor={`kind-${value}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>{kindCopy(value).name}</FieldTitle>
										<FieldDescription>
											{kindCopy(value).description}
										</FieldDescription>
									</FieldContent>
									<RadioGroupItem value={value} id={`kind-${value}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
					{errors.kind && <FieldError>{errors.kind}</FieldError>}
				</FieldSet>
			)}

			<Field data-invalid={!!errors.label}>
				<FieldLabel htmlFor="label">Label</FieldLabel>
				<Input
					id="label"
					name="label"
					maxLength={80}
					value={label}
					onChange={(event) => {
						setLabelTouched(true);
						setLabel(event.target.value);
					}}
					aria-invalid={!!errors.label}
				/>
				<FieldDescription>
					What clients see, e.g. &quot;Fonepay (Nabil Bank)&quot;.
				</FieldDescription>
				{errors.label && <FieldError>{errors.label}</FieldError>}
			</Field>

			{copy.fields.map((field) => (
				<Field key={`${kind}-${field}`} data-invalid={!!errors[field]}>
					<FieldLabel htmlFor={field}>{fieldLabel(kind, field)}</FieldLabel>
					<Input
						id={field}
						name={field}
						defaultValue={method?.[field] ?? ""}
						aria-invalid={!!errors[field]}
					/>
					{errors[field] && <FieldError>{errors[field]}</FieldError>}
				</Field>
			))}

			{copy.qr !== "none" && (
				<Field data-invalid={!!errors.qr}>
					<FieldLabel htmlFor="qr">
						QR code{copy.qr === "optional" ? " (optional)" : ""}
					</FieldLabel>
					{method?.qrUrl && (
						<div className="flex flex-wrap items-center gap-4">
							<img
								src={method.qrUrl}
								alt="Current QR code"
								className="size-24 rounded-md border bg-white object-contain"
							/>
							{copy.qr === "optional" && (
								<Field orientation="horizontal" className="w-auto">
									<Checkbox id="removeQr" name="removeQr" />
									<FieldLabel htmlFor="removeQr" className="font-normal">
										Remove this QR code
									</FieldLabel>
								</Field>
							)}
						</div>
					)}
					<Input
						id="qr"
						name="qr"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						aria-invalid={!!errors.qr}
					/>
					<FieldDescription>
						JPEG, PNG or WebP, up to 10 MB.
						{method?.qrUrl ? " Choose a file to replace the current one." : ""}
					</FieldDescription>
					{errors.qr && <FieldError>{errors.qr}</FieldError>}
				</Field>
			)}

			{copy.depositPage && (
				<Field orientation="horizontal">
					<Checkbox
						id="showOnDepositPage"
						name="showOnDepositPage"
						defaultChecked={method?.showOnDepositPage ?? true}
					/>
					<FieldContent>
						<FieldLabel htmlFor="showOnDepositPage">
							Show on the deposit page
						</FieldLabel>
						<FieldDescription>
							Clients can pay their deposit this way.
						</FieldDescription>
						{errors.showOnDepositPage && (
							<FieldError>{errors.showOnDepositPage}</FieldError>
						)}
					</FieldContent>
				</Field>
			)}

			<div className="flex gap-2">
				<Button type="submit" disabled={processing}>
					{processing ? "Saving…" : method ? "Save" : "Add payment method"}
				</Button>
				<Link
					route="tenant.settings.payments"
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({ variant: "ghost" })}
				>
					Cancel
				</Link>
			</div>
		</FieldGroup>
	);
}

PaymentMethodForm.layout = [AppLayout, SettingsLayout];
```

Run `cd apps/platform && node ace codegen`.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `cd apps/platform && PORT=3402 node ace test functional --files=tests/functional/payments/payment_method_form.spec.ts --files=tests/functional/tenancy/tenant_routes.spec.ts`
Expected: PASS.

Run: `cd apps/platform && pnpm typecheck`
Expected: no errors. If the Form's typed `errors` doesn't fit `Errors`, cast it at the call site (`errors={errors as Errors}`).

- [ ] **Step 8: Commit**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform
git commit -m "feat(platform): add and edit payment methods with QR codes" -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full checks, browser pass, Linear and review

**Files:**
- Modify: `apps/platform/AGENTS.md`

- [ ] **Step 1: Update `apps/platform/AGENTS.md`**

In the Tenancy rule, replace `(\`ctx.tenant\` is optional for that reason; the role is \`membership.role\`; per-route role checks come with TAT-30)` with `(\`ctx.tenant\` is optional for that reason; the role is \`membership.role\`)`, and add after that sentence:

```markdown
Limit a route to some roles with `middleware.role({ allow: ["owner"] })` after `tenant()`: other members get the same 404. Studio settings (`/t/:tenant/settings/…`) are owners only. They go in the nested settings group, and a test fails for a settings route without the role check. `:id` route params use `.where("id", router.matchers.uuid())`, so a malformed id is a 404 rather than a database error.
```

Add these rules after the Images rule:

```markdown
- Payments: the `payments` module (`app/modules/payments/`) owns payment methods. Read and change them through `PaymentMethodService` (`#modules/payments/services/payment_method_service`): `list(tenant)`, `findFor(tenant, id)` (throws a 404 for an unknown, deleted or other tenant's id), `create`, `update`, `move` and `delete`. The rules for each kind (which details it needs, QR or not, deposit page or not) live in `checkPaymentMethod` (`#modules/payments/rules`). Validators check only the shape. The service throws `PaymentMethodRuleError`; controllers turn it into field errors. eSewa and Khalti wallet IDs are stored in `account_number`. The deposit page (TAT-65) shows `list(tenant)` filtered to `showOnDepositPage`, with the tenant's `defaultDepositPercent` and `depositPolicy`.
- Phone numbers: validate with `phoneNumber()` from `#validators/phone`, which stores E.164 (+977 when no country code is given).
```

- [ ] **Step 2: Run every check**

Run, from the repo root:
- `pnpm check`
- `pnpm typecheck`
- `cd apps/platform && PORT=3402 node ace test`

Expected: all pass. Fix anything that doesn't before moving on.

- [ ] **Step 3: Click through on the dev server**

Start `PORT=3401 node ace serve --hmr` from `apps/platform`, sign in as an owner and check in a browser at 1280 px and 375 px wide, in light and dark:
- Settings appears in the nav for an owner and not for an artist. `/t/<slug>/settings` opens Studio profile.
- Profile: save; empty a field and save; a local phone number shows back as `+977…`; an `http://` link shows the field error.
- Payments:
  - save the deposit settings
  - add Fonepay with a QR, eSewa with only an ID, a bank with details, and cash
  - a Fonepay without a QR and a bank without details show their field errors
  - move a method up and down, edit one without re-uploading, replace a QR, remove a bank QR, and delete a method (with the confirm)
- Uploading a non-image shows the `qr` field error.

Stop the server afterwards: SIGKILL the `ace serve` parent, then SIGTERM its child, and check that nothing listens on 3401.

- [ ] **Step 4: Commit the docs**

```bash
cd /home/blank/Coding/tattoo-drip
git add apps/platform/AGENTS.md
git commit -m "docs(platform): document roles, payments and phone numbers" -m "Refs: TAT-26" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Linear, review and PR**

- TAT-26: tick the first three checklist items. The fourth (minimum notice and booking horizon) stays as the note it is.
- Run `/code-review` and `/security-review` (this branch touches tenancy and access), and fix what they find.
- Ask the user before pushing and opening the PR (the hook asks too). Push over HTTPS with gh credentials (`git -c 'url.https://github.com/.pushInsteadOf=git@github.com-personal:' -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin <branch>`), then `gh pr create`. End the PR body with the Claude Code line.
