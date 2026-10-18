# Tenant from host: studio subdomains and `*.localhost` (TAT-12)

Date: 2026-10-18
Refs: TAT-12 (Resolve tenant from subdomain, local dev via `*.localhost`). Builds on TAT-24 (slug shape, old slugs kept for good, 302 for old dashboard slugs), TAT-32 (`GET /api/v1/tenants/:tenant`: an old slug answers as an alias and the body's `slug` is the current one; unknown or malformed slugs are a `not_found` 404) and the SDK as TAT-32/51 built it. Blocks TAT-23 (SDK wiring), which blocks TAT-48 (studio page). Written without the user (unattended run): every open question is a ruling below.

## Goal

A request to `blackneedle.tattoodrip.com` (or `blackneedle.localhost:3000` in development) reaches the storefront's pages with its studio confirmed by the API. An unknown studio gets a real 404 page, an old slug a redirect to the current subdomain, a failing API a 503 page, the bare domain a placeholder landing page. Storefront only: no platform, contract or SDK change, no new route file.

## Base

This branch starts at 9cbd445, which holds TAT-24's code but only the designs of TAT-32, 51, 65 and 66. The build needs the built SDK (`RequestOptions` with `signal` and `timeoutMs`, status-0 `timeout` and `network_error` errors, `credentials: "omit"`): rebase onto the built chain's tip first (TAT-51's reviewed tip c25302a at least; TAT-66's built tip when it exists). Only this spec and plan sit on top.

## Rulings

1. **Scope: the server's request pipeline only.** Host to slug, the API check, the four answers above, and typed access to the studio on the server. The browser's client, `TattooProvider`, the per-request `QueryClient` and prefetching are TAT-23; the mock pages stay as they are until TAT-48. Rejected: carrying the studio to the browser now (half of TAT-23, untestable until something uses it).
2. **One global request middleware decides before any route runs.** `src/start.ts` registers `tenantMiddleware`; it answers every non-studio case itself with a `Response` and otherwise calls `next({ context: { studio } })`. Routes read `serverContext.studio` in server-side `beforeLoad`/`loader`; `getRouter()`, server functions and TAT-23 use `requestStudio()` (`getGlobalStartContext()`). This is Start 1.168's own mechanism (`createStartHandler` passes the middleware context to the router as `serverContext`). Rejected: a root `beforeLoad` throwing `notFound()`/`redirect()` (it runs again in the browser on every navigation, needs a server-function round trip each time, and renders error pages inside an app shell that expects a studio); a server function called from loaders.
3. **CSRF stays on.** Declaring any global request middleware replaces Start's default CSRF check on server functions, so `start.ts` adds back exactly that default, `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })`, first in the list (a cross-site call is refused before any API lookup). Rejected: turning the warning off.
4. **Only the `Host` header names the studio.** Never `X-Forwarded-Host`, and not `request.url`'s host (an adapter may rewrite it from forwarded headers). Vercel only routes the project's own domains to the function and sends the client's host in `Host`; its CDN keys its cache by host; srvx (Nitro) reads forwarded headers only with `trustProxy`, which is off. A page chosen by another header than the cache key would let one host's page be cached for another (cache poisoning). TAT-13 confirms `Host` on the first deploy. Rejected: forwarded headers first; a trusted-proxy setting (nothing sits in front of Vercel).
5. **`tenantFromHost(host, baseHost)` is pure and strict.** Refuse anything but ASCII letters, digits, `.`, `-`, `:`, `[`, `]` before lowercasing (TAT-24's Kelvin-sign rule); lowercase; drop the port (any port: the scheme and port of a redirect come from configuration, rule 7); drop one trailing dot; every label 1 to 63 characters, no hyphen at either end, the name at most 253; a numeric last label (IPv4) or brackets (IPv6) is no tenant. The base domain itself and `www.<base>` are the landing page; exactly one label under the base is the slug when it has the stored shape (rule 6); two or more labels (`a.b.<base>`) are no tenant; a valid name outside the base is `foreign`, the hook for custom domains (TAT-79), and a 404 today. Punycode (`xn--`) labels pass through undecoded and the API decides. Rejected: decoding IDNs; redirecting uppercase or trailing-dot hosts to one spelling (browsers already lowercase; no cookies or SEO depend on it).
6. **Copy the shape, never the reserved list.** `STORED_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/` is duplicated from the platform (the storefront may not import it), with a comment and a test that pins its source to the database CHECK `tenant_slugs_slug_format`. A label failing it never reaches the API. Whether a slug is reserved, taken or old is the API's answer: the platform's own rule is "never copy RESERVED_SLUGS", grandfathered slugs (`12345`, `a--b`, now-reserved words) must stay reachable (TAT-24 review I-1), and a copy of about 150 names would drift. The one storefront-owned label is `www`. A legacy studio holding `www` would lose its subdomain; none exists (the dev database has no odd slugs, production has none yet). Rejected: copying the reserved list (drift, unreachable grandfathered studios); moving the regex into the contract or SDK (touches platform and SDK for a storefront ticket; the CHECK already keeps the shape stable).
7. **Two required server-only settings: `API_URL` and `STOREFRONT_URL`.** `STOREFRONT_URL` has the name, format and value of the platform's setting from TAT-65 (`http://{tenant}.localhost:3000` in development, `https://{tenant}.tattoodrip.com` in production), so both apps take the same string. `{tenant}` must be the whole first label; the rest gives the base domain, the scheme and the port (a default port is dropped). Both are https, http only for `localhost` (and `127.0.0.1`/`[::1]` for the API); `API_URL` is an origin (no path, query, fragment or credentials). They are read from `process.env` on first use and kept for the process; the dev server checks them at start (`vite.config.ts`, `serve` only, so CI's `pnpm build` needs no values). The error names each bad variable and its rule, never a value (TAT-23's server key will share the check). Not in `src/env.ts`: its `runtimeEnv: import.meta.env` never holds non-`VITE_` variables on the server. Rejected: `STOREFRONT_BASE_DOMAIN` with the scheme guessed from `NODE_ENV` or the request (a local production run breaks; the request's scheme can't be trusted); defaults (a deploy that forgot them would redirect studios to localhost).
8. **The API confirms the studio on every server request.** A throwaway SDK client per request (`createTattooClient({ baseUrl: API_URL, tenant: slug })`), `studio.get({ signal: request.signal })`, timeout 5 s (a page shouldn't hang 10 s on the SDK default before its error page). Outcomes: `found` (the body's slug is the requested one), `moved` (another slug), `missing` (a 404 with the `not_found` envelope only: a 404 without it means `API_URL` points at the wrong server, which must show as a 503 and a log line, not as every studio missing), `unavailable` (timeouts, network errors, 5xx, 429, `invalid_response`, any other status). The current slug in the body must have the stored shape before anything uses it. A cancelled request rethrows its `AbortError`. Server functions go through it too: no server code runs without its studio. Rejected: an in-memory lookup cache (shared across requests on a server; the API is CDN-cacheable and TAT-23 can reuse this result for its prefetch).
9. **An old slug is a 302 to the same path and query on the current subdomain.** GET and HEAD only; any other method gets the 404 page, like the API's rule that writes need the current slug. `Location` is `<scheme>://<current slug>.<base>[:port]` from `STOREFRONT_URL`, then the request's path and query appended as text, never resolved against the request (so `//evil.com` stays a path) and checked to keep the origin. `Cache-Control: no-store`. The fragment survives (browsers carry it across a redirect without one), so TAT-65's `/deposit#<token>` links made before a rename keep working. Why 302: a studio can switch back to an old slug, and a cached 301/308 would then loop (TAT-24 ruling 9, TAT-32 ruling 6). Rejected: 301/308; any part of `Location` from the incoming `Host`.
10. **Not found: one static 404 page from the middleware.** For an unknown studio, a label that fails the shape, deeper names, IPs, foreign hosts, a missing or garbled `Host`, and landing-host paths other than `/`. `Cache-Control: public, max-age=0, s-maxage=60`: the CDN absorbs repeated hits (bots try random subdomains) and a new studio is reachable within a minute, like the API's own 60 s. Fixed text only: nothing from the request is echoed, so it neither leaks why it is a 404 nor reflects input. Rejected: a React `notFoundComponent` (status and headers through the app shell, hydration without a studio); `no-store` (every random label costs a function run and an API call); a longer TTL.
11. **API failure: a static 503 page, `Retry-After: 30`, `no-store`.** One page for every `unavailable` outcome, and one log line with the slug, status and code (no stack, URL or body). 503 is the "temporary, retry" signal crawlers respect. Rejected: 502/504 by cause (the log has the cause); rendering the page without a studio.
12. **Landing: a static placeholder.** `/` on the base domain or `www.` is a 200 page saying what Tattoo Drip is and that a studio's link opens its page; same short cache, `noindex`. Rejected: a React landing route (every page's `studio` would become optional).
13. **No `Vary: Host`.** HTTP caches key by the full URL, host included (RFC 9111 section 4), and Vercel's CDN keys per host; these responses depend only on host and path, and redirects aren't cached. Rejected: `Vary: Host` on every response (redundant, and it can't fix a cache that ignores the host).
14. **Local development uses the same code.** Browsers (Chrome, Firefox, Edge) and curl send `*.localhost` to loopback, and Vite 8 always allows `localhost` and `*.localhost` (no `server.allowedHosts` change). `pnpm dev` keeps port 3000; `localhost:3000` is now the landing page and `<slug>.localhost:3000` a studio from the running platform. Safari: use curl with a `Host` header or an `/etc/hosts` line. Rejected: a `?tenant=` or `DEV_TENANT` override (a second way to pick a studio, and a cache and security trap).
15. **Tests: `node:test` with `tsx`, like the SDK and React packages.** Pure, framework-free modules in `src/tenancy/`; tests in `apps/storefront/test/`; root `pnpm test` picks the new script up. The request handler test is the route-level test (real `Request` objects, a fake `fetch`, the whole decision). The Start glue (`start.ts`, `middleware.ts`) is covered by typecheck, the build (route-tree footer, no server code in the client bundle) and a dev-server curl pass. Rejected: Vitest (a second runner for one folder of pure tests); booting Start in tests (no harness).

## Request flow

| Case | Answer | `Cache-Control` |
|---|---|---|
| Studio, current slug | the app renders; `serverContext.studio` | the page's own (TAT-23/48) |
| Old slug, GET/HEAD | 302 to the current subdomain, same path and query | `no-store` |
| Old slug, other methods | 404 page | short |
| Unknown studio (API `not_found`) | 404 page | short |
| Bad label, `a.b.<base>`, IP, foreign host, no `Host` | 404 page, no API call | short |
| Base domain or `www.`, path `/` | 200 landing page | short |
| Base domain or `www.`, other paths | 404 page | short |
| API timeout, network error, 5xx, 429, odd body | 503 page, `Retry-After: 30`, log line | `no-store` |

Short = `public, max-age=0, s-maxage=60`. The three pages are static HTML (no scripts, inline styles, `noindex`) with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.

## Modules (`apps/storefront`)

| File | Exports |
|---|---|
| `src/tenancy/host.ts` | `STORED_SLUG`, `isDnsName(name)`, `tenantFromHost(host, baseHost)`: `tenant` (slug) / `landing` / `none` / `foreign` (hostname) |
| `src/tenancy/config.ts` | `StorefrontConfig` (`apiUrl`, `protocol`, `baseHost`, `port`), `parseStorefrontConfig(env)`, `storefrontConfig()` (memoized `process.env`), `tenantOrigin(config, slug)` |
| `src/tenancy/lookup.ts` | `STUDIO_LOOKUP_TIMEOUT_MS`, `lookUpTenant(slug, options)`: `found` / `moved` / `missing` / `unavailable` |
| `src/tenancy/responses.ts` | `landingResponse()`, `notFoundResponse()`, `unavailableResponse()`, `redirectResponse(location)`, `aliasLocation(config, slug, requestUrl)` |
| `src/tenancy/handle.ts` | `handleTenantRequest(request, deps)`: `{ type: "studio", studio }` or `{ type: "respond", response }` |
| `src/tenancy/middleware.ts` | `tenantMiddleware`, `requestStudio()` (Start glue, server only) |
| `src/start.ts` | `startInstance`: CSRF, then tenant |

Also: `@tattoo-drip/sdk` as a dependency and `tsx` as a dev dependency, a `test` script, `"node"` in `tsconfig.json`'s `types`, the dev-start check in `vite.config.ts`, both settings in `.env.local.example`, and the route tree's regenerated Register footer (`config: …typeof startInstance.getOptions…`, written by the Start Vite plugin on build or dev; `tsr generate` does not write that footer).

## Security

- A forged `Host` can only pick another public studio page, cached under that same host (rules 4, 5). The redirect origin is configuration plus the API's validated slug, never the request (rule 9). The API origin is configuration and the slug in its path has the stored shape, encoded by the SDK (no SSRF).
- The three pages are fixed text with no request data and no scripts; logs carry the slug, status and code only. Request smuggling is out of scope.

## Tests

One file per module in `apps/storefront/test/tenancy/`: the host table (every case in rule 5, `STORED_SLUG` pinned to the CHECK), configuration (accepted and rejected values, no value in messages), the lookup with a fake `fetch` (every outcome of rule 8, the request's URL and `credentials: "omit"`), the responses (statuses, headers, `Location` safety), and the handler (every row of the request-flow table, `X-Forwarded-Host` ignored both ways, no API call where the table says none).

## Docs

`apps/storefront/docs/development.md` (a "Tenants and hosts" section), `apps/storefront/AGENTS.md`, `docs/architecture.md` (tenant-context row, caching line), `docs/sdk.md` (server snippet), `docs/requirements.md` (studio-page rule), `docs/README.md` (storefront row), `README.md` (setup, `pnpm test`, deploy settings), `docs/agent-workflow.md` (root `pnpm test`).

## For later tickets

- **TAT-23:** build the server client from `requestStudio().slug` in `getRouter()` and seed `tattooQueries.studio` with it (one `getStudio` per page, not two); carry the slug to the browser through the router's `dehydrate`/`hydrate` (the SSR query integration chains them, and `hydrate` runs before the first match) and never re-parse the host in the browser; add `STOREFRONT_SERVER_KEY` to `parseStorefrontConfig` (same no-value messages) and keep it out of the client bundle (the build check in the plan shows how).
- **TAT-48:** a `<link rel="canonical">` from `tenantOrigin(config, studio.slug)`, since old-slug 302s leave old URLs in indexes; page caching headers.
- **TAT-65b:** `/deposit` on the studio host needs nothing more; the token in the fragment never reaches this middleware.
- **TAT-79:** the `foreign` branch of `handleTenantRequest` looks the hostname up on the platform; the redirect origin becomes per studio.
- **TAT-13 (user):** wildcard and apex domains on Vercel; `API_URL` and `STOREFRONT_URL` (`https://{tenant}.<domain>`) in its environment; on the first deploy check that a studio page is 200, a random label a 404 with the short cache, and that functions see the studio's domain in `Host`. Preview deployments (`*.vercel.app`) show the 404 page unless TAT-13 adds a preview wildcard and its own `STOREFRONT_URL`.
- **Before any public deploy:** TAT-38 (until the server key, every page's lookup counts against the storefront server's one address at the API) and TAT-55, as the earlier tickets list.

## Not in this ticket

The SDK provider, browser client and SSR prefetch (TAT-23); the studio page (TAT-48); themes (TAT-54); custom domains (TAT-79); the deposit page (TAT-65b); deployment and DNS (TAT-13, the user). TAT-53's auth and Supabase removal is already done; `src/env.ts` keeps its unused `SERVER_URL`.
