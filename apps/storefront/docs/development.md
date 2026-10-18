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
- Server code reads the studio as `serverContext.studio` in loaders and `beforeLoad`, or with `requestStudio()` (`getRouter()`, server functions). The browser never reads it: it gets the slug through the router's dehydrated state ([API and data](#api-and-data)).
- Settings, server only, from `process.env` (not `src/env.ts`, whose `import.meta.env` holds only `VITE_` variables): `API_URL`, the API's origin, and `STOREFRONT_URL`, `http://{tenant}.localhost:3000` in development and `https://{tenant}.<domain>` in production, the same value as the platform's setting of that name. Both use https except on localhost. `pnpm dev` refuses to start without them; a build and `pnpm preview` don't need them at start (neither loads `.env.local`, so export the settings when previewing a studio). `STOREFRONT_SERVER_KEY` (optional until TAT-38; 32 or more characters, e.g. `openssl rand -base64 32`) is the secret the server sends with its API calls (`Authorization: Bearer`); a malformed one stops `pnpm dev` too.
- Unverified on Vercel (TAT-13 confirms it on the first deploy): the design assumes a function sees the studio's own domain in `Host` (from Vercel's docs, not yet observed), and that Vercel's CDN keys its cache by host. If `Host` shows another name there, tenant resolution needs another source and a new decision.
- Also check on the first deploy (TAT-13), right after it goes live:
  - Open the landing page. A bad production `API_URL` or `STOREFRONT_URL` is not checked at cold start: the settings are read on the first request, so a wrong value shows as a 500 on every page (the log line names the variable and its rule, never its value). Fix the environment and redeploy.
  - A server function call from the deployed studio page works (none exists yet; check with the first one). Start's CSRF fallback for clients that send no `Sec-Fetch-Site` compares `Origin` with `request.url`'s origin, and that URL's scheme is `http:` behind Vercel's TLS termination (`trustProxy` is off). Browsers send `Sec-Fetch-Site` and are unaffected; only old or non-browser clients could get a 403.
- Local development: run the platform, set `API_URL` to its address, and open `http://<slug>.localhost:3000` for a studio in its database. Chrome, Firefox, Edge and curl send `*.localhost` to this machine (for Safari: `curl -H 'Host: <slug>.localhost:3000' http://127.0.0.1:3000/`), and Vite allows those hosts. `http://localhost:3000` is the landing page.
- `src/start.ts` puts `startInstance` in `routeTree.gen.ts`'s Register footer. The Start Vite plugin writes that footer (`pnpm dev`, `pnpm build`); `tsr generate` writes none, so after `pnpm generate-routes`, run `pnpm build` before committing the route tree.
- Tests: `pnpm test` runs `test/**/*.test.ts` with `node:test` and `tsx`. Keep `src/tenancy/` free of React and TanStack imports (except `middleware.ts`) so its tests run in plain Node; its files import each other with `.ts` extensions.

## API and data

Pages read the API only through `@tattoo-drip/react` and `@tattoo-drip/sdk` (TAT-23, `src/api/`).

- `getRouter()` makes one `QueryClient` and one SDK client per server request and one of each per browser tab; never create either at module scope. The router context is `{ queryClient, tattoo }`, and `tattoo.client` is the SDK client. `TattooProvider` wraps the root shell (`src/routes/__root.tsx`), inside the `QueryClientProvider` that `setupRouterSsrQueryIntegration` adds, so the hooks work in any component.
- Server: the client uses `API_URL`, the slug the tenant middleware confirmed and `STOREFRONT_SERVER_KEY` when set; it waits 5 s and never retries. The middleware's studio is already in the cache, so a render asks the API once. Browser: the router's dehydrated state carries only `{ apiUrl, tenant }`, and the browser's client has no key and sends no cookies. Never parse the host in the browser.
- Loaders prefetch with `context.queryClient.query({ ...tattooQueries.<name>(context.tattoo.client), staleTime: "static" })` (cached data, else one fetch: TanStack Query 5.104's replacement for the deprecated `ensureQueryData`) and pass errors to `rethrowAsNotFound`, so the API's 404 shows the route's not-found component. `loadStudio` in `src/api/loaders.ts` is the example: the root route runs it and titles the page with the studio's name. A page route must not set its own `title`, `description` or `og:title`/`og:description` until TAT-48 builds per-page metadata (`title` would replace the studio's name, the rest would show another studio's text in link previews).
- Defaults (`src/api/query-client.ts`): data stays fresh 60 s (the API's `max-age`), so hydrated queries aren't fetched again on mount. The browser retries timeouts, network errors and 5xx twice and a 429 once after a `Retry-After` of 10 s or less, never a 4xx. Only successful and pending queries are dehydrated: a failed server read is fetched again by the browser.
- Secrets: only `src/tenancy/config.ts` reads `STOREFRONT_SERVER_KEY`, from `process.env`. Never give it a `VITE_` prefix, add it to `src/env.ts`, or put a client, a config object or the key in loader data, a `beforeLoad` return value or query data: the router serializes those into the page. `API_URL` is sent to browsers, so it must be the API's public origin. Two scripts guard this (below): `pnpm build` fails when the browser bundle holds server-only text, and `pnpm check:page` runs the build with a canary key.
- `@tattoo-drip/react` is used from source and must share the storefront's React and TanStack Query (`test/api/single-copy.test.ts`); if that test fails, align the versions (`pnpm why @tanstack/react-query`) instead of aliasing them.
- Tests: `test/api/` (`node:test` + `tsx`) covers the defaults, the context and the loaders; the glue (`src/api/request.ts`, `src/router.tsx`, `src/routes/__root.tsx`) is covered by `pnpm typecheck`, `pnpm build` and the two checks below.
- `pnpm build` ends with `scripts/check-client-bundle.mjs` (also `pnpm check:bundle`): it fails when `.output/public` holds server-only text (the settings, the key, the tenant middleware and its log line; the list is in the script) or lacks the SDK's own text (then it did not look at a browser build). CI's `pnpm build` runs it. When it fails, a module that reads the settings or the key has been imported by code the browser runs (typically a route's `beforeLoad` or loader calling `storefrontConfig()`); move that read behind `createServerFn` or `createServerOnlyFn`.
- `pnpm check:page` (`scripts/check-page.mjs`, after `pnpm build`) starts the built server against a stand-in API on two free local ports, with a canary `STOREFRONT_SERVER_KEY`: the page's `<title>` is the studio's name, the page carries only the API's origin and the slug, the key is in no page, header or log line, one keyed lookup serves a page, and an API 5xx or hang is a 503, not a not-found. It takes about ten seconds and is not in CI: run it before a release and after changing how the router, the root route or the tenant middleware use the settings (TAT-13 runs it before the first deploy).
