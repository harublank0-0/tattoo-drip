## Platform

AdonisJS 7 app that owns all data, business rules and the REST API. The dashboard is Inertia + React inside it.

- **Stack:** Lucid ORM on PostgreSQL, VineJS validators, session auth (`@adonisjs/auth`), Tuyau, Inertia + React (SSR entry exists in `inertia/ssr.tsx` but is disabled in `config/inertia.ts`), Japa tests.
- **UI:** Tailwind CSS v4 and shadcn/ui (new-york style, Radix, lucide icons; same `components.json` settings as the storefront). Theme tokens are shadcn's stock zinc palette in `inertia/css/app.css` until the shared design system replaces them.

## UI conventions

- Build UI from shadcn components in `inertia/components/ui` and semantic tokens (`bg-background`, `text-muted-foreground`); don't add custom CSS classes. Use `cn` from the `cn` package.
- Add components from `apps/platform` with `pnpm dlx shadcn@latest add <component>`, then run `pnpm format:fix` from the root. Don't edit generated components just to satisfy Biome; it relaxes a few lint rules for `**/components/ui/**`.
- Forms post with `Form` from `@adonisjs/inertia/react` and are validated server-side with VineJS. Lay fields out with shadcn's `FieldGroup` / `Field` / `FieldLabel` / `FieldError`, setting `data-invalid` on `Field` and `aria-invalid` on the control (see `inertia/pages/auth/login.tsx`).
- Dark mode follows `data-theme` on `<html>`, rendered from the `app_theme` cookie, and Tailwind's `dark:` variant is keyed to it. Use `useTheme` from `~/hooks/use-theme`, not `next-themes`.
- Import frontend code with the `~/` alias (`~/components/ui/button`).

## Layout

- `app/controllers`, `app/models`, `app/validators`, `app/transformers`, `app/middleware`, `app/exceptions`
- `app/modules/<module>/`: one folder per backend module from `docs/architecture.md`, owning its `models/`, `services/`, `controllers/`, `validators/` and `emails/`. Import with `#modules/*`. New module code goes here; code still in the flat `app/*` folders moves when its module is built. Controllers and transformers stay in `app/controllers` and `app/transformers` for now: `indexEntities` in `adonisrc.ts` only scans those folders to generate `#generated/*`, so it has to be pointed at the module folders first.
- `start/routes.ts` (routes reference controllers through `#generated/controllers`), `start/kernel.ts` (middleware), `start/env.ts`
- `config/`, `database/migrations/`
- `inertia/pages`, `inertia/layouts`, `inertia/components` (shadcn components in `inertia/components/ui`), `inertia/hooks`, `inertia/css/app.css` (Tailwind entry and theme tokens)
- `tests/unit`, `tests/functional`, `tests/browser` (suites are defined in `adonisrc.ts`)

Import with the subpath aliases from `package.json` (`#controllers/*`, `#models/*`, `#services/*`, `#validators/*`, …), never with long relative paths.

## Rules

- Controllers and services that use `@inject()` must import their dependencies as values, not `import type`: the container reads the class from decorator metadata at runtime. Biome's `useImportType` fix gets this wrong, so mark those imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime`.
- Each backend module owns its models and services; other modules call its services instead of querying its tables. Inertia controllers, API controllers and jobs stay thin and call the same services. See the module table in `docs/architecture.md`.
- The tenant always comes from the URL (`/t/:slug/…` for the dashboard, `/api/v1/tenants/:slug/…` for the API). Services scope every query by tenant; never trust a tenant ID from a request body. Every tenant-owned endpoint needs a test proving tenant A can't reach tenant B's data.
- The REST API implements the contract in `packages/types/openapi.yaml`. Change the contract first, regenerate the types, then implement.
- `database/schema.ts` and `.adonisjs/` are generated. Change the schema with a new migration, never by editing an existing migration that has been run.
- Migrations follow `database/README.md`: UUIDv7 primary keys (`defaultTo(this.raw("uuidv7()"))`), `timestamptz` UTC instants, `tenant_id` on every tenant-owned table, and `deleted_at` on business records.
- Soft delete: models of business records use `compose(XSchema, withSoftDeletes)` from `#models/mixins/soft_deletes`. Delete with `record.softDelete(trx?)`, undo with `restore()`; model queries skip deleted rows unless they start from `Model.withTrashed()` or `Model.onlyTrashed()`. The hooks don't reach `whereHas` subqueries or raw `db.from(...)` queries, so add `whereNull("<table>.deleted_at")` there. Soft-deleting a parent soft-deletes its children in the same transaction (the database's `ON DELETE CASCADE` only covers real purges).
- Tenancy: the `tenancy` module (`app/modules/tenancy/`) owns tenants and memberships. Other modules read them through `TenancyService` (`#modules/tenancy/services/tenancy_service`): `createTenant`, `tenantsFor`, and `assertKeepsAnOwner`, which every remove or demote of a member must call inside its transaction. New users create their first tenant at `/onboarding`: signup always lands there, and login lands there while `tenantsFor(user)` is empty (until TAT-25 adds `/t/:slug`, everyone else goes to `/dashboard`).

## Emails

- Emails are Edge templates with inline styles and table layout: no `<style>` blocks, CSS inliner or MJML.
- Shared parts are components in `resources/views/components/email/`. Wrap every email in `@email.layout({ title, preheader })` and use `@!email.button({ href, text })` for calls to action.
- Each email is a `BaseMail` class in `app/modules/<module>/emails/`, next to an HTML template and a `_text` template. HTML templates print with `{{ }}`; text templates print with `{{{ }}}` so URLs keep their `&`. Guard optional values: Edge prints `undefined` and `null` literally.
- Mail classes never set `from`; `config/mail.ts` always sends from the platform's domain.
- A module with templates needs one `edge.mount("<module>", …)` line in `start/view.ts`; its templates are then `<module>::emails/<name>`. `metaFiles` in `adonisrc.ts` copies `app/modules/**/*.edge` into the build.
- Send with `mail.sendLater(...)`: the messenger in `start/mail.ts` queues a `SendMailJob` that the worker sends. Use `mail.send(...)` only inside a job. An email that must go out only if a transaction commits is sent from a domain job queued with `dispatchInTransaction`.
- Template data is stored as JSON until the worker renders it: templates see serialized fields only (`user.fullName` works; getters and methods don't, and dates become strings). Pass plain values for anything computed.
- Queued mail can't carry `Buffer` or stream attachments; they don't survive JSON. Attach by file `path` or URL, or build the email inside a job and use `mail.send`.
- In development, run `pnpm worker` next to `pnpm dev`, or queued emails never reach Mailpit.

## Jobs

- `@adonisjs/queue` with the `database` driver: jobs are rows in `queue_jobs` in the app's own Postgres, run by a separate worker (`pnpm worker`, i.e. `node ace queue:work`). It doesn't reload on code changes; restart it after editing a job.
- Shared plumbing such as `SendMailJob` lives in `app/jobs/` (`#jobs/*`). Domain jobs live in `app/modules/<module>/jobs/`. The worker loads every file in those folders as a job, so put nothing else there.
- Defaults in `config/queue.ts`: 3 retries with exponential backoff (5s up to 5m); completed jobs are deleted, failed jobs stay 7 days with their error. Retries must be the top-level `retry` key: a `retry` inside `defaultJobOptions` is silently ignored (`tests/unit/jobs/queue_config.spec.ts` pins this). `SendMailJob` keeps failed rows for 1 day only, because its payload holds links that work like passwords. Delivery is at-least-once: a worker stopped mid-job reruns it, so make jobs safe to repeat. A job's `failed()` hook runs once retries are used up; log identifying fields under named keys (`err` for the error), never whole objects or secrets.
- Queue a job that belongs to a database write with `dispatchInTransaction(Job.dispatch(payload), trx)` from `#services/queue`, so it commits or rolls back with the data. Don't call `.with()` on that dispatcher; the helper picks the adapter, and it throws if two copies of `@boringnode/queue` are installed.
- Jobs that touch tenant-owned data carry `tenantId` in their payload. TAT-28 runs them in tenant context.
- `@adonisjs/queue` (0.6.2) and `@boringnode/queue` (0.6.0) are pinned to exact versions, and `overrides` in `pnpm-workspace.yaml` forces a single copy of `@boringnode/queue`. Upgrade all three together, then check `pnpm why @boringnode/queue` shows one version.
- The only driver is `database`; there is no `sync` driver, because it would run jobs inside the request, before a transaction commits and without the JSON round trip.
- Tests: fake the queue with `queue.fake()` and assert with `fake.assertPushed(Job, { payload })`; run a job directly with `new Job()`, `$hydrate(payload, context)` and `execute()`. Restore fakes in `group.each.teardown`.

## Commands

Run from `apps/platform`:

- `pnpm dev` (`node ace serve --hmr`, port 3333)
- `pnpm worker` (`node ace queue:work`, runs queued jobs and emails)
- `node ace test` (add `--files` or a suite name to narrow it). The functional suite needs the local Postgres running and migrated; its tests run inside `testUtils.db().wrapInGlobalTransaction()` (Lucid 22's name; `withGlobalTransaction` is deprecated) so they leave no data behind. HTTP tests use `client` with `.loginAs(user)` and `.withCsrfToken()`; check form errors with `assertValidationError(response, field)` from `#tests/helpers/validation`, because Adonis 7 flashes them under `inputErrorsBag` and the session plugin's `assertHasValidationError` reads `errors`.
- `node ace codegen` after adding or renaming routes, pages or controllers: it regenerates the committed `.adonisjs/` types (route names, pages, controllers) that `pnpm typecheck` reads. Commit the result.
- `node ace make:controller|model|migration|validator|… <name>` to scaffold
- `node ace migration:run`
- `pnpm typecheck` (server and `inertia/`)

Relevant docs: `docs/architecture.md`, `docs/data-model.md`, `docs/requirements.md`.
