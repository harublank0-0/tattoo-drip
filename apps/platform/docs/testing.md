# Testing and code generation

Read before changing tests or routes, pages and controllers whose generated types must be refreshed. Commands below run from `apps/platform`; the [root README](../../../README.md) covers local environment, PostgreSQL and Mailpit setup.

## Development and focused checks

- `pnpm dev` runs `node ace serve --hmr` on port 3333.
- `pnpm worker` runs `node ace queue:work` for queued jobs and mail; see [jobs and email](jobs-and-email.md) for restart and delivery rules.
- `pnpm typecheck` checks the server and `inertia/`.
- `pnpm test` runs `node ace test`; narrow to a suite and filename with `pnpm test functional --files=tenant_routes.spec.ts`, or use `node ace test unit --files=queue_config.spec.ts`. Suites are defined in `adonisrc.ts` (`unit`, `functional`, `browser`). `--files` is a suffix match on the file name: use the full name (`cross_tenant.spec.ts`) or the bare stem (`cross_tenant`). The half form `cross_tenant.spec` matches nothing. Do not insert `--` after the script name: pnpm forwards it verbatim and it ends Ace flag parsing. Wrap runs in `timeout -s KILL <seconds>`: a spec that fails to import hangs `node ace test` instead of failing.
- Run relevant tests for changed behavior, including tenant-isolation tests for tenant-owned endpoints. Preserve validation and security coverage; broader checks are justified for shared behavior or new failures.

## Environment and test conventions

Ace commands that boot the app validate its environment. Prepare the platform `.env` following the root setup guide; every test run needs a reachable PostgreSQL, and functional tests need it migrated (`pnpm migrate`). The `.env` must have the `DB_USER` / `DB_MIGRATION_USER` variables from `.env.example`, or pass them inline: the runner refuses to boot as a role that bypasses row-level security.

Functional tests run inside `testUtils.db().wrapInGlobalTransaction()` (Lucid 22's name; `withGlobalTransaction` is deprecated), so they leave no data behind. HTTP tests use `client` with `.loginAs(user)` and `.withCsrfToken()`. Check form errors with `assertValidationError(response, field)` from `#tests/helpers/validation`: Adonis 7 flashes them under `inputErrorsBag`, while the session plugin's `assertHasValidationError` reads `errors`.

Slugs are permanent (TAT-24): every slug a tenant has held stays in `tenant_slugs`, and only an owner-role `DELETE` releases it ([database conventions](../database/README.md#row-level-security)). Tests roll back, so they never reserve anything, but they share the dev database. If you try the "Web address" form in `pnpm dev` with a slug the fixtures use (`black-needle`, `red-ink`, `studio-a`, `ink-1` and so on), that slug stays reserved there and `studioWithOwner(...)` or `changeSlug(...)` with it fails with `SlugTakenError` (`tenant_slugs_slug_unique`). Pick other names in dev, and in new tests give slugs a prefix or suffix specific to the test. To release one, delete its row from `tenant_slugs` as the owner role.

Rate limits (TAT-8) use the memory store under test (`config/limiter.ts`). `tests/bootstrap.ts` empties it before every functional and browser test, so counts never carry over. Test requests come from loopback, which is trusted as a proxy, so `.header("x-forwarded-for", "203.0.113.1")` picks the client address. `rate_limit_store.spec.ts` covers the Postgres store outside a global transaction. The store keeps the client it was created with, so never call `limiter.use("database", …)` inside `wrapInGlobalTransaction`.

Storage written to `tmp/storage/` is cleared before and after test runs by `tests/bootstrap.ts`. Queue fake and direct execution conventions are in [jobs and email](jobs-and-email.md#jobs).

## Generated files and scaffolding

- `node ace codegen` after adding or renaming routes, pages or controllers regenerates `.adonisjs/` types (route names, pages, controllers) that `pnpm typecheck` reads. Keep the regenerated result with the change. This command refreshes types without starting the HTTP server.
- Scaffold with one concrete command, such as `node ace make:controller <name>`, `node ace make:model <name>`, `node ace make:migration <name>` or `node ace make:validator <name>`.
- `pnpm migrate` applies migrations (as the owner role) and regenerates `database/schema.ts`. Read [database conventions](../database/README.md) before writing migrations. Never edit generated files manually.

For broader CI requirements, consult the [workflow](../../../.github/workflows/ci.yml). Relevant design docs are [architecture](../../../docs/architecture.md), [data model](../../../docs/data-model.md) and [requirements](../../../docs/requirements.md); read only the part the task needs.

## Tenant isolation tests

Tests run as the restricted app role, so row-level security applies to them. A direct model read or write of tenant-owned rows needs a context: `inTenant(tenant, fn)`, `inUser(user, fn)` or `inTenantAs(tenant, user, fn)` from `#tests/helpers/tenants`. A negative check ("nothing was created") must run in the context that would have seen the row, or it passes vacuously.

- `twoStudios()` gives studios A and B, each with an owner, an artist (a user with the artist role), two payment methods, an artist profile (`artistProfile`) and one of each pipeline record (`pipeline`: client, accepted inquiry, project, reference image, quote and a submitted payment). Seed data for a new table goes there.
- Every `/t/:tenant` route needs an entry in `tests/isolation/cases.ts` (method, pattern, actor, valid body, own status, a snapshot of what it could change) or a reasoned exemption. `cross_tenant.spec.ts` runs each as studio A against studio B: a positive control first, then B's slug and, with an `:id`, B's resource id. Each attack must be a 404 with B unchanged. `tenant_routes.spec.ts` fails for a route without an entry. A write case's positive control must change studio A's snapshot, so an invalid body, a CSRF failure or a logged-out 302 cannot pass it.
- Public API routes (TAT-32) are not in `cases.ts`: there is no signed-in actor, and another studio's slug is simply another tenant. Each `/api/v1/tenants/:tenant` route needs an entry in `tests/isolation/public_cases.ts` (method, pattern, valid body, own status, `ownMarkers`, snapshot); `public_api.spec.ts` requests it under studio A's slug and fails if the answer mentions studio B (`publicMarkers`: ids, slug and names) or B changed. `api_routes.spec.ts` fails for a route without a case, for an API route without `publicApi` first or with web middleware, and for an API GET route without `publicCache()` or a written reason. Assert API responses with `assertApiData`, `assertApiError` and `assertNoCookies` from `#tests/helpers/api` (TAT-47's schema check goes there). Test-only API routes live under `/api/v1/__test` and `/api/v1/tenants/:tenant/__test`; the guards skip `__test` patterns.
- The limit of that table: with RLS on, a service query that forgot its tenant filter still gives a 404 here (RLS hides the row), so it proves the system as a whole. The app-level filters are covered by service specs that run from the OTHER tenant's context (`inTenant` / `inTenantAs`), e.g. `payment_method_service.spec.ts` "list and findFor only see the tenant's live methods".
- Tests that drive the queue use `processQueued()` from `#tests/helpers/worker` (the real worker). Jobs that touch tenant data extend `TenantJob`. Locally the tests share the dev database, where `pnpm dev` keeps its schedules, so `processQueued()` deletes `queue_schedules` rows inside the test's transaction before draining: a test runs only what it queued.
- A SECURITY DEFINER function such as `expired_quote_candidates()` sees every tenant's committed rows, the dev database's included (so does `tenant_for_slug()`: an 'unknown slug' test must use a slug no dev studio has): filter its output to the test's own tenants, and assert a sweep's queued jobs by payload, never by count. To run a sweep's jobs through the worker, run the sweep against `queue.fake()`, keep the payloads of your own tenants and dispatch only those: the worker would otherwise run a job for every committed candidate and stop after `MAX_CYCLES` (100), so the test would depend on the data in the dev database.
- Test-only routes live in `tests/support/test_routes.ts`; the functional suite registers them.
