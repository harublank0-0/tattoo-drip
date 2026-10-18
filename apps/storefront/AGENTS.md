# Storefront

TanStack Start + Router + Query + Form, React 19, Tailwind v4 and shadcn/ui. File routes: `src/routes`; UI: `src/components/ui`; imports: `#/` maps to `src/`.

The platform/data boundaries are in [root instructions](../../AGENTS.md). Pages show only API data, through `@tattoo-drip/react` and the router context's `tattoo.client` ([API and data](docs/development.md#api-and-data)); the studio page is `src/studio/` ([studio page](docs/development.md#studio-page)). Do not introduce a storefront auth/database layer, analytics or third-party scripts (the intake form's Cloudflare Turnstile is the one exception: [intake form](docs/development.md#intake-form)).

Before UI/forms, server-function or TanStack integration changes, read the relevant section of [development guidance](docs/development.md). Never run `shadcn add form`: `src/components/ui/form.tsx` is the custom TanStack Form toolkit. Preserve Sentry server-function instrumentation.

Run from `apps/storefront`: `pnpm dev` (port 3000, loads `.env.local`; needs `API_URL` and `STOREFRONT_URL`; `TURNSTILE_SITE_KEY` is optional there and required in production), `pnpm test` (`node:test` + `tsx`, `test/`), `pnpm typecheck`, `pnpm build` (ends with the browser-bundle secret check), `pnpm check:page` (after a build; canary-key run), `pnpm generate-routes`. `src/routeTree.gen.ts` is generated; its Register footer comes from `pnpm dev`/`pnpm build`, not `generate-routes`. Browser-check UI changes.

Every request's studio comes from its host (`src/start.ts`, `src/tenancy/`): read [tenants and hosts](docs/development.md#tenants-and-hosts) before changing them.

For product behavior or API integration, choose guidance from the [documentation index](../../docs/README.md).
