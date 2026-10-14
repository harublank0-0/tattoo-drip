# Sessions inside projects + no-overlap exclusion constraint

Date: 2026-10-14
Refs: TAT-36. Its blockers TAT-37 (project models, PR #16) and TAT-28 (row-level security) are merged. It blocks TAT-43 (walk-ins), TAT-45 (slot engine), TAT-46 (inbox and project board), TAT-50 (artist calendar), TAT-70 (pilot metrics) and TAT-74 (SMS reminders).

## Goal

An artist's time can never be double-booked, and the database says so even when a service has a bug. A project moves to `booked` and `in_progress` as its tattoo sessions are scheduled and completed. This ticket creates the `project_sessions` table with the ticket's exclusion constraint, its Lucid model, and a `SessionService` that schedules, reschedules, completes, marks no-show and cancels sessions and makes the project status moves that belong to them.

It has no routes, pages, API, SDK or OpenAPI changes. TAT-43 (walk-ins), TAT-50 (calendar) and TAT-65 (deposit proofs) call the service.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Scope | Data layer plus `SessionService`; no routes, pages or API | The ticket's behavior checkboxes (the two project moves, reschedule, cancel and no-show) need a service. Surfaces belong to TAT-43 and TAT-50 |
| Session scheduled before the deposit is verified | Allowed. The session holds the artist's time and the project stays `deposit_pending`; it becomes `booked` at the later of the two events (`settleBooking`, called by `schedule` and by TAT-65) | A studio can hold a date while the client pays. `booked` is defined as "deposit verified and a session is scheduled" |
| Session's artist | Any live artist of the tenant. If the project has no artist, scheduling its first session assigns that artist | Walk-ins and accepted inquiries with no preferred artist have none; a consultation or touch-up can be with someone else |
| Last live session cancelled or marked no-show | The project stays `booked`; TAT-46 owns any rollback | The lifecycle has no backward arrow from `booked`; inventing one here would preempt TAT-46 |
| How "blocks time" is defined | A stored generated column `active`, used as the constraint's `WHERE (active)` | One definition in the database; the slot engine and calendar can `where active`. Checked on the dev Postgres 18.6: back-to-back sessions pass, a cancelled overlap is ignored, a real overlap raises 23P01 |

## Module and conventions

- **Module `scheduling`** (`app/modules/scheduling/`, the Scheduling row of the [architecture](../../architecture.md) table) owns `ProjectSession` (`models/`), `SessionService` (`services/`) and the errors (`errors.ts`).
- **The table is `project_sessions`, not `sessions`**: AdonisJS's database session store (`SESSION_DRIVER=database`, an allowed value in `start/env.ts`) defaults to a table named `sessions`. The docs still call the entity Session.
- **Migration** `1791600000000_create_project_sessions_table`, after `1791590000005`. It runs as the owner role, creates `btree_gist` if missing (available on the dev Postgres but not installed), runs `enableTenantRls`, and links other tenant-owned tables with `tenantReference(..., "NO ACTION")`. Its `down()` drops the table and leaves the extension. The table gets its `tenant_isolation:ALL` entry in `EXPECTED_POLICIES` (`tests/functional/rls/catalog_guard.spec.ts`).
- **Conventions** as in [database conventions](../../../apps/platform/database/README.md): UUIDv7 key, `timestamptz` instants, enums as string columns with a check, soft delete (`deleted_at`, `withSoftDeletes`).
- **`Tenant.softDelete`** also soft-deletes the tenant's live sessions: `ProjectSession` joins the `cascade()` list in `app/modules/tenancy/models/tenant.ts`. A project's own soft-delete cascade stays TAT-46's.

## Table `project_sessions`

Also `id`, `tenant_id` (references `tenants`, cascade, indexed), `created_at`, `updated_at`, `deleted_at`.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid, not null | Composite FK to `tattoo_projects`, `NO ACTION` |
| `artist_id` | uuid, not null | Composite FK to `artists`, `NO ACTION` |
| `kind` | enum, not null | `consultation`, `tattoo`, `touch_up` |
| `starts_at` | timestamptz, not null | |
| `ends_at` | timestamptz, not null | |
| `status` | enum, not null, default `scheduled` | `scheduled`, `completed`, `no_show`, `cancelled` |
| `active` | boolean, generated always, stored | `deleted_at IS NULL AND status IN ('scheduled', 'completed')`. Nothing writes it |

- Check `project_sessions_ends_after_starts`: `ends_at > starts_at`.
- Constraint `project_sessions_artist_no_overlap`: `EXCLUDE USING gist (artist_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (active)`. The range is half-open, so back-to-back sessions are fine. `artist_id` alone is enough: artist ids are unique and the composite key pins them to the tenant, so one artist can never be in two places even across tenants. A completed session keeps blocking the time it occupied; cancelled, no-show and deleted ones do not.
- Indexes: `(tenant_id, project_id)`; `(tenant_id, artist_id, starts_at)` (the artist foreign key's index and the calendar's); `(tenant_id, starts_at)` for an owner's studio-wide view.
- **Model** `ProjectSession` (`SESSION_KINDS`, `SESSION_STATUSES` const arrays, `withSoftDeletes`) extends the generated `ProjectSessionSchema`. Code never sets `active`; Lucid only writes assigned or dirty attributes, so the generated column is left alone.

## `SessionService`

`app/modules/scheduling/services/session_service.ts`, `@inject()`, like `ArtistService`: every call takes the tenant, every write runs in `withTransaction`, and an unknown, deleted or other-tenant id throws E_ROW_NOT_FOUND (a 404). Callers pass a project or session already loaded for the tenant; the service asserts the tenant matches.

| Operation | Rule |
|---|---|
| `schedule(tenant, project, { artistId, kind, startsAt, endsAt })` | Locks the project (below). A `declined` or `cancelled` project refuses (`project_closed`); every other status accepts, and TAT-46 can tighten that. The artist comes from `ArtistService.findFor`; if the project has none, it is set to this artist. Creates a `scheduled` session, then applies the moves below |
| `reschedule(tenant, session, { startsAt, endsAt })` | Time only (another artist is cancel plus schedule). Only a `scheduled` session |
| `complete`, `markNoShow`, `cancel` (`tenant, session`) | `scheduled` to `completed`, `no_show`, `cancelled`. Only a `scheduled` session can change; the other three statuses are final, so a mistake is a new session. This avoids re-running the overlap check on a reopen |
| `settleBooking(tenant, project)` | See below. Returns whether the project moved |
| `findFor(tenant, id)`, `listForProject(tenant, project)` | Reads. Range queries for the calendar are TAT-50's |

- Past times are allowed, so a walk-in can be recorded after the fact. The service checks `ends_at > starts_at` first and throws `SessionRuleError("invalid_range")`; the database check backs it up.
- **Errors** (`errors.ts`): `SessionOverlapError`, from SQLSTATE `23P01` on `project_sessions_artist_no_overlap`, recognized by a new `isExclusionViolation(error, constraint)` next to `isUniqueViolation` in `app/services/db_errors.ts`; and `SessionRuleError` with a reason (`project_closed`, `not_scheduled`, `invalid_range`). Both are thrown after the failed savepoint has rolled back, so the request stays usable. Messages are for developers; controllers (TAT-43, TAT-50) write their own.

## Project status moves

Only `tattoo` sessions move a project; a consultation or touch-up never does (a consultation in `reviewing` must not book the work).

| Event | Project change |
|---|---|
| `schedule` a tattoo session | `in_progress` to `booked` (the "next session" shortcut in the [project rules](../../requirements.md#project-rules)). `deposit_pending` to `booked` through `settleBooking` |
| `settleBooking` | `deposit_pending` to `booked` when a `scheduled` tattoo session exists and the deposit is settled. `schedule` calls it; TAT-65 calls it after verifying a deposit. Calling it again changes nothing |
| `complete` a tattoo session | `booked` to `in_progress`. From any other status, nothing |
| `reschedule`, `cancel`, `markNoShow` | Nothing. A project can sit in `booked` with no live session until TAT-46 decides what to do |

Moving to `completed` stays with TAT-46 and TAT-65: it needs a paid balance.

- **Deposit settled** (`DepositService.isSettled(tenant, project)`, `app/modules/payments/services/deposit_service.ts`, a read-only class TAT-65 extends): take the project's current quote, the highest `version`. Settled when its `deposit_amount` is 0, or when the sum of its verified `deposit` and `correction` payments reaches it. Corrections count so that a reversed verification un-settles the deposit. A project with no quote is not settled. The payments are summed in JavaScript (each amount is an int4 and a project has a handful of payments), so there is no int8 `sum()` string to parse.
- **Boundary shortcut.** There is no quote service yet, so `DepositService` reads the `Quote` model directly, which the [backend conventions](../../../apps/platform/docs/backend.md) discourage across modules. TAT-64 adds a quote service and removes the shortcut.
- **Locking.** Every operation that can change a project's status first runs `SELECT ... FOR UPDATE` on the project row, then re-reads the session row `FOR UPDATE`, always in that order, so a concurrent "schedule" and "verify deposit" serialize and exactly one makes the move. The overlap race between two sessions is settled by the exclusion constraint, not by this lock.

## Tests and docs

- **Table and constraint** (`tests/functional/scheduling/project_sessions_table.spec.ts`, raw SQL like `tattoo_projects_table.spec.ts`): an overlap is rejected with `23P01`; back-to-back sessions pass; cancelled, no-show and soft-deleted sessions do not block, a completed one does; two artists at one time pass; `ends_at > starts_at` is enforced; a cross-tenant project or artist link is rejected; `active` cannot be written; the enum checks; RLS isolation and `WITH CHECK`; the catalog guard entry.
- **Service** (`session_service.spec.ts`): every operation, including 404s for unknown and other-tenant ids; an overlap throws `SessionOverlapError` and the request stays usable; an empty project artist is filled; `declined` and `cancelled` projects refuse; final statuses stay final; each row of the move table; `settleBooking` twice is a no-op; deposit cases (zero, unverified, verified, reversed by a correction, no quote). The `Tenant.softDelete` cascade test in `tests/functional/models/soft_deletes.spec.ts` gains a session. No routes, so no endpoint isolation cases. Test rows come from `tests/helpers/pipeline.ts` (a `makeSession` helper joins it).
- **Not tested:** the project row lock, because the test harness shares one connection. It is a design claim, like the tenant-purge note in TAT-37.
- **Docs:** `docs/data-model.md` (the Session row: table name, `active`, half-open range); `apps/platform/docs/backend.md` (a Scheduling paragraph, and the soft-delete note in Clients, inquiries and projects); `apps/platform/database/README.md` (the `btree_gist` note). `database/schema.ts` regenerates with `pnpm migrate`; `node ace codegen` should change nothing.
- **Carry-forwards**, posted as Linear comments when the PR is ready: TAT-46 (the moves already live in `SessionService`; "booked with no live session" is its to flag; the project-delete cascade must include sessions), TAT-65 (call `settleBooking` after a deposit is verified; take over `DepositService`), TAT-43 (use `schedule`), TAT-50 and TAT-45 (query `where active`), TAT-64 (add a quote service).

## Not in this ticket

Routes, pages, the API, SDK and OpenAPI changes. The calendar (TAT-50), availability and slots (TAT-45), reminders (TAT-74), the project state machine and its soft-delete cascade (TAT-46), the quote service (TAT-64), the deposit page and proofs (TAT-65). Session notes, moving a session to another artist, and reopening a final session.

## Assumptions the user can overrule at review

Table name `project_sessions`; only tattoo sessions move the project; completed sessions keep blocking time; `completed`, `no_show` and `cancelled` are final; reschedule changes the time only; past times allowed; every project status except `declined` and `cancelled` accepts sessions; corrections count toward the deposit; `DepositService` reads `Quote` directly for now; no notes column; `ProjectSession` joins the tenant cascade but a project's does not.

## Verification

`pnpm migrate` on the dev database, and from zero on a scratch database (identical regenerated `database/schema.ts`); `pnpm migrate:rollback` then `pnpm migrate` clean. `PORT=3402 node ace test` passes, including the catalog guard and the new specs. `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. Then the whole-branch review and the Codex code and security reviews before the PR.
