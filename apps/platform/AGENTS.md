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
- `app/modules/<module>/`: one folder per backend module from `docs/architecture.md`, owning its `models/`, `services/`, `controllers/`, `validators/` and `emails/`. Import with `#modules/*`. New module code goes here; code still in the flat `app/*` folders moves when its module is built.
- `start/routes.ts` (routes reference controllers through `#generated/controllers`), `start/kernel.ts` (middleware), `start/env.ts`
- `config/`, `database/migrations/`
- `inertia/pages`, `inertia/layouts`, `inertia/components` (shadcn components in `inertia/components/ui`), `inertia/hooks`, `inertia/css/app.css` (Tailwind entry and theme tokens)
- `tests/unit`, `tests/functional`, `tests/browser` (suites are defined in `adonisrc.ts`)

Import with the subpath aliases from `package.json` (`#controllers/*`, `#models/*`, `#services/*`, `#validators/*`, …), never with long relative paths.

## Rules

- Each backend module owns its models and services; other modules call its services instead of querying its tables. Inertia controllers, API controllers and jobs stay thin and call the same services. See the module table in `docs/architecture.md`.
- The tenant always comes from the URL (`/t/:slug/…` for the dashboard, `/api/v1/tenants/:slug/…` for the API). Services scope every query by tenant; never trust a tenant ID from a request body. Every tenant-owned endpoint needs a test proving tenant A can't reach tenant B's data.
- The REST API implements the contract in `packages/types/openapi.yaml`. Change the contract first, regenerate the types, then implement.
- `database/schema.ts` and `.adonisjs/` are generated. Change the schema with a new migration, never by editing an existing migration that has been run.
- Migrations follow `database/README.md`: UUIDv7 primary keys (`defaultTo(this.raw("uuidv7()"))`), `timestamptz` UTC instants, and `tenant_id` on every tenant-owned table.

## Emails

- Emails are Edge templates with inline styles and table layout: no `<style>` blocks, CSS inliner or MJML.
- Shared parts are components in `resources/views/components/email/`. Wrap every email in `@email.layout({ title, preheader })` and use `@!email.button({ href, text })` for calls to action.
- Each email is a `BaseMail` class in `app/modules/<module>/emails/`, next to an HTML template and a `_text` template. HTML templates print with `{{ }}`; text templates print with `{{{ }}}` so URLs keep their `&`. Guard optional values: Edge prints `undefined` and `null` literally.
- Mail classes never set `from`; `config/mail.ts` always sends from the platform's domain.
- A module with templates needs one `edge.mount("<module>", …)` line in `start/view.ts`; its templates are then `<module>::emails/<name>`. `metaFiles` in `adonisrc.ts` copies `app/modules/**/*.edge` into the build.

## Commands

Run from `apps/platform`:

- `pnpm dev` (`node ace serve --hmr`, port 3333)
- `node ace test` (add `--files` or a suite name to narrow it)
- `node ace make:controller|model|migration|validator|… <name>` to scaffold
- `node ace migration:run`
- `pnpm typecheck` (server and `inertia/`)

Relevant docs: `docs/architecture.md`, `docs/data-model.md`, `docs/requirements.md`.
