# Platform

AdonisJS 7 owns all data, business rules and REST API; the dashboard uses Inertia + React. Lucid/PostgreSQL, VineJS, session auth, Tuyau and Japa.

Map: `app/modules/<module>/` owns domain code; `app/controllers` and `app/transformers` remain flat until `adonisrc.ts` indexing supports module folders. Routes/middleware: `start/`; settings: `config/`; migrations: `database/`; dashboard: `inertia/`; tests: `tests/{unit,functional,browser}`. Use server subpath aliases from `package.json` (`#modules/*`, `#models/*`, etc.) and frontend `~/`.

## Read before changing the matching area

- Backend, services, tenancy, soft deletes, media or payments: [backend conventions](docs/backend.md); before schema/migration edits also read [database conventions](database/README.md).
- Dashboard components, forms or theme: [UI conventions](docs/ui.md).
- Queues, workers or mail: [jobs and email](docs/jobs-and-email.md).
- Tests, routes/pages/controllers or generated types: [testing and code generation](docs/testing.md).
- Cross-project design or product rules: choose the relevant document from the [documentation index](../../docs/README.md).

## Essential constraints

- Modules own their models/services. Other modules call services; controllers and jobs stay thin.
- Tenant identity comes from the URL (`/t/:tenant/…`, `/api/v1/tenants/:slug/…`), never body/query/headers. Scope every query by tenant; every tenant endpoint needs a cross-tenant isolation test. Tenant routes require auth + tenant middleware; settings also require owner checks.
- `@inject()` dependencies must be value imports: runtime decorator metadata needs the class. Preserve the `useImportType` suppression described in backend guidance.
- Change `packages/types/openapi.yaml` before REST implementation and regenerate types. Never edit `database/schema.ts` or `.adonisjs/`; add new migrations instead of changing any that ran. Run `node ace codegen` after route/page/controller changes, then typecheck; keep regenerated files with the change.

## Commands (from apps/platform)

`pnpm dev` (3333), `pnpm worker` (queued jobs/mail; restart after job edits), `pnpm typecheck`, `pnpm test functional --files=<filename>` (narrow tests). Functional tests require migrated PostgreSQL and valid app env; see testing guidance for setup and other suites.
