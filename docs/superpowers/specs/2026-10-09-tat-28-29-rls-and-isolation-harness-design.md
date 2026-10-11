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
| `FORCE ROW LEVEL SECURITY` | No: `ENABLE` only, plus an ownership guard | With `FORCE`, a backfill run by a non-superuser owner updates zero rows, silently, in production only. The guard checks the real invariant: the app role never gets owner powers. |
| How a failed request rolls back | The exception handler signals it, not `next()` | Adonis turns a controller's exception into a response before the upstream middleware resumes, so `await next()` never rejects. A middleware that waited for a throw would commit failed requests. |
| How a failed job rolls back | A `TenantJob` base class wraps `execute()`; no `executionWrapper` | The worker catches the job's error inside the callback a wrapper receives, so a wrapper can't see the failure, and the worker acknowledges the job before a wrapper could commit. |
| Side effects outside the database | `afterCommit` / `afterRollback` in `db_context` | Inside a request, a service's own transaction is only a savepoint. Its release is not a commit, so a file deleted right after it returns can outlive a rollback. |

## Roles and connections

| Role | Used for | Attributes |
|---|---|---|
| Owner (`postgres` in dev and CI) | Owns the tables and runs migrations | Owner or superuser |
| App (`tattoo_drip_app`) | The web server, the worker and the tests | `LOGIN NOSUPERUSER NOBYPASSRLS`, DML grants only |

- `DB_USER` / `DB_PASSWORD` are the **app** role and feed the default `pg` connection.
- New `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` feed a second Lucid connection, `owner`, with the same `migrations` and `schemaGeneration` settings as `pg`, so `database/schema.ts` and the CI schema check stay unchanged. Migrations run with `--connection=owner` (a `migrate` script in the platform package wraps it). Making the app role the default means forgetting the flag fails with a permission error. Making the owner the default would silently bypass RLS.
- `.env.example` defaults become `DB_USER=tattoo_drip_app` and `DB_MIGRATION_USER=postgres`.
- `apps/platform/database/setup_roles.sql` runs once per database, by an admin. It creates the app role if missing and grants it `USAGE` on the schema and `SELECT, INSERT, UPDATE, DELETE` on all existing tables. It also sets `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>`, so tables the owner creates later are granted too. The two role names are psql variables. The compose init directory, the CI workflow and a one-time manual step for existing dev databases all run it. Role creation and grants stay out of migrations because they are infrastructure and need privileges a production owner role may not have. Migrations stay free of role names and env reads.
- `docker-compose.yml` bootstraps the cluster with the **owner** credentials. `POSTGRES_USER`, `POSTGRES_PASSWORD` and the healthcheck read `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD` (default `postgres`). With today's mapping to `DB_USER`, the new `DB_USER=tattoo_drip_app` default would make the app role the cluster superuser on a fresh volume, so the boot guard refuses to start, and no `postgres` role would exist. An initdb script runs `setup_roles.sql` against `POSTGRES_DB`, with the app credentials (`DB_USER`, `DB_PASSWORD`) passed in. An existing volume keeps its roles and gets the one-time manual step. Checked on an empty volume under a throwaway compose project (`-p`) and port, never by wiping the dev volume.
- `setup_roles.sql` always runs `ALTER ROLE <app> LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` with the given password, so a role that already existed with more privileges is normalized. It stops with an error if the app role name equals the owner's, because that `ALTER` would strip the bootstrap superuser.
- Tables get `ENABLE ROW LEVEL SECURITY`, not `FORCE`. The owner keeps bypassing RLS, so data migrations behave the same in dev (owner is a superuser) and on a managed Postgres (owner usually is not).
- **Boot guard.** The web server, the worker and the test runner refuse to start unless the connected role is not a superuser, has no `BYPASSRLS`, owns no table in `public`, and is not a member of a role that does. Membership inherits ownership, and owners bypass RLS. Other ace commands (codegen, build, migrations) skip the check. A test runs the same check, so the suite itself proves it runs as the restricted role.

## Request context

New module `app/services/db_context.ts` (`#services/db_context`):

- `withDbContext({ userId?, tenantId? }, fn)` opens its own transaction, or a savepoint inside the ambient one, sets the settings there and runs `fn`. If `fn` throws, the savepoint rolls back and Postgres reverts the settings itself. Nothing runs inside the aborted transaction, so the original error surfaces. If `fn` succeeds, the savepoint is released and the previous values are set again, so nothing leaks into the rest of the transaction, including the tests' global transaction. Values not passed are inherited from the outer context.
- An `AsyncLocalStorage` holds `{ trx, userId?, tenantId? }`.
- `withTransaction(fn)` opens a **savepoint** when an ambient transaction exists, else a normal transaction. The five existing `db.transaction` call sites move to it (`TenancyService.createTenant`, three in `PaymentMethodService`, `Tenant.softDelete`). A failed statement, such as a unique violation, aborts only the savepoint, so the request can still re-render a form with errors.
- `afterCommit(fn)` and `afterRollback(fn)` register work outside the database, such as deleting files and, later, emails and HTTP calls. The work attaches to the innermost `withDbContext` or `withTransaction` level. When a savepoint is released, its callbacks move to the parent. When a savepoint rolls back, its `afterCommit` callbacks are dropped and its `afterRollback` callbacks run at once. The outermost wrapper in our `AsyncLocalStorage` store runs whatever remains after it commits or rolls back. That wrapper is the `dbContext` middleware, a `TenantJob`, or a `withTransaction` with no store around it. "Outermost" means our store, not the database: in tests the request transaction is a savepoint inside the global test transaction, and its callbacks still fire. A callback's error is logged and does not change the outcome, since the transaction has already settled. Calling either function outside a wrapper throws.
- `dbClient()` returns the ambient transaction, or `db` outside a request. Raw queries that need context use it.
- `abortRequestTransaction()` rolls back the request transaction and detaches it from the `AsyncLocalStorage` store, so later code in the same request runs with no ambient transaction. It does nothing outside a request. The exception handler calls it; see *Middleware*.
- A small provider installs an adapter on `BaseModel.$adapter` that overrides `modelConstructorClient`. When an ambient transaction exists on the same connection, it is returned in place of any plain (non-transaction) client. Instances loaded outside a context (`auth.user` is one) store the plain pool client in `$options.client`, so honoring plain clients would let them bypass the request transaction. An explicit transaction client still wins, and models on another connection (`owner`) are untouched. `modelClient` already prefers `$trx`, which Lucid sets for instances loaded inside a transaction and clears when it commits.
- Settings are written with `select set_config('app.tenant_id', $1, true)`: the same as `SET LOCAL`, but it accepts bind parameters. The `true` makes it transaction-local.

### Middleware

- New `dbContext` named middleware, used right after `auth` on every authenticated group (`/dashboard`, `/onboarding`, `/t/:tenant`). It opens a transaction, keeps it in the store with `app.user_id` set from the session user, and runs `next()`. Then it commits, unless `abortRequestTransaction()` already rolled the transaction back. After the commit it runs the `afterCommit` callbacks. `abortRequestTransaction()` runs the `afterRollback` callbacks after it rolls back. It does not wait for `next()` to throw. Adonis's route middleware runner handles a downstream exception (the controller's, a validation error, a 404) before the upstream `await next()` resumes (`@poppinss/middleware` 3.2.7, `invokeWithErrorManagement`), so `next()` resolves even when the request failed. An error the middleware itself throws still rolls back. Public routes (login, signup) get no transaction, since they only touch `users`.
- The tenant middleware runs inside that transaction. It resolves the membership under user context, so a stranger still gets the same 404, then sets `app.tenant_id` and continues. It throws if `dbContext` did not run, like `tenantContext(ctx)` does outside the group.
- `createTenant` generates the new id with `select uuidv7()` and runs the inserts inside `withDbContext({ tenantId })`.
- **Exception handler.** `HttpExceptionHandler.handle()` calls `abortRequestTransaction()` before it renders anything. Any exception, including a validation redirect or a 404, rolls the request back, so earlier writes never commit after a failure. The page then renders with no ambient transaction, which also avoids queries running inside an aborted transaction after an uncaught SQL error. Because of that, `InertiaMiddleware.share()` wraps its `tenantsFor` read in its own `withDbContext({ userId, tenantId })` when no ambient context exists, so an error page inside a tenant still shows the switcher.
- The existing "every tenant route has the tenant middleware" test also asserts `dbContext` is present.
- Tests drive the real HTTP pipeline: a request that writes and then throws an application error, and one that writes and then hits an uncaught SQL error, must both leave nothing behind and still render the error page. A successful request commits. A request that registers both callbacks fires `afterCommit` on success and `afterRollback` on failure.

## Policies

Two `STABLE` SQL functions, `app_tenant_id()` and `app_user_id()`, return `nullif(current_setting('app.…', true), '')::uuid`. Unset or empty gives `NULL`, so every comparison fails and no rows return (fail closed). Policies call them as `(select app_tenant_id())`, which Postgres evaluates once per statement, not per row. Policies use the default `TO PUBLIC`. The owner bypasses them as owner, and superusers always do.

| Table | Command | Rule |
|---|---|---|
| Tenant-owned tables (`payment_methods`, all future ones) | all | `tenant_id = (select app_tenant_id())`, with an explicit `WITH CHECK` of the same expression |
| `tenant_memberships` | select | `tenant_id = app_tenant_id() or user_id = app_user_id()` |
| `tenant_memberships` | insert, update, delete | `tenant_id = app_tenant_id()` |
| `tenants` | select | `id = app_tenant_id()` or `id in (select tenant_id from tenant_memberships where user_id = app_user_id() and deleted_at is null)` |
| `tenants` | insert, update | `id = app_tenant_id()` |
| `tenants` | delete | no policy (deletes are soft updates) |

Update policies state both `USING` and `WITH CHECK` with the same expression, and insert policies state `WITH CHECK`, so the catalog guard can require an explicit write check on every write policy.

The `tenants` subquery goes through the membership policy, which does not read `tenants`, so there is no recursion. It skips removed memberships, so a removed member loses the database-level view of the studio too. Other soft-delete filtering stays in app code.

RLS does not decide who may create a tenant: any signed-in user can, by setting the new id as context. Onboarding's app-level check stays the gate.

## Migration helpers

In a shared migrations helper module (location chosen in the plan):

- `enableTenantRls(table)` runs `ENABLE ROW LEVEL SECURITY`, creates the standard `tenant_isolation` policy, with `USING` and an explicit `WITH CHECK` of the same expression, and adds `UNIQUE (tenant_id, id)`.
- `tenantReference(table, column, parent)` builds a composite foreign key `(tenant_id, column) → parent(tenant_id, id)`.

No foreign key between tenant-owned tables exists yet, because `payment_methods` only points at `tenants`. So this work delivers the helpers, applies `enableTenantRls` to `payment_methods`, adds the unique key and bespoke policies to `tenant_memberships`, and adds the bespoke policies to `tenants`. TAT-36 and TAT-37 are the first users of `tenantReference`.

## Jobs

`executionWrapper` is not used. The worker's callback catches a job's error and handles retry or failure inside itself, then resolves normally, and it acknowledges the job before any wrapper could commit (`@boringnode/queue` 0.6.0, the `run` closure in `build/index.js`). A wrapper would commit failed attempts, repeat their writes on retry, and acknowledge a job whose commit later fails.

Instead, `app/jobs/tenant_job.ts` (`#jobs/tenant_job`) defines `TenantJob`, a base class whose `execute()` reads `tenantId` from the payload (the TAT-7 convention) and runs the subclass's `handle()` inside `withDbContext({ tenantId })`. It returns only after the transaction has committed or rolled back. A throw rolls back and propagates to the worker, which then retries or fails the job outside the transaction. The worker acknowledges only after the commit.

- Jobs that touch tenant data extend `TenantJob`. A job with no `tenantId`, like `SendMailJob`, extends the plain `Job`, runs with no transaction (an SMTP call never holds a connection) and sees nothing from any tenant table.
- A `TenantJob` whose payload has a missing or malformed `tenantId` fails. It never runs unscoped.
- A guard test lists every job class under `app/jobs` and `app/modules/*/jobs`. Each must extend `TenantJob` or be on a named allowlist with a reason (`SendMailJob`).
- `queue_jobs` is not tenant-owned and gets plain grants.
- The TAT-28 ticket text says "through the queue `executionWrapper` in `config/queue.ts`". Update the ticket to match.

## TAT-29: isolation harness

Under `apps/platform/tests/`:

1. **`withDbContext` in factories.** The existing `studioWithOwner` and `artistIn` helpers move to it. Specs that create tenants, memberships or payment methods directly (`auth/access`, `models/soft_deletes`, the three payments specs and the four tenancy specs) switch to the factories or wrap their setup in a context. This is a one-time sweep of nine files.
2. **`twoStudios()`** builds tenants A and B, each with an owner, an artist and one payment method. Later tickets add seed functions for their own tables.
3. **Declarative case table** (`tests/isolation/cases.ts`). Each entry has:
   - a method and a route pattern;
   - the actor's role (`owner` for every settings route, since artists get the `role` middleware's 404);
   - the seeded resource its `:id` refers to;
   - a valid body for writes;
   - the status the actor gets on its own tenant;
   - a snapshot function that reads the B-side state the route could change.
4. **`assertCrossTenantIsolation()`** runs each case in two steps.
   - First a positive control: A's actor sends the same request with the same body against A's own tenant and resource, and gets the case's status. Without it, a wrong role or an invalid body would fail for reasons other than tenancy, and the attacks would pass vacuously.
   - Then the two attacks, as the same actor: B's slug in the URL, and A's slug with B's resource id (only the first for routes without an `:id`). Each must return a 404, and B's snapshot must be equal before and after. That means the row for updates and deletes, the list for creates, and the tenant's columns for the profile and deposit forms.
5. **Route-coverage guard.** A functional test, next to the two route-group tests in `tests/functional/tenancy/tenant_routes.spec.ts`. Like them, it lists routes with `router.toJSON()`, which is empty until the HTTP server starts, and only the functional, browser and e2e suites start it (`tests/bootstrap.ts:66`). As a unit test it would see no routes and pass. It asserts the tenant-route list is not empty. It then fails unless a case covers each `/t/:tenant` route or the route appears in the exemptions with a written reason, such as the dashboard page and the settings redirect, which touch no tenant-owned data. The same table drives both the spec and the guard, so they can't drift.
6. **PR template** (`.github/pull_request_template.md`) with a checkbox: every new or changed tenant-owned endpoint has an isolation case.

### RLS-layer tests (raw queries, no app code)

- Under context A, a plain `select` on each tenant-owned table returns only A's rows.
- With no context, the same select returns zero rows while other tenants have data.
- An insert with B's `tenant_id` under context A fails the policy check.
- Update and delete on B's rows under context A affect zero rows.
- An unqualified raw `UPDATE payment_methods SET tenant_id = <B>` under context A fails the write check, and A's rows keep their `tenant_id`. The same holds for `tenant_memberships.tenant_id` and for `tenants.id`. A policy with a correct `USING` but a permissive write check would pass every other test here.
- The memberships and tenants policies: listing my tenants works under user context, resolving a slug works, a stranger's slug returns nothing, and a removed member no longer sees the tenant.
- Settings don't leak: after `withDbContext` returns, the previous values are back, and after it throws, the original error surfaces.
- The connected role passes the boot guard: not a superuser, no `BYPASSRLS`, owns no table and is not a member of a role that does.

### Catalog guard

One test queries the catalog:

- Every table in `public` either has RLS enabled with at least one policy, or is on a named exemption list with a reason (`users`, the queue tables and the migration bookkeeping tables).
- Every table with a `tenant_id` column has `UNIQUE (tenant_id, id)`.
- Every foreign key between two tenant-owned tables includes `tenant_id`.
- Each table with RLS has exactly the expected policies, by name and command: `tenant_isolation` for all commands on helper tables, and the sets in *Policies* for `tenants` and `tenant_memberships`.
- No policy's `USING` or write check is the literal `true`. Every policy for all, insert or update commands has an explicit write check.

A new table that forgets the helper fails CI, and adding to the exemption list is a conscious edit.

### Job tests

These run through the real worker, not by calling `execute()` directly:

- A `TenantJob` with a `tenantId` sees its tenant's rows. A plain job without one sees none and runs without a transaction.
- A job that writes and then throws leaves no rows after each attempt, and the retry does not see the earlier writes.
- The job is acknowledged only after its writes are committed.
- Context does not leak into the next job.
- A missing or malformed `tenantId` fails a `TenantJob`.
- The job-class guard fails for a new job class that is neither a `TenantJob` nor allowlisted.

## Changes outside the new code

- `createTenantValidator`: remove `.unique({ table: "tenants", column: "slug" })` and the `slug.database.unique` message. `SlugTakenError` in `OnboardingController` uses one message: "This address is already taken. Try another one." The existing unique-index catch is now the only check.
- `app/exceptions/handler.ts`: call `abortRequestTransaction()` first in `handle()`. New `app/jobs/tenant_job.ts` with `TenantJob`.
- `PaymentMethodService.create` and `update`: a newly stored QR file is removed by `afterRollback`. It is registered first thing inside the `withTransaction` callback and replaces the `catch` that deletes it today. `update` removes the replaced file with `afterCommit`, replacing the delete after the transaction returns (`payment_method_service.ts:180`). Test: inside one wrapper, `update` replaces a QR and then the wrapper throws. The row keeps the old key, the old file still exists and the new file is gone. When the wrapper commits instead, the old file still exists right after `update` returns and is gone after the commit. The image rule in `backend.md` changes to match: side effects outside the database go in `afterCommit` / `afterRollback`, never right after `withTransaction` returns.
- `config/database.ts`: add the `owner` connection. `start/env.ts` and `.env.example`: add `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`, with the new defaults above.
- `docker-compose.yml`: owner credentials for bootstrap and the healthcheck, plus the initdb script and the role script mounted (see *Roles and connections*). `.github/workflows/ci.yml`: run `setup_roles.sql` before migrating, migrate with `pnpm migrate`, test as the app role.
- Docs: `architecture.md` (RLS is no longer planned), `database/README.md` (roles, helper, the guard), `backend.md` (context, `withTransaction`, `dbClient()`, why raw `db` queries and Vine's `unique` and `exists` rules see nothing in a request), `testing.md` (harness, and `pnpm migrate` in place of `node ace migration:run`), `jobs-and-email.md` (replace "TAT-28 runs them in tenant context" with the `TenantJob` rule), the root README (env vars and the one-time role setup for an existing dev database), the root `AGENTS.md` generated-files section (`pnpm migrate`) and the platform `AGENTS.md` constraint line.

## Open risks, checked first in the plan

Each unverified item changes the design if it fails. The fallback is in brackets.

1. Relations and preloads from an instance loaded inside a context reuse its `$trx`, and the adapter rule covers instances loaded outside one. Checked first with a test. [Fall back to a base-model `query()` override.]
2. Verified: `inertia.render` resolves props, including `share()`, before the controller returns (`@adonisjs/inertia` 5.0.1), so normal renders run inside the transaction. Error pages are the exception: they render after `abortRequestTransaction()` has detached it, which the exception-handler bullet handles.
3. Verified: the worker's callback swallows job errors, so job transactions live inside `execute()` (`TenantJob`), not in `executionWrapper`. A worker-run test pins the behavior: an attempt that throws leaves no writes.
4. Verified: inside the tests' global transaction, `db.connection()` returns the global transaction, so `db.transaction()` becomes a savepoint and the request flow nests correctly. The leak test checks the settings behavior.
5. Verified: with an error handler registered, `next()` resolves after a downstream exception, so rollback is signaled by the exception handler. To confirm with a real-request test: the `AsyncLocalStorage` store is still present when the exception handler runs (its `.catch` is attached inside the middleware's `next()` call). [If the store is missing there, also keep the transaction on `ctx` and have the handler read it from `ctx`.]

## Known costs and not in scope

- A request holds one database connection for its whole length, including image processing in uploads. If pool pressure shows, move image work ahead of the transaction.
- PgBouncer in transaction mode is compatible, since the settings are transaction-local.
- `users` RLS (follow-up), looking up a tenant by slug for the unauthenticated public API (the first `/api/v1` ticket), reserved slugs (TAT-24), setting context when an invitation is accepted (the invites ticket), and the REST variant of the isolation helper.
- Production role provisioning is manual: the managed database's admin runs the same script.
