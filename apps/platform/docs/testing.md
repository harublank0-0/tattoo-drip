# Testing and code generation

Read before changing tests or routes, pages and controllers whose generated types must be refreshed. Commands below run from `apps/platform`; the [root README](../../../README.md) covers local environment, PostgreSQL and Mailpit setup.

## Development and focused checks

- `pnpm dev` runs `node ace serve --hmr` on port 3333.
- `pnpm worker` runs `node ace queue:work` for queued jobs and mail; see [jobs and email](jobs-and-email.md) for restart and delivery rules.
- `pnpm typecheck` checks the server and `inertia/`.
- `pnpm test` runs `node ace test`; narrow to a suite and filename with `pnpm test functional --files=tenant_routes.spec.ts`, or use `node ace test unit --files=queue_config.spec.ts`. Suites are defined in `adonisrc.ts` (`unit`, `functional`, `browser`). Do not insert `--` after the script name: pnpm forwards it verbatim and it ends Ace flag parsing.
- Run relevant tests for changed behavior, including tenant-isolation tests for tenant-owned endpoints. Preserve validation and security coverage; broader checks are justified for shared behavior or new failures.

## Environment and test conventions

Ace commands that boot the app validate its environment. Prepare the platform `.env` following the root setup guide; functional tests need local PostgreSQL running and migrated (`node ace migration:run`).

Functional tests run inside `testUtils.db().wrapInGlobalTransaction()` (Lucid 22's name; `withGlobalTransaction` is deprecated), so they leave no data behind. HTTP tests use `client` with `.loginAs(user)` and `.withCsrfToken()`. Check form errors with `assertValidationError(response, field)` from `#tests/helpers/validation`: Adonis 7 flashes them under `inputErrorsBag`, while the session plugin's `assertHasValidationError` reads `errors`.

Storage written to `tmp/storage/` is cleared before and after test runs by `tests/bootstrap.ts`. Queue fake and direct execution conventions are in [jobs and email](jobs-and-email.md#jobs).

## Generated files and scaffolding

- `node ace codegen` after adding or renaming routes, pages or controllers regenerates `.adonisjs/` types (route names, pages, controllers) that `pnpm typecheck` reads. Keep the regenerated result with the change. This command refreshes types without starting the HTTP server.
- Scaffold with one concrete command, such as `node ace make:controller <name>`, `node ace make:model <name>`, `node ace make:migration <name>` or `node ace make:validator <name>`.
- `node ace migration:run` applies migrations and regenerates `database/schema.ts`. Read [database conventions](../database/README.md) before writing migrations. Never edit generated files manually.

For broader CI requirements, consult the [workflow](../../../.github/workflows/ci.yml). Relevant design docs are [architecture](../../../docs/architecture.md), [data model](../../../docs/data-model.md) and [requirements](../../../docs/requirements.md); read only the part the task needs.
