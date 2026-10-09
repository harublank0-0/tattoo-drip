# Storefront

TanStack Start + Router + Query + Form, React 19, Tailwind v4 and shadcn/ui. File routes: `src/routes`; UI: `src/components/ui`; imports: `#/` maps to `src/`.

The platform/data boundaries are in [root instructions](../../AGENTS.md). Pages currently use `src/data/mock` pending API integration; do not introduce a storefront auth/database layer.

Before UI/forms, server-function or TanStack integration changes, read the relevant section of [development guidance](docs/development.md). Never run `shadcn add form`: `src/components/ui/form.tsx` is the custom TanStack Form toolkit. Preserve Sentry server-function instrumentation.

Run from `apps/storefront`: `pnpm dev` (port 3000, loads `.env.local`), `pnpm typecheck`, `pnpm build`, `pnpm generate-routes`. `src/routeTree.gen.ts` is generated. There is no test script; use validation appropriate to changed behavior, including browser checks for UI.

For product behavior or API integration, choose guidance from the [documentation index](../../docs/README.md).
