# Inquiry-to-Deposit Models (TAT-37) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the six tenant-owned tables of the inquiry-to-deposit loop (`clients`, `inquiries`, `tattoo_projects`, `reference_images`, `quotes`, `payments`) with Lucid models, composite tenant foreign keys, row-level security, and two guard triggers (payments are append-only, an inquiry is a frozen record), data layer only.

**Architecture:** One migration per table in dependency order, each running `enableTenantRls` and linking other tenant-owned tables with `tenantReference(…, "NO ACTION")`. Models live in the modules from the architecture table (`clients`, `inquiries`, `projects`, `payments`) with their allowed-value arrays in the model files. The two triggers are `FOR EACH ROW` plpgsql functions that freeze every column except a named allow-list. Tests prove the database rules with raw SQL (as `artists_table.spec.ts` does) plus model-level checks; new shared test helpers (`sql`, `rls`, `pipeline`) keep the six specs short.

**Tech Stack:** AdonisJS 7, Lucid 22.4.2, PostgreSQL 18 (plpgsql triggers), Japa, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-tat-37-pipeline-models-design.md` (approved, Opus-reviewed). Read it first; it is the binding authority and this plan follows it.

## Notes where the plan goes beyond the spec

1. Three shared test helpers are added: `tests/helpers/sql.ts` (raw-SQL `sql`, `insertRow`, `updateRow`), `tests/helpers/rls.ts` (`assertRowLevelSecurity`, one proof used by all six table specs) and `tests/helpers/pipeline.ts` (model factories plus `seedPipeline`). The spec only names `pipeline.ts`.
2. The spec's "RLS isolation" test list is implemented once, in `assertRowLevelSecurity`; on `inquiries` and `payments` it asserts the trigger's message for the "move a row" case, as the spec requires.

## Corrections made while executing

The plan text above was corrected after the work to match what shipped; the differences were found by the per-task reviews:

1. **`quotes_deposit_within_total` computes in bigint** (`round(hourly_rate::bigint * estimated_minutes / 60.0)`). The first version multiplied two int4 columns and raised `integer out of range` for a legitimate quote (NPR 10,000 an hour for 40 hours). Tests pin 40,000,000 accepted and 40,000,001 rejected, and the half-up rounding.
2. **The inquiries guard names its trigger in its messages** (`inquiries_guard_update: <column> cannot change`), as the spec's convention says; the first version said `inquiries_guard:`.
3. **`Tenant.softDelete` reads its cascade list through a function**, not a module constant: `tenant_membership.ts` imports `tenant.ts`, so a constant read while the module loads crashed whenever the membership model loaded first.
4. **Each "cannot be hard-deleted" test leg is refused by a row that only that foreign key references**, and each new composite key's `NO ACTION` is proven by a temporary `CASCADE` mutation (a Task 3 review found a leg masked by a second key).
5. Lucid leaves unset nullable columns `undefined` after `create()`, so tests that assert `isNull` on a fresh model `refresh()` it first.

## Global Constraints

- PostgreSQL 18. Primary keys are `uuidv7()`; instants are `timestamptz`; enums are `table.enum` string columns (check constraints); money is integer paisa plus `currency varchar(3)` default `NPR`.
- Soft delete (`deleted_at` + `withSoftDeletes`) on every table **except `payments` and `quotes`**, which are history.
- Every table: `enableTenantRls()` in its migration and a `tenant_isolation:ALL` entry in `EXPECTED_POLICIES` (`tests/functional/rls/catalog_guard.spec.ts`), added in the same task as the migration (the guard fails for a table without its entry, and for an entry without its table).
- Composite foreign keys between tenant-owned tables: `tenantReference(table, "<col>", "<parent>", "NO ACTION")` (the helper's default is CASCADE; always pass `"NO ACTION"`). `payments.verified_by_user_id` references `users` with `ON DELETE SET NULL`. Each composite FK gets an index on `(tenant_id, <column>)` unless a listed index already starts with those columns; `payments.verified_by_user_id` gets a plain index.
- Triggers (`inquiries_guard_update`, `payments_guard`): `FOR EACH ROW`; fail closed (a named allow-list of changeable columns, every other column frozen via `to_jsonb(new)` vs `to_jsonb(old)`); stable messages `<trigger>: <column> cannot change`; the migration's `down()` drops the trigger **function** too.
- Never put a `?` character in SQL passed to `this.schema.raw` (knex treats it as a binding placeholder). Write the phone-regex plus as `[+]`.
- The module never imports the `db` service (a Biome rule fails `pnpm check`). Use models, `withTransaction`, `dbClient()` in app code; tests use `withDbContext`/`withTransaction` and raw queries on the passed transaction.
- pnpm only; Biome, tabs and double quotes. Never edit `database/schema.ts` or `.adonisjs/` by hand: `pnpm migrate` regenerates the schema, then `pnpm exec biome check --write database/schema.ts`.
- **Every command that boots the app carries these inline variables** (the user's `.env` may not have them), and tests use port 3402:
  `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402`
  Wrap runs in `timeout -s KILL <seconds>`: a spec that fails to import makes `node ace test` hang. Test filters are the full file name: `node ace test functional --files=clients_table.spec.ts`, never the bare stem. Check afterwards for stray `node ace` processes (exact PIDs only).
- Never read or edit any `.env` file (a deny rule protects them; `.env.example` is fine). Do not touch anything under `docs/superpowers/` (the controller does).
- Conventional Commits with scope `platform`. End every commit message with the trailer the session specifies. Never push.

## Review Focus

Failure modes the spec implies but that no obvious test reaches; each has a test in the task named.

1. Lucid's own writes pass the triggers: `save()` (which sets `updated_at`), `softDelete()` and `restore()` on an `Inquiry`, and `save()` when verifying or rejecting a `Payment` (Tasks 2 and 6).
2. Deleting a user whose account verified a decided payment still works and nulls `verified_by_user_id` (the trigger carve-out), and a decided payment's status cannot change (Task 6).
3. A link through a nullable column is still checked when set and skipped when null: `preferred_artist_id`, `artist_id`, `inquiry_id`, `project_id` (Tasks 2 to 4).
4. Anonymization: the contact snapshot and free-text fields are frozen until `anonymized_at` is set, may be scrubbed in that update, and `anonymized_at` never changes afterwards; several anonymized clients (null phones) can coexist in a tenant (Tasks 1 and 2).
5. A soft-deleted client frees its phone for a returning client, and a soft-deleted project frees its inquiry for a new project; `Tenant.softDelete` leaves quotes and payments alone and never touches another tenant's rows (Tasks 1, 3 and 7).

---

## File Structure

Create (all under `apps/platform/` unless noted):

| File | Responsibility |
|---|---|
| `database/migrations/1791590000000_create_clients_table.ts` … `1791590000005_create_payments_table.ts` | The six tables, checks, indexes, RLS, and the two trigger functions |
| `app/modules/clients/models/client.ts` | `Client` |
| `app/modules/inquiries/models/inquiry.ts`, `reference_image.ts` | `Inquiry` (+ `INQUIRY_STATUSES`, `SOURCE_CHANNELS`), `ReferenceImage` |
| `app/modules/projects/models/tattoo_project.ts`, `quote.ts` | `TattooProject` (+ `PROJECT_STATUSES`), `Quote` (+ `QUOTE_KINDS`) |
| `app/modules/payments/models/payment.ts` | `Payment` (+ `PAYMENT_KINDS`, `PAYMENT_STATUSES`) |
| `tests/helpers/sql.ts`, `tests/helpers/rls.ts`, `tests/helpers/pipeline.ts` | Shared test helpers |
| `tests/functional/{clients,inquiries,projects,payments}/*_table.spec.ts` | One spec per table (database rules + model checks) |

Modify: `database/schema.ts` (generated), `app/modules/media/services/image_service.ts` (new purpose), `app/modules/tenancy/models/tenant.ts`, `tests/helpers/tenants.ts`, `tests/functional/rls/catalog_guard.spec.ts`, `tests/functional/tenancy/tenancy_service.spec.ts`, `docs/backend.md`, `docs/testing.md`, `database/README.md` (all under `apps/platform/`), and `docs/data-model.md`, `docs/requirements.md` (repo root `docs/`).

---

### Task 1: `clients`, the shared test helpers, and the first model

The first table also lands the helpers every later task uses. The catalog guard is the first RED signal (it fails for an entry whose table does not exist).

**Files:**
- Create: `apps/platform/tests/helpers/sql.ts`, `apps/platform/tests/helpers/rls.ts`, `apps/platform/tests/helpers/pipeline.ts`
- Create: `apps/platform/database/migrations/1791590000000_create_clients_table.ts`
- Create: `apps/platform/app/modules/clients/models/client.ts`
- Create: `apps/platform/tests/functional/clients/clients_table.spec.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Produces:
  - Table `clients`; `ClientSchema` (generated) with `id, tenantId, name, phone, email, notes, anonymizedAt, createdAt, updatedAt, deletedAt`; `Client` (default export of `#modules/clients/models/client`).
  - Constraint/index names `clients_phone_e164`, `clients_phone_unless_anonymized`, `clients_tenant_phone_live_unique`.
  - `#tests/helpers/sql`: `sql(context, query, bindings?)`, `insertRow(client, table, values)` (INSERT one row from column/value pairs, fills `created_at`, returns `{ rows: [{ id }] }`), `updateRow(client, table, id, set)`.
  - `#tests/helpers/rls`: `assertRowLevelSecurity(assert, table, seed, moved?)` where `seed(tenant)` runs its own `inTenant(...)`, creates the row's parents and returns the column/value pairs of a fresh INSERT naming that tenant.
  - `#tests/helpers/pipeline`: `makeClient(tenant, over?)` (call inside `inTenant(tenant, …)`).

- [ ] **Step 1: Write the helpers, the spec and the catalog entry**

Create `apps/platform/tests/helpers/sql.ts`:

```ts
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { type DbContextValues, withDbContext } from "#services/db_context";

/**
 * Raw SQL in a database context. Raw on purpose: these tests prove what the
 * database itself enforces, whatever the models do.
 */
export const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

/**
 * INSERTs one row from column/value pairs (created_at is filled in). When a
 * test expects the insert to fail, run it through withTransaction so the
 * failure rolls back to a savepoint and the test can go on.
 */
export function insertRow(
	client: QueryClientContract,
	table: string,
	values: Record<string, unknown>,
) {
	const columns = Object.keys(values);
	return client.rawQuery(
		`insert into ${table} (${columns.join(", ")}, created_at) values (${columns.map(() => "?").join(", ")}, now()) returning id`,
		Object.values(values) as RawQueryBindings,
	);
}

/**
 * UPDATEs the row with this id from column/value pairs.
 */
export function updateRow(
	client: QueryClientContract,
	table: string,
	id: string,
	set: Record<string, unknown>,
) {
	const columns = Object.keys(set);
	return client.rawQuery(
		`update ${table} set ${columns.map((column) => `${column} = ?`).join(", ")} where id = ?`,
		[...Object.values(set), id] as RawQueryBindings,
	);
}

/**
 * The id from an insertRow result.
 */
export const idOf = (result: { rows: { id: string }[] }) => result.rows[0].id;
```

Create `apps/platform/tests/helpers/rls.ts`:

```ts
import type { Assert } from "@japa/assert";
import { withDbContext, withTransaction } from "#services/db_context";
import { insertRow, sql } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * Proves row-level security on `table` with raw SQL, for two studios:
 * each sees only its own rows, no context sees none, an INSERT naming
 * another tenant fails the policy check, and an UPDATE that moves a row to
 * another tenant is refused.
 *
 * `seed(tenant)` runs its own `inTenant(tenant, …)`, creates the row's
 * parents (through the pipeline factories) and returns the column/value
 * pairs of a fresh INSERT naming that tenant; it is called more than once
 * per tenant, so it must not reuse unique values.
 *
 * `moved` is the message the move is refused with. It is the policy's
 * message everywhere except on tables with a guard trigger (inquiries,
 * payments), where the BEFORE ROW trigger fires first and names the frozen
 * column.
 */
export async function assertRowLevelSecurity(
	assert: Assert,
	table: string,
	seed: (tenant: { id: string }) => Promise<Record<string, unknown>>,
	moved: RegExp = /row-level security/,
) {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	for (const tenant of [a, b]) {
		const values = await seed(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			insertRow(trx, table, values),
		);
	}

	const own = await sql({ tenantId: a.id }, `select tenant_id from ${table}`);
	assert.deepEqual(
		own.rows.map((row: { tenant_id: string }) => row.tenant_id),
		[a.id],
		`${table}: tenant A sees only its own rows`,
	);
	const none = await sql({}, `select count(*)::int as n from ${table}`);
	assert.equal(none.rows[0].n, 0, `${table}: no context sees no rows`);

	const foreign = await seed(b);
	await withDbContext({ tenantId: a.id }, async () => {
		await assert.rejects(
			() => withTransaction((trx) => insertRow(trx, table, foreign)),
			/row-level security/,
		);
		await assert.rejects(
			() =>
				withTransaction((trx) =>
					trx.rawQuery(`update ${table} set tenant_id = ?`, [b.id]),
				),
			moved,
		);
	});
}
```

Create `apps/platform/tests/helpers/pipeline.ts` (later tasks append to it):

```ts
import Client from "#modules/clients/models/client";

type TenantRef = { id: string };

let sequence = 0;
const next = () => ++sequence;

/**
 * A fresh E.164 phone, unique for the whole test run.
 */
export const nextPhone = () => `+97798${String(next()).padStart(8, "0")}`;

type ClientOver = Partial<
	Pick<Client, "name" | "phone" | "email" | "notes" | "anonymizedAt">
>;

/**
 * A client with a unique phone. Call it inside `inTenant(tenant, …)`: the
 * factories use the models, which join the ambient transaction.
 */
export function makeClient(tenant: TenantRef, over: ClientOver = {}) {
	return Client.create({
		tenantId: tenant.id,
		name: `Client ${next()}`,
		phone: nextPhone(),
		...over,
	});
}
```

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts` add the entry to `EXPECTED_POLICIES`, keeping the keys alphabetical:

```ts
	artists: ["tenant_isolation:ALL"],
	clients: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
```

Create `apps/platform/tests/functional/clients/clients_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, nextPhone } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const PHONE = "+9779812345678";

const newClient = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	name: "Sita",
	phone: PHONE,
	...over,
});

test.group("clients table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a phone must be in E.164 form", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const phone of ["9812345678", "+0123456789", "+97798", "no phone"]) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "clients", newClient(tenant.id, { phone })),
						),
					/clients_phone_e164/,
				);
			}
			await insertRow(trx, "clients", newClient(tenant.id));
		});
	});

	test("a phone is unique among a tenant's live clients and free again after a soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "clients", newClient(tenant.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "clients", newClient(tenant.id, { name: "Other" })),
					),
				/clients_tenant_phone_live_unique/,
			);
			await trx.rawQuery("update clients set deleted_at = now() where phone = ?", [
				PHONE,
			]);
			await insertRow(trx, "clients", newClient(tenant.id, { name: "Again" }));
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from clients where phone = ?",
				[PHONE],
			);
			assert.equal(rows[0].n, 2);
		});
	});

	test("two tenants can have a client with the same phone", async () => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		await withDbContext({ tenantId: a.id }, (trx) =>
			insertRow(trx, "clients", newClient(a.id)),
		);
		await withDbContext({ tenantId: b.id }, (trx) =>
			insertRow(trx, "clients", newClient(b.id)),
		);
	});

	test("a client has a phone unless it is anonymized, and anonymized clients are unlimited", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "clients", newClient(tenant.id, { phone: null })),
					),
				/clients_phone_unless_anonymized/,
			);
			const gone = { phone: null, anonymized_at: new Date() };
			await insertRow(trx, "clients", newClient(tenant.id, gone));
			await insertRow(trx, "clients", newClient(tenant.id, gone));
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "clients", async (tenant) =>
			newClient(tenant.id, { phone: nextPhone() }),
		);
	});
});

test.group("Client model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates a client, hides it when soft-deleted and brings it back on restore", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant, {
				phone: PHONE,
				email: "sita@example.com",
				notes: "Prefers mornings",
			});
			assert.equal(client.tenantId, tenant.id);
			assert.equal(client.phone, PHONE);
			assert.equal(client.email, "sita@example.com");
			assert.equal(client.notes, "Prefers mornings");
			assert.isNull(client.anonymizedAt);

			await client.softDelete();
			assert.isEmpty(await Client.query().where("tenant_id", tenant.id));
			assert.lengthOf(
				await Client.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);

			await client.restore();
			assert.lengthOf(await Client.query().where("tenant_id", tenant.id), 1);
		});
	});

	test("a returning client can be created after the first one is deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const first = await makeClient(tenant, { phone: PHONE });
			await first.softDelete();

			const returning = await makeClient(tenant, { phone: PHONE });

			assert.notEqual(returning.id, first.id);
			assert.equal(returning.phone, PHONE);
		});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

From `apps/platform`:
`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 node ace test functional --files=catalog_guard.spec.ts`
Expected: FAIL on "each protected table has exactly the expected policies" (`clients` is expected, absent). Then `--files=clients_table.spec.ts`: it cannot import `#modules/clients/models/client` yet, so the run fails to import and may hang until the timeout kills it; that is the expected RED.

- [ ] **Step 3: Write the migration and the model**

Create `apps/platform/database/migrations/1791590000000_create_clients_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * The people who contact a studio (TAT-37): one per phone per tenant.
 * `anonymized_at` is for TAT-42, which scrubs a client's personal data.
 */
export default class extends BaseSchema {
	protected tableName = "clients";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("name", 120).notNullable();
			table.string("phone", 16).nullable();
			table.string("email", 254).nullable();
			table.string("notes", 2000).nullable();
			table.timestamp("anonymized_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			table.index(["tenant_id"]);
		});

		// E.164, the shape normalizePhone produces. A null phone passes this check
		// and is policed by the next one.
		this.schema.raw(
			"alter table clients add constraint clients_phone_e164 check (phone ~ '^[+][1-9][0-9]{7,14}$')",
		);
		this.schema.raw(
			"alter table clients add constraint clients_phone_unless_anonymized check (phone is not null or anonymized_at is not null)",
		);
		// One live client per phone per tenant; a deleted client frees its phone.
		this.schema.raw(
			"create unique index clients_tenant_phone_live_unique on clients (tenant_id, phone) where deleted_at is null and phone is not null",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/clients/models/client.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { ClientSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * A person who contacts a studio: one per normalized phone per tenant.
 * Services arrive with the intake and clients tickets (TAT-51, TAT-41); until
 * then read and change clients through this model only inside a tenant
 * context.
 */
export default class Client extends compose(ClientSchema, withSoftDeletes) {}
```

- [ ] **Step 4: Migrate and regenerate the schema**

From `apps/platform`: `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` must show only a new `ClientSchema` class. If its name differs from `ClientSchema`, use the generated name in the model.

- [ ] **Step 5: Run the tests to verify they pass**

`--files=clients_table.spec.ts`, `--files=catalog_guard.spec.ts` and `--files=policies.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: PASS. Then prove the migration reverses: `pnpm migrate:rollback && pnpm migrate` (inline variables) finishes without errors and, after `pnpm exec biome check --write database/schema.ts`, leaves `git diff database/schema.ts` unchanged.

- [ ] **Step 6: Typecheck, lint and commit**

`pnpm typecheck` and `pnpm exec biome check .` (the 2 known `inertia/` warnings are fine; run `pnpm exec biome check --write` on touched files for formatting).

```bash
git add apps/platform
git commit -m "feat(platform): add the clients table with row-level security"
```

---

### Task 2: `inquiries` and its freeze trigger

**Files:**
- Create: `apps/platform/database/migrations/1791590000001_create_inquiries_table.ts`
- Create: `apps/platform/app/modules/inquiries/models/inquiry.ts`
- Create: `apps/platform/tests/functional/inquiries/inquiries_table.spec.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Consumes: `Client`, `makeClient`, the helpers from Task 1; the existing `Artist` model (`#modules/artists/models/artist`).
- Produces:
  - Table `inquiries`; `Inquiry` (default export of `#modules/inquiries/models/inquiry`) with `INQUIRY_STATUSES`, `InquiryStatus`, `SOURCE_CHANNELS`, `SourceChannel`; `declare status: InquiryStatus`, `declare sourceChannel: SourceChannel`.
  - Constraint names `inquiries_decided_matches_status`, `inquiries_contact_phone_e164`, `inquiries_contact_phone_unless_anonymized`; FK names `inquiries_tenant_id_client_id_foreign`, `inquiries_tenant_id_preferred_artist_id_foreign`; trigger `inquiries_guard_update` (function of the same name).
  - `makeInquiry(tenant, client, over?)` and `makeArtist(tenant, slug?)` in `#tests/helpers/pipeline`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/helpers/pipeline.ts` (add the imports at the top with the others, sorted):

```ts
import Artist from "#modules/artists/models/artist";
import Inquiry from "#modules/inquiries/models/inquiry";
```

```ts
/**
 * An artist profile (the pipeline tables link to it). Call it inside
 * `inTenant(tenant, …)`; slugs are unique per tenant.
 */
export function makeArtist(tenant: TenantRef, slug = "sita") {
	return Artist.create({ tenantId: tenant.id, name: "Sita", slug });
}

type InquiryOver = Partial<
	Pick<
		Inquiry,
		| "idea"
		| "placement"
		| "approximateSize"
		| "preferredDates"
		| "preferredArtistId"
		| "budget"
		| "sourceChannel"
		| "contactName"
		| "contactPhone"
		| "contactEmail"
		| "status"
		| "decidedAt"
		| "anonymizedAt"
	>
>;

/**
 * A new inquiry from `client`, with the client's contact as its snapshot.
 */
export function makeInquiry(
	tenant: TenantRef,
	client: Client,
	over: InquiryOver = {},
) {
	return Inquiry.create({
		tenantId: tenant.id,
		clientId: client.id,
		idea: "A small fine-line moth",
		placement: "Forearm",
		approximateSize: "8 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: client.name,
		contactPhone: client.phone,
		contactEmail: client.email,
		status: "new",
		...over,
	});
}
```

In `catalog_guard.spec.ts` add `inquiries: ["tenant_isolation:ALL"],` after `clients` (alphabetical).

Create `apps/platform/tests/functional/inquiries/inquiries_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry, {
	INQUIRY_STATUSES,
	SOURCE_CHANNELS,
} from "#modules/inquiries/models/inquiry";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeArtist, makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const PHONE = "+9779812345678";

const newInquiry = (
	tenantId: string,
	clientId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	client_id: clientId,
	idea: "A small moth",
	placement: "Forearm",
	approximate_size: "8 cm",
	preferred_dates: "November",
	source_channel: "instagram",
	contact_name: "Sita",
	contact_phone: PHONE,
	...over,
});

/** One studio with a client, and a second studio's client and artist to link to. */
async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	const clientA = await inTenant(a, () => makeClient(a));
	const clientB = await inTenant(b, () => makeClient(b));
	const artistB = await inTenant(b, () => makeArtist(b));
	return { a, b, clientA, clientB, artistB };
}

test.group("inquiries table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an inquiry links only to its own tenant's client and artist; a null artist is not checked", async ({
		assert,
	}) => {
		const { a, clientA, clientB, artistB } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientB.id)),
					),
				/inquiries_tenant_id_client_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { preferred_artist_id: artistB.id }),
						),
					),
				/inquiries_tenant_id_preferred_artist_id_foreign/,
			);
			await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id));
		});
	});

	test("a client or artist with an inquiry cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a } = await twoTenants();
		const { client, artist } = await inTenant(a, async () => ({
			client: await makeClient(a),
			artist: await makeArtist(a, "mine"),
		}));

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(
				trx,
				"inquiries",
				newInquiry(a.id, client.id, { preferred_artist_id: artist.id }),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from clients where id = ?", [client.id]),
					),
				/inquiries_tenant_id_client_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from artists where id = ?", [artist.id]),
					),
				/inquiries_tenant_id_preferred_artist_id_foreign/,
			);
		});
	});

	test("status and source channel only take their listed values, and a decision matches the status", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientA.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			// Postgres reports the first failing check by name, so give the unknown
			// status a decision time that satisfies inquiries_decided_matches_status.
			await rejects(
				{ status: "maybe", decided_at: new Date() },
				/inquiries_status_check/,
			);
			await rejects({ source_channel: "smoke" }, /inquiries_source_channel_check/);
			await rejects(
				{ status: "accepted" },
				/inquiries_decided_matches_status/,
			);
			await rejects(
				{ status: "new", decided_at: new Date() },
				/inquiries_decided_matches_status/,
			);
		});
	});

	test("the contact phone is E.164, and missing only once the inquiry is anonymized", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { contact_phone: "9812345678" }),
						),
					),
				/inquiries_contact_phone_e164/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { contact_phone: null }),
						),
					),
				/inquiries_contact_phone_unless_anonymized/,
			);
			await insertRow(
				trx,
				"inquiries",
				newInquiry(a.id, clientA.id, {
					contact_phone: null,
					anonymized_at: new Date(),
				}),
			);
		});
	});

	test("the guard trigger freezes every submitted column", async ({ assert }) => {
		const { a, b, clientA } = await twoTenants();
		const otherClient = await inTenant(a, () => makeClient(a));
		const artist = await inTenant(a, () => makeArtist(a));
		const frozen: [string, unknown][] = [
			["tenant_id", b.id],
			["client_id", otherClient.id],
			["idea", "Another idea"],
			["placement", "Ribs"],
			["approximate_size", "20 cm"],
			["preferred_dates", "December"],
			["preferred_artist_id", artist.id],
			["budget", "10k"],
			["source_channel", "google"],
			["contact_name", "Someone else"],
			["contact_phone", "+9779800000000"],
			["contact_email", "x@example.com"],
			["created_at", new Date("2020-01-01")],
		];

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)));
			for (const [column, value] of frozen) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "inquiries", id, { [column]: value }),
						),
					new RegExp(`inquiries_guard_update: ${column} cannot change`),
				);
			}
		});
	});

	test("the decision, deletion and updated_at are free to change", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)));

			await updateRow(trx, "inquiries", id, {
				status: "accepted",
				decided_at: new Date(),
			});
			await updateRow(trx, "inquiries", id, { updated_at: new Date() });
			await updateRow(trx, "inquiries", id, { deleted_at: new Date() });
			const { rows } = await trx.rawQuery(
				"select status, deleted_at from inquiries where id = ?",
				[id],
			);
			assert.equal(rows[0].status, "accepted");
			assert.isNotNull(rows[0].deleted_at);
		});
	});

	test("the contact snapshot and free text can be scrubbed only in the update that sets anonymized_at, which then never changes", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(
					trx,
					"inquiries",
					newInquiry(a.id, clientA.id, { budget: "5k", contact_email: "s@x.com" }),
				),
			);

			await updateRow(trx, "inquiries", id, {
				contact_name: "Deleted client",
				contact_phone: null,
				contact_email: null,
				idea: "[removed]",
				placement: "[removed]",
				approximate_size: "[removed]",
				preferred_dates: "[removed]",
				budget: null,
				anonymized_at: new Date(),
			});

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, {
							anonymized_at: new Date("2020-01-01"),
						}),
					),
				/inquiries_guard_update: anonymized_at cannot change/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, { source_channel: "google" }),
					),
				/inquiries_guard_update: source_channel cannot change/,
			);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(
			assert,
			"inquiries",
			async (tenant) => {
				const client = await inTenant(tenant, () => makeClient(tenant));
				return newInquiry(tenant.id, client.id);
			},
			// The guard trigger fires before the policy's WITH CHECK and names the column.
			/inquiries_guard_update: tenant_id cannot change/,
		);
	});
});

test.group("Inquiry model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("accepting and declining go through save() and pass the guard", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const accepted = await makeInquiry(tenant, client);
			const declined = await makeInquiry(tenant, client);

			accepted.merge({ status: "accepted", decidedAt: DateTime.utc() });
			await accepted.save();
			declined.merge({ status: "declined", decidedAt: DateTime.utc() });
			await declined.save();

			assert.equal((await Inquiry.findOrFail(accepted.id)).status, "accepted");
			assert.equal((await Inquiry.findOrFail(declined.id)).status, "declined");
		});
	});

	test("soft delete and restore pass the guard", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));

			await inquiry.softDelete();
			assert.isEmpty(await Inquiry.query().where("tenant_id", tenant.id));
			await inquiry.restore();
			assert.lengthOf(await Inquiry.query().where("tenant_id", tenant.id), 1);
		});
	});

	test("every status and source channel in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const sourceChannel of SOURCE_CHANNELS) {
				await makeInquiry(tenant, client, { sourceChannel });
			}
			for (const status of INQUIRY_STATUSES) {
				await makeInquiry(tenant, client, {
					status,
					decidedAt: status === "new" ? null : DateTime.utc(),
				});
			}
			assert.lengthOf(
				await Inquiry.query().where("tenant_id", tenant.id),
				SOURCE_CHANNELS.length + INQUIRY_STATUSES.length,
			);
		});
	});
});
```

Run `--files=inquiries_table.spec.ts` and `--files=catalog_guard.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: FAIL (the model and the table do not exist; the spec may fail to import and the run be killed by the timeout, and the catalog guard fails on the missing `inquiries` table).

- [ ] **Step 2: Write the migration and the model**

Create `apps/platform/database/migrations/1791590000001_create_inquiries_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * What a person asked a studio for, as submitted (TAT-37). The guard
 * trigger makes it a frozen record: only the decision can change, and the
 * contact snapshot and free text can be scrubbed when `anonymized_at` is
 * set (TAT-42). Everything else is frozen, including any column added later.
 */
export default class extends BaseSchema {
	protected tableName = "inquiries";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("client_id").notNullable();
			table.string("idea", 4000).notNullable();
			table.string("placement", 120).notNullable();
			table.string("approximate_size", 120).notNullable();
			table.string("preferred_dates", 500).notNullable();
			table.uuid("preferred_artist_id").nullable();
			table.string("budget", 120).nullable();
			table
				.enum("source_channel", [
					"instagram",
					"facebook",
					"tiktok",
					"google",
					"friend",
					"other",
				])
				.notNullable();
			// The contact as submitted. Null phone only once anonymized.
			table.string("contact_name", 120).notNullable();
			table.string("contact_phone", 16).nullable();
			table.string("contact_email", 254).nullable();
			table
				.enum("status", ["new", "accepted", "declined"])
				.notNullable()
				.defaultTo("new");
			table.timestamp("decided_at", { useTz: true }).nullable();
			table.timestamp("anonymized_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			// The parents' UNIQUE (tenant_id, id) from enableTenantRls (clients,
			// artists) is what these keys point at.
			tenantReference(table, "client_id", "clients", "NO ACTION");
			tenantReference(table, "preferred_artist_id", "artists", "NO ACTION");

			table.index(["tenant_id"]);
			// The inbox.
			table.index(["tenant_id", "status", "created_at"]);
			table.index(["tenant_id", "client_id"]);
			table.index(["tenant_id", "preferred_artist_id"]);
		});

		this.schema.raw(
			"alter table inquiries add constraint inquiries_decided_matches_status check ((status = 'new') = (decided_at is null))",
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_contact_phone_e164 check (contact_phone ~ '^[+][1-9][0-9]{7,14}$')",
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_contact_phone_unless_anonymized check (contact_phone is not null or anonymized_at is not null)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);

		this.schema.raw(`
create function inquiries_guard_update() returns trigger language plpgsql as $$
declare
	free text[] := array['status', 'decided_at', 'deleted_at', 'updated_at', 'anonymized_at'];
	scrub text[] := array['contact_name', 'contact_phone', 'contact_email', 'idea', 'placement', 'approximate_size', 'preferred_dates', 'budget'];
	changed text;
begin
	if old.anonymized_at is not null and new.anonymized_at is distinct from old.anonymized_at then
		raise exception 'inquiries_guard_update: anonymized_at cannot change';
	end if;
	if new.anonymized_at is not null then
		free := free || scrub;
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'inquiries_guard_update: % cannot change', changed;
	end if;
	return new;
end
$$`);
		this.schema.raw(
			"create trigger inquiries_guard_update before update on inquiries for each row execute function inquiries_guard_update()",
		);
	}

	async down() {
		this.schema.raw(
			"drop trigger inquiries_guard_update on inquiries",
		);
		this.schema.raw("drop function inquiries_guard_update()");
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/inquiries/models/inquiry.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { InquirySchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const INQUIRY_STATUSES = ["new", "accepted", "declined"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const SOURCE_CHANNELS = [
	"instagram",
	"facebook",
	"tiktok",
	"google",
	"friend",
	"other",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

/**
 * What a person asked a studio for, exactly as submitted. A database
 * trigger freezes everything except the decision (and the privacy scrub
 * when `anonymizedAt` is set), so do not try to edit the submitted fields.
 * Services arrive with TAT-51 (intake) and TAT-46 (inbox).
 */
export default class Inquiry extends compose(InquirySchema, withSoftDeletes) {
	declare status: InquiryStatus;
	declare sourceChannel: SourceChannel;
}
```

- [ ] **Step 3: Migrate and regenerate the schema**

`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` must show only a new `InquirySchema` class (use the generated name).

- [ ] **Step 4: Run the tests to verify they pass**

`--files=inquiries_table.spec.ts`, `--files=catalog_guard.spec.ts`, `--files=clients_table.spec.ts`. Expected: PASS.

Prove the freeze test is not vacuous with one mutation: in the migration file add `'idea'` to the `free` array of `inquiries_guard_update`, run `pnpm migrate:rollback && pnpm migrate`, run `--files=inquiries_table.spec.ts` (expect the frozen-columns test to FAIL on the `idea` case), then revert the file edit, run `pnpm migrate:rollback && pnpm migrate` again, and confirm the spec is green. Check `git diff` on the migration file is empty afterwards. The same two commands also prove `down()` drops the function (a leftover function would fail the second `migrate` with "function already exists"); afterwards `git diff database/schema.ts` must be unchanged after `pnpm exec biome check --write database/schema.ts`.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): add the inquiries table with a freeze trigger"
```

### Task 3: `tattoo_projects`

**Files:**
- Create: `apps/platform/database/migrations/1791590000002_create_tattoo_projects_table.ts`
- Create: `apps/platform/app/modules/projects/models/tattoo_project.ts`
- Create: `apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Consumes: `Client`, `Inquiry`, `Artist`; `makeClient`, `makeInquiry`, `makeArtist`; the Task 1 helpers.
- Produces:
  - Table `tattoo_projects`; `TattooProject` (default export of `#modules/projects/models/tattoo_project`) with `PROJECT_STATUSES`, `ProjectStatus`; `declare status: ProjectStatus`.
  - Index/FK names `tattoo_projects_inquiry_live_unique`, `tattoo_projects_tenant_id_client_id_foreign`, `…_artist_id_foreign`, `…_inquiry_id_foreign`.
  - `makeProject(tenant, client, over?)` in `#tests/helpers/pipeline`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/helpers/pipeline.ts` (import at the top, sorted):

```ts
import TattooProject from "#modules/projects/models/tattoo_project";
```

```ts
type ProjectOver = Partial<
	Pick<
		TattooProject,
		"artistId" | "inquiryId" | "brief" | "notes" | "status" | "lastContactedAt"
	>
>;

/**
 * A project for `client`. Pass `inquiryId` for one accepted from an inquiry.
 */
export function makeProject(
	tenant: TenantRef,
	client: Client,
	over: ProjectOver = {},
) {
	return TattooProject.create({
		tenantId: tenant.id,
		clientId: client.id,
		brief: "A small fine-line moth on the forearm",
		status: "reviewing",
		...over,
	});
}
```

In `catalog_guard.spec.ts` add `tattoo_projects: ["tenant_isolation:ALL"],` (alphabetical, after `payment_methods`).

Create `apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import TattooProject, {
	PROJECT_STATUSES,
} from "#modules/projects/models/tattoo_project";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newProject = (
	tenantId: string,
	clientId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	client_id: clientId,
	brief: "A small moth",
	...over,
});

/** A client, its inquiry and an artist in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			client,
			inquiry: await makeInquiry(tenant, client),
			artist: await makeArtist(tenant),
		};
	});

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await parentsIn(a), theirs: await parentsIn(b) };
}

test.group("tattoo_projects table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project links only to its own tenant's client, artist and inquiry; a null artist or inquiry is not checked", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();
		const rejects = (over: Record<string, unknown>, clientId: string, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "tattoo_projects", newProject(a.id, clientId, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({}, theirs.client.id, /tattoo_projects_tenant_id_client_id_foreign/);
			await rejects(
				{ artist_id: theirs.artist.id },
				mine.client.id,
				/tattoo_projects_tenant_id_artist_id_foreign/,
			);
			await rejects(
				{ inquiry_id: theirs.inquiry.id },
				mine.client.id,
				/tattoo_projects_tenant_id_inquiry_id_foreign/,
			);
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
		});
	});

	test("a client, artist or inquiry with a project cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(
				trx,
				"tattoo_projects",
				newProject(a.id, mine.client.id, {
					artist_id: mine.artist.id,
					inquiry_id: mine.inquiry.id,
				}),
			);
			for (const [table, id, constraint] of [
				// The client is also the inquiry's client, so either key may be named.
				[
					"clients",
					mine.client.id,
					/(inquiries|tattoo_projects)_tenant_id_client_id_foreign/,
				],
				["artists", mine.artist.id, /tattoo_projects_tenant_id_artist_id_foreign/],
				["inquiries", mine.inquiry.id, /tattoo_projects_tenant_id_inquiry_id_foreign/],
			] as const) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							inner.rawQuery(`delete from ${table} where id = ?`, [id]),
						),
					constraint,
				);
			}
		});
	});

	test("status only takes its listed values", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"tattoo_projects",
							newProject(a.id, mine.client.id, { status: "inquiry" }),
						),
					),
				/tattoo_projects_status_check/,
			);
		});
	});

	test("an inquiry becomes at most one live project; deleting the project frees it; projects without an inquiry are unlimited", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const fromInquiry = () =>
			newProject(a.id, mine.client.id, { inquiry_id: mine.inquiry.id });

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const first = idOf(await insertRow(trx, "tattoo_projects", fromInquiry()));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "tattoo_projects", fromInquiry()),
					),
				/tattoo_projects_inquiry_live_unique/,
			);
			await updateRow(trx, "tattoo_projects", first, { deleted_at: new Date() });
			await insertRow(trx, "tattoo_projects", fromInquiry());
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from tattoo_projects where tenant_id = ?",
				[a.id],
			);
			assert.equal(rows[0].n, 4);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "tattoo_projects", async (tenant) => {
			const client = await inTenant(tenant, () => makeClient(tenant));
			return newProject(tenant.id, client.id);
		});
	});
});

test.group("TattooProject model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new project starts in reviewing, records contact, soft-deletes and restores", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.equal(project.status, "reviewing");
			assert.isNull(project.artistId);
			assert.isNull(project.inquiryId);

			project.merge({ lastContactedAt: DateTime.utc(), notes: "Called back" });
			await project.save();
			const reloaded = await TattooProject.findOrFail(project.id);
			assert.isNotNull(reloaded.lastContactedAt);
			assert.equal(reloaded.notes, "Called back");

			await project.softDelete();
			assert.isEmpty(await TattooProject.query().where("tenant_id", tenant.id));
			await project.restore();
			assert.lengthOf(
				await TattooProject.query().where("tenant_id", tenant.id),
				1,
			);
		});
	});

	test("soft-deleting a project frees its inquiry for a new one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const first = await makeProject(tenant, client, { inquiryId: inquiry.id });
			await first.softDelete();

			const second = await makeProject(tenant, client, { inquiryId: inquiry.id });

			assert.notEqual(second.id, first.id);
		});
	});

	test("every project status in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const status of PROJECT_STATUSES) {
				await makeProject(tenant, client, { status });
			}
			assert.lengthOf(
				await TattooProject.query().where("tenant_id", tenant.id),
				PROJECT_STATUSES.length,
			);
		});
	});
});
```

Run `--files=tattoo_projects_table.spec.ts` and `--files=catalog_guard.spec.ts`. Expected: FAIL (no model, no table).

- [ ] **Step 2: Write the migration and the model**

Create `apps/platform/database/migrations/1791590000002_create_tattoo_projects_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The sale of one tattoo (TAT-37): created when an inquiry is accepted, or
 * directly for a walk-in. The lifecycle rules (which status may follow
 * which) belong to TAT-46; this table only keeps the allowed values.
 */
export default class extends BaseSchema {
	protected tableName = "tattoo_projects";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("client_id").notNullable();
			// Nobody assigned yet, for example an accepted inquiry with no
			// preferred artist.
			table.uuid("artist_id").nullable();
			// Null for a project created directly (walk-in, phone, DM).
			table.uuid("inquiry_id").nullable();
			table.string("brief", 4000).notNullable();
			table.string("notes", 4000).nullable();
			table.timestamp("last_contacted_at", { useTz: true }).nullable();
			table
				.enum("status", [
					"reviewing",
					"quoted",
					"on_hold",
					"deposit_pending",
					"booked",
					"in_progress",
					"completed",
					"healing_check",
					"declined",
					"cancelled",
				])
				.notNullable()
				.defaultTo("reviewing");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "client_id", "clients", "NO ACTION");
			tenantReference(table, "artist_id", "artists", "NO ACTION");
			tenantReference(table, "inquiry_id", "inquiries", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "status"]);
			table.index(["tenant_id", "artist_id"]);
			table.index(["tenant_id", "client_id"]);
			// The unique index below is partial, so it cannot serve the foreign
			// key's NO ACTION check; this plain one does.
			table.index(["tenant_id", "inquiry_id"]);
		});

		// An inquiry becomes at most one live project.
		this.schema.raw(
			"create unique index tattoo_projects_inquiry_live_unique on tattoo_projects (tenant_id, inquiry_id) where deleted_at is null and inquiry_id is not null",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/projects/models/tattoo_project.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { TattooProjectSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const PROJECT_STATUSES = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
	"completed",
	"healing_check",
	"declined",
	"cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The sale of one tattoo: a client, an optional artist, the brief and a
 * lifecycle status. There is no `inquiry` status: the inquiry is its own
 * record. The transition rules arrive with TAT-46.
 */
export default class TattooProject extends compose(
	TattooProjectSchema,
	withSoftDeletes,
) {
	declare status: ProjectStatus;
}
```

- [ ] **Step 3: Migrate and regenerate the schema**

`pnpm migrate` (inline variables), then `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` shows only a new `TattooProjectSchema` class.

- [ ] **Step 4: Run the tests to verify they pass**

`--files=tattoo_projects_table.spec.ts`, `--files=catalog_guard.spec.ts`, `--files=inquiries_table.spec.ts`, `--files=clients_table.spec.ts`. Expected: PASS. Then `pnpm migrate:rollback && pnpm migrate` finishes clean and `git diff database/schema.ts` is unchanged after the biome format.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): add the tattoo_projects table"
```

---

### Task 4: `reference_images` and the private image purpose

**Files:**
- Create: `apps/platform/database/migrations/1791590000003_create_reference_images_table.ts`
- Create: `apps/platform/app/modules/inquiries/models/reference_image.ts`
- Create: `apps/platform/tests/functional/inquiries/reference_images_table.spec.ts`
- Modify: `apps/platform/app/modules/media/services/image_service.ts`, `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Consumes: `Inquiry`, `TattooProject`; `makeClient`, `makeInquiry`, `makeProject`; the Task 1 helpers.
- Produces:
  - Table `reference_images`; `ReferenceImage` (default export of `#modules/inquiries/models/reference_image`).
  - `IMAGE_PURPOSES.reference_image` (private).
  - Constraint/FK names `reference_images_attached`, `reference_images_tenant_id_inquiry_id_foreign`, `reference_images_tenant_id_project_id_foreign`.
  - `makeReferenceImage(tenant, over?)` in `#tests/helpers/pipeline` (pass `inquiryId` and/or `projectId`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/helpers/pipeline.ts` (imports at the top, sorted: `import { randomUUID } from "node:crypto";` first, then `import ReferenceImage from "#modules/inquiries/models/reference_image";`):

```ts
type ReferenceImageOver = Partial<
	Pick<
		ReferenceImage,
		"inquiryId" | "projectId" | "imageKey" | "width" | "height" | "position"
	>
>;

/**
 * A reference image. Pass `inquiryId` and/or `projectId`: with neither the
 * database refuses it, which a test relies on.
 */
export function makeReferenceImage(
	tenant: TenantRef,
	over: ReferenceImageOver = {},
) {
	return ReferenceImage.create({
		tenantId: tenant.id,
		imageKey: `tenants/${tenant.id}/reference_image/${randomUUID()}.webp`,
		width: 800,
		height: 600,
		position: 0,
		...over,
	});
}
```

In `catalog_guard.spec.ts` add `reference_images: ["tenant_isolation:ALL"],` (alphabetical, after `payment_methods`).

Create `apps/platform/tests/functional/inquiries/reference_images_table.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { IMAGE_PURPOSES } from "#modules/media/services/image_service";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newImage = (
	tenantId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	image_key: `tenants/${tenantId}/reference_image/${randomUUID()}.webp`,
	width: 800,
	height: 600,
	position: 0,
	...over,
});

/** A client, its inquiry and a project in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			inquiry: await makeInquiry(tenant, client),
			project: await makeProject(tenant, client),
		};
	});

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await parentsIn(a), theirs: await parentsIn(b) };
}

test.group("reference_images table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an image attaches to an inquiry, a project or both, never to neither", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "reference_images", newImage(a.id)),
					),
				/reference_images_attached/,
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, { inquiry_id: mine.inquiry.id }),
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, { project_id: mine.project.id }),
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, {
					inquiry_id: mine.inquiry.id,
					project_id: mine.project.id,
				}),
			);
		});
	});

	test("an image links only to its own tenant's inquiry and project", async ({
		assert,
	}) => {
		const { a, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"reference_images",
							newImage(a.id, { inquiry_id: theirs.inquiry.id }),
						),
					),
				/reference_images_tenant_id_inquiry_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"reference_images",
							newImage(a.id, { project_id: theirs.project.id }),
						),
					),
				/reference_images_tenant_id_project_id_foreign/,
			);
		});
	});

	test("an inquiry or project with an image cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, {
					inquiry_id: mine.inquiry.id,
					project_id: mine.project.id,
				}),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from inquiries where id = ?", [
							mine.inquiry.id,
						]),
					),
				/reference_images_tenant_id_inquiry_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [
							mine.project.id,
						]),
					),
				/reference_images_tenant_id_project_id_foreign/,
			);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "reference_images", async (tenant) => {
			const { inquiry } = await parentsIn(tenant);
			return newImage(tenant.id, { inquiry_id: inquiry.id });
		});
	});
});

test.group("ReferenceImage model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an inquiry's image is attached to its project when the inquiry is accepted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const image = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 2,
			});
			assert.isNull(image.projectId);

			const project = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
			});
			image.merge({ projectId: project.id });
			await image.save();

			const reloaded = await ReferenceImage.findOrFail(image.id);
			assert.equal(reloaded.projectId, project.id);
			assert.equal(reloaded.inquiryId, inquiry.id);
			assert.equal(reloaded.position, 2);
		});
	});

	test("a project's own image has no inquiry, and a soft delete hides it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const image = await makeReferenceImage(tenant, { projectId: project.id });
			assert.isNull(image.inquiryId);

			await image.softDelete();

			assert.isEmpty(await ReferenceImage.query().where("tenant_id", tenant.id));
		});
	});

	test("reference images are stored on the private disk", ({ assert }) => {
		assert.equal(IMAGE_PURPOSES.reference_image.visibility, "private");
	});
});
```

Run `--files=reference_images_table.spec.ts` and `--files=catalog_guard.spec.ts`. Expected: FAIL.

- [ ] **Step 2: Write the migration, the model and the image purpose**

Create `apps/platform/database/migrations/1791590000003_create_reference_images_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Images a client sends as references (TAT-37), private. Created with the
 * inquiry; `project_id` is filled in when the inquiry is accepted. A
 * project created directly has images with only `project_id`.
 */
export default class extends BaseSchema {
	protected tableName = "reference_images";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("inquiry_id").nullable();
			table.uuid("project_id").nullable();
			table.string("image_key", 255).notNullable();
			table.integer("width").notNullable();
			table.integer("height").notNullable();
			// Order within its inquiry, or within its project when it has none.
			table.smallint("position").notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "inquiry_id", "inquiries", "NO ACTION");
			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "inquiry_id"]);
			table.index(["tenant_id", "project_id"]);
		});

		this.schema.raw(
			"alter table reference_images add constraint reference_images_attached check (inquiry_id is not null or project_id is not null)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/inquiries/models/reference_image.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { ReferenceImageSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * An image a client sent as a reference, attached to the inquiry and then
 * to its project. Private: its URL comes from
 * `ImageService.url("reference_image", key)`, a short-lived signed URL, only
 * after loading the owning record scoped to the tenant.
 */
export default class ReferenceImage extends compose(
	ReferenceImageSchema,
	withSoftDeletes,
) {}
```

In `apps/platform/app/modules/media/services/image_service.ts` add the purpose:

```ts
export const IMAGE_PURPOSES = {
	payment_qr: { visibility: "public" }, // TAT-26
	payment_proof: { visibility: "private" }, // TAT-65
	artist_photo: { visibility: "public" }, // TAT-31
	reference_image: { visibility: "private" }, // TAT-37
} as const;
```

- [ ] **Step 3: Migrate and regenerate the schema**

`pnpm migrate` (inline variables), `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` shows only a new `ReferenceImageSchema` class.

- [ ] **Step 4: Run the tests to verify they pass**

`--files=reference_images_table.spec.ts`, `--files=catalog_guard.spec.ts`, `--files=image_service.spec.ts`, `--files=file_serving.spec.ts`. Expected: PASS. Then `pnpm migrate:rollback && pnpm migrate` clean, schema diff unchanged after the format.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): add the reference_images table and a private image purpose"
```

---

### Task 5: `quotes`

**Files:**
- Create: `apps/platform/database/migrations/1791590000004_create_quotes_table.ts`
- Create: `apps/platform/app/modules/projects/models/quote.ts`
- Create: `apps/platform/tests/functional/projects/quotes_table.spec.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Consumes: `TattooProject`; `makeClient`, `makeProject`; the Task 1 helpers.
- Produces:
  - Table `quotes` (no `deleted_at`); `Quote` (default export of `#modules/projects/models/quote`) with `QUOTE_KINDS`, `QuoteKind`; `declare kind: QuoteKind`.
  - Constraint names `quotes_project_version_unique`, `quotes_version_positive`, `quotes_kind_columns`, `quotes_amounts_positive`, `quotes_deposit_within_total`; FK `quotes_tenant_id_project_id_foreign`.
  - `makeQuote(tenant, project, over?)` in `#tests/helpers/pipeline` (a fixed quote by default).

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/helpers/pipeline.ts` (imports at the top, sorted: `import { DateTime } from "luxon";` and `import Quote from "#modules/projects/models/quote";`):

```ts
type QuoteOver = Partial<
	Pick<
		Quote,
		| "version"
		| "kind"
		| "fixedPrice"
		| "hourlyRate"
		| "estimatedMinutes"
		| "depositAmount"
		| "currency"
		| "expiresAt"
	>
>;

/**
 * A fixed-price quote (NPR 15,000 with a NPR 3,000 deposit, in paisa) valid
 * for two weeks. For an hourly one pass `kind: "hourly"`, `fixedPrice: null`,
 * `hourlyRate` and `estimatedMinutes`.
 */
export function makeQuote(
	tenant: TenantRef,
	project: TattooProject,
	over: QuoteOver = {},
) {
	return Quote.create({
		tenantId: tenant.id,
		projectId: project.id,
		version: 1,
		kind: "fixed",
		fixedPrice: 1_500_000,
		depositAmount: 300_000,
		currency: "NPR",
		expiresAt: DateTime.utc().plus({ days: 14 }),
		...over,
	});
}
```

In `catalog_guard.spec.ts` add `quotes: ["tenant_isolation:ALL"],` (alphabetical, after `payment_methods`).

Create `apps/platform/tests/functional/projects/quotes_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Quote, { QUOTE_KINDS } from "#modules/projects/models/quote";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newQuote = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	version: 1,
	kind: "fixed",
	fixed_price: 1_000_000,
	deposit_amount: 200_000,
	expires_at: new Date("2030-01-01T00:00:00Z"),
	...over,
});

/** An hourly quote: NPR 5,000 an hour for 150 minutes, a total of 1,250,000 paisa. */
const hourly = (over: Record<string, unknown> = {}) => ({
	kind: "hourly",
	fixed_price: null,
	hourly_rate: 500_000,
	estimated_minutes: 150,
	...over,
});

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeProject(tenant, await makeClient(tenant)));

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await projectIn(a), theirs: await projectIn(b) };
}

test.group("quotes table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a fixed quote has a price only, an hourly quote a rate and minutes only", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				/quotes_kind_columns/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({ hourly_rate: 500_000 });
			await rejects({ estimated_minutes: 60 });
			await rejects({ fixed_price: null });
			await rejects(hourly({ fixed_price: 1_000_000 }));
			await rejects(hourly({ estimated_minutes: null }));
			await rejects(hourly({ hourly_rate: null }));
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await insertRow(trx, "quotes", newQuote(a.id, mine.id, hourly({ version: 2 })));
		});
	});

	test("prices, rate, minutes and the version are positive and the deposit is not negative", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects({ fixed_price: 0, deposit_amount: 0 }, /quotes_amounts_positive/);
			await rejects(hourly({ hourly_rate: 0, deposit_amount: 0 }), /quotes_amounts_positive/);
			await rejects(
				hourly({ estimated_minutes: 0, deposit_amount: 0 }),
				/quotes_amounts_positive/,
			);
			await rejects({ deposit_amount: -1 }, /quotes_amounts_positive/);
			await rejects({ version: 0 }, /quotes_version_positive/);
			await rejects({ kind: "weekly" }, /quotes_kind_check/);
		});
	});

	test("the deposit may be zero and never exceeds the total", async ({ assert }) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				/quotes_deposit_within_total/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({ deposit_amount: 1_000_001 });
			await rejects(hourly({ deposit_amount: 1_250_001 }));
			await insertRow(trx, "quotes", newQuote(a.id, mine.id, { deposit_amount: 0 }));
			await insertRow(
				trx,
				"quotes",
				newQuote(a.id, mine.id, { version: 2, deposit_amount: 1_000_000 }),
			);
			await insertRow(
				trx,
				"quotes",
				newQuote(a.id, mine.id, hourly({ version: 3, deposit_amount: 1_250_000 })),
			);
		});
	});

	test("a project's versions are unique, and another project can reuse them", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const other = await projectIn(a);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id)),
					),
				/quotes_project_version_unique/,
			);
			await insertRow(trx, "quotes", newQuote(a.id, mine.id, { version: 2 }));
			await insertRow(trx, "quotes", newQuote(a.id, other.id));
		});
	});

	test("a quote links only to its own tenant's project, and a project with a quote cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, theirs.id)),
					),
				/quotes_tenant_id_project_id_foreign/,
			);
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [mine.id]),
					),
				/quotes_tenant_id_project_id_foreign/,
			);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "quotes", async (tenant) =>
			newQuote(tenant.id, (await projectIn(tenant)).id),
		);
	});
});

test.group("Quote model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("stores a fixed and an hourly quote", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const fixed = await makeQuote(tenant, project);
			const perHour = await makeQuote(tenant, project, {
				version: 2,
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 500_000,
				estimatedMinutes: 150,
				depositAmount: 0,
			});

			const reloaded = await Quote.findOrFail(perHour.id);
			assert.equal(reloaded.kind, "hourly");
			assert.equal(reloaded.hourlyRate, 500_000);
			assert.equal(reloaded.estimatedMinutes, 150);
			assert.isNull(reloaded.fixedPrice);
			assert.equal(reloaded.currency, "NPR");
			assert.isTrue(reloaded.expiresAt > DateTime.utc());
			assert.equal((await Quote.findOrFail(fixed.id)).fixedPrice, 1_500_000);
		});
	});

	test("the current quote is the project's highest version, and quotes cannot be soft-deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			await makeQuote(tenant, project, { version: 1 });
			const second = await makeQuote(tenant, project, {
				version: 2,
				fixedPrice: 1_800_000,
			});

			const current = await Quote.query()
				.where("project_id", project.id)
				.orderBy("version", "desc")
				.firstOrFail();

			assert.equal(current.id, second.id);
			assert.isUndefined(
				(Quote.prototype as unknown as Record<string, unknown>).softDelete,
			);
		});
	});

	test("every quote kind in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			let version = 0;
			for (const kind of QUOTE_KINDS) {
				version += 1;
				await makeQuote(
					tenant,
					project,
					kind === "fixed"
						? { version }
						: {
								version,
								kind,
								fixedPrice: null,
								hourlyRate: 500_000,
								estimatedMinutes: 90,
							},
				);
			}
			assert.lengthOf(
				await Quote.query().where("project_id", project.id),
				QUOTE_KINDS.length,
			);
		});
	});
});
```

Run `--files=quotes_table.spec.ts` and `--files=catalog_guard.spec.ts`. Expected: FAIL.

- [ ] **Step 2: Write the migration and the model**

Create `apps/platform/database/migrations/1791590000004_create_quotes_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The price of a project (TAT-37), versioned: a revision is a new row with
 * the next `version`, and the current quote is the project's highest
 * version. Quotes are history, so there is no `deleted_at`; by convention
 * the price, deposit and expiry never change after insert. Sending a quote
 * (`sent_at`) is TAT-64's.
 */
export default class extends BaseSchema {
	protected tableName = "quotes";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.integer("version").notNullable();
			table.enum("kind", ["fixed", "hourly"]).notNullable();
			// Paisa. Which of the three is set depends on the kind.
			table.integer("fixed_price").nullable();
			table.integer("hourly_rate").nullable();
			// Whole minutes: Postgres returns numeric hours as a string, a trap for
			// money maths. The UI converts hours.
			table.integer("estimated_minutes").nullable();
			table.integer("deposit_amount").notNullable().defaultTo(0);
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.timestamp("expires_at", { useTz: true }).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
		});

		this.schema.raw(
			"alter table quotes add constraint quotes_project_version_unique unique (project_id, version)",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_version_positive check (version >= 1)",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_kind_columns check ((kind = 'fixed' and fixed_price is not null and hourly_rate is null and estimated_minutes is null) or (kind = 'hourly' and fixed_price is null and hourly_rate is not null and estimated_minutes is not null))",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_amounts_positive check ((fixed_price is null or fixed_price > 0) and (hourly_rate is null or hourly_rate > 0) and (estimated_minutes is null or estimated_minutes > 0) and deposit_amount >= 0)",
		);
		// The deposit never exceeds the total: the price, or the rate for the
		// estimated minutes (rounded half away from zero, like Postgres' round).
		this.schema.raw(
			"alter table quotes add constraint quotes_deposit_within_total check (deposit_amount <= coalesce(fixed_price, round(hourly_rate::bigint * estimated_minutes / 60.0)))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/projects/models/quote.ts`:

```ts
import { QuoteSchema } from "#database/schema";

export const QUOTE_KINDS = ["fixed", "hourly"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

/**
 * A price for a project. A revision is a new row with the next `version`;
 * the current quote is the project's highest version. Not soft-deletable:
 * quotes are history. Money is integer paisa; time is whole minutes.
 */
export default class Quote extends QuoteSchema {
	declare kind: QuoteKind;
}
```

- [ ] **Step 3: Migrate and regenerate the schema**

`pnpm migrate` (inline variables), `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` shows only a new `QuoteSchema` class.

- [ ] **Step 4: Run the tests to verify they pass**

`--files=quotes_table.spec.ts`, `--files=catalog_guard.spec.ts`, `--files=tattoo_projects_table.spec.ts`. Expected: PASS. Then `pnpm migrate:rollback && pnpm migrate` clean, schema diff unchanged after the format.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): add the versioned quotes table"
```

### Task 6: `payments` and its append-only trigger

**Files:**
- Create: `apps/platform/database/migrations/1791590000005_create_payments_table.ts`
- Create: `apps/platform/app/modules/payments/models/payment.ts`
- Create: `apps/platform/tests/functional/payments/payments_table.spec.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Modify (generated): `apps/platform/database/schema.ts`

**Interfaces:**
- Consumes: `TattooProject`; `PAYMENT_METHOD_KINDS`/`PaymentMethodKind` from `#modules/payments/models/payment_method`; `User`; `makeClient`, `makeProject`; the Task 1 helpers.
- Produces:
  - Table `payments` (no `deleted_at`); `Payment` (default export of `#modules/payments/models/payment`) with `PAYMENT_KINDS`, `PaymentKind`, `PAYMENT_STATUSES`, `PaymentStatus`; `declare kind: PaymentKind`, `declare status: PaymentStatus`, `declare method: PaymentMethodKind`.
  - Constraint names `payments_amount_sign`, `payments_verified_matches_status`, `payments_unverified_has_no_verifier`, `payments_proof_all_or_none`; FK `payments_tenant_id_project_id_foreign`; trigger and function `payments_guard`.
  - `makePayment(tenant, project, over?)` in `#tests/helpers/pipeline` (a submitted cash deposit by default).

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/helpers/pipeline.ts` (import at the top, sorted):

```ts
import Payment from "#modules/payments/models/payment";
```

```ts
type PaymentOver = Partial<
	Pick<
		Payment,
		| "kind"
		| "amount"
		| "currency"
		| "method"
		| "proofImageKey"
		| "proofImageWidth"
		| "proofImageHeight"
		| "status"
		| "verifiedByUserId"
		| "verifiedAt"
	>
>;

/**
 * A submitted cash deposit of NPR 3,000 (300,000 paisa). To make a decided
 * payment pass `status`, `verifiedAt` and `verifiedByUserId` together: the
 * database checks they agree.
 */
export function makePayment(
	tenant: TenantRef,
	project: TattooProject,
	over: PaymentOver = {},
) {
	return Payment.create({
		tenantId: tenant.id,
		projectId: project.id,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		method: "cash",
		status: "submitted",
		...over,
	});
}
```

In `catalog_guard.spec.ts` add `payments: ["tenant_isolation:ALL"],` (after `payment_methods`).

Create `apps/platform/tests/functional/payments/payments_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import Payment, {
	PAYMENT_KINDS,
	PAYMENT_STATUSES,
} from "#modules/payments/models/payment";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeClient,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newPayment = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	kind: "deposit",
	amount: 300_000,
	method: "cash",
	...over,
});

/** The columns of a payment that has been verified by `userId`. */
const verified = (userId: string, over: Record<string, unknown> = {}) => ({
	status: "verified",
	verified_at: new Date(),
	verified_by_user_id: userId,
	...over,
});

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeProject(tenant, await makeClient(tenant)));

async function twoTenants() {
	const { tenant: a, owner } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return {
		a,
		b,
		owner,
		mine: await projectIn(a),
		other: await projectIn(a),
		theirs: await projectIn(b),
	};
}

test.group("payments table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a payment links only to its own tenant's project, which then cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, theirs.id)),
					),
				/payments_tenant_id_project_id_foreign/,
			);
			await insertRow(trx, "payments", newPayment(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [mine.id]),
					),
				/payments_tenant_id_project_id_foreign/,
			);
		});
	});

	test("kind, method and status only take their listed values", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects({ kind: "bonus" }, /payments_kind_check/);
			await rejects({ method: "paypal" }, /payments_method_check/);
			// A decision time keeps payments_verified_matches_status satisfied, so
			// the status check is the one that fails.
			await rejects(
				verified(owner.id, { status: "paid" }),
				/payments_status_check/,
			);
		});
	});

	test("a refund is negative, a correction is non-zero, every other kind is positive", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const cases: [string, number, boolean][] = [
			["deposit", 1000, true],
			["deposit", 0, false],
			["deposit", -1000, false],
			["session", 500, true],
			["balance", 500, true],
			["refund", -500, true],
			["refund", 500, false],
			["refund", 0, false],
			["correction", -500, true],
			["correction", 500, true],
			["correction", 0, false],
		];

		await withDbContext({ tenantId: a.id }, async () => {
			for (const [kind, amount, allowed] of cases) {
				const insert = () =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, mine.id, { kind, amount })),
					);
				if (allowed) await insert();
				else await assert.rejects(insert, /payments_amount_sign/);
			}
		});
	});

	test("a decision time goes with a decided status, and only a decided payment has a verifier", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({ verified_at: new Date() }, /payments_verified_matches_status/);
			await rejects({ status: "verified" }, /payments_verified_matches_status/);
			await rejects(
				{ verified_by_user_id: owner.id },
				/payments_unverified_has_no_verifier/,
			);
			await insertRow(trx, "payments", newPayment(a.id, mine.id, verified(owner.id)));
			// A desk payment can be decided without a named verifier.
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, { status: "rejected", verified_at: new Date() }),
			);
		});
	});

	test("the proof columns are all set or all null", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { proof_image_key: "k.webp" }),
						),
					),
				/payments_proof_all_or_none/,
			);
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, {
					proof_image_key: "k.webp",
					proof_image_width: 800,
					proof_image_height: 600,
				}),
			);
		});
	});

	test("the guard rejects every DELETE", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(await insertRow(trx, "payments", newPayment(a.id, mine.id)));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from payments where id = ?", [id]),
					),
				/payments_guard: payments are never deleted/,
			);
		});
	});

	test("the guard freezes the money facts", async ({ assert }) => {
		const { a, b, mine, other } = await twoTenants();
		const frozen: [string, unknown][] = [
			["tenant_id", b.id],
			["project_id", other.id],
			["kind", "session"],
			["amount", 1],
			["currency", "USD"],
			["method", "bank"],
			["created_at", new Date("2020-01-01")],
		];

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(await insertRow(trx, "payments", newPayment(a.id, mine.id)));
			for (const [column, value] of frozen) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "payments", id, { [column]: value }),
						),
					new RegExp(`payments_guard: ${column} cannot change`),
				);
			}
		});
	});

	test("a submitted payment can be verified or rejected, and then it is final", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const stranger = await User.create({
			email: "stranger@example.com",
			password: "secret-password",
		});
		const rejects = (id: string, set: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() => withTransaction((inner) => updateRow(inner, "payments", id, set)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const accepted = idOf(await insertRow(trx, "payments", newPayment(a.id, mine.id)));
			const turnedDown = idOf(await insertRow(trx, "payments", newPayment(a.id, mine.id)));

			await updateRow(trx, "payments", accepted, verified(owner.id));
			await updateRow(
				trx,
				"payments",
				turnedDown,
				verified(owner.id, { status: "rejected" }),
			);

			await rejects(
				accepted,
				{ status: "rejected" },
				/payments_guard: status cannot change/,
			);
			await rejects(
				turnedDown,
				{ status: "submitted", verified_at: null, verified_by_user_id: null },
				/payments_guard: status cannot change/,
			);
			await rejects(
				accepted,
				{ verified_at: new Date("2020-01-01") },
				/payments_guard: verified_at cannot change/,
			);
			await rejects(
				accepted,
				{ verified_by_user_id: stranger.id },
				/payments_guard: verified_by_user_id cannot change/,
			);
		});
	});

	test("the proof can be cleared but never replaced", async ({ assert }) => {
		const { a, mine } = await twoTenants();
		const proof = {
			proof_image_key: "k.webp",
			proof_image_width: 800,
			proof_image_height: 600,
		};

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(await insertRow(trx, "payments", newPayment(a.id, mine.id, proof)));

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "payments", id, {
							proof_image_key: "other.webp",
							proof_image_width: 10,
							proof_image_height: 10,
						}),
					),
				/payments_guard: proof can only be cleared/,
			);
			await updateRow(trx, "payments", id, {
				proof_image_key: null,
				proof_image_width: null,
				proof_image_height: null,
			});
			await assert.rejects(
				() => withTransaction((inner) => updateRow(inner, "payments", id, proof)),
				/payments_guard: proof can only be cleared/,
			);
		});
	});

	test("deleting the verifier's account keeps the decided payment and clears the verifier", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const verifier = await User.create({
			email: "verifier@example.com",
			password: "secret-password",
		});

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id, verified(verifier.id))),
			);

			await trx.rawQuery("delete from users where id = ?", [verifier.id]);

			const { rows } = await trx.rawQuery(
				"select status, verified_by_user_id from payments where id = ?",
				[id],
			);
			assert.equal(rows[0].status, "verified");
			assert.isNull(rows[0].verified_by_user_id);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(
			assert,
			"payments",
			async (tenant) => newPayment(tenant.id, (await projectIn(tenant)).id),
			// The guard trigger fires before the policy's WITH CHECK and names the column.
			/payments_guard: tenant_id cannot change/,
		);
	});
});

test.group("Payment model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying and rejecting go through save() and pass the guard", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const toVerify = await makePayment(tenant, project);
			const toReject = await makePayment(tenant, project);

			toVerify.merge({
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			await toVerify.save();
			toReject.merge({
				status: "rejected",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			await toReject.save();

			assert.equal((await Payment.findOrFail(toVerify.id)).status, "verified");
			assert.equal((await Payment.findOrFail(toReject.id)).status, "rejected");
		});
	});

	test("a model delete is refused and Payment has no soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const payment = await makePayment(
				tenant,
				await makeProject(tenant, await makeClient(tenant)),
			);

			assert.isUndefined(
				(Payment.prototype as unknown as Record<string, unknown>).softDelete,
			);
			await assert.rejects(
				() => withTransaction(() => payment.delete()),
				/payments_guard: payments are never deleted/,
			);
		});
	});

	test("every kind, status and method in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			for (const kind of PAYMENT_KINDS) {
				const negative = kind === "refund" || kind === "correction";
				await makePayment(tenant, project, {
					kind,
					amount: negative ? -100_000 : 100_000,
				});
			}
			for (const status of PAYMENT_STATUSES) {
				await makePayment(
					tenant,
					project,
					status === "submitted"
						? { status }
						: { status, verifiedAt: DateTime.utc(), verifiedByUserId: owner.id },
				);
			}
			for (const method of PAYMENT_METHOD_KINDS) {
				await makePayment(tenant, project, { method });
			}
			assert.lengthOf(
				await Payment.query().where("tenant_id", tenant.id),
				PAYMENT_KINDS.length + PAYMENT_STATUSES.length + PAYMENT_METHOD_KINDS.length,
			);
		});
	});
});
```

Run `--files=payments_table.spec.ts` and `--files=catalog_guard.spec.ts`. Expected: FAIL (no model, no table).

- [ ] **Step 2: Write the migration and the model**

Create `apps/platform/database/migrations/1791590000005_create_payments_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The ledger of money received (TAT-37). Append-only: the guard trigger
 * rejects every DELETE and freezes every column except the decision
 * (`status`, `verified_by_user_id`, `verified_at`), `updated_at` and the
 * proof, which can only be cleared (TAT-42). A decided payment is final.
 * There is no `deleted_at`.
 */
export default class extends BaseSchema {
	protected tableName = "payments";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table
				.enum("kind", ["deposit", "session", "balance", "refund", "correction"])
				.notNullable();
			// Signed paisa: a refund is negative.
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			// The kind of payment method used, not a link to payment_methods: those
			// can be edited or deleted, and the books must not depend on that.
			table
				.enum("method", ["fonepay", "esewa", "khalti", "bank", "cash"])
				.notNullable();
			table.string("proof_image_key", 255).nullable();
			table.integer("proof_image_width").nullable();
			table.integer("proof_image_height").nullable();
			table
				.enum("status", ["submitted", "verified", "rejected"])
				.notNullable()
				.defaultTo("submitted");
			// Set on rejection too: whoever decided.
			table
				.uuid("verified_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("verified_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
			// Deleting a user must not scan the whole ledger.
			table.index(["verified_by_user_id"]);
		});

		this.schema.raw(
			"alter table payments add constraint payments_amount_sign check ((kind = 'refund' and amount < 0) or (kind = 'correction' and amount <> 0) or (kind not in ('refund', 'correction') and amount > 0))",
		);
		this.schema.raw(
			"alter table payments add constraint payments_verified_matches_status check ((status = 'submitted') = (verified_at is null))",
		);
		this.schema.raw(
			"alter table payments add constraint payments_unverified_has_no_verifier check (status <> 'submitted' or verified_by_user_id is null)",
		);
		this.schema.raw(
			"alter table payments add constraint payments_proof_all_or_none check ((proof_image_key is null) = (proof_image_width is null) and (proof_image_key is null) = (proof_image_height is null))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);

		this.schema.raw(`
create function payments_guard() returns trigger language plpgsql as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height'];
	changed text;
begin
	if tg_op = 'DELETE' then
		raise exception 'payments_guard: payments are never deleted';
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'payments_guard: % cannot change', changed;
	end if;
	-- The proof can only be cleared (TAT-42), never set to a new value.
	if (new.proof_image_key, new.proof_image_width, new.proof_image_height)
			is distinct from (old.proof_image_key, old.proof_image_width, old.proof_image_height)
		and (new.proof_image_key is not null or new.proof_image_width is not null or new.proof_image_height is not null) then
		raise exception 'payments_guard: proof can only be cleared';
	end if;
	-- A decided payment is final. The one change allowed is the verifier
	-- becoming null, which is what deleting the verifier's account does.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id and new.verified_by_user_id is not null then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`);
		this.schema.raw(
			"create trigger payments_guard before update or delete on payments for each row execute function payments_guard()",
		);
	}

	async down() {
		this.schema.raw("drop trigger payments_guard on payments");
		this.schema.raw("drop function payments_guard()");
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/app/modules/payments/models/payment.ts`:

```ts
import { PaymentSchema } from "#database/schema";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";

export const PAYMENT_KINDS = [
	"deposit",
	"session",
	"balance",
	"refund",
	"correction",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["submitted", "verified", "rejected"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Money received for a project. Append-only, enforced by a database trigger:
 * never edited (except the decision: `status`, `verifiedByUserId`,
 * `verifiedAt`), never deleted, and a decided payment (verified or rejected)
 * is final. A refund is a negative `refund` payment; a mistaken verification
 * is reversed with a `correction`. Amounts are signed integer paisa.
 */
export default class Payment extends PaymentSchema {
	declare kind: PaymentKind;
	declare status: PaymentStatus;
	declare method: PaymentMethodKind;
}
```

- [ ] **Step 3: Migrate and regenerate the schema**

`pnpm migrate` (inline variables), `pnpm exec biome check --write database/schema.ts`. `git diff database/schema.ts` shows only a new `PaymentSchema` class.

- [ ] **Step 4: Run the tests to verify they pass**

`--files=payments_table.spec.ts`, `--files=catalog_guard.spec.ts`, `--files=payment_method_service.spec.ts`. Expected: PASS.

Prove the freeze and finality tests are not vacuous with two mutations in the migration file, each followed by `pnpm migrate:rollback && pnpm migrate` and a run of `--files=payments_table.spec.ts`, and reverted afterwards (`git diff` on the migration file empty at the end, a final rollback and migrate, spec green):
1. Add `'amount'` to the `free` array: the "freezes the money facts" test must FAIL on the `amount` case.
2. Delete the `if old.status <> 'submitted' then … end if;` block: the "final" test must FAIL.

The two commands also prove `down()` drops the function. `git diff database/schema.ts` is unchanged after `pnpm exec biome check --write database/schema.ts`.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): add the append-only payments table"
```

---

### Task 7: The tenant cascade and the seeded pipeline

**Files:**
- Modify: `apps/platform/app/modules/tenancy/models/tenant.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts`, `apps/platform/tests/helpers/tenants.ts`
- Modify (tests): `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts`

**Interfaces:**
- Consumes: all six models and factories from Tasks 1 to 6.
- Produces: `seedPipeline(tenant)` in `#tests/helpers/pipeline` (returns `{ client, inquiry, project, referenceImage, quote, payment }`; call inside `inTenant`); `Studio.pipeline` (that object) on every studio of `twoStudios()`; `Tenant.softDelete` also soft-deletes live clients, inquiries, projects and reference images.

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts` add the imports (sorted with the existing ones):

```ts
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import { makeClient, seedPipeline } from "#tests/helpers/pipeline";
```

Add next to the artists cascade test ("soft-deleting a tenant soft-deletes its artists and keeps an earlier delete as it was"):

```ts
	test("soft-deleting a tenant soft-deletes its clients, inquiries, projects and reference images, and leaves quotes, payments and other tenants alone", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const rival = await makeUser("rival@example.com");
		const other = await tenancy.createTenant(rival, studio("red-ink"));
		await inTenant(other, () => seedPipeline(other));

		await inTenant(tenant, async () => {
			await seedPipeline(tenant);
			// A client removed earlier keeps its original deleted_at.
			const removed = await makeClient(tenant);
			await removed.softDelete();
			const removedAt = (
				await Client.withTrashed().where("id", removed.id).firstOrFail()
			).deletedAt?.toMillis();

			await tenant.softDelete();

			assert.isEmpty(await Client.query().where("tenant_id", tenant.id));
			assert.isEmpty(await Inquiry.query().where("tenant_id", tenant.id));
			assert.isEmpty(await TattooProject.query().where("tenant_id", tenant.id));
			assert.isEmpty(await ReferenceImage.query().where("tenant_id", tenant.id));
			const trashedClients = await Client.onlyTrashed().where(
				"tenant_id",
				tenant.id,
			);
			assert.lengthOf(trashedClients, 2);
			assert.equal(
				trashedClients.find(({ id }) => id === removed.id)?.deletedAt?.toMillis(),
				removedAt,
			);
			assert.lengthOf(await Inquiry.onlyTrashed().where("tenant_id", tenant.id), 1);
			assert.lengthOf(
				await TattooProject.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
			assert.lengthOf(
				await ReferenceImage.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
			// No deleted_at on these, so they stay (and remain readable) after the cascade.
			assert.lengthOf(await Quote.query().where("tenant_id", tenant.id), 1);
			assert.lengthOf(await Payment.query().where("tenant_id", tenant.id), 1);
		});

		await inTenant(other, async () => {
			assert.lengthOf(await Client.query().where("tenant_id", other.id), 1);
			assert.lengthOf(await Inquiry.query().where("tenant_id", other.id), 1);
			assert.lengthOf(await TattooProject.query().where("tenant_id", other.id), 1);
			assert.lengthOf(await ReferenceImage.query().where("tenant_id", other.id), 1);
		});
	});
```

Run `--files=tenancy_service.spec.ts`. Expected: FAIL (`seedPipeline` does not exist; the spec fails to import).

- [ ] **Step 2: Add `seedPipeline` and seed `twoStudios()`**

Append to `apps/platform/tests/helpers/pipeline.ts`:

```ts
/**
 * One of everything in `tenant`: a client with an accepted inquiry that
 * became a project, the inquiry's reference image (attached to the project
 * too), a fixed quote and a submitted payment. Call it inside
 * `inTenant(tenant, …)`.
 */
export async function seedPipeline(tenant: TenantRef) {
	const client = await makeClient(tenant);
	const inquiry = await makeInquiry(tenant, client, {
		status: "accepted",
		decidedAt: DateTime.utc(),
	});
	const project = await makeProject(tenant, client, { inquiryId: inquiry.id });
	const referenceImage = await makeReferenceImage(tenant, {
		inquiryId: inquiry.id,
		projectId: project.id,
	});
	const quote = await makeQuote(tenant, project);
	const payment = await makePayment(tenant, project);
	return { client, inquiry, project, referenceImage, quote, payment };
}
```

In `apps/platform/tests/helpers/tenants.ts` import `seedPipeline` (`import { seedPipeline } from "#tests/helpers/pipeline";`, sorted), seed it in `studio()` and return it:

```ts
	const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
	return { tenant, owner, artist, paymentMethod, artistProfile, pipeline };
```

and update the `twoStudios` doc comment: "Two studios, each with an owner, an artist, two payment methods (`paymentMethod` is the first), an artist profile (`artistProfile`) and one of each pipeline record (`pipeline`: client, accepted inquiry, project, reference image, quote and a submitted payment). Later tickets add seed data for their own tables here, so every isolation case sees it."

- [ ] **Step 3: Make `Tenant.softDelete` cascade through a list**

In `apps/platform/app/modules/tenancy/models/tenant.ts` add the imports (sorted):

```ts
import type { LucidModel } from "@adonisjs/lucid/types/model";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import TattooProject from "#modules/projects/models/tattoo_project";
```

Add above the class:

```ts
/**
 * Models that are soft-deleted with their tenant: each has `tenant_id` and
 * `deleted_at`. Quotes and payments have no `deleted_at` and are left alone;
 * they stay readable by direct queries, so list them through a live project.
 */
const CASCADE: LucidModel[] = [
	TenantMembership,
	PaymentMethod,
	Artist,
	Client,
	Inquiry,
	TattooProject,
	ReferenceImage,
];
```

Replace the three repeated update statements in `softDelete` with a loop and update the doc comment ("…its live memberships, payment methods, artists, clients, inquiries, projects and reference images, so nothing keeps pointing at a deleted tenant."):

```ts
		const run = async (client: TransactionClientContract) => {
			// Update queries skip the soft-delete hooks: filter live rows here,
			// so rows removed earlier keep their original deleted_at.
			for (const model of CASCADE) {
				await model
					.query({ client })
					.where("tenant_id", this.id)
					.whereNull("deleted_at")
					.update({ deleted_at: DateTime.utc().toSQL() });
			}
			await super.softDelete(client);
		};
```

If `pnpm typecheck` rejects `LucidModel[]` for these classes, stop and report BLOCKED with the compiler message; do not widen types with casts.

- [ ] **Step 4: Run the tests to verify they pass**

`--files=tenancy_service.spec.ts`, `--files=soft_deletes.spec.ts`, `--files=cross_tenant.spec.ts`, `--files=harness.spec.ts`, `--files=tenant_routes.spec.ts`. Expected: PASS. Then the whole functional suite once (`timeout -s KILL 900 node ace test functional`): every existing test still passes with the seeded pipeline rows.

- [ ] **Step 5: Typecheck, lint and commit**

`pnpm typecheck`, `pnpm exec biome check .`.

```bash
git add apps/platform
git commit -m "feat(platform): cascade tenant deletes through the pipeline and seed it"
```

---

### Task 8: Documentation

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/database/README.md`
- Modify: `docs/data-model.md`, `docs/requirements.md` (repo root)

- [ ] **Step 1: Backend conventions (`apps/platform/docs/backend.md`)**

1. In the Tenancy bullet replace "also soft-deletes its live memberships, payment methods and artists." with "also soft-deletes its live memberships, payment methods, artists, clients, inquiries, projects and reference images (quotes and payments have no `deleted_at` and stay)."
2. In the Images bullet replace "production moves to R2 (TAT-27)." with "production moves to R2 (TAT-27). The private `reference_image` purpose (TAT-37) holds a client's reference images: load the owning inquiry or project scoped to the tenant first, then ask for the signed URL."
3. In the Payments bullet replace "with the tenant's `defaultDepositPercent` and `depositPolicy`." with "with the tenant's `defaultDepositPercent` and `depositPolicy`. `Payment` (`#modules/payments/models/payment`, TAT-37) is the append-only ledger of money received; see the next section."
4. Before `## Phone numbers` insert:

```md
## Clients, inquiries and projects

- Clients, inquiries and projects (TAT-37, data layer only): `app/modules/clients/` owns `Client` (one per normalized phone per tenant; `anonymized_at` is for the privacy deletion, TAT-42), `app/modules/inquiries/` owns `Inquiry` (a frozen record of what was submitted) and `ReferenceImage`, `app/modules/projects/` owns `TattooProject` and `Quote`, and `Payment` lives in `app/modules/payments/`. There are no services yet: TAT-51 (intake and client matching), TAT-46 (inbox and lifecycle), TAT-64 (quotes) and TAT-65 (deposit page and proofs) add them, so until then touch these models only in tests and inside a tenant context. The allowed values are const arrays in the model files (`INQUIRY_STATUSES`, `SOURCE_CHANNELS`, `PROJECT_STATUSES`, `QUOTE_KINDS`, `PAYMENT_KINDS`, `PAYMENT_STATUSES`). Links between these tables are composite `(tenant_id, id)` foreign keys with `NO ACTION`. A project has no `inquiry` status (the inquiry is its own record) and its transition rules are TAT-46's. A quote revision is a new row with the next `version`, the current quote is the project's highest version, time is whole minutes (`estimated_minutes`) and money is paisa. A payment is never edited or deleted: a refund is a negative `refund` payment, a reversal of a mistaken verification is a `correction`, and a decided payment (`verified` or `rejected`) is final, so if a customer paid a different amount than shown, reject the payment and record a new one (it may reuse the proof key, so delete a proof file only when no other payment references its key). Balance due (the current quote's total minus verified payments) is computed, never stored.
```

- [ ] **Step 2: Database conventions (`apps/platform/database/README.md`)**

1. Replace "payments (never deleted at all), and queue tables." with "payments (never deleted at all), quotes (versioned history), and queue tables."
2. Insert before the `- **Operations.**` bullet:

```md
- **Guard triggers.** `inquiries_guard_update` (the submitted fields are frozen) and `payments_guard` (append-only) are `FOR EACH ROW` plpgsql triggers that fail closed: they name the columns that may change and freeze every other column, so a column added later is frozen until its migration allows it. Errors read `<trigger>: <column> cannot change`. The privacy deletion (TAT-42) scrubs an inquiry by setting `anonymized_at` in the same update as the scrub; while it is set, the contact snapshot and the free-text fields (`idea`, `placement`, `approximate_size`, `preferred_dates`, `budget`) may change, and `anonymized_at` itself never changes again. The same ticket may only clear a payment's proof columns. A migration that backfills a frozen column on these tables must `ALTER TABLE … DISABLE TRIGGER <name>` around the backfill: the owner bypasses RLS but not triggers. A trigger's `down()` must drop its function as well as the trigger.
```

- [ ] **Step 3: Testing and data-model docs**

1. `apps/platform/docs/testing.md`: replace "two payment methods and an artist profile (`artistProfile`). Seed data for a new table goes there." with "two payment methods, an artist profile (`artistProfile`) and one of each pipeline record (`pipeline`: client, accepted inquiry, project, reference image, quote and a submitted payment). Seed data for a new table goes there."
2. `docs/data-model.md`, MVP entities table, replace these four rows (match them exactly as they are in the file today):
   - Client: `| **Client** | A person who contacts the studio: one per normalized phone per tenant; name, optional email, notes. Form input never overwrites an existing client |` becomes `| **Client** | A person who contacts the studio: one per normalized phone per tenant; name, optional email, notes. Form input never overwrites an existing client. Every client has a phone until its personal data is scrubbed (`anonymized_at`) |`
   - Inquiry: `... contact snapshot. Status `new`, `accepted` or `declined` |` becomes `... contact snapshot. Status `new`, `accepted` or `declined`, with the time of the decision. The submitted fields never change (a database trigger); only the privacy deletion can scrub the contact snapshot and free text |`
   - Quote: `| **Quote** | Fixed price, or hourly rate with estimated hours; deposit amount (may be zero); expiry. A new version replaces the current one, and history is kept |` becomes `| **Quote** | Fixed price, or hourly rate with estimated time (whole minutes); deposit amount (may be zero, never above the total); expiry. A revision is a new row with the next version, the current quote is the highest, and history is never deleted |`
   - Payment: `| **Payment** | Kind (`deposit`, `session`, `balance`, `refund`), amount, method, proof image, status (`submitted`, `verified`, `rejected`), who verified it and when. Never edited or deleted; a refund is a negative payment |` becomes `| **Payment** | Kind (`deposit`, `session`, `balance`, `refund`, `correction`), amount, method (a kind: `fonepay`, `esewa`, `khalti`, `bank` or `cash`), proof image, status (`submitted`, `verified`, `rejected`), who verified it and when. Never edited or deleted (a database trigger): a refund is a negative payment, a `correction` reverses a mistaken verification, and once verified or rejected a payment is final |`
3. `docs/requirements.md`, Project rules table, replace `| `inquiry` | Submitted, not yet looked at |` with `| `inquiry` | Not a project status: the submitted Inquiry (status `new`) before it is accepted; accepting it creates a project in `reviewing` |`.

If a row's text no longer matches the file exactly, read the row and apply the same change to what is there; say so in the report.

- [ ] **Step 4: Check and commit**

Re-read the diff. Biome ignores Markdown; run `pnpm exec biome check .` only if you touched anything else. `git status` shows only the five documentation files.

```bash
git add apps/platform/docs apps/platform/database/README.md docs
git commit -m "docs(platform): document the pipeline models and guard triggers"
```

---

### Task 9: Verification and review gates (run by the controller, not by an implementer)

Nothing here adds code; fix rounds go back to implementers.

- [ ] **Step 1: Everything green on the final head**

From `apps/platform`, with the inline variables: `timeout -s KILL 900 node ace test` (unit and functional; the previous 402 plus the new specs, no failures). Then `pnpm typecheck`; from the repo root `pnpm check` (only the 2 old `inertia/` warnings); `node ace codegen` and `git status --short` (no changes). Check for stray `node ace` processes.

- [ ] **Step 2: The migrations on a fresh database, both directions**

Create a scratch database (host and port as in `.env.example`; `psql` as `postgres` with the dev password), migrate it from zero as the owner, roll every migration back and migrate again, then drop it:

```bash
createdb -h 127.0.0.1 -p 5432 -U postgres tattoo_drip_scratch
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate
git status --short   # database/schema.ts must be unchanged after `pnpm exec biome check --write database/schema.ts`
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres node ace migration:rollback --connection=owner --batch=0
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate
dropdb -h 127.0.0.1 -p 5432 -U postgres tattoo_drip_scratch
```

Expected: all migrations run, the regenerated schema equals the committed one, the full rollback and the second migrate succeed (this proves both trigger functions are dropped by `down()`), and the scratch database is dropped. (`PGPASSWORD=postgres` for the `createdb`/`dropdb` calls. If `--batch=0` is not supported, roll back with repeated `migration:rollback` until `migration:status` shows everything pending.)

- [ ] **Step 3: Reviews**

Final whole-branch review by an Opus reviewer against the spec and this plan's Review Focus (each of the five must have a test that fails without the behaviour). Then the `codex-review` skill (Codex code review and security review). Fix confirmed findings in one wave, re-verify, commit. There is no UI, so no browser pass. Do not push or open the PR without the user's go-ahead.

