# Artist Profiles (TAT-31) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can create, edit, hide and delete the public profiles of their studio's artists from the dashboard, and an independent artist gets their own profile automatically, on a new tenant-owned `artists` table that TAT-37 and TAT-36 can reference.

**Architecture:** A new `app/modules/artists/` module mirrors `app/modules/payments/`: model, service, errors, validators. The `artists` table is created by one migration with row-level security from the start (`enableTenantRls`). `ArtistService` is the module's public API; the photo follows the QR-code lifecycle (`images.store` inside `withTransaction`, `afterRollback` right after, `afterCommit` for replaced files). A flat `ArtistsController` serves an owner-only `/t/:tenant/artists` area, and `TenancyService.createTenant` calls `ArtistService.createOwnerProfile` for independent tenants.

**Tech Stack:** AdonisJS 7, Lucid 22.4.2, PostgreSQL 18, VineJS, Inertia + React + shadcn, Japa, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-tat-31-artist-profiles-design.md` (approved). Read it first. This plan follows it with the notes below.

## Notes where the plan differs from the spec

1. **The "linked user is a member" rule is structural.** The spec says the service enforces it. Here the service only ever links the signed-in member that the route already proved to be a member (`member` argument), and `linkToMe` never takes over a profile that is already linked to another user. TAT-33's claim path will add its own check before passing a user in. This also avoids a runtime import cycle between `ArtistService` and `TenancyService`.
2. **`TenancyService` gets an optional constructor argument** (`artists = new ArtistService(new ImageService())`) so every existing `new TenancyService()` call keeps working and the container (which does not inject it) uses the default.
3. **`isUniqueViolation` moves** from `tenancy_service.ts` into `app/services/db_errors.ts` so both modules share it.
4. **Naming.** The seeded profile on `Studio` is `artistProfile`, because `Studio.artist` already means the artist-role user. The form page gets a `canLink` prop (computed by the controller) so the "This is my profile" checkbox only shows where linking can succeed.

## Global Constraints

- PostgreSQL 18. Primary keys are `uuidv7()`; instants are `timestamptz`; business records soft-delete through `withSoftDeletes`.
- New table `artists` with exactly the columns, limits, indexes and constraint names of the spec: `name varchar(120)`, `slug varchar(63)`, `bio varchar(1000)`, `closed_message varchar(300)`, `photo_key varchar(255)` / `photo_width` / `photo_height` (all three set or all three null, constraint `artists_photo_all_or_none`), `visible` and `accepting_inquiries` booleans default true, `user_id` references `users` **on delete set null**, indexes `artists_tenant_slug_live_unique` (`(tenant_id, slug) where deleted_at is null`) and `artists_tenant_user_live_unique` (`(tenant_id, user_id) where user_id is not null and deleted_at is null`).
- Slug: `/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/` (2 to 63 characters, lowercase letters, digits, hyphens, none at either end). Owners only: every artists route runs `auth`, `dbContext`, `tenant`, then `role({ allow: ["owner"] })`; a member with the `artist` role gets the same 404 as an unknown URL.
- The module never imports the `db` service (a Biome rule fails `pnpm check`); use models, `withTransaction`, `dbClient()`. Recover from unique violations after the savepoint has rolled back.
- A new tenant-owned table runs `enableTenantRls()` in its migration and gets its `tenant_isolation:ALL` entry in `EXPECTED_POLICIES` (`tests/functional/rls/catalog_guard.spec.ts`). Every new `/t/:tenant` route gets a case in `tests/isolation/cases.ts`. A service query that reads or writes artists has a test that runs it from the other tenant's context.
- Work outside the database (deleting a file) uses `afterCommit` / `afterRollback`, never right after a service's own transaction returns.
- pnpm only; Biome, tabs and double quotes. Never edit `database/schema.ts` or `.adonisjs/` by hand; `pnpm migrate` regenerates the schema and `node ace codegen` the rest.
- **Every command that boots the app carries these inline variables** (the user's `.env` may not have them yet), and tests use port 3402:
  `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402`
  Wrap runs in `timeout -s KILL <seconds>`: a spec that fails to import makes `node ace test` hang. Test filters are the full file name or the bare stem: `--files=artist_service.spec.ts`, never `--files=artist_service.spec`. Check afterwards for stray `node ace` processes (exact PIDs only).
- Never read or edit any `.env` file (a deny rule protects them; `.env.example` is fine). Do not touch `docs/superpowers/`.
- Conventional Commits with scope `platform`. End every commit message with the trailer the session specifies. Never push.

## Review Focus

Failure modes the spec implies but that no obvious test reaches. Each has a test in the task named.

1. A slug with capitals or spaces is normalized, and the 2 and 63 character boundaries and a double hyphen behave as the rule says (Task 2: unit test for the boundaries; Task 4: HTTP test for the normalization and the rejected forms).
2. An unchecked checkbox means false: a form that omits `visible` hides the artist; one that omits `acceptingInquiries` closes inquiries (Task 4).
3. Editing a profile that is linked to another user must not unlink or steal that link (Task 2).
4. A photo replaced or removed in a request that later fails keeps the old file and drops the new one (Task 2).
5. A failing profile insert during onboarding rolls the whole tenant back (Task 3).
6. Deleting the linked user's account keeps the public profile and unlinks it (Task 1).

---

## File Structure

Create (all under `apps/platform/` unless noted):

| File | Responsibility |
|---|---|
| `database/migrations/1791580000000_create_artists_table.ts` | The table, its indexes, the photo check constraint, RLS |
| `app/modules/artists/models/artist.ts` | The model (`compose(ArtistSchema, withSoftDeletes)`) |
| `app/modules/artists/errors.ts` | `ArtistSlugTakenError`, `ArtistProfileExistsError` |
| `app/modules/artists/validators/artist.ts` | Shape validation, `ARTIST_SLUG` |
| `app/modules/artists/services/artist_service.ts` | The module's public API |
| `app/services/db_errors.ts` | `isUniqueViolation` shared by modules |
| `app/controllers/artists_controller.ts` | HTTP for the owner-only area |
| `inertia/pages/artists/index.tsx`, `inertia/pages/artists/form.tsx` | The list and the create/edit form |
| `inertia/components/artists.ts` | `ArtistProps` shared by both pages |
| `inertia/lib/slugify.ts` | The slug suggestion, extracted from onboarding |
| `tests/helpers/transactions.ts` | `whereNoSavepointOpens`, moved out of `qr_cleanup.spec.ts` |
| `tests/functional/artists/*.spec.ts`, `tests/unit/modules/artists/slug.spec.ts`, `tests/unit/services/db_errors.spec.ts` | New specs |

Modify: `database/schema.ts` (generated), `.adonisjs/` (generated), `app/modules/media/services/image_service.ts` (new purpose), `app/modules/tenancy/services/tenancy_service.ts`, `app/modules/tenancy/models/tenant.ts`, `start/routes.ts`, `inertia/layouts/app.tsx`, `inertia/pages/onboarding/create_tenant.tsx`, `tests/helpers/images.ts` (gets `RecordingImageService`), `tests/functional/payments/qr_cleanup.spec.ts` (imports the moved helpers), `tests/helpers/tenants.ts`, `tests/isolation/cases.ts`, `tests/functional/rls/catalog_guard.spec.ts`, `tests/functional/tenancy/{tenant_routes,tenancy_service,onboarding}.spec.ts`, `docs/backend.md`.

**Task order.** Page names, their props and route names are type-checked against `.adonisjs/` (generated from the pages and routes), and the route-coverage guard fails for a route with no isolation case. So Task 4 lands the routes, controller, typed placeholder pages, seed data and isolation cases together; Task 5 replaces the placeholders with the real pages.

---

### Task 1: The `artists` table, model and RLS

The data foundation. The catalog guard already fails for any table that is not in `EXPECTED_POLICIES`, so it is the first RED signal.

**Files:**
- Create: `apps/platform/database/migrations/1791580000000_create_artists_table.ts`
- Create: `apps/platform/app/modules/artists/models/artist.ts`
- Create: `apps/platform/tests/functional/artists/artists_table.spec.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Produces: table `artists`; `ArtistSchema` (generated) with camelCase columns `id, tenantId, userId, name, slug, bio, photoKey, photoWidth, photoHeight, visible, acceptingInquiries, closedMessage, createdAt, updatedAt, deletedAt`; `Artist` model (default export of `#modules/artists/models/artist`); index names `artists_tenant_slug_live_unique`, `artists_tenant_user_live_unique`; constraint `artists_photo_all_or_none`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/artists/artists_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	type DbContextValues,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL on purpose: this proves what the database itself enforces.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

const INSERT =
	"insert into artists (tenant_id, name, slug, created_at) values (?, ?, ?, now())";
const INSERT_LINKED =
	"insert into artists (tenant_id, user_id, name, slug, created_at) values (?, ?, ?, ?, now())";

test.group("artists table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a slug is unique among a tenant's live artists and free again after a soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT, [tenant.id, "Sita", "sita"]);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(INSERT, [tenant.id, "Other", "sita"]),
					),
				/artists_tenant_slug_live_unique/,
			);
			await trx.rawQuery(
				"update artists set deleted_at = now() where slug = 'sita'",
			);
			await trx.rawQuery(INSERT, [tenant.id, "Again", "sita"]);
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from artists where slug = 'sita'",
			);
			assert.equal(rows[0].n, 2);
		});
	});

	test("two tenants can use the same slug", async () => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		await sql({ tenantId: a.id }, INSERT, [a.id, "Sita", "sita"]);
		await sql({ tenantId: b.id }, INSERT, [b.id, "Sita", "sita"]);
	});

	test("a login has at most one live profile per tenant, and profiles without a login are unlimited", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT_LINKED, [tenant.id, owner.id, "A", "a1"]);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(INSERT_LINKED, [tenant.id, owner.id, "B", "b1"]),
					),
				/artists_tenant_user_live_unique/,
			);
			await trx.rawQuery(INSERT, [tenant.id, "C", "c1"]);
			await trx.rawQuery(INSERT, [tenant.id, "D", "d1"]);
		});
	});

	test("the photo columns are all set or all null", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(
							"insert into artists (tenant_id, name, slug, photo_key, created_at) values (?, 'A', 'a1', 'k.png', now())",
							[tenant.id],
						),
					),
				/artists_photo_all_or_none/,
			);
			await trx.rawQuery(
				"insert into artists (tenant_id, name, slug, photo_key, photo_width, photo_height, created_at) values (?, 'A', 'a1', 'k.png', 300, 200, now())",
				[tenant.id],
			);
		});
	});

	test("deleting the linked user's account keeps the profile and unlinks it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT_LINKED, [tenant.id, other.id, "A", "a1"]);
			await trx.rawQuery("delete from users where id = ?", [other.id]);
			const { rows } = await trx.rawQuery(
				"select user_id from artists where slug = 'a1'",
			);
			assert.lengthOf(rows, 1);
			assert.isNull(rows[0].user_id);
		});
	});

	test("row-level security: a tenant sees only its own artists, no context sees none, and rows cannot move", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		await sql({ tenantId: a.id }, INSERT, [a.id, "A", "a-1"]);
		await sql({ tenantId: b.id }, INSERT, [b.id, "B", "b-1"]);

		const underA = await sql({ tenantId: a.id }, "select tenant_id from artists");
		assert.deepEqual(
			underA.rows.map((row: { tenant_id: string }) => row.tenant_id),
			[a.id],
		);
		const none = await sql({}, "select count(*)::int as n from artists");
		assert.equal(none.rows[0].n, 0);
		await assert.rejects(
			() => sql({ tenantId: a.id }, INSERT, [b.id, "X", "x-1"]),
			/row-level security/,
		);
		await assert.rejects(
			() =>
				sql({ tenantId: a.id }, "update artists set tenant_id = ?", [b.id]),
			/row-level security/,
		);
	});
});
```

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, add the entry to `EXPECTED_POLICIES` (keep the other keys):

```ts
const EXPECTED_POLICIES: Record<string, string[]> = {
	artists: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/platform`):
`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 node ace test functional --files=artists_table.spec.ts`
Expected: FAIL, `relation "artists" does not exist`. Then `--files=catalog_guard.spec.ts`: FAIL on "each protected table has exactly the expected policies".

- [ ] **Step 3: Write the migration and the model**

Create `apps/platform/database/migrations/1791580000000_create_artists_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * The public profiles of a tenant's artists (TAT-31). A profile may be
 * linked to a login; deleting the account only unlinks it. Row-level
 * security and the (tenant_id, id) key are added by enableTenantRls.
 */
export default class extends BaseSchema {
	protected tableName = "artists";

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
				.uuid("user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.string("name", 120).notNullable();
			table.string("slug", 63).notNullable();
			table.string("bio", 1000).nullable();
			table.string("photo_key", 255).nullable();
			table.integer("photo_width").nullable();
			table.integer("photo_height").nullable();
			table.boolean("visible").notNullable().defaultTo(true);
			table.boolean("accepting_inquiries").notNullable().defaultTo(true);
			table.string("closed_message", 300).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			table.index(["tenant_id"]);
			table.index(["user_id"]);
		});

		// A deleted profile frees its slug and its login.
		this.schema.raw(
			"create unique index artists_tenant_slug_live_unique on artists (tenant_id, slug) where deleted_at is null",
		);
		this.schema.raw(
			"create unique index artists_tenant_user_live_unique on artists (tenant_id, user_id) where user_id is not null and deleted_at is null",
		);
		this.schema.raw(
			"alter table artists add constraint artists_photo_all_or_none check ((photo_key is null) = (photo_width is null) and (photo_key is null) = (photo_height is null))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/artists/models/artist.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { ArtistSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * A public profile of one artist in one tenant. Read and change artists
 * through ArtistService, not from other modules directly.
 */
export default class Artist extends compose(ArtistSchema, withSoftDeletes) {}
```

- [ ] **Step 4: Migrate and regenerate the schema**

From `apps/platform`: `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate`
Expected: the migration runs and prints that schema classes were generated. Then `pnpm exec biome check --write database/schema.ts` (CI compares the formatted file). `git diff database/schema.ts` must show a new `ArtistSchema` class and nothing else changed.

- [ ] **Step 5: Run the tests to verify they pass**

Run `--files=artists_table.spec.ts`, `--files=catalog_guard.spec.ts` and `--files=policies.spec.ts` (each wrapped in `timeout -s KILL 180`, with the inline variables).
Expected: PASS. Also check the rollback and forward path: `pnpm migrate:rollback && pnpm migrate` (inline variables) finishes without errors and leaves `git diff database/schema.ts` unchanged after `biome check --write`.

- [ ] **Step 6: Typecheck and commit**

Run `pnpm typecheck`. Expected: no errors.

```bash
git add apps/platform/database apps/platform/app/modules/artists apps/platform/tests
git commit -m "feat(platform): add the artists table with row-level security"
```

---

### Task 2: `ArtistService`: profiles, conflicts, link rules and photo

The module's public API. Both test files are written first (RED), then the service.

**Files:**
- Create: `apps/platform/app/services/db_errors.ts`
- Create: `apps/platform/app/modules/artists/errors.ts`
- Create: `apps/platform/app/modules/artists/validators/artist.ts`
- Create: `apps/platform/app/modules/artists/services/artist_service.ts`
- Create: `apps/platform/tests/helpers/transactions.ts`
- Create: `apps/platform/tests/unit/services/db_errors.spec.ts`, `apps/platform/tests/unit/modules/artists/slug.spec.ts`
- Create: `apps/platform/tests/functional/artists/artist_service.spec.ts`, `apps/platform/tests/functional/artists/artist_photo.spec.ts`
- Modify: `apps/platform/app/modules/media/services/image_service.ts`, `apps/platform/app/modules/tenancy/services/tenancy_service.ts`, `apps/platform/tests/helpers/images.ts`, `apps/platform/tests/functional/payments/qr_cleanup.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`Artist`), `ImageService`, `withTransaction` / `afterCommit` / `afterRollback` from `#services/db_context`.
- Produces:
  - `isUniqueViolation(error: unknown, constraint: string): boolean` from `#services/db_errors`.
  - `ArtistSlugTakenError(slug)` and `ArtistProfileExistsError()` from `#modules/artists/errors`.
  - `ARTIST_SLUG`, `createArtistValidator`, `updateArtistValidator` from `#modules/artists/validators/artist`.
  - `IMAGE_PURPOSES.artist_photo` (public).
  - From `#modules/artists/services/artist_service` (default export `ArtistService`, constructor `(images: ImageService)`):
    - `type Member = { id: string }`
    - `type ArtistInput = { name: string; slug: string; bio: string | null; visible: boolean; acceptingInquiries: boolean; closedMessage: string | null; linkToMe: boolean; photo?: Upload; removePhoto?: boolean }` where `Upload = Pick<MultipartFile, "tmpPath">`
    - `list(tenant): Promise<Artist[]>`, `findFor(tenant, id): Promise<Artist>`, `create(tenant, input, member): Promise<Artist>`, `update(tenant, artist, input, member): Promise<Artist>`, `delete(tenant, artist): Promise<void>`, `createOwnerProfile(tenant: Pick<Tenant, "id" | "name" | "slug">, owner: Member): Promise<Artist>`
  - `RecordingImageService` from `#tests/helpers/images` and `whereNoSavepointOpens(tenantId, work)` from `#tests/helpers/transactions` (both moved, unchanged, out of `qr_cleanup.spec.ts`).

- [ ] **Step 1: Add the shared helpers and their unit tests**

Create `apps/platform/app/services/db_errors.ts`:

```ts
/**
 * Whether `error` is PostgreSQL's unique violation (23505) of the named
 * constraint or unique index. Recover from it after the savepoint that
 * raised it has rolled back (withTransaction does that).
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505" &&
		"constraint" in error &&
		error.constraint === constraint
	);
}
```

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts` delete the local `function isUniqueViolation(...)` at the bottom of the file and add `import { isUniqueViolation } from "#services/db_errors";` below the `#services/db_context` import.

Create `apps/platform/tests/unit/services/db_errors.spec.ts`:

```ts
import { test } from "@japa/runner";
import { isUniqueViolation } from "#services/db_errors";

test.group("isUniqueViolation", () => {
	test("matches a 23505 error for the named constraint", ({ assert }) => {
		const error = { code: "23505", constraint: "artists_tenant_slug_live_unique" };
		assert.isTrue(isUniqueViolation(error, "artists_tenant_slug_live_unique"));
	});

	test("does not match another constraint, another code or a non-error", ({
		assert,
	}) => {
		assert.isFalse(
			isUniqueViolation({ code: "23505", constraint: "other" }, "mine"),
		);
		assert.isFalse(
			isUniqueViolation({ code: "23503", constraint: "mine" }, "mine"),
		);
		assert.isFalse(isUniqueViolation(null, "mine"));
		assert.isFalse(isUniqueViolation("23505", "mine"));
	});
});
```

Run `--files=db_errors.spec.ts` and `--files=tenancy_service.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: PASS (the move changed nothing observable).

- [ ] **Step 2: Errors, validators, media purpose and the slug unit test**

Create `apps/platform/app/modules/artists/errors.ts`:

```ts
/**
 * Another live artist of the same tenant already uses this slug. The
 * message is for developers; show your own to the user.
 */
export class ArtistSlugTakenError extends Error {
	constructor(readonly slug: string) {
		super(`The artist slug "${slug}" is already in use`);
		this.name = "ArtistSlugTakenError";
	}
}

/**
 * The signed-in member already has a live profile in this tenant.
 */
export class ArtistProfileExistsError extends Error {
	constructor() {
		super("This member already has an artist profile in this tenant");
		this.name = "ArtistProfileExistsError";
	}
}
```

Create `apps/platform/app/modules/artists/validators/artist.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";

/**
 * An artist's slug ends a public link, so it follows the tenant slug rules
 * (lowercase letters, digits and hyphens, none at either end) but may be as
 * short as 2 characters: it is a path segment, not a subdomain.
 */
export const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * The input's shape only. Unchecked checkboxes are not sent, so the
 * controller reads a missing boolean as false.
 */
const fields = () => ({
	name: vine.string().trim().minLength(1).maxLength(120),
	slug: vine.string().trim().toLowerCase().regex(ARTIST_SLUG),
	bio: vine.string().trim().maxLength(1000).nullable().optional(),
	visible: vine.boolean().optional(),
	acceptingInquiries: vine.boolean().optional(),
	closedMessage: vine.string().trim().maxLength(300).nullable().optional(),
	linkToMe: vine.boolean().optional(),
	photo: imageFile().optional(),
});

export const createArtistValidator = vine.create(fields());

export const updateArtistValidator = vine.create({
	...fields(),
	removePhoto: vine.boolean().optional(),
});

const messages = new SimpleMessagesProvider(
	{
		"slug.regex":
			"Use 2 to 63 lowercase letters, numbers and hyphens, not starting or ending with a hyphen.",
	},
	{ closedMessage: "message", linkToMe: "profile link" },
);
createArtistValidator.messagesProvider = messages;
updateArtistValidator.messagesProvider = messages;
```

In `apps/platform/app/modules/media/services/image_service.ts` add the purpose:

```ts
export const IMAGE_PURPOSES = {
	payment_qr: { visibility: "public" }, // TAT-26
	payment_proof: { visibility: "private" }, // TAT-65
	artist_photo: { visibility: "public" }, // TAT-31
} as const;
```

Create `apps/platform/tests/unit/modules/artists/slug.spec.ts`:

```ts
import { test } from "@japa/runner";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";

test.group("ARTIST_SLUG", () => {
	test("accepts 2 to 63 lowercase letters, digits and inner hyphens", ({
		assert,
	}) => {
		for (const slug of ["ab", "sita", "sita-rai", "a--b", "a1", "x".repeat(63)]) {
			assert.match(slug, ARTIST_SLUG, slug);
		}
	});

	test("rejects one character, 64 characters, edge hyphens, capitals and symbols", ({
		assert,
	}) => {
		for (const slug of [
			"a",
			"x".repeat(64),
			"-ab",
			"ab-",
			"Ab",
			"a b",
			"a_b",
			"é",
			"",
		]) {
			assert.notMatch(slug, ARTIST_SLUG, JSON.stringify(slug));
		}
	});
});
```

Run `--files=slug.spec.ts` (unit). Expected: PASS.

- [ ] **Step 3: Share the photo-test helpers**

`tests/functional/payments/qr_cleanup.spec.ts` defines `RecordingImageService` and `whereNoSavepointOpens` locally. Move them, unchanged, so both specs use one copy.

Append to `apps/platform/tests/helpers/images.ts` (add `import ImageService from "#modules/media/services/image_service";` to its imports):

```ts
/**
 * ImageService that remembers every key it stored, so a test can check that
 * no stored file is left behind.
 */
export class RecordingImageService extends ImageService {
	keys: string[] = [];

	override async store(...args: Parameters<ImageService["store"]>) {
		const stored = await super.store(...args);
		this.keys.push(stored.key);
		return stored;
	}
}
```

Create `apps/platform/tests/helpers/transactions.ts`:

```ts
import { currentClient, withDbContext } from "#services/db_context";

/**
 * Runs `work` inside an open request-like transaction in which opening the
 * next level (the savepoint a service's withTransaction needs) fails with
 * "cannot open", as a lost database connection would.
 */
export function whereNoSavepointOpens<T>(
	tenantId: string,
	work: () => Promise<T>,
) {
	return withDbContext({ tenantId }, async () => {
		const client = currentClient();
		if (!client) throw new Error("expected an open transaction");
		const original = client.transaction;
		client.transaction = (() =>
			Promise.reject(new Error("cannot open"))) as unknown as typeof original;
		try {
			return await work();
		} finally {
			client.transaction = original;
		}
	});
}
```

In `qr_cleanup.spec.ts` delete the two local definitions, drop the imports only they used (`currentClient`, `withDbContext` if unused elsewhere in the file; keep `ImageService` if still used), and import `RecordingImageService` from `#tests/helpers/images` and `whereNoSavepointOpens` from `#tests/helpers/transactions`. Run `--files=qr_cleanup.spec.ts`: PASS, same test count as before.

- [ ] **Step 4: Write the failing service tests**

Create `apps/platform/tests/functional/artists/artist_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { dbClient, withDbContext } from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

const names = (list: Artist[]) => list.map(({ name }) => name);

test.group("ArtistService profiles", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the profile, unlinked by default", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ bio: "Fine line work" }), owner),
		);

		assert.equal(artist.tenantId, tenant.id);
		assert.equal(artist.name, "Sita Rai");
		assert.equal(artist.slug, "sita");
		assert.equal(artist.bio, "Fine line work");
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
		assert.isNull(artist.userId);
		assert.isNull(artist.photoKey);
	});

	test("linkToMe links the profile to the acting member", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		assert.equal(artist.userId, owner.id);
	});

	test("a second profile for the same member is refused, and the request stays usable", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			await artists.create(tenant, input({ linkToMe: true }), owner);
			await assert.rejects(
				() =>
					artists.create(
						tenant,
						input({ slug: "second", linkToMe: true }),
						owner,
					),
				ArtistProfileExistsError,
			);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);
		});
	});

	test("a taken slug is refused, the request stays usable, and a deleted profile frees its slug", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			const first = await artists.create(tenant, input(), owner);
			await assert.rejects(
				() => artists.create(tenant, input({ name: "Other" }), owner),
				ArtistSlugTakenError,
			);
			assert.deepEqual(names(await artists.list(tenant)), ["Sita Rai"]);

			await artists.delete(tenant, await artists.findFor(tenant, first.id));
			await artists.create(tenant, input({ name: "Again" }), owner);
			assert.deepEqual(names(await artists.list(tenant)), ["Again"]);
		});
	});

	test("two tenants can use the same slug", async () => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);

		await inTenant(a, () => artists.create(a, input(), ownerA));
		await inTenant(b, () => artists.create(b, input(), ownerB));
	});

	test("update changes the profile and refuses a slug another artist uses", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const first = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		await inTenant(tenant, () =>
			artists.create(tenant, input({ name: "Bea", slug: "bea" }), owner),
		);

		await inTenant(tenant, async () => {
			const saved = await artists.update(
				tenant,
				first,
				input({
					name: "Sita R.",
					slug: "sita-r",
					bio: "New bio",
					visible: false,
					acceptingInquiries: false,
					closedMessage: "Back in May",
				}),
				owner,
			);
			assert.equal(saved.name, "Sita R.");
			assert.equal(saved.slug, "sita-r");
			assert.equal(saved.bio, "New bio");
			assert.isFalse(saved.visible);
			assert.isFalse(saved.acceptingInquiries);
			assert.equal(saved.closedMessage, "Back in May");

			await assert.rejects(
				() => artists.update(tenant, first, input({ slug: "bea" }), owner),
				ArtistSlugTakenError,
			);
			assert.equal((await artists.findFor(tenant, first.id)).slug, "sita-r");
		});
	});

	test("unchecking 'this is my profile' unlinks only the acting member", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const mine = await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const unlinked = await inTenant(tenant, () =>
			artists.update(tenant, mine, input({ linkToMe: false }), owner),
		);

		assert.isNull(unlinked.userId);
	});

	test("linkToMe never takes over, and an edit never unlinks, another user's profile", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});
		const artist = await inTenant(tenant, async () => {
			const created = await artists.create(tenant, input(), owner);
			await Artist.query()
				.where("id", created.id)
				.update({ user_id: other.id });
			return created;
		});

		await inTenant(tenant, async () => {
			const claimed = await artists.update(
				tenant,
				artist,
				input({ linkToMe: true }),
				owner,
			);
			assert.equal(claimed.userId, other.id);
			const edited = await artists.update(
				tenant,
				artist,
				input({ linkToMe: false }),
				owner,
			);
			assert.equal(edited.userId, other.id);
		});
	});

	test("list is ordered by name, ignoring case", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await artists.create(tenant, input({ name: "bea", slug: "bea" }), owner);
			await artists.create(tenant, input({ name: "Ada", slug: "ada" }), owner);
			await artists.create(tenant, input({ name: "Carl", slug: "carl" }), owner);

			assert.deepEqual(names(await artists.list(tenant)), ["Ada", "bea", "Carl"]);
		});
	});

	test("delete is a soft delete: the profile leaves the list and findFor", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		await inTenant(tenant, () => artists.delete(tenant, artist));

		await inTenant(tenant, async () => {
			assert.lengthOf(await artists.list(tenant), 0);
			await assert.rejects(
				() => artists.findFor(tenant, artist.id),
				/Row not found/,
			);
			assert.lengthOf(
				await Artist.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
		});
	});

	test("list and findFor only see the tenant's own live artists", async ({
		assert,
	}) => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const mine = await inTenant(a, () => artists.create(a, input(), ownerA));

		// A's context lets row-level security show A's row, so only the
		// service's own tenant filter can hide it from B's lookups.
		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(() => artists.findFor(b, mine.id), /Row not found/);
			assert.lengthOf(await artists.list(b), 0);
			assert.lengthOf(await artists.list(a), 1);
		});
	});

	test("createOwnerProfile makes a visible, accepting profile from the tenant's name and slug", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.createOwnerProfile(tenant, owner),
		);

		assert.equal(artist.name, tenant.name);
		assert.equal(artist.slug, tenant.slug);
		assert.equal(artist.userId, owner.id);
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
	});
});
```

Create `apps/platform/tests/functional/artists/artist_photo.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { ArtistSlugTakenError } from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import { InvalidImageError } from "#modules/media/errors";
import { withDbContext } from "#services/db_context";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { whereNoSavepointOpens } from "#tests/helpers/transactions";

const photo = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

function makeService() {
	const images = new RecordingImageService();
	return { images, artists: new ArtistService(images) };
}

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

test.group("ArtistService photo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the photo on the public disk with its size", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();

		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);

		assert.match(
			artist.photoKey ?? "",
			new RegExp(`^tenants/${tenant.id}/artist_photo/`),
		);
		assert.equal(artist.photoWidth, 300);
		assert.equal(artist.photoHeight, 200);
		assert.isTrue(await exists(artist.photoKey ?? ""));
	});

	test("a file that isn't an image is an InvalidImageError and creates nothing", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					artists.create(
						tenant,
						input({ photo: await uploadOf(await testImages.gif()) }),
						owner,
					),
				),
			InvalidImageError,
		);

		assert.lengthOf(await inTenant(tenant, () => artists.list(tenant)), 0);
	});

	test("saving without a new photo keeps all three photo columns", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);

		const saved = await inTenant(tenant, () =>
			artists.update(tenant, artist, input({ name: "Sita R." }), owner),
		);

		assert.equal(saved.photoKey, artist.photoKey);
		assert.equal(saved.photoWidth, 300);
		assert.equal(saved.photoHeight, 200);
		assert.isTrue(await exists(artist.photoKey ?? ""));
	});

	test("replacing a photo keeps the old file until the outermost transaction commits", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		let newKey = "";

		await withDbContext({ tenantId: tenant.id }, async () => {
			const saved = await artists.update(
				tenant,
				artist,
				input({ photo: await photo() }),
				owner,
			);
			newKey = saved.photoKey ?? "";
			assert.notEqual(newKey, oldKey);
			assert.isTrue(await exists(oldKey), "the old photo stays until the commit");
		});

		assert.isFalse(await exists(oldKey));
		assert.isTrue(await exists(newKey));
	});

	test("a later failure keeps the old photo and drops the new one", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		let newKey = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const saved = await artists.update(
						tenant,
						artist,
						input({ photo: await photo() }),
						owner,
					);
					newKey = saved.photoKey ?? "";
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isTrue(await exists(oldKey));
		assert.isFalse(await exists(newKey));
		const row = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.equal(row.photoKey, oldKey);
	});

	test("removePhoto clears the three columns and deletes the file after the commit", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";

		const saved = await inTenant(tenant, () =>
			artists.update(tenant, artist, input({ removePhoto: true }), owner),
		);

		assert.isNull(saved.photoKey);
		assert.isNull(saved.photoWidth);
		assert.isNull(saved.photoHeight);
		assert.isFalse(await exists(oldKey));
	});

	test("a slug conflict after the photo was stored removes the new photo", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();
		await inTenant(tenant, () => artists.create(tenant, input(), owner));

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					artists.create(
						tenant,
						input({ name: "Other", photo: await photo() }),
						owner,
					),
				),
			ArtistSlugTakenError,
		);

		assert.lengthOf(images.keys, 1);
		for (const key of images.keys) {
			assert.isFalse(await exists(key), `${key} was left on the public disk`);
		}
	});

	test("create leaves no file behind when its transaction cannot open", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					artists.create(tenant, input({ photo: await photo() }), owner),
				),
			/cannot open/,
		);

		assert.lengthOf(images.keys, 0, "nothing should be stored if it cannot open");
	});

	test("update leaves no new file behind when its transaction cannot open, and keeps the old one", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		images.keys.length = 0;

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					artists.update(tenant, artist, input({ photo: await photo() }), owner),
				),
			/cannot open/,
		);

		assert.lengthOf(images.keys, 0);
		assert.isTrue(await exists(oldKey), "the stored photo stays");
	});
});
```

Run `--files=artist_service.spec.ts` and `--files=artist_photo.spec.ts`. Expected: FAIL (cannot resolve `#modules/artists/services/artist_service`). Wrap in `timeout -s KILL 180`.

- [ ] **Step 5: Write `ArtistService`**

Create `apps/platform/app/modules/artists/services/artist_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	afterCommit,
	afterRollback,
	withTransaction,
} from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

/**
 * The signed-in user making the change. Routes check that they are a member
 * of the tenant; the only user a profile is ever linked to is this one.
 */
export type Member = { id: string };

export type ArtistInput = {
	name: string;
	slug: string;
	bio: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	closedMessage: string | null;
	/**
	 * Link the profile to the acting member. Unchecking it unlinks the member
	 * from their own profile; a profile linked to someone else is never
	 * changed by it.
	 */
	linkToMe: boolean;
	/** A new photo; it replaces the stored one. */
	photo?: Upload;
	/** Drop the stored photo (ignored when `photo` is given). */
	removePhoto?: boolean;
};

const PHOTO = "artist_photo";
const SLUG_INDEX = "artists_tenant_slug_live_unique";
const USER_INDEX = "artists_tenant_user_live_unique";

/**
 * The way to read and change a tenant's artist profiles. Every call is
 * scoped to the tenant. Photos are stored through ImageService and cleaned
 * up here, after the real commit or rollback.
 */
@inject()
export default class ArtistService {
	constructor(private images: ImageService) {}

	/**
	 * The tenant's live profiles, by name, ignoring case.
	 */
	async list(tenant: TenantRef): Promise<Artist[]> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.orderByRaw("lower(name) asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's live profile with this id. An unknown id, a deleted
	 * profile and another tenant's profile all throw E_ROW_NOT_FOUND (a 404),
	 * so callers can't tell them apart.
	 */
	async findFor(tenant: TenantRef, id: string): Promise<Artist> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * Adds a profile. Throws ArtistSlugTakenError or ArtistProfileExistsError
	 * (after rolling back its own savepoint, so the request stays usable) and
	 * InvalidImageError for a photo we can't accept.
	 */
	async create(
		tenant: TenantRef,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		try {
			return await withTransaction(async (trx) => {
				const photo = await this.storePhoto(tenant, input.photo);
				return Artist.create(
					{
						tenantId: tenant.id,
						...profileFields(input),
						userId: input.linkToMe ? member.id : null,
						...photoColumns(photo),
					},
					{ client: trx },
				);
			});
		} catch (error) {
			rethrowConflict(error, input.slug);
		}
	}

	/**
	 * Saves an edit. A new `photo` replaces the stored one and `removePhoto`
	 * drops it; the old file is deleted once the outermost transaction
	 * commits.
	 */
	async update(
		tenant: TenantRef,
		artist: Artist,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
		try {
			return await withTransaction(async (trx) => {
				// Stored inside the transaction: nothing is stored if it cannot
				// open, and the cleanup is registered right after the store
				// resolves. It comes before the row lock below, so the lock is
				// not held while the image is processed.
				const photo = await this.storePhoto(tenant, input.photo);
				// Lock the live row: a delete that landed since the form loaded
				// makes this a 404, and the photo and link are read from the row,
				// not from the form's copy.
				const live = await Artist.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("id", artist.id)
					.forUpdate()
					.firstOrFail();
				const previous = live.photoKey;
				const keepsPhoto = !photo && !input.removePhoto;
				live.merge({
					...profileFields(input),
					userId: nextUserId(live.userId, input.linkToMe, member),
					...(keepsPhoto ? {} : photoColumns(photo)),
				});
				await live.save();
				// The replaced file goes only once the change is committed for good.
				if (previous && previous !== live.photoKey) {
					afterCommit(() => this.images.delete(PHOTO, previous));
				}
				return live;
			});
		} catch (error) {
			rethrowConflict(error, input.slug);
		}
	}

	/**
	 * Soft-deletes the profile. Its photo stays, like every soft-deleted
	 * record's files.
	 */
	async delete(tenant: TenantRef, artist: Artist): Promise<void> {
		assertOwnedBy(tenant, artist);
		await artist.softDelete();
	}

	/**
	 * The profile an independent artist gets with their tenant: named after
	 * the tenant, same slug, linked to the owner. Call it inside the
	 * transaction that creates the tenant.
	 */
	async createOwnerProfile(
		tenant: Pick<Tenant, "id" | "name" | "slug">,
		owner: Member,
	): Promise<Artist> {
		return Artist.create({
			tenantId: tenant.id,
			name: tenant.name,
			slug: tenant.slug,
			bio: null,
			visible: true,
			acceptingInquiries: true,
			closedMessage: null,
			userId: owner.id,
		});
	}

	/**
	 * Stores an upload and registers its cleanup in the same step: no await
	 * sits between the store resolving and the registration, so no failure
	 * can fall between them. If the level rolls back, or the request fails
	 * later, no row will point at the file.
	 */
	private async storePhoto(tenant: TenantRef, upload?: Upload) {
		if (!upload) return null;
		const stored = await this.images.store(upload, {
			tenant,
			purpose: PHOTO,
		});
		afterRollback(() => this.images.delete(PHOTO, stored.key));
		return stored;
	}
}

function profileFields(input: ArtistInput) {
	return {
		name: input.name,
		slug: input.slug,
		bio: input.bio,
		visible: input.visible,
		acceptingInquiries: input.acceptingInquiries,
		closedMessage: input.closedMessage,
	};
}

function photoColumns(
	photo: { key: string; width: number; height: number } | null,
) {
	return {
		photoKey: photo?.key ?? null,
		photoWidth: photo?.width ?? null,
		photoHeight: photo?.height ?? null,
	};
}

/**
 * The link after an edit: checking the box links an unlinked profile (never
 * one that belongs to someone else); unchecking unlinks only the acting
 * member from their own profile.
 */
function nextUserId(
	current: string | null,
	linkToMe: boolean,
	member: Member,
): string | null {
	if (linkToMe) return current ?? member.id;
	return current === member.id ? null : current;
}

/**
 * Turns the two unique indexes into the errors callers handle. Runs after
 * withTransaction rolled its savepoint back.
 */
function rethrowConflict(error: unknown, slug: string): never {
	if (isUniqueViolation(error, SLUG_INDEX)) throw new ArtistSlugTakenError(slug);
	if (isUniqueViolation(error, USER_INDEX)) throw new ArtistProfileExistsError();
	throw error;
}

/**
 * A caller bug, not a user error: profiles come from findFor(tenant, id).
 */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run `--files=artist_service.spec.ts`, `--files=artist_photo.spec.ts`, `--files=db_errors.spec.ts` and `--files=slug.spec.ts` (each with the inline variables and `timeout -s KILL 180`).
Expected: PASS. If `assert.equal(artist.photoWidth, 300)` fails because the processed image has other dimensions, read the stored width and height from `testImages.png()` (300 by 200 by default) and fix the expectation, not the service.

- [ ] **Step 7: Typecheck, lint and commit**

Run `pnpm typecheck` and `pnpm exec biome check .` (from `apps/platform`). Expected: no errors (the 2 known `inertia/` warnings are fine). If Biome flags an unused import or formatting, run `pnpm exec biome check --write` on the touched files.

```bash
git add apps/platform/app apps/platform/tests
git commit -m "feat(platform): add ArtistService with conflicts, link rules and photo lifecycle"
```

### Task 3: Tenancy hooks: the independent artist's profile and the delete cascade

**Files:**
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts`
- Modify: `apps/platform/app/modules/tenancy/models/tenant.ts`
- Modify (tests): `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts`, `apps/platform/tests/functional/tenancy/onboarding.spec.ts`

**Interfaces:**
- Consumes: `ArtistService.createOwnerProfile`, `Artist` (Tasks 1 and 2).
- Produces: `new TenancyService(artists?)` where `artists` is `Pick<ArtistService, "createOwnerProfile">` and defaults to a real `ArtistService`; `createTenant` makes the profile for `type: "independent"`; `Tenant.softDelete` also soft-deletes the tenant's live artists.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts` add these imports (keep the existing ones, in Biome's sorted order):

```ts
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
```

Add inside the `TenancyService.createTenant` group, after the last test of that group:

```ts
	test("an independent artist gets a visible profile named after the tenant, linked to them", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, {
			...studio("sita-rai"),
			type: "independent",
			name: "Sita Rai",
		});

		const profiles = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(profiles, 1);
		assert.equal(profiles[0].name, "Sita Rai");
		assert.equal(profiles[0].slug, "sita-rai");
		assert.equal(profiles[0].userId, owner.id);
		assert.isTrue(profiles[0].visible);
		assert.isTrue(profiles[0].acceptingInquiries);
	});

	test("a studio gets no automatic profile", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		assert.isEmpty(
			await inTenant(tenant, () =>
				Artist.query().where("tenant_id", tenant.id),
			),
		);
	});

	test("a failing profile step rolls the tenant, its owner and the profile back", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const real = new ArtistService(new ImageService());
		let tenantId = "";
		// Inserts the profile for real, then fails: all of it must roll back.
		const failing = new TenancyService({
			createOwnerProfile: async (tenant, member) => {
				tenantId = tenant.id;
				await real.createOwnerProfile(tenant, member);
				throw new Error("profile failed");
			},
		});

		await assert.rejects(
			() =>
				failing.createTenant(owner, {
					...studio("sita-rai"),
					type: "independent",
				}),
			"profile failed",
		);

		assert.isNotEmpty(tenantId, "the profile step ran");
		await inTenant({ id: tenantId }, async () => {
			assert.isNull(await Tenant.find(tenantId));
			assert.isEmpty(
				await TenantMembership.query().where("tenant_id", tenantId),
			);
			assert.isEmpty(await Artist.query().where("tenant_id", tenantId));
		});
	});
```

Add next to the existing "soft-deleting a tenant soft-deletes its payment methods" test:

```ts
	test("soft-deleting a tenant soft-deletes its artists and keeps an earlier delete as it was", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, {
			...studio("sita-rai"),
			type: "independent",
		});
		const artists = new ArtistService(new ImageService());

		await inTenant(tenant, async () => {
			const removed = await artists.create(
				tenant,
				{
					name: "Old",
					slug: "old",
					bio: null,
					visible: true,
					acceptingInquiries: true,
					closedMessage: null,
					linkToMe: false,
				},
				owner,
			);
			await artists.delete(tenant, removed);
			const removedAt = (
				await Artist.withTrashed().where("id", removed.id).firstOrFail()
			).deletedAt?.toMillis();

			await tenant.softDelete();

			assert.isEmpty(await Artist.query().where("tenant_id", tenant.id));
			const trashed = await Artist.onlyTrashed().where("tenant_id", tenant.id);
			assert.lengthOf(trashed, 2, "the automatic profile and the removed one");
			assert.equal(
				trashed.find(({ id }) => id === removed.id)?.deletedAt?.toMillis(),
				removedAt,
			);
		});
	});
```

In `apps/platform/tests/functional/tenancy/onboarding.spec.ts` add `import Artist from "#modules/artists/models/artist";` and, inside the `Onboarding` group after "creates the tenant with the user as owner, then opens the dashboard":

```ts
	test("an independent artist's new tenant comes with their profile", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		await client
			.post("/onboarding")
			.form({ ...validTenant, type: "independent" })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const tenant = await inUser(user, () =>
			Tenant.findByOrFail("slug", "black-needle"),
		);
		const profiles = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(profiles, 1);
		assert.equal(profiles[0].name, "Black Needle");
		assert.equal(profiles[0].userId, user.id);
	});

	test("a studio's new tenant has no profile", async ({ client, assert }) => {
		const user = await makeUser();

		await client
			.post("/onboarding")
			.form(validTenant)
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const tenant = await inUser(user, () =>
			Tenant.findByOrFail("slug", "black-needle"),
		);
		assert.isEmpty(
			await inTenant(tenant, () =>
				Artist.query().where("tenant_id", tenant.id),
			),
		);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

`--files=tenancy_service.spec.ts` and `--files=onboarding.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: FAIL: no profile is created, the stub constructor argument does not type-check at runtime (it is ignored), and the soft-delete count is 1, not 2.

- [ ] **Step 3: Implement**

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts` add the imports (sorted):

```ts
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
```

Give the class a constructor and add the profile step. The container builds `TenancyService` with no injections (it has no `@inject()`), so the default is what runs in the app:

```ts
export default class TenancyService {
	/**
	 * `artists` is only replaceable so a test can make the profile step
	 * fail; everything else uses the default.
	 */
	constructor(
		private artists: Pick<
			ArtistService,
			"createOwnerProfile"
		> = new ArtistService(new ImageService()),
	) {}

	async createTenant(owner: User, input: NewTenant): Promise<Tenant> {
		try {
			// ... unchanged up to the membership insert ...
				await TenantMembership.create(
					{ tenantId: tenant.id, userId: owner.id, role: "owner" },
					{ client: trx },
				);
				// An independent artist is the tenant's only artist, so their
				// profile comes with it, in the same transaction.
				if (input.type === "independent") {
					await this.artists.createOwnerProfile(tenant, owner);
				}
				return tenant;
```

(Keep the rest of the method and its doc comment; add "and, for an independent artist, their profile" to the comment.)

In `apps/platform/app/modules/tenancy/models/tenant.ts` import `Artist from "#modules/artists/models/artist"` (above `PaymentMethod`), update the doc comment to "its live memberships, payment methods and artists", and add after the `PaymentMethod` update:

```ts
				await Artist.query({ client })
					.where("tenant_id", this.id)
					.whereNull("deleted_at")
					.update({ deleted_at: DateTime.utc().toSQL() });
```

- [ ] **Step 4: Run the tests to verify they pass**

`--files=tenancy_service.spec.ts`, `--files=onboarding.spec.ts`, `--files=soft_deletes.spec.ts`, `--files=access.spec.ts` and `--files=tenant_routes.spec.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck` and `pnpm exec biome check .`. Expected: no errors.

```bash
git add apps/platform/app apps/platform/tests
git commit -m "feat(platform): give an independent artist a profile and cascade tenant deletes"
```

---

### Task 4: The owner-only artists area: routes, controller, isolation cases

The route-coverage guard fails for a route without an isolation case, and page props are type-checked against the generated page types, so this task adds the routes, the controller, typed placeholder pages, the seed data and the cases together. Task 5 replaces the placeholders.

**Files:**
- Create: `apps/platform/app/controllers/artists_controller.ts`
- Create: `apps/platform/inertia/components/artists.ts`
- Create (placeholders): `apps/platform/inertia/pages/artists/index.tsx`, `apps/platform/inertia/pages/artists/form.tsx`
- Create: `apps/platform/tests/functional/artists/artists_page.spec.ts`, `apps/platform/tests/functional/artists/artist_form.spec.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/isolation/cases.ts`, `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Modify (generated): `apps/platform/.adonisjs/`

**Interfaces:**
- Consumes: `ArtistService`, validators, errors (Task 2), `tenantContext`, `ImageService.url`.
- Produces:
  - Routes `tenant.artists` (GET `/t/:tenant/artists`), `tenant.artists.create` (GET `/artists/new`), `tenant.artists.store` (POST `/artists`), `tenant.artists.edit` (GET `/artists/:id/edit`), `tenant.artists.update` (PUT `/artists/:id`), `tenant.artists.destroy` (DELETE `/artists/:id`), all owners only.
  - Page `artists/index` with props `{ artists: ArtistProps[] }`; page `artists/form` with props `{ artist: ArtistProps | null; canLink: boolean }`.
  - `ArtistProps = { id, name, slug, bio: string | null, photoUrl: string | null, visible, acceptingInquiries, closedMessage: string | null, isMine }` from `~/components/artists`.
  - Field errors: `slug` ("This link is already used by another artist."), `linkToMe` ("You already have a profile."), `photo` (the image error), plus the validators' own.
  - `Studio.artistProfile` (seeded) in `#tests/helpers/tenants`; isolation `resource: "artistProfile"`.

- [ ] **Step 1: Seed data, isolation cases and the route-group test (RED)**

In `apps/platform/tests/helpers/tenants.ts` add imports `import ArtistService from "#modules/artists/services/artist_service";` and seed a profile:

```ts
const paymentMethods = new PaymentMethodService(new ImageService());
const artists = new ArtistService(new ImageService());

async function studio(slug: string, name: string) {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const paymentMethod = await inTenant(tenant, async () => {
		// ... unchanged ...
	});
	// The same slug in both studios on purpose: it is unique per tenant.
	const artistProfile = await inTenant(tenant, () =>
		artists.create(
			tenant,
			{
				name: `${name} Sita`,
				slug: "sita",
				bio: null,
				visible: true,
				acceptingInquiries: true,
				closedMessage: null,
				linkToMe: false,
			},
			owner,
		),
	);
	return { tenant, owner, artist, paymentMethod, artistProfile };
}
```

Update the `twoStudios` doc comment: "...an owner, an artist, two payment methods (`paymentMethod` is the first) and an artist profile (`artistProfile`)."

In `apps/platform/tests/isolation/cases.ts`: import `Artist from "#modules/artists/models/artist"`; widen the union to `resource?: "paymentMethod" | "artistProfile";`; add the snapshot next to `methodRows`:

```ts
// Deleted rows included, so an unauthorized soft delete shows.
const artistRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await Artist.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("slug")
				.orderBy("id")
		).map((artist) => artist.serialize()),
	);
```

and append these cases to `isolationCases`:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/artists",
		actor: "owner",
		ownStatus: 200,
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/artists",
		actor: "owner",
		body: () => ({ name: "Another artist", slug: "another-artist" }),
		ownStatus: 302,
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists/:id/edit",
		resource: "artistProfile",
		actor: "owner",
		ownStatus: 200,
		snapshot: artistRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/artists/:id",
		resource: "artistProfile",
		actor: "owner",
		body: (own) => ({
			name: "Renamed artist",
			slug: own.artistProfile.slug,
		}),
		ownStatus: 302,
		snapshot: artistRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/artists/:id",
		resource: "artistProfile",
		actor: "owner",
		ownStatus: 302,
		snapshot: artistRows,
	},
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` turn the settings route-group test into a loop over both owner-only areas. Replace the whole `test("every settings route runs auth, then the tenant check, then owners only", ...)` with:

```ts
	for (const area of ["settings", "artists"]) {
		test(`every ${area} route runs auth, then the tenant check, then owners only`, ({
			assert,
		}) => {
			const routes = Object.values(router.toJSON())
				.flat()
				.filter(({ pattern }) =>
					new RegExp(`^/t/:tenant/${area}(/|$)`).test(pattern),
				);
			assert.isNotEmpty(routes);

			for (const route of routes) {
				const entries = [...route.middleware.all()].map((entry) =>
					typeof entry === "function" ? undefined : entry,
				);
				const names = entries.map((entry) => entry?.name);
				const auth = names.indexOf("auth");
				const tenant = names.indexOf("tenant");
				const role = names.indexOf("role");
				const dbContext = names.indexOf("dbContext");
				assert.isAbove(dbContext, auth, route.pattern);
				assert.isBelow(dbContext, tenant, route.pattern);
				assert.isAtLeast(auth, 0, route.pattern);
				assert.isAbove(tenant, auth, route.pattern);
				assert.isAbove(role, tenant, route.pattern);
				assert.deepEqual(
					entries[role]?.args,
					{ allow: ["owner"] },
					route.pattern,
				);
			}
		});
	}
```

- [ ] **Step 2: Write the HTTP specs (RED)**

Create `apps/platform/tests/functional/artists/artists_page.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const base = "/t/black-needle/artists";

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

test.group("Artists page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the artists by name, with photo URLs, and which one is theirs", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await artists.create(
				tenant,
				input({
					name: "bea",
					slug: "bea",
					photo: await uploadOf(await testImages.png()),
				}),
				owner,
			);
			await artists.create(
				tenant,
				input({ name: "Ada", slug: "ada", linkToMe: true, visible: false }),
				owner,
			);
		});

		const response = await client.get(base).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/index");
		const list = response.inertiaProps.artists;
		assert.deepEqual(
			list.map(({ name }: { name: string }) => name),
			["Ada", "bea"],
		);
		assert.isFalse(list[0].visible);
		assert.isTrue(list[0].isMine);
		assert.isNull(list[0].photoUrl);
		assert.isFalse(list[1].isMine);
		assert.match(new URL(list[1].photoUrl).pathname, /^\/uploads\/tenants\//);
		// The page gets what it shows, not the row.
		assert.notProperty(list[0], "tenantId");
		assert.notProperty(list[0], "userId");
	});

	test("an owner deletes an artist", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		const response = await client
			.delete(`${base}/${artist.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita Rai" deleted.');
		await inTenant(tenant, async () => {
			assert.isEmpty(await artists.list(tenant));
			const deleted = await Artist.withTrashed()
				.where("id", artist.id)
				.firstOrFail();
			assert.isNotNull(deleted.deletedAt);
		});
	});
});

test.group("Artists page access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist-role member gets 404 on every artists route", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		for (const request of [
			client.get(base),
			client.get(`${base}/new`),
			client.post(base).fields({ name: "Sneaky", slug: "sneaky" }),
			client.get(`${base}/${artist.id}/edit`),
			client
				.put(`${base}/${artist.id}`)
				.fields({ name: "Sneaky", slug: "sita" }),
			client.delete(`${base}/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(member);
			response.assertStatus(404);
		}
		const live = await inTenant(tenant, () => artists.list(tenant));
		assert.deepEqual(
			live.map(({ name }) => name),
			["Sita Rai"],
		);
	});

	test("another tenant's owner gets 404 on an artist, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { owner: blackNeedleOwner, tenant: blackNeedle } =
			await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		const artist = await inTenant(blackNeedle, () =>
			artists.create(blackNeedle, input(), blackNeedleOwner),
		);

		for (const request of [
			client.get(`/t/red-ink/artists/${artist.id}/edit`),
			client
				.put(`/t/red-ink/artists/${artist.id}`)
				.fields({ name: "Mine", slug: "mine" }),
			client.delete(`/t/red-ink/artists/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		const saved = await inTenant(blackNeedle, () =>
			Artist.findOrFail(artist.id),
		);
		assert.equal(saved.name, "Sita Rai");
		assert.isNull(saved.deletedAt);
	});

	test("a deleted artist gets 404 on edit, update and delete", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		await inTenant(tenant, () => artists.delete(tenant, artist));

		for (const request of [
			client.get(`${base}/${artist.id}/edit`),
			client
				.put(`${base}/${artist.id}`)
				.fields({ name: "Back", slug: "back" }),
			client.delete(`${base}/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("an id that isn't a UUID gets 404, not a server error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		for (const request of [
			client.get(`${base}/not-a-uuid/edit`),
			client.delete(`${base}/not-a-uuid`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
```

Create `apps/platform/tests/functional/artists/artist_form.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { testImages } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const artists = new ArtistService(new ImageService());
const base = "/t/black-needle/artists";

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

const listOf = (tenant: { id: string }) =>
	inTenant(tenant, () => artists.list(tenant));

test.group("Adding an artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form is empty and offers 'this is my profile'", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/form");
		assert.isNull(response.inertiaProps.artist);
		assert.isTrue(response.inertiaProps.canLink);
	});

	test("the form stops offering it once the owner has a profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		assert.isFalse(response.inertiaProps.canLink);
	});

	test("an owner adds an artist: the slug is normalized and unchecked boxes mean off", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "  SITA-Rai ", bio: "Fine line work" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita Rai" added.');
		const [artist] = await listOf(tenant);
		assert.equal(artist.slug, "sita-rai");
		assert.equal(artist.bio, "Fine line work");
		// Nothing was sent for the checkboxes: they were unchecked.
		assert.isFalse(artist.visible);
		assert.isFalse(artist.acceptingInquiries);
		assert.isNull(artist.userId);
	});

	test("checked boxes mean on, and 'this is my profile' links the owner", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.post(base)
			.fields({
				name: "Sita Rai",
				slug: "sita",
				visible: "on",
				acceptingInquiries: "on",
				linkToMe: "on",
				closedMessage: "Back in May",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [artist] = await listOf(tenant);
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
		assert.equal(artist.userId, owner.id);
		assert.equal(artist.closedMessage, "Back in May");
	});

	test("a taken slug comes back as a field error on slug and adds nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () => artists.create(tenant, input(), owner));

		const response = await client
			.post(base)
			.fields({ name: "Other", slug: "sita" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"slug",
			"This link is already used by another artist",
		);
		assert.lengthOf(await listOf(tenant), 1);
	});

	test("a second profile for the same owner comes back as a field error on linkToMe", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const response = await client
			.post(base)
			.fields({ name: "Again", slug: "again", linkToMe: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "linkToMe", "You already have a profile");
		assert.lengthOf(await listOf(tenant), 1);
	});

	for (const slug of ["a", "-ab", "ab-", "a b", "a_b", "x".repeat(64)]) {
		test(`rejects the slug ${JSON.stringify(slug)}`, async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner();

			const response = await client
				.post(base)
				.fields({ name: "Sita Rai", slug })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

			assertValidationError(response, "slug");
			assert.isEmpty(await listOf(tenant));
		});
	}

	test("an empty name or one over 120 characters comes back as a field error", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		for (const name of ["", "x".repeat(121)]) {
			const response = await client
				.post(base)
				.fields({ name, slug: "sita" })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(response, "name");
		}
		assert.isEmpty(await listOf(tenant));
	});

	test("a photo is stored and shown in the edit form", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [artist] = await listOf(tenant);
		assert.isNotNull(artist.photoKey);
		const edit = await client
			.get(`${base}/${artist.id}/edit`)
			.withInertia()
			.loginAs(owner);
		assert.match(
			new URL(edit.inertiaProps.artist.photoUrl).pathname,
			/^\/uploads\/tenants\//,
		);
	});

	test("a file that isn't an image comes back as a field error on photo", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.gif(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "photo");
		assert.isEmpty(await listOf(tenant));
	});
});

test.group("Editing an artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form shows the artist and offers the link only where it can succeed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});
		const [mine, theirs, loose] = await inTenant(tenant, async () => {
			const first = await artists.create(
				tenant,
				input({ name: "Mine", slug: "mine", linkToMe: true }),
				owner,
			);
			const second = await artists.create(
				tenant,
				input({ name: "Theirs", slug: "theirs" }),
				owner,
			);
			await Artist.query().where("id", second.id).update({ user_id: other.id });
			const third = await artists.create(
				tenant,
				input({ name: "Loose", slug: "loose" }),
				owner,
			);
			return [first, second, third];
		});
		const edit = async (id: string) =>
			(
				await client.get(`${base}/${id}/edit`).withInertia().loginAs(owner)
			).inertiaProps;

		const own = await edit(mine.id);
		assert.equal(own.artist.name, "Mine");
		assert.isTrue(own.artist.isMine);
		assert.isTrue(own.canLink);
		assert.isFalse((await edit(theirs.id)).canLink);
		// Linking "Loose" would be a second profile for the owner.
		assert.isFalse((await edit(loose.id)).canLink);
	});

	test("saving changes the fields and keeps the photo", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita", visible: "on" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner);
		const [artist] = await listOf(tenant);

		const response = await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita R.", slug: "sita-r", visible: "on", bio: "New" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita R." saved.');
		const [saved] = await listOf(tenant);
		assert.equal(saved.slug, "sita-r");
		assert.equal(saved.bio, "New");
		assert.equal(saved.photoKey, artist.photoKey);
	});

	test("unchecked boxes on an edit turn the artist off", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita" })
			.withCsrfToken()
			.loginAs(owner);

		const [saved] = await listOf(tenant);
		assert.isFalse(saved.visible);
		assert.isFalse(saved.acceptingInquiries);
	});

	test("an owner removes the photo", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner);
		const [artist] = await listOf(tenant);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita", removePhoto: "on" })
			.withCsrfToken()
			.loginAs(owner);

		const [saved] = await listOf(tenant);
		assert.isNull(saved.photoKey);
		assert.isNull(saved.photoWidth);
	});

	test("saving a slug another artist uses comes back as a field error and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const first = await inTenant(tenant, async () => {
			await artists.create(
				tenant,
				input({ name: "Bea", slug: "bea" }),
				owner,
			);
			return artists.create(tenant, input(), owner);
		});

		const response = await client
			.put(`${base}/${first.id}`)
			.fields({ name: "Renamed", slug: "bea" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "slug");
		const saved = await inTenant(tenant, () => Artist.findOrFail(first.id));
		assert.equal(saved.name, "Sita Rai");
		assert.equal(saved.slug, "sita");
	});
});
```

Run `--files=artists_page.spec.ts`, `--files=artist_form.spec.ts`, `--files=tenant_routes.spec.ts` and `--files=cross_tenant.spec.ts`. Expected: FAIL (404 on every artists URL; "cases for routes that no longer exist").

- [ ] **Step 3: Types, placeholder pages and the controller**

Create `apps/platform/inertia/components/artists.ts`:

```ts
/**
 * An artist profile as the artists pages get it.
 */
export type ArtistProps = {
	id: string;
	name: string;
	slug: string;
	bio: string | null;
	photoUrl: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	closedMessage: string | null;
	/** Linked to the signed-in user. */
	isMine: boolean;
};
```

Create the two placeholders. They exist so the generated page types (and the props the controller sends) type-check; Task 5 replaces both files completely.

`apps/platform/inertia/pages/artists/index.tsx`:

```tsx
import type { ArtistProps } from "~/components/artists";

// Placeholder: Task 5 builds the page.
export default function Artists(_props: { artists: ArtistProps[] }) {
	return null;
}
```

`apps/platform/inertia/pages/artists/form.tsx`:

```tsx
import type { ArtistProps } from "~/components/artists";

// Placeholder: Task 5 builds the page.
export default function ArtistForm(_props: {
	artist: ArtistProps | null;
	canLink: boolean;
}) {
	return null;
}
```

Create `apps/platform/app/controllers/artists_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import {
	createArtistValidator,
	updateArtistValidator,
} from "#modules/artists/validators/artist";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";

/**
 * The studio's artist profiles, managed by its owners. Every :id loads
 * through findFor(tenant, id), so another tenant's artist is a 404.
 */
@inject()
export default class ArtistsController {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;
		const list = await this.artists.list(tenant);

		return ctx.inertia.render("artists/index", {
			artists: await Promise.all(list.map((artist) => this.toProps(artist, userId))),
		});
	}

	async create(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;

		return ctx.inertia.render("artists/form", {
			artist: null,
			canLink: !(await this.hasProfile(tenant, userId)),
		});
	}

	async store(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		const data = await ctx.request.validateUsing(createArtistValidator);

		const artist = await asFieldErrors(() =>
			this.artists.create(tenant, toInput(data), user),
		);

		ctx.session.flash("success", `"${artist.name}" added.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	async edit(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;
		const artist = await this.artists.findFor(tenant, ctx.params.id);
		// Linking has to succeed: not to someone else's profile, and not a
		// second profile for the same person.
		const canLink =
			artist.userId === userId ||
			(artist.userId === null && !(await this.hasProfile(tenant, userId)));

		return ctx.inertia.render("artists/form", {
			artist: await this.toProps(artist, userId),
			canLink,
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		// Load first: another tenant's id is a 404 even with a bad body.
		const artist = await this.artists.findFor(tenant, ctx.params.id);
		const data = await ctx.request.validateUsing(updateArtistValidator);

		const saved = await asFieldErrors(() =>
			this.artists.update(tenant, artist, toInput(data), user),
		);

		ctx.session.flash("success", `"${saved.name}" saved.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const artist = await this.artists.findFor(tenant, ctx.params.id);

		await this.artists.delete(tenant, artist);

		ctx.session.flash("success", `"${artist.name}" deleted.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	/**
	 * Whether the user already has a live profile in the tenant.
	 */
	private async hasProfile(tenant: { id: string }, userId: string) {
		const list = await this.artists.list(tenant);
		return list.some((artist) => artist.userId === userId);
	}

	/**
	 * What the pages get for one artist, with the photo's public URL. Not the
	 * row: the tenant and the linked user's id stay on the server.
	 */
	private async toProps(artist: Artist, userId: string) {
		return {
			id: artist.id,
			name: artist.name,
			slug: artist.slug,
			bio: artist.bio,
			photoUrl: artist.photoKey
				? await this.images.url("artist_photo", artist.photoKey)
				: null,
			visible: artist.visible,
			acceptingInquiries: artist.acceptingInquiries,
			closedMessage: artist.closedMessage,
			isMine: artist.userId === userId,
		};
	}
}

/**
 * The service's input from the validated body. A checkbox that is not
 * checked is not sent at all, so a missing boolean means off.
 */
function toInput(data: Infer<typeof updateArtistValidator>): ArtistInput {
	return {
		name: data.name,
		slug: data.slug,
		bio: data.bio ?? null,
		visible: data.visible ?? false,
		acceptingInquiries: data.acceptingInquiries ?? false,
		closedMessage: data.closedMessage ?? null,
		linkToMe: data.linkToMe ?? false,
		photo: data.photo,
		removePhoto: data.removePhoto ?? false,
	};
}

function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}

/**
 * Turns the service's conflicts and an unusable image into field errors, so
 * the form shows them next to their inputs.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof ArtistSlugTakenError) {
			throw fieldError("slug", "This link is already used by another artist.", "unique");
		}
		if (error instanceof ArtistProfileExistsError) {
			throw fieldError("linkToMe", "You already have a profile.", "unique");
		}
		if (error instanceof InvalidImageError) {
			throw fieldError("photo", error.message, "image");
		}
		throw error;
	}
}
```

- [ ] **Step 4: Routes and generated types**

In `apps/platform/start/routes.ts` add a second nested group inside the `/t/:tenant` group, right after the settings group (before the closing `})` of the tenant group):

```ts
		/**
		 * Artist profiles, owners only for now: artists get the same 404 as
		 * an unknown URL. TAT-30 opens this area to artists by changing the
		 * allow list. Every artists route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router.get("/", [controllers.Artists, "index"]).as("tenant.artists");
				router
					.get("new", [controllers.Artists, "create"])
					.as("tenant.artists.create");
				router
					.post("/", [controllers.Artists, "store"])
					.as("tenant.artists.store");
				router
					.get(":id/edit", [controllers.Artists, "edit"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.edit");
				router
					.put(":id", [controllers.Artists, "update"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.update");
				router
					.delete(":id", [controllers.Artists, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.destroy");
			})
			.prefix("/artists")
			.use(middleware.role({ allow: ["owner"] }));
```

Then regenerate: `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres node ace codegen` (wrap in `timeout -s KILL 120`). Expected: `.adonisjs/` gains `controllers.Artists`, the `artists/index` and `artists/form` pages and the six route names. `git status` shows only `.adonisjs/` files changed besides yours.

- [ ] **Step 5: Run the tests to verify they pass**

`--files=artists_page.spec.ts`, `--files=artist_form.spec.ts`, `--files=tenant_routes.spec.ts`, `--files=cross_tenant.spec.ts`, `--files=harness.spec.ts`, `--files=payments_page.spec.ts` (inline variables, `timeout -s KILL 240`). Expected: PASS. In `cross_tenant.spec.ts` each new case passes its positive control (`ownStatus`) and its two attacks (a 404 each, studio B unchanged).

- [ ] **Step 6: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`. Expected: no errors.

```bash
git add apps/platform
git commit -m "feat(platform): add the owner-only artists area"
```

---

### Task 5: The pages, the navigation entry and the shared slug helper

No automated test: the project has no frontend test runner, and the HTTP specs already check every prop the pages read. The gates are typecheck, Biome and a production build; the controller then does a manual pass in a browser (Task 7).

**Files:**
- Create: `apps/platform/inertia/lib/slugify.ts`
- Replace: `apps/platform/inertia/pages/artists/index.tsx`, `apps/platform/inertia/pages/artists/form.tsx`
- Modify: `apps/platform/inertia/pages/onboarding/create_tenant.tsx`, `apps/platform/inertia/layouts/app.tsx`

**Interfaces:**
- Consumes: `ArtistProps` (Task 4), the routes `tenant.artists*`, `useTenant`, `Page`, the shadcn `Card`, `Checkbox`, `Field*`, `Input`, `Textarea`, `Badge`, `Empty*`.
- Produces: `slugify(name)` from `~/lib/slugify`; the two real pages; an "Artists" nav entry for owners.

- [ ] **Step 1: Extract `slugify`**

Create `apps/platform/inertia/lib/slugify.ts` with the function moved from `onboarding/create_tenant.tsx`, unchanged except that the combining-mark range is written with escapes (the same characters, U+0300 to U+036F):

```ts
/**
 * Turns a business or artist name into a slug: lowercase letters, digits
 * and single hyphens, at most 63 characters.
 */
export function slugify(name: string) {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/, "");
}
```

In `inertia/pages/onboarding/create_tenant.tsx` delete the local `slugify` (with its doc comment) and add `import { slugify } from "~/lib/slugify";` in sorted position.

- [ ] **Step 2: The navigation entry**

In `inertia/layouts/app.tsx` import `Users` from `lucide-react` (`import { House, LogOut, Settings, Users } from "lucide-react";`) and change the owner block of `tenantNav` to:

```tsx
	// Owners only; the server 404s anyone else.
	if (tenant.role === "owner") {
		items.push(
			{
				label: "Artists",
				route: "tenant.artists",
				params,
				icon: Users,
			},
			{
				label: "Settings",
				route: "tenant.settings",
				params,
				icon: Settings,
			},
		);
	}
```

- [ ] **Step 3: The list page**

Replace `apps/platform/inertia/pages/artists/index.tsx`:

```tsx
import { Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { Pencil, Plus, Trash2, User, Users } from "lucide-react";
import { urlFor } from "~/client";
import type { ArtistProps } from "~/components/artists";
import Page from "~/components/page";
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
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

export default function Artists({ artists }: { artists: ArtistProps[] }) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const add = (
		<Link
			route="tenant.artists.create"
			routeParams={params}
			className={buttonVariants()}
		>
			<Plus data-icon="inline-start" />
			Add an artist
		</Link>
	);

	return (
		<Page
			title="Artists"
			description="The artists clients can book. A hidden artist doesn't show anywhere public."
			actions={artists.length > 0 ? add : undefined}
		>
			{artists.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Users />
						</EmptyMedia>
						<EmptyTitle>No artists yet</EmptyTitle>
						<EmptyDescription>
							Add the artists who work here, each with their own photo, bio
							and link.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{add}</EmptyContent>
				</Empty>
			) : (
				<div className="flex flex-col gap-3">
					{artists.map((artist) => (
						<ArtistRow key={artist.id} artist={artist} tenantSlug={tenant.slug} />
					))}
				</div>
			)}
		</Page>
	);
}

function ArtistRow({
	artist,
	tenantSlug,
}: {
	artist: ArtistProps;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: artist.id };

	const remove = () => {
		if (
			window.confirm(
				`Delete "${artist.name}"? Their link stops working and clients won't see them.`,
			)
		) {
			router.delete(urlFor("tenant.artists.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
			{artist.photoUrl ? (
				<img
					src={artist.photoUrl}
					alt={artist.name}
					className="size-16 rounded-md border object-cover"
				/>
			) : (
				<div className="flex size-16 items-center justify-center rounded-md border bg-muted text-muted-foreground">
					<User />
				</div>
			)}
			{/* min-w-40: on narrow screens the actions wrap below instead. */}
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{artist.name}</span>
					{artist.isMine && <Badge>You</Badge>}
					{!artist.visible && <Badge variant="secondary">Hidden</Badge>}
					{!artist.acceptingInquiries && (
						<Badge variant="outline">Not accepting inquiries</Badge>
					)}
				</div>
				<p className="truncate text-sm text-muted-foreground">/{artist.slug}</p>
			</div>
			<div className="ml-auto flex items-center gap-1">
				<Link
					route="tenant.artists.edit"
					routeParams={params}
					aria-label={`Edit ${artist.name}`}
					className={buttonVariants({ variant: "ghost", size: "icon" })}
				>
					<Pencil />
				</Link>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Delete ${artist.name}`}
					onClick={remove}
				>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

Artists.layout = [AppLayout];
```

- [ ] **Step 4: The form page**

Replace `apps/platform/inertia/pages/artists/form.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import type { ArtistProps } from "~/components/artists";
import Page from "~/components/page";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import { slugify } from "~/lib/slugify";

type Errors = Partial<Record<string, string>>;

/**
 * Adds an artist (`artist` is null) or edits one. `canLink` says whether
 * "This is my profile" can succeed for the signed-in owner.
 */
export default function ArtistForm({
	artist,
	canLink,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<Page title={artist ? "Edit artist" : "Add an artist"}>
			<Card className="max-w-2xl">
				<CardContent>
					{artist ? (
						<Form
							route="tenant.artists.update"
							routeParams={{ ...params, id: artist.id }}
						>
							{({ errors, processing }) => (
								<ArtistFields
									artist={artist}
									canLink={canLink}
									errors={errors}
									processing={processing}
									tenantSlug={tenant.slug}
								/>
							)}
						</Form>
					) : (
						<Form route="tenant.artists.store" routeParams={params}>
							{({ errors, processing }) => (
								<ArtistFields
									artist={null}
									canLink={canLink}
									errors={errors}
									processing={processing}
									tenantSlug={tenant.slug}
								/>
							)}
						</Form>
					)}
				</CardContent>
			</Card>
		</Page>
	);
}

function ArtistFields({
	artist,
	canLink,
	errors,
	processing,
	tenantSlug,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
	errors: Errors;
	processing: boolean;
	tenantSlug: string;
}) {
	const [name, setName] = useState(artist?.name ?? "");
	const [slug, setSlug] = useState(artist?.slug ?? "");
	// A new artist's link follows the name until the owner edits it; an
	// existing link never changes by itself.
	const [slugTouched, setSlugTouched] = useState(artist !== null);
	const slugChanged = artist !== null && slug !== artist.slug;

	return (
		<FieldGroup>
			<Field data-invalid={!!errors.name}>
				<FieldLabel htmlFor="name">Name</FieldLabel>
				<Input
					id="name"
					name="name"
					maxLength={120}
					autoComplete="off"
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						if (!slugTouched) setSlug(slugify(event.target.value));
					}}
					aria-invalid={!!errors.name}
				/>
				{errors.name && <FieldError>{errors.name}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.slug}>
				<FieldLabel htmlFor="slug">Link</FieldLabel>
				<Input
					id="slug"
					name="slug"
					autoComplete="off"
					spellCheck={false}
					value={slug}
					onChange={(event) => {
						setSlugTouched(true);
						setSlug(event.target.value);
					}}
					aria-invalid={!!errors.slug}
				/>
				<FieldDescription>
					Lowercase letters, numbers and hyphens, 2 to 63 characters. It ends
					this artist&apos;s own link.
				</FieldDescription>
				{slugChanged && (
					<FieldDescription className="text-destructive" role="status">
						Changing the link breaks the old one: anyone you already sent it
						to will no longer reach this artist.
					</FieldDescription>
				)}
				{errors.slug && <FieldError>{errors.slug}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.bio}>
				<FieldLabel htmlFor="bio">Bio</FieldLabel>
				<Textarea
					id="bio"
					name="bio"
					rows={5}
					maxLength={1000}
					defaultValue={artist?.bio ?? ""}
					aria-invalid={!!errors.bio}
				/>
				{errors.bio && <FieldError>{errors.bio}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.photo}>
				<FieldLabel htmlFor="photo">Photo</FieldLabel>
				{artist?.photoUrl && (
					<div className="flex flex-wrap items-center gap-4">
						<img
							src={artist.photoUrl}
							alt={`Current photo of ${artist.name}`}
							className="size-24 rounded-md border object-cover"
						/>
						<Field orientation="horizontal" className="w-auto">
							<Checkbox id="removePhoto" name="removePhoto" />
							<FieldLabel htmlFor="removePhoto" className="font-normal">
								Remove this photo
							</FieldLabel>
						</Field>
					</div>
				)}
				<Input
					id="photo"
					name="photo"
					type="file"
					accept="image/jpeg,image/png,image/webp"
					aria-invalid={!!errors.photo}
				/>
				<FieldDescription>
					JPEG, PNG or WebP, up to 10 MB.
					{artist?.photoUrl ? " Choose a file to replace the current one." : ""}
				</FieldDescription>
				{errors.photo && <FieldError>{errors.photo}</FieldError>}
			</Field>

			<Field orientation="horizontal">
				<Checkbox
					id="visible"
					name="visible"
					defaultChecked={artist?.visible ?? true}
				/>
				<FieldContent>
					<FieldLabel htmlFor="visible">Show on the public page</FieldLabel>
					<FieldDescription>
						Uncheck to hide this artist everywhere clients can see.
					</FieldDescription>
					{errors.visible && <FieldError>{errors.visible}</FieldError>}
				</FieldContent>
			</Field>

			<Field orientation="horizontal">
				<Checkbox
					id="acceptingInquiries"
					name="acceptingInquiries"
					defaultChecked={artist?.acceptingInquiries ?? true}
				/>
				<FieldContent>
					<FieldLabel htmlFor="acceptingInquiries">
						Accepting new inquiries
					</FieldLabel>
					<FieldDescription>
						Uncheck while the books are closed: the artist stays visible, but
						clients can&apos;t send a request.
					</FieldDescription>
					{errors.acceptingInquiries && (
						<FieldError>{errors.acceptingInquiries}</FieldError>
					)}
				</FieldContent>
			</Field>

			<Field data-invalid={!!errors.closedMessage}>
				<FieldLabel htmlFor="closedMessage">Message when closed</FieldLabel>
				<Textarea
					id="closedMessage"
					name="closedMessage"
					rows={2}
					maxLength={300}
					defaultValue={artist?.closedMessage ?? ""}
					placeholder="Books reopen in May."
					aria-invalid={!!errors.closedMessage}
				/>
				<FieldDescription>
					Shown instead of the request form while inquiries are off.
				</FieldDescription>
				{errors.closedMessage && <FieldError>{errors.closedMessage}</FieldError>}
			</Field>

			{canLink && (
				<Field orientation="horizontal">
					<Checkbox
						id="linkToMe"
						name="linkToMe"
						defaultChecked={artist?.isMine ?? false}
					/>
					<FieldContent>
						<FieldLabel htmlFor="linkToMe">This is my profile</FieldLabel>
						<FieldDescription>
							Links the profile to your login. You can have one per studio.
						</FieldDescription>
						{errors.linkToMe && <FieldError>{errors.linkToMe}</FieldError>}
					</FieldContent>
				</Field>
			)}

			<div className="flex gap-2">
				<Button type="submit" disabled={processing}>
					{processing ? "Saving…" : artist ? "Save" : "Add artist"}
				</Button>
				<Link
					route="tenant.artists"
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({ variant: "ghost" })}
				>
					Cancel
				</Link>
			</div>
		</FieldGroup>
	);
}

ArtistForm.layout = [AppLayout];
```

- [ ] **Step 5: Typecheck, lint, build and commit**

From `apps/platform`: `pnpm typecheck`, `pnpm exec biome check .` (only the 2 known `inertia/` warnings may remain; if Biome reports formatting, run `pnpm exec biome check --write inertia`), then `pnpm build` (add the inline variables if it complains about env). Expected: all succeed. Then re-run `--files=artists_page.spec.ts` and `--files=onboarding.spec.ts`: PASS.

```bash
git add apps/platform/inertia
git commit -m "feat(platform): add the artists pages and navigation"
```

---

### Task 6: Documentation

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`
- Read and, only if something contradicts, modify: `docs/data-model.md`

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`:

1. In the Tenancy bullet (line starting `- Tenancy: the tenancy module`), replace the last sentence "Soft-deleting a tenant (`tenant.softDelete(trx?)`) also soft-deletes its live memberships." with "`createTenant` also gives an independent artist their own artist profile (`ArtistService.createOwnerProfile`) in the same transaction; a studio gets none. Soft-deleting a tenant (`tenant.softDelete(trx?)`) also soft-deletes its live memberships, payment methods and artists."
2. Also in the Tenancy-and-route-access section, in the bullet starting `- Tenant pages live in the`, replace "Studio settings (`/t/:tenant/settings/…`) are owners only. They go in the nested settings group, and a test fails for a settings route without the role check." with "Studio settings (`/t/:tenant/settings/…`) and the artists area (`/t/:tenant/artists/…`) are owners only. They go in their nested groups, and a test fails for a route in either area without the role check."
3. After the `## Payments` section add:

```md
## Artists

- Artists: the `artists` module (`app/modules/artists/`) owns the public profiles of a tenant's artists. Read and change them through `ArtistService` (`#modules/artists/services/artist_service`): `list(tenant)` (by name), `findFor(tenant, id)` (a 404 for an unknown, deleted or other tenant's id), `create`, `update`, `delete` (soft) and `createOwnerProfile`. `create` and `update` take the signed-in member: `linkToMe` links the profile to them, never takes over a profile that is linked to someone else, and unchecking it unlinks only them, so a profile is only ever linked to a proven member (TAT-33's claim path adds its own check before linking anyone else). They throw `ArtistSlugTakenError` or `ArtistProfileExistsError` after rolling back their own savepoint; the controller turns them into field errors. A slug is unique among a tenant's live artists, so a deleted profile frees it. The photo is the `artist_photo` image purpose (public) with the usual `store` / `afterRollback` / `afterCommit` lifecycle. `user_id` is optional and `ON DELETE SET NULL`: deleting an account keeps the public profile, and TAT-33 must unlink, not delete, a removed member's profile. The dashboard area is owners only for now; TAT-30 opens it to artists by changing the allow list. Public reads (visible profiles only) are TAT-44.
```

- [ ] **Step 2: Testing conventions**

In `apps/platform/docs/testing.md` line 33, change "`twoStudios()` gives studios A and B, each with an owner, an artist and two payment methods." to "`twoStudios()` gives studios A and B, each with an owner, an artist (a user with the artist role), two payment methods and an artist profile (`artistProfile`)."

- [ ] **Step 3: Data model check**

Read the Artist section of `docs/data-model.md` and compare it with the migration. Change a sentence only if it contradicts a column or rule (for example a field that does not exist, or a wrong delete rule); do not rewrite its conceptual text otherwise. Say in the commit body what changed, or that nothing did.

- [ ] **Step 4: Commit**

```bash
git add apps/platform/docs docs
git commit -m "docs(platform): document the artists module"
```

---

### Task 7: Verification and review gates (run by the controller, not by an implementer)

Nothing here adds code; fix rounds go back to implementers.

- [ ] **Step 1: Everything green on the final head**

From `apps/platform`, with the inline variables: `timeout -s KILL 900 node ace test` (all suites: unit and functional; expect the previous 323 plus the new specs, no failures). Then `pnpm typecheck`; from the repo root `pnpm check` (only the 2 old `inertia/` warnings). Then `node ace codegen` and `git status --short`: no changes. Then check for stray `node ace` processes.

- [ ] **Step 2: The migration on a fresh database**

Create a scratch database, migrate it from zero as the owner, and drop it (host and port as in `.env.example`; `psql` as the `postgres` user with the dev password):

```bash
createdb -h <DB_HOST> -p <DB_PORT> -U postgres tattoo_drip_scratch
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate
git status --short   # database/schema.ts must be unchanged
dropdb -h <DB_HOST> -p <DB_PORT> -U postgres tattoo_drip_scratch
```

Expected: every migration runs, `database/schema.ts` is unchanged, the database is dropped.

- [ ] **Step 3: Reviews**

Final whole-branch review by an Opus reviewer against the spec and this plan's Review Focus (all six items must have a test that fails without the behavior). Then the `codex-review` skill (Codex code review and security review). Fix confirmed findings, re-verify, commit. Do not push or open the PR without the user's go-ahead.

- [ ] **Step 4: Manual pass (the user, in a browser)**

With `pnpm dev`: create a studio profile with and without a photo; edit its slug (the warning shows) and save; hide it; switch accepting inquiries off with a message; delete it (the confirm shows); sign up a new independent artist and see the automatic profile, marked "You"; confirm that a member with the artist role (invite arrives with TAT-33, so use the database or a test account) gets a 404 on `/t/<slug>/artists`.
