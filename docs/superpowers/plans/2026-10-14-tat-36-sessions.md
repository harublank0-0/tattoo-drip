# Sessions Inside Projects (TAT-36) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `project_sessions` table with the no-overlap exclusion constraint, its Lucid model, and a `SessionService` that schedules, reschedules, completes, marks no-show and cancels sessions and moves the project between `deposit_pending`, `booked` and `in_progress`, data and service layer only.

**Architecture:** One migration creates `project_sessions` with a stored generated `active` column (`deleted_at IS NULL AND status IN ('scheduled','completed')`) and `EXCLUDE USING gist (artist_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (active)`. A new `scheduling` module owns the model, the errors and `SessionService`; every operation that can change a project locks the project row first, then the session row. A small read-only `DepositService` in the `payments` module answers "is the deposit settled".

**Tech Stack:** AdonisJS 7, Lucid 22.4.2, Luxon, PostgreSQL 18 (`btree_gist`), Japa, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-14-tat-36-sessions-design.md` (approved). Read it first; it is the binding authority and this plan follows it.

## Notes where the plan goes beyond or differs from the spec

1. The spec's "the same artist is blocked across two tenants" test is dropped: the composite foreign keys refuse such a row before the constraint is reached, so the "cross-tenant project or artist link is rejected" test covers it. The spec text was corrected.
2. `DepositService` sums payments in JavaScript instead of SQL `sum()` (no int8 string to parse). The spec text was corrected.
3. The `SessionService` constructor takes `ArtistService` in Task 4 and gains `DepositService` in Task 5 (a private property nothing reads would fail `noUnusedLocals` in between).
4. Test-only additions: `makeSession` in `tests/helpers/pipeline.ts`, `isExclusionViolation` cases in `tests/unit/services/db_errors.spec.ts`, and a session in the existing `Tenant.softDelete` cascade test in `tests/functional/tenancy/tenancy_service.spec.ts` (the spec says `soft_deletes.spec.ts`, but the TAT-37 cascade test lives in `tenancy_service.spec.ts`).

## Global Constraints

- PostgreSQL 18; primary keys `uuidv7()`; instants `timestamptz`; enums are `table.enum` string columns (check constraints named `<table>_<column>_check`).
- Table `project_sessions` (never `sessions`: AdonisJS's database session store defaults to that name). Model `ProjectSession`, module `app/modules/scheduling/`.
- Constraint names: `project_sessions_artist_no_overlap` (exclusion) and `project_sessions_ends_after_starts` (check). Composite keys to `tattoo_projects` and `artists` use `tenantReference(table, "<col>", "<parent>", "NO ACTION")`.
- `active` is `GENERATED ALWAYS AS (deleted_at IS NULL AND status IN ('scheduled', 'completed')) STORED`. Application code never writes it.
- The exclusion range is half-open (`tstzrange(starts_at, ends_at)`), so back-to-back sessions are allowed.
- `btree_gist` is created by the migration (`create extension if not exists btree_gist`, owner role); `down()` leaves it.
- Soft delete (`deleted_at` + `withSoftDeletes`) on `project_sessions`; `Tenant.softDelete` soft-deletes its sessions too.
- Project statuses that refuse new sessions: `declined`, `cancelled`. Only `tattoo` sessions move a project. Session statuses `completed`, `no_show`, `cancelled` are final.
- Never put a `?` character in SQL passed to `this.schema.raw` (knex treats it as a binding placeholder).
- The app code never imports the `db` service (a Biome rule fails `pnpm check`). Use models, `withTransaction` and `dbClient()` from `#services/db_context`. Use `withTransaction` (a savepoint inside a request), never `db.transaction`.
- Controllers/services that use `@inject()` import their dependencies as values, with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- pnpm only; Biome, tabs and double quotes. Never edit `database/schema.ts` or `.adonisjs/` by hand: `pnpm migrate` regenerates the schema, then `pnpm exec biome check --write database/schema.ts`.
- Commits are Conventional Commits with the `platform` scope and end with the attribution trailer the session requires (`Co-Authored-By: ...`).
- **Every command that boots the app carries these inline variables** (the user's `.env` may not have them), and tests use port 3402:
  `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402`
- Wrap test runs in `timeout -s KILL <seconds>` (a spec that fails to import hangs instead of failing). `--files` is a suffix match: use the full file name.
- All commands run from `apps/platform` unless they say otherwise.
- Before writing the migration (Task 1), load the `supabase-postgres-best-practices` skill.

## Review Focus

The inputs and conditions the spec implies but a happy-path test would miss. Each line has its test in the task named.

1. **A time given in another zone.** A Luxon `DateTime` in `Asia/Kathmandu` is stored as the same instant, and overlap detection compares instants (Task 4, "a time in another zone").
2. **An invalid date.** `DateTime.fromISO("not a date")` has NaN milliseconds: it must fail as `invalid_range`, not reach the database (Task 4, "an invalid range").
3. **Moving a session by less than its own length.** Its new range overlaps its own old range; the constraint must not count the row against itself (Task 4, "reschedule").
4. **A repeated click on a finished session.** A stale in-memory session passed to `complete` twice gives `not_scheduled` the second time and must not push the project again (Task 4 "final statuses", Task 5 "completing twice").
5. **A soft-deleted artist or project.** Scheduling gives a 404 (`Row not found`), not a foreign-key error (Task 4, "unknown, deleted and other-tenant ids").

---

### Task 1: Migration, exclusion constraint and table tests

**Files:**
- Create: `database/migrations/1791600000000_create_project_sessions_table.ts`
- Modify (regenerated by `pnpm migrate`): `database/schema.ts`
- Modify: `tests/functional/rls/catalog_guard.spec.ts` (the `EXPECTED_POLICIES` object)
- Create: `tests/functional/scheduling/project_sessions_table.spec.ts`

**Interfaces:**
- Consumes: `enableTenantRls`, `disableTenantRls`, `tenantReference` from `#database/helpers/tenant_rls`; the pipeline factories `makeClient`, `makeProject`, `makeArtist`; `assertRowLevelSecurity`; `insertRow`, `updateRow`, `idOf`.
- Produces: table `project_sessions` with columns `id`, `tenant_id`, `project_id`, `artist_id`, `kind`, `starts_at`, `ends_at`, `status`, `active` (generated), `created_at`, `updated_at`, `deleted_at`; constraints `project_sessions_artist_no_overlap`, `project_sessions_ends_after_starts`, `project_sessions_kind_check`, `project_sessions_status_check`, `project_sessions_tenant_id_project_id_foreign`, `project_sessions_tenant_id_artist_id_foreign`; the generated `ProjectSessionSchema` class in `database/schema.ts` (Task 2 uses it).

- [ ] **Step 1: Write the failing table spec**

Create `tests/functional/scheduling/project_sessions_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeArtist, makeClient, makeProject } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** 2 November 2026 at `hour`:`minute` UTC. */
const at = (hour: number, minute = 0) =>
	new Date(Date.UTC(2026, 10, 2, hour, minute));

const OVERLAP = /project_sessions_artist_no_overlap/;

let seeded = 0;

const newSession = (
	tenantId: string,
	projectId: string,
	artistId: string,
	from: Date,
	to: Date,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	artist_id: artistId,
	kind: "tattoo",
	starts_at: from,
	ends_at: to,
	...over,
});

/** A project and two artists in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client);
		const sita = await makeArtist(tenant, "sita");
		const anu = await makeArtist(tenant, "anu");
		return { project, sita, anu };
	});

/** The insert fails; it runs in a savepoint so the test can go on. */
const rejects = (
	assert: Assert,
	row: Record<string, unknown>,
	message: RegExp,
) =>
	assert.rejects(
		() =>
			withTransaction((inner) => insertRow(inner, "project_sessions", row)),
		message,
	);

test.group("project_sessions table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist cannot have two blocking sessions that overlap; touching ones are fine", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (from: Date, to: Date) =>
			newSession(tenant.id, project.id, sita.id, from, to);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "project_sessions", row(at(10), at(12)));
			const overlapping: [Date, Date][] = [
				[at(11), at(13)], // starts inside
				[at(9), at(11)], // ends inside
				[at(10, 30), at(11, 30)], // inside
				[at(9), at(13)], // contains it
				[at(10), at(12)], // identical
			];
			for (const [from, to] of overlapping) {
				await rejects(assert, row(from, to), OVERLAP);
			}
			// Half-open ranges: starting when another ends, or ending when it
			// starts, is not an overlap.
			await insertRow(trx, "project_sessions", row(at(12), at(13)));
			await insertRow(trx, "project_sessions", row(at(8), at(10)));
		});
	});

	test("only scheduled and completed sessions block; cancelled, no-show and deleted ones do not", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (from: Date, to: Date, over: Record<string, unknown> = {}) =>
			newSession(tenant.id, project.id, sita.id, from, to, over);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const base = idOf(
				await insertRow(trx, "project_sessions", row(at(10), at(12))),
			);
			for (const status of ["cancelled", "no_show"]) {
				await insertRow(
					trx,
					"project_sessions",
					row(at(10), at(12), { status }),
				);
			}

			// A completed session still blocks the time it occupied.
			await insertRow(
				trx,
				"project_sessions",
				row(at(14), at(16), { status: "completed" }),
			);
			await rejects(assert, row(at(15), at(17)), OVERLAP);

			// Putting a cancelled session back into a taken slot is refused.
			const cancelled = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(at(11), at(13), { status: "cancelled" }),
				),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", cancelled, {
							status: "scheduled",
						}),
					),
				OVERLAP,
			);

			// A soft-deleted session frees its time; restoring it needs the time free.
			await updateRow(trx, "project_sessions", base, {
				deleted_at: new Date(),
			});
			await insertRow(trx, "project_sessions", row(at(10), at(12)));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", base, { deleted_at: null }),
					),
				OVERLAP,
			);
		});
	});

	test("two artists may have sessions at the same time", async () => {
		const { tenant } = await studioWithOwner();
		const { project, sita, anu } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const artist of [sita, anu]) {
				await insertRow(
					trx,
					"project_sessions",
					newSession(tenant.id, project.id, artist.id, at(10), at(12)),
				);
			}
		});
	});

	test("a session must end after it starts", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async () => {
			const ranges: [Date, Date][] = [
				[at(10), at(10)],
				[at(12), at(10)],
			];
			for (const [from, to] of ranges) {
				await rejects(
					assert,
					newSession(tenant.id, project.id, sita.id, from, to),
					/project_sessions_ends_after_starts/,
				);
			}
		});
	});

	test("active is generated from status and deleted_at and cannot be written", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (hour: number, over: Record<string, unknown> = {}) =>
			newSession(tenant.id, project.id, sita.id, at(hour), at(hour + 1), over);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const activeOf = async (id: string) =>
				(
					await trx.rawQuery(
						"select active from project_sessions where id = ?",
						[id],
					)
				).rows[0].active;

			const scheduled = idOf(await insertRow(trx, "project_sessions", row(8)));
			const completed = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(9, { status: "completed" }),
				),
			);
			const noShow = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(10, { status: "no_show" }),
				),
			);
			const cancelled = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(11, { status: "cancelled" }),
				),
			);
			assert.isTrue(await activeOf(scheduled));
			assert.isTrue(await activeOf(completed));
			assert.isFalse(await activeOf(noShow));
			assert.isFalse(await activeOf(cancelled));

			await updateRow(trx, "project_sessions", scheduled, {
				deleted_at: new Date(),
			});
			assert.isFalse(await activeOf(scheduled));

			await rejects(assert, row(12, { active: true }), /column "active"/);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", completed, { active: false }),
					),
				/column "active"/,
			);
		});
	});

	test("kind and status only take their listed values", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await rejects(
				assert,
				newSession(tenant.id, project.id, sita.id, at(10), at(12), {
					kind: "piercing",
				}),
				/project_sessions_kind_check/,
			);
			await rejects(
				assert,
				newSession(tenant.id, project.id, sita.id, at(10), at(12), {
					status: "pending",
				}),
				/project_sessions_status_check/,
			);
		});
	});

	test("a session links only to its own tenant's project and artist", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const mine = await parentsIn(a);
		const theirs = await parentsIn(b);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				assert,
				newSession(a.id, theirs.project.id, mine.sita.id, at(10), at(12)),
				/project_sessions_tenant_id_project_id_foreign/,
			);
			await rejects(
				assert,
				newSession(a.id, mine.project.id, theirs.sita.id, at(10), at(12)),
				/project_sessions_tenant_id_artist_id_foreign/,
			);
			await insertRow(
				trx,
				"project_sessions",
				newSession(a.id, mine.project.id, mine.sita.id, at(10), at(12)),
			);
		});
	});

	test("a project or artist with a session cannot be hard-deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(
				trx,
				"project_sessions",
				newSession(tenant.id, project.id, sita.id, at(10), at(12)),
			);
			for (const [table, id, constraint] of [
				[
					"tattoo_projects",
					project.id,
					/project_sessions_tenant_id_project_id_foreign/,
				],
				[
					"artists",
					sita.id,
					/project_sessions_tenant_id_artist_id_foreign/,
				],
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

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "project_sessions", async (tenant) => {
			seeded += 1;
			const { project, sita } = await inTenant(tenant, async () => {
				const client = await makeClient(tenant);
				return {
					project: await makeProject(tenant, client),
					// A fresh slug each call: slugs are unique per tenant.
					sita: await makeArtist(tenant, `artist-${seeded}`),
				};
			});
			return newSession(tenant.id, project.id, sita.id, at(10), at(12));
		});
	});
});
```

- [ ] **Step 2: Add the catalog guard entry**

In `tests/functional/rls/catalog_guard.spec.ts`, add `project_sessions: ["tenant_isolation:ALL"],` to `EXPECTED_POLICIES`, between the `payments` and `quotes` lines:

```ts
	payments: ["tenant_isolation:ALL"],
	project_sessions: ["tenant_isolation:ALL"],
	quotes: ["tenant_isolation:ALL"],
```

- [ ] **Step 3: Run both specs to verify they fail**

Run:
`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 pnpm test functional --files=project_sessions_table.spec.ts`
`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 pnpm test functional --files=catalog_guard.spec.ts`
Expected: the table spec FAILs with `relation "project_sessions" does not exist`; the catalog guard FAILs because `project_sessions` has an expected policy entry but no table.

- [ ] **Step 4: Write the migration**

Create `database/migrations/1791600000000_create_project_sessions_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * A time block for one artist inside a project (TAT-36). `active` is the one
 * definition of "blocks time": a session is active while it is scheduled or
 * completed and not deleted. The exclusion constraint keeps one artist from
 * having two active sessions that overlap; the range is half-open, so
 * back-to-back sessions are fine. Table name: not `sessions`, which the
 * database session store of AdonisJS uses by default.
 */
export default class extends BaseSchema {
	protected tableName = "project_sessions";

	async up() {
		// A gist index needs this extension to compare a uuid with `=`.
		// Available on PostgreSQL 18; creating it takes the owner role, which
		// is who runs migrations.
		this.schema.raw("create extension if not exists btree_gist");

		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("artist_id").notNullable();
			table.enum("kind", ["consultation", "tattoo", "touch_up"]).notNullable();
			table.timestamp("starts_at", { useTz: true }).notNullable();
			table.timestamp("ends_at", { useTz: true }).notNullable();
			table
				.enum("status", ["scheduled", "completed", "no_show", "cancelled"])
				.notNullable()
				.defaultTo("scheduled");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");
			tenantReference(table, "artist_id", "artists", "NO ACTION");

			table.index(["tenant_id", "project_id"]);
			// The artist foreign key's index, and the calendar's.
			table.index(["tenant_id", "artist_id", "starts_at"]);
			// An owner's studio-wide view.
			table.index(["tenant_id", "starts_at"]);
		});

		this.schema.raw(
			"alter table project_sessions add column active boolean generated always as (deleted_at is null and status in ('scheduled', 'completed')) stored",
		);
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_ends_after_starts check (ends_at > starts_at)",
		);
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_artist_no_overlap exclude using gist (artist_id with =, tstzrange(starts_at, ends_at) with &&) where (active)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
		// btree_gist stays: nothing says only this table uses it.
	}
}
```

- [ ] **Step 5: Migrate and regenerate the schema**

Run:
`DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate`
then `pnpm exec biome check --write database/schema.ts`.
Expected: the migration runs; `database/schema.ts` gains `ProjectSessionSchema`. Check it:
`rg -n "class ProjectSessionSchema" -A40 database/schema.ts` shows `active`, `artistId`, `endsAt`, `kind`, `projectId`, `startsAt`, `status`, `tenantId`, `deletedAt`, `createdAt`, `updatedAt` columns (`startsAt`/`endsAt` as `DateTime`, `active` as `boolean`). If the class is named differently, note the real name: Task 2 imports it.

- [ ] **Step 6: Run both specs to verify they pass**

Run the two commands from Step 3 again. Expected: both PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec biome check --write database/migrations/1791600000000_create_project_sessions_table.ts tests/functional/scheduling/project_sessions_table.spec.ts tests/functional/rls/catalog_guard.spec.ts
git add database/migrations/1791600000000_create_project_sessions_table.ts database/schema.ts tests/functional/scheduling/project_sessions_table.spec.ts tests/functional/rls/catalog_guard.spec.ts
git commit -m "feat(platform): add the project_sessions table with a no-overlap constraint"
```

- [ ] **Step 8: Prove the migration reverses and the tests are not vacuous**

Run `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate:rollback` then `... pnpm migrate` again, then `pnpm exec biome check --write database/schema.ts`. Expected: both finish clean and `git diff database/schema.ts` is empty.

Mutation check: in the migration, change the generated column to `status in ('scheduled', 'completed', 'cancelled')`, run `pnpm migrate:rollback && pnpm migrate`, run `--files=project_sessions_table.spec.ts`. Expected: FAIL in "only scheduled and completed sessions block" (a cancelled overlap is rejected) and in "active is generated". Revert with `git checkout database/migrations/1791600000000_create_project_sessions_table.ts`, run `pnpm migrate:rollback && pnpm migrate` and `pnpm exec biome check --write database/schema.ts`, rerun the spec (PASS), and confirm `git status --short` shows nothing changed.

---

### Task 2: `ProjectSession` model, `makeSession` factory and the tenant cascade

**Files:**
- Create: `app/modules/scheduling/models/project_session.ts`
- Modify: `app/modules/tenancy/models/tenant.ts` (the `cascade()` list and two comments)
- Modify: `tests/helpers/pipeline.ts` (add `makeSession`)
- Modify: `tests/functional/scheduling/project_sessions_table.spec.ts` (add a model group)
- Modify: `tests/functional/tenancy/tenancy_service.spec.ts` (the TAT-37 cascade test)

**Interfaces:**
- Consumes: `ProjectSessionSchema` from `#database/schema`, `withSoftDeletes`.
- Produces:
  - `export const SESSION_KINDS = ["consultation", "tattoo", "touch_up"] as const; export type SessionKind`
  - `export const SESSION_STATUSES = ["scheduled", "completed", "no_show", "cancelled"] as const; export type SessionStatus`
  - `export default class ProjectSession` with `kind: SessionKind`, `status: SessionStatus`, plus the schema's `tenantId`, `projectId`, `artistId`, `startsAt: DateTime`, `endsAt: DateTime`, `active: boolean`, `deletedAt`.
  - `makeSession(tenant: {id: string}, project: TattooProject, artist: Artist, over?: Partial<Pick<ProjectSession, "kind" | "startsAt" | "endsAt" | "status">>): Promise<ProjectSession>` — default: a scheduled `tattoo` session 10:00–12:00 UTC on 2 Nov 2026.

- [ ] **Step 1: Write the failing tests**

Append to `tests/functional/scheduling/project_sessions_table.spec.ts`. Add these imports at the top of the file (merge with the existing ones):

```ts
import { DateTime } from "luxon";
import ProjectSession, {
	SESSION_KINDS,
	SESSION_STATUSES,
} from "#modules/scheduling/models/project_session";
import { makeSession } from "#tests/helpers/pipeline";
```
(`makeSession` joins the existing `#tests/helpers/pipeline` import: `import { makeArtist, makeClient, makeProject, makeSession } from "#tests/helpers/pipeline";`.) Then add at the end of the file:

```ts
test.group("ProjectSession model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("keeps its columns and lists its allowed values", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await inTenant(tenant, async () => {
			const session = await makeSession(tenant, project, sita);
			// Lucid leaves columns the database fills in undefined until reloaded.
			await session.refresh();
			assert.equal(session.tenantId, tenant.id);
			assert.equal(session.projectId, project.id);
			assert.equal(session.artistId, sita.id);
			assert.equal(session.kind, "tattoo");
			assert.equal(session.status, "scheduled");
			assert.equal(
				session.startsAt.toMillis(),
				DateTime.utc(2026, 11, 2, 10).toMillis(),
			);
			assert.equal(
				session.endsAt.toMillis(),
				DateTime.utc(2026, 11, 2, 12).toMillis(),
			);
			assert.isTrue(session.active);
			assert.isNull(session.deletedAt);
		});
		assert.deepEqual(
			[...SESSION_KINDS],
			["consultation", "tattoo", "touch_up"],
		);
		assert.deepEqual(
			[...SESSION_STATUSES],
			["scheduled", "completed", "no_show", "cancelled"],
		);
	});

	test("a soft delete frees the artist's time and a restore needs it free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await inTenant(tenant, async () => {
			const first = await makeSession(tenant, project, sita);
			await first.softDelete();

			assert.isNull(await ProjectSession.find(first.id));
			const trashed = await ProjectSession.withTrashed()
				.where("id", first.id)
				.firstOrFail();
			assert.isFalse(trashed.active);

			// The same time is free again.
			await makeSession(tenant, project, sita);
			await assert.rejects(
				() => withTransaction((trx) => first.restore(trx)),
				OVERLAP,
			);
		});
	});
});
```

In `tests/functional/tenancy/tenancy_service.spec.ts`, add imports (keep them in the file's alphabetical import order):

```ts
import ProjectSession from "#modules/scheduling/models/project_session";
```
and extend the pipeline import: `import { makeArtist, makeClient, makeSession, seedPipeline } from "#tests/helpers/pipeline";`.

Then edit the test "soft-deleting a tenant soft-deletes its clients, inquiries, projects and reference images, and leaves quotes, payments and other tenants alone". Rename it to "soft-deleting a tenant soft-deletes its clients, inquiries, projects, reference images and sessions, and leaves quotes, payments and other tenants alone". Replace

```ts
		await inTenant(other, () => seedPipeline(other));

		await inTenant(tenant, async () => {
			await seedPipeline(tenant);
			// A client removed earlier keeps its original deleted_at.
```
(inside that test only) with

```ts
		await inTenant(other, async () => {
			const seeded = await seedPipeline(other);
			await makeSession(other, seeded.project, await makeArtist(other));
		});

		await inTenant(tenant, async () => {
			const seeded = await seedPipeline(tenant);
			await makeSession(tenant, seeded.project, await makeArtist(tenant));
			// A client removed earlier keeps its original deleted_at.
```
and, after the `ReferenceImage` assertions inside `await inTenant(tenant, ...)` (after the line `assert.lengthOf(await ReferenceImage.onlyTrashed().where("tenant_id", tenant.id), 1);`), add:

```ts
			assert.isEmpty(
				await ProjectSession.query().where("tenant_id", tenant.id),
			);
			assert.lengthOf(
				await ProjectSession.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
```
and in the `await inTenant(other, async () => {` block at the end of the test add:

```ts
			assert.lengthOf(
				await ProjectSession.query().where("tenant_id", other.id),
				1,
			);
```

- [ ] **Step 2: Run the specs to verify they fail**

Run `--files=project_sessions_table.spec.ts` and `--files=tenancy_service.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: FAIL with a module-not-found error for `#modules/scheduling/models/project_session` (and `makeSession` not exported).

- [ ] **Step 3: Create the model**

Create `app/modules/scheduling/models/project_session.ts`:

```ts
import { compose } from "@adonisjs/core/helpers";
import { ProjectSessionSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const SESSION_KINDS = ["consultation", "tattoo", "touch_up"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = [
	"scheduled",
	"completed",
	"no_show",
	"cancelled",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * A time block for one artist inside a project. `active` is generated by the
 * database (scheduled or completed, and not deleted) and is what the
 * no-overlap constraint looks at: never set it, and use `where active` for
 * anything that asks whether time is taken. `completed`, `no_show` and
 * `cancelled` are final. Read and change sessions through SessionService.
 */
export default class ProjectSession extends compose(
	ProjectSessionSchema,
	withSoftDeletes,
) {
	declare kind: SessionKind;
	declare status: SessionStatus;
}
```

- [ ] **Step 4: Add `makeSession` to the pipeline helpers**

In `tests/helpers/pipeline.ts` add the imports

```ts
import ProjectSession from "#modules/scheduling/models/project_session";
```
(after the `#modules/projects/...` imports, keeping alphabetical order) and append:

```ts
type SessionOver = Partial<
	Pick<ProjectSession, "kind" | "startsAt" | "endsAt" | "status">
>;

/**
 * A scheduled tattoo session for `artist` in `project`, two hours long from
 * 10:00 UTC on 2 November 2026. The database refuses two active sessions of
 * one artist that overlap, so pass `startsAt` and `endsAt` for a second one.
 */
export function makeSession(
	tenant: TenantRef,
	project: TattooProject,
	artist: Artist,
	over: SessionOver = {},
) {
	return ProjectSession.create({
		tenantId: tenant.id,
		projectId: project.id,
		artistId: artist.id,
		kind: "tattoo",
		startsAt: DateTime.utc(2026, 11, 2, 10),
		endsAt: DateTime.utc(2026, 11, 2, 12),
		status: "scheduled",
		...over,
	});
}
```

- [ ] **Step 5: Add sessions to the tenant cascade**

In `app/modules/tenancy/models/tenant.ts`: add `import ProjectSession from "#modules/scheduling/models/project_session";` after the `#modules/projects/models/tattoo_project` import, add `ProjectSession,` as the last item of `cascade()` (after `ReferenceImage`), and update the two comments: in the `cascade` doc comment nothing needs to change; in `softDelete`'s comment change "projects and reference images" to "projects, reference images and sessions":

```ts
		/**
		 * Soft-deletes the tenant and, in the same transaction, its live
		 * memberships, payment methods, artists, clients, inquiries, projects,
		 * reference images and sessions, so nothing keeps pointing at a deleted
		 * tenant.
		 */
```

- [ ] **Step 6: Run the specs to verify they pass**

Run `--files=project_sessions_table.spec.ts`, `--files=tenancy_service.spec.ts` and `--files=soft_deletes.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: PASS. Then `pnpm typecheck`. Expected: clean.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec biome check --write app/modules/scheduling app/modules/tenancy/models/tenant.ts tests/helpers/pipeline.ts tests/functional/scheduling/project_sessions_table.spec.ts tests/functional/tenancy/tenancy_service.spec.ts
git add app/modules/scheduling app/modules/tenancy/models/tenant.ts tests/helpers/pipeline.ts tests/functional/scheduling/project_sessions_table.spec.ts tests/functional/tenancy/tenancy_service.spec.ts
git commit -m "feat(platform): add the ProjectSession model and soft-delete it with its tenant"
```

---

### Task 3: `DepositService`

**Files:**
- Create: `app/modules/payments/services/deposit_service.ts`
- Create: `tests/functional/payments/deposit_service.spec.ts`

**Interfaces:**
- Consumes: `Quote` (`depositAmount`, `version`), `Payment` (`amount`, `kind`, `status`), the pipeline factories.
- Produces: `export default class DepositService { isSettled(tenant: Pick<Tenant, "id">, project: Pick<TattooProject, "id">): Promise<boolean> }` — constructible with no arguments.

- [ ] **Step 1: Write the failing spec**

Create `tests/functional/payments/deposit_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositService from "#modules/payments/services/deposit_service";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const deposits = new DepositService();

/** Decided as verified: the database wants a decision time with the status. */
const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

/** A project with no quote or payments yet. */
const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), { status: "deposit_pending" }),
	);

test.group("DepositService.isSettled", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project with no quote is not settled", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		assert.isFalse(
			await inTenant(tenant, () => deposits.isSettled(tenant, project)),
		);
	});

	test("a zero deposit is settled with no payments", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project, { depositAmount: 0 });
			assert.isTrue(await deposits.isSettled(tenant, project));
		});
	});

	test("only verified deposits count, and they must reach the amount", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			// The default quote asks for NPR 3,000 (300,000 paisa).
			await makeQuote(tenant, project);
			assert.isFalse(await deposits.isSettled(tenant, project), "unpaid");

			await makePayment(tenant, project);
			assert.isFalse(await deposits.isSettled(tenant, project), "submitted");

			await makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			assert.isFalse(await deposits.isSettled(tenant, project), "rejected");

			await makePayment(tenant, project, { amount: 100_000, ...verified() });
			assert.isFalse(await deposits.isSettled(tenant, project), "partial");

			await makePayment(tenant, project, { amount: 200_000, ...verified() });
			assert.isTrue(await deposits.isSettled(tenant, project), "two parts");

			await makePayment(tenant, project, { amount: 50_000, ...verified() });
			assert.isTrue(await deposits.isSettled(tenant, project), "overpaid");
		});
	});

	test("a verified correction reverses a deposit; other kinds do not count", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, { kind: "session", ...verified() });
			await makePayment(tenant, project, { kind: "balance", ...verified() });
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"session and balance payments are not the deposit",
			);

			await makePayment(tenant, project, verified());
			assert.isTrue(await deposits.isSettled(tenant, project), "deposit");

			await makePayment(tenant, project, {
				kind: "correction",
				amount: -300_000,
				...verified(),
			});
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"the correction un-settles it",
			);
		});
	});

	test("the current quote is the highest version", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, verified());
			assert.isTrue(await deposits.isSettled(tenant, project), "v1 asks 3,000");

			await makeQuote(tenant, project, { version: 2, depositAmount: 500_000 });
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"v2 asks 5,000 and replaces v1",
			);

			await makeQuote(tenant, project, { version: 3, depositAmount: 300_000 });
			assert.isTrue(await deposits.isSettled(tenant, project), "v3 asks 3,000");
		});
	});

	test("another tenant cannot see the project's quote or payments", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await projectIn(a);
		await inTenant(a, () => makeQuote(a, project, { depositAmount: 0 }));

		assert.isTrue(await inTenant(a, () => deposits.isSettled(a, project)));
		assert.isFalse(await inTenant(b, () => deposits.isSettled(b, project)));
	});
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 pnpm test functional --files=deposit_service.spec.ts`. Expected: FAIL with module-not-found for `#modules/payments/services/deposit_service`.

- [ ] **Step 3: Write the service**

Create `app/modules/payments/services/deposit_service.ts`:

```ts
import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;

/**
 * Payment kinds that count toward a deposit. A `correction` is a verified
 * reversal of a mistaken verification (negative for a deposit that was
 * counted by mistake), so it counts too.
 */
const COUNTED_KINDS = ["deposit", "correction"];

/**
 * Whether a project's deposit is covered. Read-only; TAT-65 (the deposit page
 * and proofs) will own this class and grow it.
 *
 * It reads the `Quote` model directly because there is no quote service yet:
 * TAT-64 adds one, and this should call it then.
 */
export default class DepositService {
	/**
	 * True when the project's current quote (its highest version) asks for no
	 * deposit, or the verified deposits and corrections reach the amount. A
	 * project with no quote is not settled. Payments are summed here, not in
	 * SQL: each amount is an int4 and a project has a handful of payments, so
	 * there is no int8 `sum()` string to parse.
	 */
	async isSettled(tenant: TenantRef, project: ProjectRef): Promise<boolean> {
		const quote = await Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();
		if (!quote) return false;
		if (quote.depositAmount === 0) return true;

		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("status", "verified")
			.whereIn("kind", COUNTED_KINDS);
		const paid = payments.reduce((sum, { amount }) => sum + amount, 0);
		return paid >= quote.depositAmount;
	}
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run the command from Step 2. Expected: PASS (6 tests). Then `pnpm typecheck`; expected clean.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec biome check --write app/modules/payments/services/deposit_service.ts tests/functional/payments/deposit_service.spec.ts
git add app/modules/payments/services/deposit_service.ts tests/functional/payments/deposit_service.spec.ts
git commit -m "feat(platform): add DepositService to tell whether a deposit is settled"
```

---

### Task 4: `SessionService` operations

**Files:**
- Create: `app/modules/scheduling/errors.ts`
- Create: `app/modules/scheduling/services/session_service.ts`
- Modify: `app/services/db_errors.ts` (add `isExclusionViolation`)
- Modify: `tests/unit/services/db_errors.spec.ts`
- Create: `tests/functional/scheduling/session_service.spec.ts`

**Interfaces:**
- Consumes: `ProjectSession`, `SessionKind`, `SessionStatus` (Task 2); `ArtistService.findFor(tenant, id)`; `TattooProject`, `PROJECT_STATUSES`, `ProjectStatus`; `withTransaction`; the test factories `makeSession`, `makeArtist`, `makeClient`, `makeProject`.
- Produces:
  - `isExclusionViolation(error: unknown, constraint: string): boolean` in `#services/db_errors`.
  - `class SessionRuleError extends Error { readonly reason: "project_closed" | "not_scheduled" | "invalid_range" }` and `class SessionOverlapError extends Error` in `#modules/scheduling/errors`; `type SessionRuleReason`.
  - `SessionService` (`@inject()`, `constructor(private artists: ArtistService)` in this task) with:
    - `findFor(tenant, id: string): Promise<ProjectSession>`
    - `listForProject(tenant, project: TattooProject): Promise<ProjectSession[]>` (by `starts_at`, then `id`)
    - `schedule(tenant, project: TattooProject, input: NewSession): Promise<ProjectSession>`
    - `reschedule(tenant, session: ProjectSession, times: SessionTimes): Promise<ProjectSession>`
    - `complete(tenant, session)`, `markNoShow(tenant, session)`, `cancel(tenant, session)`: `Promise<ProjectSession>`
    - `type SessionTimes = { startsAt: DateTime; endsAt: DateTime }`, `type NewSession = SessionTimes & { artistId: string; kind: SessionKind }`
  - Task 5 relies on the module-private helpers `lockProject`, `lockScheduled`, `assertProjectOf`, `assertSessionOf` and on `finish` and `schedule` being the places the moves are added.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/services/db_errors.spec.ts`: change the import to `import { isExclusionViolation, isUniqueViolation } from "#services/db_errors";` and append:

```ts
test.group("isExclusionViolation", () => {
	test("matches a 23P01 error for the named constraint", ({ assert }) => {
		const error = {
			code: "23P01",
			constraint: "project_sessions_artist_no_overlap",
		};
		assert.isTrue(
			isExclusionViolation(error, "project_sessions_artist_no_overlap"),
		);
	});

	test("does not match another constraint, another code or a non-error", ({
		assert,
	}) => {
		assert.isFalse(
			isExclusionViolation({ code: "23P01", constraint: "other" }, "mine"),
		);
		assert.isFalse(
			isExclusionViolation({ code: "23505", constraint: "mine" }, "mine"),
		);
		assert.isFalse(isExclusionViolation(null, "mine"));
		assert.isFalse(isExclusionViolation("23P01", "mine"));
	});
});
```

Create `tests/functional/scheduling/session_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import SessionService, {
	type NewSession,
} from "#modules/scheduling/services/session_service";
import { dbClient } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeProject,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(new ArtistService(new ImageService()));

/** 2 November 2026 at `hour`:`minute` UTC. */
const at = (hour: number, minute = 0) => DateTime.utc(2026, 11, 2, hour, minute);

const slot = (
	artist: { id: string },
	from: number,
	to: number,
	kind: SessionKind = "tattoo",
): NewSession => ({
	artistId: artist.id,
	kind,
	startsAt: at(from),
	endsAt: at(to),
});

/** The reason of the SessionRuleError `fn` throws, or null if it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof SessionRuleError) return error.reason;
		throw error;
	}
	return null;
}

/** A studio with one project (default `booked`) and two artists. */
async function setup(status: ProjectStatus = "booked") {
	const { tenant } = await studioWithOwner();
	const parts = await inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			client,
			project: await makeProject(tenant, client, { status }),
			sita: await makeArtist(tenant, "sita"),
			anu: await makeArtist(tenant, "anu"),
		};
	});
	return { tenant, ...parts };
}

test.group("SessionService schedule", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates a scheduled session and fills an empty project artist, never replacing one", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(
				tenant,
				project,
				slot(sita, 10, 12),
			);

			assert.equal(session.tenantId, tenant.id);
			assert.equal(session.projectId, project.id);
			assert.equal(session.artistId, sita.id);
			assert.equal(session.kind, "tattoo");
			assert.equal(session.status, "scheduled");
			assert.equal(session.startsAt.toMillis(), at(10).toMillis());
			assert.equal(session.endsAt.toMillis(), at(12).toMillis());
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				sita.id,
			);

			// `project` in memory still has no artist; the live row has.
			await sessions.schedule(tenant, project, slot(anu, 10, 12, "consultation"));
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				sita.id,
			);
		});
	});

	test("every project status takes a session except declined and cancelled", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				const project = await makeProject(tenant, client, { status });
				const attempt = () =>
					sessions.schedule(tenant, project, slot(sita, 8 + index, 9 + index));
				if (status === "declined" || status === "cancelled") {
					assert.equal(await ruleOf(attempt), "project_closed", status);
				} else {
					assert.isNull(await ruleOf(attempt), status);
				}
			}
		});
	});

	test("an invalid range is refused before the database sees it", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const ranges: [DateTime, DateTime][] = [
				[at(10), at(10)],
				[at(12), at(10)],
				[DateTime.fromISO("not a date"), at(12)],
				[at(10), DateTime.fromISO("not a date")],
			];
			for (const [startsAt, endsAt] of ranges) {
				const rule = await ruleOf(() =>
					sessions.schedule(tenant, project, {
						artistId: sita.id,
						kind: "tattoo",
						startsAt,
						endsAt,
					}),
				);
				assert.equal(rule, "invalid_range");
			}
			assert.isEmpty(
				await ProjectSession.query().where("project_id", project.id),
			);
		});
	});

	test("a time in another zone is the same instant, and overlaps are found across zones", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		// 15:45 in Kathmandu (UTC+5:45) is 10:00 UTC.
		const local = DateTime.fromObject(
			{ year: 2026, month: 11, day: 2, hour: 15, minute: 45 },
			{ zone: "Asia/Kathmandu" },
		);

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(tenant, project, {
				artistId: sita.id,
				kind: "tattoo",
				startsAt: local,
				endsAt: local.plus({ hours: 2 }),
			});

			const stored = await ProjectSession.findOrFail(session.id);
			assert.equal(stored.startsAt.toMillis(), at(10).toMillis());
			assert.equal(stored.endsAt.toMillis(), at(12).toMillis());
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 11, 13)),
				SessionOverlapError,
			);
		});
	});

	test("unknown, deleted and other-tenant ids are a 404", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other, "sita"));

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(theirs, 10, 12)),
				/Row not found/,
			);
			await assert.rejects(
				() =>
					sessions.schedule(tenant, project, {
						...slot(sita, 10, 12),
						artistId: randomUUID(),
					}),
				/Row not found/,
			);

			await sita.softDelete();
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 10, 12)),
				/Row not found/,
			);

			await project.softDelete();
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(anu, 10, 12)),
				/Row not found/,
			);
		});
	});

	test("an overlap throws SessionOverlapError, leaves the request usable and rolls back the artist fill", async ({
		assert,
	}) => {
		const { tenant, client, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			await sessions.schedule(tenant, project, slot(sita, 10, 12));
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 11, 13)),
				SessionOverlapError,
			);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);

			// Touching, and another artist at the same time, are fine.
			await sessions.schedule(tenant, project, slot(sita, 12, 13));
			await sessions.schedule(tenant, project, slot(anu, 10, 12));
			assert.lengthOf(
				await ProjectSession.query().where("project_id", project.id),
				3,
			);

			// A project with no artist yet: the failed schedule must not leave
			// the artist behind.
			const fresh = await makeProject(tenant, client);
			await assert.rejects(
				() => sessions.schedule(tenant, fresh, slot(sita, 11, 13)),
				SessionOverlapError,
			);
			assert.isNull((await TattooProject.findOrFail(fresh.id)).artistId);
		});
	});
});

test.group("SessionService reschedule, complete, no-show and cancel", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("reschedule changes the time, may overlap its own old time, and refuses other sessions' time", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(
				tenant,
				project,
				slot(sita, 10, 12),
			);
			await sessions.schedule(tenant, project, slot(sita, 14, 16));

			// 11:00–13:00 overlaps the session's own 10:00–12:00.
			const moved = await sessions.reschedule(tenant, session, {
				startsAt: at(11),
				endsAt: at(13),
			});
			assert.equal(moved.startsAt.toMillis(), at(11).toMillis());
			assert.equal(moved.endsAt.toMillis(), at(13).toMillis());

			await assert.rejects(
				() =>
					sessions.reschedule(tenant, session, {
						startsAt: at(15),
						endsAt: at(17),
					}),
				SessionOverlapError,
			);
			const stored = await ProjectSession.findOrFail(session.id);
			assert.equal(stored.startsAt.toMillis(), at(11).toMillis());

			assert.equal(
				await ruleOf(() =>
					sessions.reschedule(tenant, session, {
						startsAt: at(13),
						endsAt: at(13),
					}),
				),
				"invalid_range",
			);
		});
	});

	test("complete, markNoShow and cancel set the status; only a completed session keeps blocking", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const toComplete = await sessions.schedule(tenant, project, slot(sita, 8, 9));
			const toMiss = await sessions.schedule(tenant, project, slot(sita, 10, 11));
			const toCancel = await sessions.schedule(tenant, project, slot(sita, 12, 13));

			const done = await sessions.complete(tenant, toComplete);
			const missed = await sessions.markNoShow(tenant, toMiss);
			const cancelled = await sessions.cancel(tenant, toCancel);
			assert.equal(done.status, "completed");
			assert.equal(missed.status, "no_show");
			assert.equal(cancelled.status, "cancelled");

			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 8, 9)),
				SessionOverlapError,
			);
			await sessions.schedule(tenant, project, slot(sita, 10, 11));
			await sessions.schedule(tenant, project, slot(sita, 12, 13));
		});
	});

	test("completed, no-show and cancelled sessions are final, even for a stale copy", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const stale = await sessions.schedule(tenant, project, slot(sita, 8, 9));
			const other = await sessions.schedule(tenant, project, slot(sita, 10, 11));
			await sessions.complete(tenant, stale);
			await sessions.cancel(tenant, other);

			// `stale` still says "scheduled" in memory: the live row decides.
			for (const session of [stale, other]) {
				for (const attempt of [
					() => sessions.complete(tenant, session),
					() => sessions.markNoShow(tenant, session),
					() => sessions.cancel(tenant, session),
					() =>
						sessions.reschedule(tenant, session, {
							startsAt: at(20),
							endsAt: at(21),
						}),
				]) {
					assert.equal(await ruleOf(attempt), "not_scheduled");
				}
			}
		});
	});
});

test.group("SessionService reads and tenant scoping", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("findFor and listForProject see only the tenant's live sessions, in time order", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");

		await inTenant(tenant, async () => {
			const late = await sessions.schedule(tenant, project, slot(sita, 14, 15));
			const early = await sessions.schedule(tenant, project, slot(sita, 10, 11));
			const deleted = await sessions.schedule(
				tenant,
				project,
				slot(sita, 16, 17),
			);
			// A fresh copy: the one the service returned belongs to its finished
			// savepoint.
			await (await ProjectSession.findOrFail(deleted.id)).softDelete();

			const listed = await sessions.listForProject(tenant, project);
			assert.deepEqual(
				listed.map(({ id }) => id),
				[early.id, late.id],
			);
			assert.equal((await sessions.findFor(tenant, early.id)).id, early.id);
			await assert.rejects(
				() => sessions.findFor(tenant, deleted.id),
				/Row not found/,
			);
			await assert.rejects(
				() => sessions.findFor(tenant, randomUUID()),
				/Row not found/,
			);

			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.findFor(other, early.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.listForProject(other, project),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() => sessions.schedule(other, project, slot(sita, 10, 11)),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() => sessions.cancel(other, early),
					/belongs to another tenant/,
				);
			});
		});
	});
});
```

- [ ] **Step 2: Run the specs to verify they fail**

Run `--files=db_errors.spec.ts` (with `node ace test unit --files=db_errors.spec.ts`, inline variables) and `--files=session_service.spec.ts` (functional). Expected: both FAIL (`isExclusionViolation` is not exported; module-not-found for `#modules/scheduling/errors`).

- [ ] **Step 3: Add `isExclusionViolation`**

Append to `app/services/db_errors.ts`:

```ts

/**
 * Whether `error` is PostgreSQL's exclusion violation (23P01) of the named
 * exclusion constraint. Recover from it after the savepoint that raised it
 * has rolled back (withTransaction does that).
 */
export function isExclusionViolation(
	error: unknown,
	constraint: string,
): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23P01" &&
		"constraint" in error &&
		error.constraint === constraint
	);
}
```

- [ ] **Step 4: Write the errors**

Create `app/modules/scheduling/errors.ts`:

```ts
export const SESSION_RULE_REASONS = [
	"project_closed",
	"not_scheduled",
	"invalid_range",
] as const;
export type SessionRuleReason = (typeof SESSION_RULE_REASONS)[number];

const MESSAGES: Record<SessionRuleReason, string> = {
	project_closed: "A declined or cancelled project takes no new sessions",
	not_scheduled: "Only a scheduled session can be changed",
	invalid_range: "A session must end after it starts",
};

/**
 * A scheduling rule was broken; `reason` says which. The message is for
 * developers; show your own to the user.
 */
export class SessionRuleError extends Error {
	constructor(readonly reason: SessionRuleReason) {
		super(MESSAGES[reason]);
		this.name = "SessionRuleError";
	}
}

/**
 * The artist already has a scheduled or completed session that overlaps this
 * time. The message is for developers; show your own to the user.
 */
export class SessionOverlapError extends Error {
	constructor() {
		super("The artist already has a session at that time");
		this.name = "SessionOverlapError";
	}
}
```

- [ ] **Step 5: Write the service**

Create `app/modules/scheduling/services/session_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isExclusionViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

export type SessionTimes = { startsAt: DateTime; endsAt: DateTime };
export type NewSession = SessionTimes & {
	artistId: string;
	kind: SessionKind;
};

const OVERLAP = "project_sessions_artist_no_overlap";

/** Projects that take no new sessions. */
const CLOSED: ProjectStatus[] = ["declined", "cancelled"];

/**
 * The way to read and change a tenant's sessions. Every call is scoped to
 * the tenant, and every write runs in a transaction that first locks the
 * project row and then the session row, always in that order. Overlaps are
 * settled by the database: the exclusion constraint raises, and the error
 * becomes SessionOverlapError after the failed savepoint has rolled back.
 */
@inject()
export default class SessionService {
	constructor(private artists: ArtistService) {}

	/**
	 * The tenant's live session with this id. An unknown id, a deleted
	 * session and another tenant's session all throw E_ROW_NOT_FOUND (a 404).
	 */
	async findFor(tenant: TenantRef, id: string): Promise<ProjectSession> {
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * The project's live sessions, earliest first.
	 */
	async listForProject(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<ProjectSession[]> {
		assertProjectOf(tenant, project);
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * Adds a `scheduled` session. A declined or cancelled project refuses
	 * (SessionRuleError "project_closed"); a project without an artist gets
	 * this session's artist. Throws SessionOverlapError when the artist is
	 * busy, and E_ROW_NOT_FOUND for an unknown or deleted artist or project.
	 */
	async schedule(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
	): Promise<ProjectSession> {
		assertRange(input);
		assertProjectOf(tenant, project);
		const artist = await this.artists.findFor(tenant, input.artistId);
		try {
			return await withTransaction(async (trx) => {
				const live = await lockProject(trx, tenant, project.id);
				if (CLOSED.includes(live.status)) {
					throw new SessionRuleError("project_closed");
				}
				if (!live.artistId) {
					live.artistId = artist.id;
					await live.save();
				}
				return ProjectSession.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						artistId: artist.id,
						kind: input.kind,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
					},
					{ client: trx },
				);
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * Moves a scheduled session to another time (the same artist; another
	 * artist is cancel plus schedule).
	 */
	async reschedule(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		assertRange(times);
		assertSessionOf(tenant, session);
		try {
			return await withTransaction(async (trx) => {
				await lockProject(trx, tenant, session.projectId);
				const live = await lockScheduled(trx, tenant, session.id);
				live.merge({ startsAt: times.startsAt, endsAt: times.endsAt });
				await live.save();
				return live;
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/** `scheduled` to `completed`. The time it occupied stays blocked. */
	complete(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "completed");
	}

	/** `scheduled` to `no_show`. The time is free again. */
	markNoShow(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "no_show");
	}

	/** `scheduled` to `cancelled`. The time is free again. */
	cancel(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "cancelled");
	}

	private async finish(
		tenant: TenantRef,
		session: ProjectSession,
		to: Exclude<SessionStatus, "scheduled">,
	): Promise<ProjectSession> {
		assertSessionOf(tenant, session);
		return withTransaction(async (trx) => {
			await lockProject(trx, tenant, session.projectId);
			const live = await lockScheduled(trx, tenant, session.id);
			live.status = to;
			await live.save();
			return live;
		});
	}
}

/**
 * Written so that an invalid DateTime (NaN milliseconds) fails too.
 */
function assertRange({ startsAt, endsAt }: SessionTimes) {
	if (!(endsAt.toMillis() > startsAt.toMillis())) {
		throw new SessionRuleError("invalid_range");
	}
}

/**
 * Locks the live project row. A deleted or other tenant's project is a 404.
 */
function lockProject(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return TattooProject.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * Locks the live session row and checks it is still `scheduled`: the copy a
 * caller holds can be stale, the row decides.
 */
async function lockScheduled(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	const session = await ProjectSession.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
	if (session.status !== "scheduled") {
		throw new SessionRuleError("not_scheduled");
	}
	return session;
}

/**
 * Turns the exclusion violation into the error callers handle. Runs after
 * withTransaction rolled its savepoint back.
 */
function rethrowOverlap(error: unknown): never {
	if (isExclusionViolation(error, OVERLAP)) throw new SessionOverlapError();
	throw error;
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}

function assertSessionOf(tenant: TenantRef, session: ProjectSession) {
	if (session.tenantId !== tenant.id) {
		throw new Error(`Session ${session.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 6: Run the specs to verify they pass**

Run `node ace test unit --files=db_errors.spec.ts` and `pnpm test functional --files=session_service.spec.ts` (inline variables, `timeout -s KILL 180`). Expected: PASS. Then `pnpm typecheck`; expected clean.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec biome check --write app/services/db_errors.ts app/modules/scheduling tests/unit/services/db_errors.spec.ts tests/functional/scheduling/session_service.spec.ts
git add app/services/db_errors.ts app/modules/scheduling tests/unit/services/db_errors.spec.ts tests/functional/scheduling/session_service.spec.ts
git commit -m "feat(platform): add SessionService to schedule, move and finish sessions"
```

---

### Task 5: Project status moves and `settleBooking`

**Files:**
- Modify: `app/modules/scheduling/services/session_service.ts`
- Modify: `tests/functional/scheduling/session_service.spec.ts`

**Interfaces:**
- Consumes: Task 4's service and its private helpers; `DepositService.isSettled` (Task 3); `makeQuote`, `makePayment`, `makeSession`.
- Produces:
  - `SessionService` constructor becomes `(private artists: ArtistService, private deposits: DepositService)`.
  - `settleBooking(tenant: TenantRef, project: TattooProject): Promise<boolean>` — true when it moved the project `deposit_pending` to `booked`. TAT-65 calls it after verifying a deposit.
  - `schedule` (tattoo kind) and `complete` (tattoo kind) now move the project as the spec's table says.

- [ ] **Step 1: Write the failing tests**

In `tests/functional/scheduling/session_service.spec.ts`, change the imports and the service construction:

```ts
import DepositService from "#modules/payments/services/deposit_service";
```
(keep imports alphabetical: it goes after `#modules/media/services/image_service`), extend the pipeline import to `import { makeArtist, makeClient, makePayment, makeProject, makeQuote, makeSession } from "#tests/helpers/pipeline";`, and replace

```ts
const sessions = new SessionService(new ArtistService(new ImageService()));
```
with

```ts
const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(),
);

const statusOf = async (project: { id: string }) =>
	(await TattooProject.findOrFail(project.id)).status;
```
Also add `at`-based helper for factory sessions and the verified payment attributes near `slot`:

```ts
/** Decided as verified: the database wants a decision time with the status. */
const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});
```

Append these groups to the file:

```ts
test.group("SessionService project moves", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a tattoo session books a deposit_pending project only when the deposit is settled", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();
		const cases = [
			{ name: "no quote", deposit: null, paid: "none", expected: "deposit_pending" },
			{ name: "a zero deposit", deposit: 0, paid: "none", expected: "booked" },
			{ name: "an unpaid deposit", deposit: 300_000, paid: "none", expected: "deposit_pending" },
			{ name: "a submitted payment", deposit: 300_000, paid: "submitted", expected: "deposit_pending" },
			{ name: "a verified payment", deposit: 300_000, paid: "verified", expected: "booked" },
		] as const;

		await inTenant(tenant, async () => {
			for (const [index, c] of cases.entries()) {
				const project = await makeProject(tenant, client, {
					status: "deposit_pending",
				});
				if (c.deposit !== null) {
					await makeQuote(tenant, project, { depositAmount: c.deposit });
				}
				if (c.paid === "submitted") await makePayment(tenant, project);
				if (c.paid === "verified") {
					await makePayment(tenant, project, verified());
				}

				await sessions.schedule(
					tenant,
					project,
					slot(sita, 8 + index, 9 + index),
				);

				assert.equal(await statusOf(project), c.expected, c.name);
			}
		});
	});

	test("a consultation or touch-up never moves the project; the next tattoo session re-books an in_progress one", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const settled = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, settled, { depositAmount: 0 });
			await sessions.schedule(tenant, settled, slot(sita, 8, 9, "consultation"));
			await sessions.schedule(tenant, settled, slot(sita, 9, 10, "touch_up"));
			assert.equal(await statusOf(settled), "deposit_pending");

			const working = await makeProject(tenant, client, {
				status: "in_progress",
			});
			await sessions.schedule(tenant, working, slot(sita, 10, 11, "touch_up"));
			assert.equal(await statusOf(working), "in_progress");
			await sessions.schedule(tenant, working, slot(sita, 11, 12));
			assert.equal(await statusOf(working), "booked");
		});
	});

	test("a session can hold the date while the deposit is unpaid; settleBooking books it once the deposit is verified, and only once", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, project);
			await sessions.schedule(tenant, project, slot(sita, 10, 12));
			assert.equal(await statusOf(project), "deposit_pending");
			assert.isFalse(await sessions.settleBooking(tenant, project));

			await makePayment(tenant, project, verified());
			assert.isTrue(await sessions.settleBooking(tenant, project));
			assert.equal(await statusOf(project), "booked");
			assert.isFalse(await sessions.settleBooking(tenant, project));
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("settleBooking needs a scheduled tattoo session and a deposit_pending project", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, project, { depositAmount: 0 });
			assert.isFalse(await sessions.settleBooking(tenant, project), "none");

			await makeSession(tenant, project, sita, {
				kind: "consultation",
				startsAt: at(8),
				endsAt: at(9),
			});
			await makeSession(tenant, project, sita, {
				kind: "touch_up",
				startsAt: at(9),
				endsAt: at(10),
			});
			await makeSession(tenant, project, sita, {
				status: "cancelled",
				startsAt: at(10),
				endsAt: at(11),
			});
			await makeSession(tenant, project, sita, {
				status: "completed",
				startsAt: at(11),
				endsAt: at(12),
			});
			assert.isFalse(
				await sessions.settleBooking(tenant, project),
				"consultation, touch-up, cancelled and completed sessions do not count",
			);
			assert.equal(await statusOf(project), "deposit_pending");

			await makeSession(tenant, project, sita, {
				startsAt: at(12),
				endsAt: at(13),
			});
			assert.isTrue(await sessions.settleBooking(tenant, project));
			assert.equal(await statusOf(project), "booked");

			const reviewing = await makeProject(tenant, client, {
				status: "reviewing",
			});
			await makeQuote(tenant, reviewing, { depositAmount: 0 });
			await makeSession(tenant, reviewing, sita, {
				startsAt: at(14),
				endsAt: at(15),
			});
			assert.isFalse(await sessions.settleBooking(tenant, reviewing));
			assert.equal(await statusOf(reviewing), "reviewing");
		});
	});

	test("completing a tattoo session starts the work; nothing else moves a project", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();
		const cases = [
			{ status: "booked", kind: "tattoo", action: "complete", expected: "in_progress" },
			{ status: "booked", kind: "consultation", action: "complete", expected: "booked" },
			{ status: "booked", kind: "touch_up", action: "complete", expected: "booked" },
			{ status: "in_progress", kind: "tattoo", action: "complete", expected: "in_progress" },
			{ status: "deposit_pending", kind: "tattoo", action: "complete", expected: "deposit_pending" },
			{ status: "booked", kind: "tattoo", action: "markNoShow", expected: "booked" },
			{ status: "booked", kind: "tattoo", action: "cancel", expected: "booked" },
		] as const;

		await inTenant(tenant, async () => {
			for (const [index, c] of cases.entries()) {
				const project = await makeProject(tenant, client, { status: c.status });
				const session = await makeSession(tenant, project, sita, {
					kind: c.kind,
					startsAt: at(index * 2),
					endsAt: at(index * 2 + 1),
				});

				await sessions[c.action](tenant, session);

				assert.equal(
					await statusOf(project),
					c.expected,
					`${c.status} + ${c.kind} ${c.action}`,
				);
			}
		});
	});

	test("rescheduling changes no status, and cancelling the last session leaves the project booked", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup("booked");

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(tenant, project, slot(sita, 10, 12));
			await sessions.reschedule(tenant, session, {
				startsAt: at(14),
				endsAt: at(16),
			});
			assert.equal(await statusOf(project), "booked");

			await sessions.cancel(tenant, session);
			assert.equal(await statusOf(project), "booked");
			assert.isEmpty(
				(await sessions.listForProject(tenant, project)).filter(
					({ status }) => status === "scheduled",
				),
			);
		});
	});

	test("completing a session twice does not push the project twice", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup("booked");

		await inTenant(tenant, async () => {
			const first = await sessions.schedule(tenant, project, slot(sita, 8, 9));
			await sessions.complete(tenant, first);
			assert.equal(await statusOf(project), "in_progress");

			// The next session books it again.
			await sessions.schedule(tenant, project, slot(sita, 10, 11));
			assert.equal(await statusOf(project), "booked");

			// A second click on the first session's button, with the stale copy.
			assert.equal(
				await ruleOf(() => sessions.complete(tenant, first)),
				"not_scheduled",
			);
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("settleBooking refuses another tenant's project", async ({ assert }) => {
		const { project } = await setup("deposit_pending");
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");

		await inTenant(other, async () => {
			await assert.rejects(
				() => sessions.settleBooking(other, project),
				/belongs to another tenant/,
			);
		});
	});
});
```

(`ProjectSession` is already imported in this file from Task 4; `at` returns a Luxon `DateTime`, which is what `makeSession` takes.)

- [ ] **Step 2: Run the spec to verify it fails**

Run `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 180 pnpm test functional --files=session_service.spec.ts`. Expected: the new "project moves" tests FAIL (`sessions.settleBooking is not a function`, statuses unchanged); the Task 4 tests still pass.

- [ ] **Step 3: Add the moves to the service**

In `app/modules/scheduling/services/session_service.ts`:

1. Add the import (keep alphabetical order, after the `#modules/artists` import):

```ts
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
```

2. Change the constructor:

```ts
	constructor(
		private artists: ArtistService,
		private deposits: DepositService,
	) {}
```

3. In `schedule`, replace the `return ProjectSession.create(...)` statement with:

```ts
				const session = await ProjectSession.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						artistId: artist.id,
						kind: input.kind,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
					},
					{ client: trx },
				);
				if (input.kind === "tattoo") {
					if (live.status === "in_progress") await setStatus(live, "booked");
					else await this.moveToBooked(tenant, live);
				}
				return session;
```

4. In `finish`, replace the body of the `withTransaction` callback with:

```ts
			const project = await lockProject(trx, tenant, session.projectId);
			const live = await lockScheduled(trx, tenant, session.id);
			live.status = to;
			await live.save();
			if (
				to === "completed" &&
				live.kind === "tattoo" &&
				project.status === "booked"
			) {
				await setStatus(project, "in_progress");
			}
			return live;
```

5. Add the public method `settleBooking` and the private `moveToBooked` to the class (after `cancel`, before `finish`):

```ts
	/**
	 * Moves a `deposit_pending` project to `booked` when it has a scheduled
	 * tattoo session and its deposit is settled. Returns whether it moved.
	 * `schedule` calls it; so does whatever verifies a deposit (TAT-65), so
	 * the move happens at the later of the two events. Calling it again, or
	 * for a project in another status, changes nothing.
	 */
	async settleBooking(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			return this.moveToBooked(tenant, live);
		});
	}

	/**
	 * The `deposit_pending` to `booked` rule. The caller holds the project's
	 * row lock and passes the live row.
	 */
	private async moveToBooked(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		if (project.status !== "deposit_pending") return false;
		const tattoo = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "tattoo")
			.where("status", "scheduled")
			.first();
		if (!tattoo) return false;
		if (!(await this.deposits.isSettled(tenant, project))) return false;
		await setStatus(project, "booked");
		return true;
	}
```

6. Add the helper at the bottom of the file (before `assertRange`):

```ts
/**
 * Changes a locked project's status. The row came from `lockProject`, so it
 * saves in the same transaction.
 */
async function setStatus(project: TattooProject, status: ProjectStatus) {
	project.status = status;
	await project.save();
}
```

(`ProjectStatus` is already imported. `ProjectSession.query()` and `deposits.isSettled` join the ambient transaction, the same one `withTransaction` opened.)

- [ ] **Step 4: Run the spec to verify it passes**

Run the command from Step 2. Expected: PASS, all groups. Then `pnpm typecheck`; expected clean.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec biome check --write app/modules/scheduling tests/functional/scheduling/session_service.spec.ts
git add app/modules/scheduling tests/functional/scheduling/session_service.spec.ts
git commit -m "feat(platform): move the project when tattoo sessions are scheduled and completed"
```

---

### Task 6: Docs and full verification

**Files:**
- Modify: `docs/data-model.md` (the Session row)
- Modify: `apps/platform/docs/backend.md` (new Scheduling bullet; two sentences)
- Modify: `apps/platform/database/README.md` (a new bullet)

- [ ] **Step 1: Update `docs/data-model.md`**

Replace the Session row in the MVP entities table with:

```
| **Session** | A time block for one artist inside a project (table `project_sessions`): kind (`consultation`, `tattoo`, `touch_up`), start and end, status (`scheduled`, `completed`, `no_show`, `cancelled`). The database prevents overlapping active sessions for the same artist: a session is active while it is `scheduled` or `completed` and not deleted, and the time is a half-open range, so back-to-back sessions are fine. `completed`, `no_show` and `cancelled` are final |
```

- [ ] **Step 2: Update `apps/platform/docs/backend.md`**

1. In the "Clients, inquiries and projects" bullet, change "Soft-deleting a client, inquiry or project does NOT cascade to its children yet (only `Tenant.softDelete` does, across the whole tenant)" to "Soft-deleting a client, inquiry or project does NOT cascade to its children yet, sessions included (only `Tenant.softDelete` does, across the whole tenant)".
2. In the "Tenancy and route access" Tenancy bullet, change "also soft-deletes its live memberships, payment methods, artists, clients, inquiries, projects and reference images" to "also soft-deletes its live memberships, payment methods, artists, clients, inquiries, projects, reference images and sessions".
3. Insert a new section between "Clients, inquiries and projects" and "Phone numbers":

```
## Scheduling

- Scheduling (TAT-36): `app/modules/scheduling/` owns `ProjectSession` (table `project_sessions`, not `sessions`: the database session store's default name) and `SessionService` (`#modules/scheduling/services/session_service`): `schedule`, `reschedule` (time only), `complete`, `markNoShow`, `cancel`, `settleBooking`, `findFor` and `listForProject`; calendar range queries are TAT-50's. A session is `active` while it is `scheduled` or `completed` and not deleted: `active` is a stored generated column and the one definition of "blocks time", so never write it and use `where active` for anything that asks whether time is taken. `project_sessions_artist_no_overlap` (a gist exclusion on the artist and the half-open time range) settles every race; `schedule` and `reschedule` turn its SQLSTATE 23P01 into `SessionOverlapError`, and `SessionRuleError` carries a `reason` (`project_closed`, `not_scheduled`, `invalid_range`). Controllers write their own messages. `completed`, `no_show` and `cancelled` are final; a mistake is a new session. Only `tattoo` sessions move the project: scheduling one moves `in_progress` to `booked` and, through `settleBooking`, `deposit_pending` to `booked` once a scheduled tattoo session exists and `DepositService.isSettled` is true (the current quote's deposit is 0, or verified `deposit` and `correction` payments reach it); completing one moves `booked` to `in_progress`. Whatever verifies a deposit (TAT-65) must call `settleBooking` afterwards. Cancelling or no-showing the last live session leaves a `booked` project `booked`: TAT-46 owns any rollback and can flag "booked with no scheduled session". Every write locks the project row `FOR UPDATE` first and then the session row, in that order. `DepositService` (payments module) reads the `Quote` model directly until TAT-64 adds a quote service. A session's artist can be any live artist of the tenant; the first session fills an empty project artist.
```

- [ ] **Step 3: Update `apps/platform/database/README.md`**

Insert a new bullet before the `- **Operations.**` bullet:

```
- **Exclusion constraints and `btree_gist`.** `project_sessions` keeps one artist from being in two places with `EXCLUDE USING gist (artist_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (active)`. Comparing a uuid with `=` in a gist index needs the `btree_gist` extension, which the migration creates with `create extension if not exists btree_gist` (the owner role runs migrations; on a managed Postgres check the provider allows the extension). `down()` leaves the extension in place. `active` is a stored generated column, so the definition of "blocks time" lives in one place; the half-open range makes back-to-back sessions legal. The error is SQLSTATE 23P01 with the constraint name `project_sessions_artist_no_overlap`: recognize it with `isExclusionViolation` (`#services/db_errors`), the way unique indexes use `isUniqueViolation`.
```

- [ ] **Step 4: Full verification**

1. Scratch database from zero (host and port as in `.env.example`; `PGPASSWORD=postgres` for `createdb`/`dropdb`):

```bash
createdb -h 127.0.0.1 -p 5432 -U postgres tattoo_drip_scratch
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate
pnpm exec biome check --write database/schema.ts
git diff --stat database/schema.ts
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres node ace migration:rollback --connection=owner --batch=0
DB_DATABASE=tattoo_drip_scratch DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres pnpm migrate
dropdb -h 127.0.0.1 -p 5432 -U postgres tattoo_drip_scratch
git status --short database/schema.ts
```
Expected: every migration runs from zero (including `btree_gist`), the regenerated schema equals the committed one (no diff), the full rollback and the second migrate succeed, and the scratch database is dropped. If `--batch=0` is not supported, roll back with repeated `migration:rollback` until `migration:status` shows everything pending. `database/schema.ts` must be unchanged afterwards.

2. The whole platform suite: `DB_USER=tattoo_drip_app DB_PASSWORD=tattoo_drip_app DB_MIGRATION_USER=postgres DB_MIGRATION_PASSWORD=postgres PORT=3402 timeout -s KILL 900 node ace test`. Expected: all suites PASS, including `catalog_guard`, the cross-tenant harness and the new specs.

3. `pnpm typecheck` and `pnpm check` (from the repo root: `pnpm check` runs Biome). Expected: clean.

4. `node ace codegen`, then `git status --short`. Expected: no change (there are no new routes, pages or controllers). If `.adonisjs/` changed, keep the regenerated files.

- [ ] **Step 5: Commit**

```bash
git add docs/data-model.md apps/platform/docs/backend.md apps/platform/database/README.md
git commit -m "docs(platform): document scheduling and the btree_gist requirement"
```

- [ ] **Step 6: Hand off for review**

Do not push or open the PR from the plan. Tell the user the branch is ready and that the whole-branch review (the Codex code and security review, `codex-review` skill) comes next; the PR and the Linear carry-forward comments (TAT-46, TAT-65, TAT-43, TAT-50, TAT-45, TAT-64, per the spec's "Tests and docs" section) follow once the user approves them.

---

## Self-review (done while writing)

**Spec coverage:** table, generated `active`, constraint, indexes, RLS, `btree_gist` (Task 1); model, factory, `Tenant.softDelete` cascade (Task 2); deposit rule (Task 3); `SessionService` operations, errors, `isExclusionViolation`, locking, artist fill, closed projects, final statuses, reads (Task 4); status moves and `settleBooking` (Task 5); docs, scratch-database run, suite, typecheck, Biome, codegen (Task 6). The spec's "design claim" (row lock is untested) is not turned into a test; Tasks 4 and 5 call `lockProject` on every write path, which is the claim.

**Placeholders:** none; every step has code or an exact command.

**Type consistency:** `SessionRuleError.reason` / `SessionRuleReason`; `NewSession`, `SessionTimes`; `lockProject(trx, tenant, id)`, `lockScheduled(trx, tenant, id)`, `assertProjectOf`, `assertSessionOf`, `setStatus(project, status)`, `moveToBooked(tenant, project)`; `makeSession(tenant, project, artist, over)`; `DepositService.isSettled(tenant, project)`. The constructor changes in Task 5 (one extra argument) and the Task 4 spec's `new SessionService(new ArtistService(new ImageService()))` line is replaced in Task 5 Step 1.
