# Storefront development

Read the relevant section before changing UI/forms, server functions or version-specific TanStack integration. General commands and boundaries are in [area instructions](../AGENTS.md).

Both apps use Tailwind CSS v4 and shadcn/ui (new-york, Radix, lucide, zinc), with separate themes until a shared design system replaces them. Storefront theme entry: `src/styles.css`. Environment validation: `src/env.ts`.

The unused `@tanstack/ai*` prototype packages are slated for removal; do not build on them.

## shadcn

Add components from `apps/storefront` with `pnpm dlx shadcn@latest add <component>`, then run a focused Biome check on the generated components from the root (see [validation](../../../docs/agent-workflow.md#validation)). The CLI imports `cn` from the `cn` package (shadcn's clsx + tailwind-merge replacement); older components (`dialog`, `sheet`) still use `#/lib/utils`.

Never run `shadcn add form`: `src/components/ui/form.tsx` is our TanStack Form toolkit, and the CLI would overwrite it with shadcn's react-hook-form version.

## Forms

- Build forms with `useAppForm` from `#/components/ui/form` (TanStack Form composition) and render fields with `<form.AppField name="…">`, using `field.TextField`, `field.TextareaField` or `field.SelectField`. Add new field types to `form.tsx` rather than wiring inputs by hand. `src/features/home/booking-form.tsx` is the reference.
- Pass Zod schemas straight to `validators` (TanStack Form 1.x reads Standard Schema; there are no adapters). For "validate on submit, then on change", use `validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })` with `validators: { onDynamic: schema }`.
- No skill covers TanStack Form 1.x: the skills.sh `tanstack-form` skill targets the pre-1.0 adapter API. Go by the installed package's types and shadcn's TanStack Form guide.

## Sentry

Sentry is initialised server-side in `instrument.server.mjs`, which `pnpm dev` and `pnpm start` load with `--import`. Instrument server functions: wrap the body of each `createServerFn` handler in a span.

```tsx
import * as Sentry from "@sentry/tanstackstart-react";

Sentry.startSpan({ name: "Load studio profile" }, async () => {
	// server work here
});
```

## TanStack skill loading

The linked TanStack skills cover most work. Only when a change depends on version-specific TanStack APIs they don't cover:

- Run `pnpm dlx @tanstack/intent@latest list` from `apps/storefront` to see the skills shipped with the installed packages.
- Load the one matching skill with `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files, and follow its `SKILL.md`.

## Tenants and hosts

Every server request finds its studio from its `Host` header before any route runs (TAT-12): `src/start.ts` registers Start's CSRF check for server functions, then `tenantMiddleware` (`src/tenancy/`).

- `<slug>.<base>` is a studio: the API confirms it with `studio.get()` (5 s timeout). The current slug goes on; an old slug gets a 302 to the same path and query on the current subdomain (GET and HEAD; other methods get the 404 page). The base domain and `www.` show a static landing page at `/`.
- An unknown studio, a label that can't be a slug, a deeper name, an IP or another domain gets a static 404 page (`Cache-Control: public, max-age=0, s-maxage=60`, so a new studio shows within a minute). An API failure is a static 503 page with `Retry-After: 30`, logged with the slug, status and code.
- Only `Host` counts, never `X-Forwarded-Host`. Labels are checked against the stored slug shape only (`STORED_SLUG`, a copy of the platform's, pinned by a test); reserved and old slugs are the API's answer, so never copy the platform's reserved list.
- Server code reads the studio as `serverContext.studio` in loaders and `beforeLoad`, or with `requestStudio()` (`getRouter()`, server functions). The browser doesn't have it yet (TAT-23).
- Settings, server only, from `process.env` (not `src/env.ts`, whose `import.meta.env` holds only `VITE_` variables): `API_URL`, the API's origin, and `STOREFRONT_URL`, `http://{tenant}.localhost:3000` in development and `https://{tenant}.<domain>` in production, the same value as the platform's setting of that name. Both use https except on localhost. `pnpm dev` refuses to start without them; a build doesn't need them.
- Unverified on Vercel (TAT-13 confirms it on the first deploy): the design assumes a function sees the studio's own domain in `Host` (from Vercel's docs, not yet observed), and that Vercel's CDN keys its cache by host. If `Host` shows another name there, tenant resolution needs another source and a new decision.
- Local development: run the platform, set `API_URL` to its address, and open `http://<slug>.localhost:3000` for a studio in its database. Chrome, Firefox, Edge and curl send `*.localhost` to this machine (for Safari: `curl -H 'Host: <slug>.localhost:3000' http://127.0.0.1:3000/`), and Vite allows those hosts. `http://localhost:3000` is the landing page.
- `src/start.ts` puts `startInstance` in `routeTree.gen.ts`'s Register footer. The Start Vite plugin writes that footer (`pnpm dev`, `pnpm build`); `tsr generate` writes none, so after `pnpm generate-routes`, run `pnpm build` before committing the route tree.
- Tests: `pnpm test` runs `test/**/*.test.ts` with `node:test` and `tsx`. Keep `src/tenancy/` free of React and TanStack imports (except `middleware.ts`) so its tests run in plain Node; its files import each other with `.ts` extensions.
