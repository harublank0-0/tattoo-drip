# Row-level security and the cross-tenant isolation harness

Date: 2026-10-09
Refs: TAT-28 (blocks TAT-36, TAT-37), TAT-29. Both need TAT-25, which is done.

## Goal

PostgreSQL row-level security (RLS) becomes the second isolation layer, behind the app-level scoping that already exists. A forgotten `WHERE tenant_id`, a wrong id or a join that crosses tenants can no longer return another tenant's rows. TAT-29 is the proof: a harness that shows tenant A's member gets a 404 for tenant B's data, and a guard that stops a new table or endpoint from shipping without protection.

Success means all of these hold:

- With the app's own query code bypassed (raw SQL as the app role), tenant A's context sees only A's rows, and no context sees nothing.
- A new tenant-owned table or tenant route can't merge without RLS or an isolation test.
- Jobs touching tenant data run in their tenant's context.

## Threat model

The tenant settings (`app.tenant_id`, `app.user_id`) are set by trusted app code. RLS here defends against **app bugs**: missing scoping, wrong ids, unscoped joins. It does not defend against SQL injection, because injected SQL could change the settings. Injection is prevented by parameterized queries (Lucid) and review, not by this layer.

## Decisions made while designing

| Question | Decision | Why |
|---|---|---|
| Where the tenant transaction starts and ends | One transaction per authenticated request | Service signatures don't change. A request is atomic. Costs one held connection per request. |
| The `users` table | Stays outside RLS | Login, the session guard and signup read it before any context exists. A separate "auth" connection can't work: tests use one global transaction per connection, so foreign-key checks across connections break. Hardening is a follow-up. |
| Slug uniqueness check | Drop the Vine `.unique` rule on `tenants.slug` and rely on the unique index | The rule runs a raw query with no context and would silently never find a conflict. |
| Tests | Run as the app role everywhere | A missing context must fail in tests the way it fails in production. |

## Roles and connections

| Role | Used for | Attributes |
|---|---|---|
| Owner (`postgres` in dev and CI) | Owns the tables and runs migrations | Owner or superuser |
| App (`tattoo_drip_app`) | The web server, the worker and the tests | `LOGIN NOSUPERUSER NOBYPASSRLS`, DML grants only |

- `DB_USER` / `DB_PASSWORD` are the **app** role and feed the default `pg` connection.
- New `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` feed a second Lucid connection, `owner`. Migrations run with `--connection=owner` (a `migrate` script in the platform package wraps it). Making the app role the default means forgetting the flag fails with a permission error. Making the owner the default would silently bypass RLS.
- One idempotent SQL script (`apps/platform/database/setup_roles.sql`) creates the app role. The compose init directory, the CI workflow and a one-time manual step for existing dev databases all run it. Role creation stays out of migrations because it is infrastructure and needs privileges a production owner role may not have.
- The grants migration gives the app role `USAGE` on the schema and `SELECT, INSERT, UPDATE, DELETE` on all tables and sequences. It also sets `ALTER DEFAULT PRIVILEGES` for the owner, so future tables are covered. The role name comes from `DB_USER`.
- All tenant-owned tables get `FORCE ROW LEVEL SECURITY`. That covers a non-superuser owner connecting to the same database.
- **Boot guard.** The web server and the worker check `pg_roles` for the connected role on startup and refuse to start if it is a superuser or has `BYPASSRLS`. A test runs the same check, so the suite itself proves it runs as the restricted role.

## Request context

New module `app/services/db_context.ts` (`#services/db_context`):

- `withDbContext({ userId?, tenantId? }, fn)` runs `fn` with those settings in the ambient transaction. It saves the previous values and restores them in `finally`, so nothing leaks, including inside the tests' global transaction.
- An `AsyncLocalStorage` holds `{ trx, userId?, tenantId? }`.
- `withTransaction(fn)` opens a **savepoint** when an ambient transaction exists, else a normal transaction. The five existing `db.transaction` call sites move to it (`TenancyService.createTenant`, three in `PaymentMethodService`, `Tenant.softDelete`). A failed statement, such as a unique violation, aborts only the savepoint, so the request can still re-render a form with errors.
- `dbClient()` returns the ambient transaction, or `db` outside a request. Raw queries that need context use it.
- A small provider installs an adapter on `BaseModel.$adapter` that overrides `modelClient` and `modelConstructorClient` to return the ambient transaction when one exists. Every model query, preload, `whereHas` and relation then runs inside the request transaction. An explicit `{ client }` still wins.
- Settings are written with `select set_config('app.tenant_id', $1, true)`: the same as `SET LOCAL`, but it accepts bind parameters. The `true` makes it transaction-local.

### Middleware

- New `dbContext` named middleware, used right after `auth` on every authenticated group (`/dashboard`, `/onboarding`, `/t/:tenant`). It opens the transaction and sets `app.user_id` from the session user. It commits when the response succeeds and rolls back when anything throws. Public routes (login, signup) get no transaction, since they only touch `users`.
- The tenant middleware runs inside that transaction. It resolves the membership under user context, so a stranger still gets the same 404, then sets `app.tenant_id` and continues. It throws if `dbContext` did not run, like `tenantContext(ctx)` does outside the group.
- `createTenant` generates the new id with `select uuidv7()`, sets it as the context for the insert and restores the previous context after.
- The existing "every tenant route has the tenant middleware" test also asserts `dbContext` is present.

## Policies

Two `STABLE` SQL functions, `app_tenant_id()` and `app_user_id()`, return `nullif(current_setting('app.…', true), '')::uuid`. Unset or empty gives `NULL`, so every comparison fails and no rows return (fail closed). Policies call them as `(select app_tenant_id())`, which Postgres evaluates once per statement, not per row. All policies are `TO` the app role.

| Table | Command | Rule |
|---|---|---|
| Tenant-owned tables (`payment_methods`, all future ones) | all | `tenant_id = (select app_tenant_id())`, same expression as the write check |
| `tenant_memberships` | select | `tenant_id = app_tenant_id() or user_id = app_user_id()` |
| `tenant_memberships` | insert, update, delete | `tenant_id = app_tenant_id()` |
| `tenants` | select | `id = app_tenant_id()` or `id in (select tenant_id from tenant_memberships where user_id = app_user_id())` |
| `tenants` | insert, update | `id = app_tenant_id()` |
| `tenants` | delete | no policy (deletes are soft updates) |

The `tenants` subquery goes through the membership policy, which does not read `tenants`, so there is no recursion. Soft-delete filtering stays in app code.

## Migration helpers

In a shared migrations helper module (location chosen in the plan):

- `enableTenantRls(table)` runs `ENABLE` and `FORCE ROW LEVEL SECURITY`, creates the standard `tenant_isolation` policy and adds `UNIQUE (tenant_id, id)`.
- `tenantReference(table, column, parent)` builds a composite foreign key `(tenant_id, column) → parent(tenant_id, id)`.

No foreign key between tenant-owned tables exists yet, because `payment_methods` only points at `tenants`. So this work delivers the helpers, applies `enableTenantRls` to `payment_methods`, adds the unique key and bespoke policies to `tenant_memberships`, and adds the bespoke policies to `tenants`. TAT-36 and TAT-37 are the first users of `tenantReference`.

## Jobs

`executionWrapper` in `config/queue.ts` reads `tenantId` from the job payload (the TAT-7 convention) and runs the job through `withTransaction` and `withDbContext({ tenantId })`. It commits on success and rolls back on failure.

- Jobs without a `tenantId` (`SendMailJob`) run with no context and fail closed.
- A `tenantId` that is present but malformed fails the job. It never runs unscoped.
- `queue_jobs` is not tenant-owned and gets plain grants.

## TAT-29: isolation harness

Under `apps/platform/tests/`:

1. **`withDbContext` in factories.** The existing `studioWithOwner` and `artistIn` helpers move to it. Specs that create tenants, memberships or payment methods directly (`auth/access`, `models/soft_deletes`, the three payments specs and the four tenancy specs) switch to the factories or wrap their setup in a context. This is a one-time sweep of nine files.
2. **`twoStudios()`** builds tenants A and B, each with an owner, an artist and one payment method. Later tickets add seed functions for their own tables.
3. **Declarative case table** (`tests/isolation/cases.ts`): each entry is a method, a route pattern, the seeded resource its `:id` refers to, and a body for writes.
4. **`assertCrossTenantIsolation()`** runs every case as A's member with two attacks: B's slug in the URL, and A's slug with B's resource id (only the first for routes without an `:id`). It asserts a 404, and for update and delete it asserts that B's row is unchanged when read back in B's context.
5. **Route-coverage guard.** A unit test lists every `/t/:tenant` route and fails unless a case covers it or it appears in the exemptions with a written reason (pages that touch no tenant-owned data). The same table drives both the spec and the guard, so they can't drift.
6. **PR template** (`.github/pull_request_template.md`) with a checkbox: every new or changed tenant-owned endpoint has an isolation case.

### RLS-layer tests (raw queries, no app code)

- Under context A, a plain `select` on each tenant-owned table returns only A's rows.
- With no context, the same select returns zero rows while other tenants have data.
- An insert with B's `tenant_id` under context A fails the policy check.
- Update and delete on B's rows under context A affect zero rows.
- The memberships and tenants policies: listing my tenants works under user context, resolving a slug works, and a stranger's slug returns nothing.
- Settings don't leak: after `withDbContext` returns, the previous values are back.
- The connected role is not a superuser and has no `BYPASSRLS`.

### Catalog guard

One test queries the catalog:

- Every table in `public` is either RLS-forced with at least one policy, or on a named exemption list with a reason (`users`, the queue tables and the migration bookkeeping tables).
- Every table with a `tenant_id` column has `UNIQUE (tenant_id, id)`.
- Every foreign key between two tenant-owned tables includes `tenant_id`.

A new table that forgets the helper fails CI, and adding to the exemption list is a conscious edit.

### Job tests

- A job with a `tenantId` sees its tenant's rows. One without sees none.
- A throw rolls back its writes.
- Context does not leak into the next job.
- A malformed `tenantId` fails the job.

## Changes outside the new code

- `createTenantValidator`: remove `.unique({ table: "tenants", column: "slug" })` and the `slug.database.unique` message. `SlugTakenError` in `OnboardingController` uses one message: "This address is already taken. Try another one." The existing unique-index catch is now the only check.
- `config/database.ts`: add the `owner` connection. `start/env.ts` and `.env.example`: add `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`.
- `docker-compose.yml`: mount the role script. `.github/workflows/ci.yml`: create the role, migrate as the owner, test as the app role.
- Docs: `architecture.md` (RLS is no longer planned), `database/README.md` (roles, helper, the guard), `backend.md` (context, `withTransaction`, `dbClient()`, why raw `db` queries and Vine's `unique` and `exists` rules see nothing in a request), `testing.md` (harness), `jobs-and-email.md` (replace "TAT-28 runs them in tenant context"), the root README (env vars and the one-time role setup for an existing dev database) and the platform `AGENTS.md` constraint line.

## Open risks, checked first in the plan

Each of these changes the design if it fails. The fallback is in brackets.

1. The Lucid adapter hook covers `preload`, `whereHas` and relation queries. [Fall back to a base-model `query()` override.]
2. `AsyncLocalStorage` survives the Adonis middleware chain and the Inertia render, including lazily resolved props, before the transaction commits. [Resolve props inside the controller, or bind the transaction to the HTTP context.]
3. `@adonisjs/queue` 0.6.2 honors `executionWrapper` for worker-run jobs. [Wrap in a base job class `execute`.]
4. Nested savepoints inside the test global transaction restore the settings cleanly. [Reset explicitly with `set_config(…, '', true)` in `finally`.]

## Known costs and not in scope

- A request holds one database connection for its whole length, including image processing in uploads. If pool pressure shows, move image work ahead of the transaction.
- PgBouncer in transaction mode is compatible, since the settings are transaction-local.
- `users` RLS (follow-up), looking up a tenant by slug for the unauthenticated public API (the first `/api/v1` ticket), reserved slugs (TAT-24), setting context when an invitation is accepted (the invites ticket), and the REST variant of the isolation helper.
- Production role provisioning is manual: the managed database's admin runs the same script.
