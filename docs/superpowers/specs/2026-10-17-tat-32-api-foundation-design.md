# API foundation: /api/v1, tenant by path, error envelope, CORS, cache headers (TAT-32)

Date: 2026-10-17
Refs: TAT-32. Builds on TAT-24 (slug registry, see "Depends on TAT-24"), TAT-28/29 (RLS, catalog guard), TAT-83 (the definer-function pattern) and TAT-8 (429 handling). Blocks TAT-44, TAT-49 and TAT-38; TAT-51 and TAT-65 build on it. Linear has no comments on TAT-32, TAT-24, TAT-38 or TAT-44 (checked 2026-10-17). The carry-forwards are TAT-24's spec section "For TAT-32", as its review corrected it (the path pre-filter is `STORED_SLUG`, not `checkSlug`), ruled on in 4 to 6, and its review's deferred M-1 (probing) and M-2 (stale pages writing to an old slug), ruled on in 16 and 6.

## Goal

One `/api/v1` group that every public endpoint joins: the tenant from the path (old slugs included), handlers in that tenant's RLS context, no session or cookies, open CORS without credentials, one success and one error envelope matching `openapi.yaml`, and explicit cache headers. One real endpoint proves it end to end, and the SDK gets the pieces every later endpoint needs.

Written without the user (unattended run): every open question is a ruling below. One migration.

## Depends on TAT-24

Built after this branch is rebased onto TAT-24's final tip, 009ee56 (reviewed and fixed). Used: `tenant_slugs` (migration `1791630000000`: its unique index, the `tenant_slugs_slug_format` CHECK and the trigger); `STORED_SLUG` from `#modules/tenancy/slugs`, the stored shape pinned to that CHECK (`/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/`), which TAT-24's rewritten "For TAT-32" section makes the path pre-filter; `TenancyService.changeSlug` (tests make old slugs with it; neither it nor `createTenant` applies `checkSlug`, so a raw slug update in a test makes a grandfathered slug); TAT-24's testing note that registry rows are permanent in the shared dev database, so new tests use slugs specific to them; and the README and `backend.md` slug text, which this ticket extends. Plan tasks 7 to 11 need that code.

## What exists today

- `router.use` runs session, shield (its CSRF guard reads the session and sets `XSRF-TOKEN` on every request; `exceptRoutes` only skips the check), auth and silent auth on every route; `server.use` runs CORS and Inertia on every request. The session middleware sets its cookie on every request it runs (checked in `@adonisjs/session` 8.1.0 and `@adonisjs/shield` 9.0.0).
- `config/cors.ts` reflects any origin with credentials in development and allows none in production. `@adonisjs/cors` 3.0.0 has one global config (`enabled` may be a function, `credentials` is a boolean) and never sets `Vary`.
- The exception handler renders Adonis defaults for JSON; the limiter's 429 body is `{ errors: [...] }`; debug mode adds stacks. The router answers a known path with another method with a 404.
- `providers/api_provider.ts` adds `ctx.serialize()`, which wraps a transformer's output in `{ data }`. Nothing uses it yet.
- `openapi.yaml` is the booking draft: `ErrorResponse`, `NotFound`/`ValidationError`/`RateLimited` and `getStudio` exist; nothing is implemented. The SDK has `createTattooClient`, `TattooApiError` (`status`, `code`, `fields`), fetch injection and `{ data }` unwrapping, but no timeout, abort or tests.

## Rulings

1. **Scope: the shared foundation plus `getStudio` at its minimum.** `GET /api/v1/tenants/{tenant}` returns `{ data: { slug, name } }`; `Studio` keeps its draft fields as optional, and TAT-44 makes them real and required (additive for clients). Why: a real endpoint proves resolution, RLS, envelope and caching, and the name can only come through the RLS read. Rejected: a separate `/resolve` endpoint (permanent surface for what `getStudio` answers); a test-only proof (no contract or SDK path).
2. **Contract cleanup is shared pieces only.** TAT-32 edits the info text, the `Tenant` parameter, `ErrorResponse`, shared responses and headers, and `getStudio`. The booking draft (`createBooking`, `availability`, `BookingRequestInput`, V1 paths) stays for TAT-51 / TAT-68. Rejected: moving the draft to inquiries here (TAT-51 owns the shapes).
3. **Stateless by one predicate.** `isApiRequest(ctx)`: the matched route's pattern, or before routing the URL path, is `/api` or under it. Thin wrappers run the session and shield middleware for everything else; silent auth and Inertia skip API requests; CORS is enabled only for them. The pattern (not the URL) decides once a route matched, so no URL trick strips the session from a dashboard route. `publicApi` sets `X-Content-Type-Options: nosniff` (shield's other headers are for documents and the TLS edge). Rejected: putting session and shield on a named web group (a route outside it would silently lose CSRF); shield's `exceptRoutes` (still needs the session and sets a cookie).
4. **Resolution: pre-filter, a one-argument definer function, then RLS.** `public.tenant_for_slug(requested_slug text) returns uuid`: the live tenant whose current or old slug equals the argument, else null. SQL-standard body, `stable strict security definer`, pinned `search_path`, schema-qualified, `EXECUTE` for the app role only; it never lists tenants. The middleware opens the request transaction, calls it, sets `app.tenant_id` (never `app.user_id`) and reads the tenant row through RLS. The database README's "no arguments" rule gains one exception: an exact `=` lookup on a unique column returning at most one id; the catalog guard checks each definer function's argument list. Rejected: returning `(tenant_id, current_slug, is_alias)` (the RLS read gives both, so the function exposes less); an anonymous SELECT policy on `tenants`.
5. **The path pre-filter is the stored shape, never `checkSlug` (the corrected TAT-24 contract).** A path slug that fails `STORED_SLUG` (TAT-24's export, pinned to the `tenant_slugs_slug_format` CHECK) can't be in the registry, so it is a 404 without a query; every other slug goes to the function, matched exactly, never case-folded. Grandfathered slugs that TAT-24 ruling 4 keeps (`12345`, `a--b`, `www`, `xn--…`) resolve exactly as their dashboard does, and a test pins it. Reserved words are not checked on lookup. TAT-32 imports the regex and never copies it. Rejected: `checkSlug` (it lowercases and refuses those grandfathered slugs, so their studio pages would 404 while their dashboards work); no pre-filter (any malformed or 10 000-character path would reach the database).
6. **Old slugs: reads are served as an alias; writes are a 404**, consistent with TAT-24 ruling 9 on the dashboard. GET and HEAD under an old slug answer as under the current one, and the tenant resource's `slug` is the current slug, which is the hint (the storefront redirects with it, TAT-48). Any other method under an old slug gets the unknown-tenant 404 before its body is validated or anything runs, so a write never lands through an alias. A page left open across a rename (TAT-24 review M-2) gets that 404; a client tells it from an unknown studio by reading `getStudio` under the same slug (the alias answers with the current one) and offers a reload, which is TAT-51's and TAT-48's to word. Rejected: 301/308 (308 replays writes, a cached permanent redirect loops when a studio switches back, preflighted requests and the SDK would need redirect handling, and `config/app.ts` forwards the query string on every redirect, which TAT-24 had to turn off with `.withQs(false)`); a `canonicalSlug` header (needs CORS exposure; the body says it); accepting writes through an alias (safe only while no slug is ever released).
7. **One request transaction per tenant request, without a user.** `publicTenant` wraps the rest of the request in `runInRequestTransaction`; a failure is rolled back by the exception handler, as on the dashboard. A dashboard session cookie on an API request is ignored. Rejected: a transaction only for writes (the RLS settings are `SET LOCAL`).
8. **Envelopes.** Success: `{ data }` from `ctx.serialize()` and a transformer that picks public fields. Errors: `{ error: { code, message, fields? } }` (table below), `fields` only on `validation_failed`. Messages are fixed per code; only an `ApiException` (the class later endpoints throw for their own codes, such as `too_many_open_inquiries`) brings its own user-facing message. No stack, error message or internal detail in any environment. `code` stays an open string in the contract. Rejected: Adonis's default JSON errors; a closed enum (every new code would break strict clients).
9. **405 for a known path with another method.** For a router miss only (no matched route), the handler asks the router which methods match the URL and answers 405 with `Allow`. A 404 thrown inside a matched route (an unknown tenant) stays a 404. Rejected: 404 for everything; a catch-all route per endpoint.
10. **CORS: any origin, no credentials.** GET, HEAD and POST; request headers `Accept` and `Content-Type`; exposed `Retry-After`; preflight max-age 600 s (only JSON writes preflight; a fix reaches browsers in 10 minutes). `publicApi` also sends `Access-Control-Allow-Origin: *` without an `Origin`, so a CDN copy fetched server-side works in a browser and no `Vary: Origin` is needed. `Authorization` is not allowed cross-origin: the server key is server-side only (TAT-38). The dashboard gets no CORS at all. Rejected: reflecting origins (needs `Vary: Origin`, and credentials would be one flag away).
11. **Caching is opt-in per route, `no-store` by default.** `publicApi` sets `no-store`; `middleware.publicCache()` turns a 200 GET or HEAD into `public, max-age=60, stale-while-revalidate=600` with a strong `ETag` (a matching `If-None-Match` gets a 304). Errors and writes stay `no-store`. 60 s: an owner's edit shows within a minute; 600 s of stale-while-revalidate keeps a quiet studio page fast while one request refreshes it. No `Vary`: the body never depends on cookies, `Accept` or the server key. A route guard makes every API GET route either use `publicCache` or be listed with a reason. Rejected: caching every 200 GET (fail-open for TAT-65's private deposit data); `stale-if-error` (keeps serving a deleted studio).
12. **API 4xx are not reported to the log.** Slug probing would flood it; 5xx still are.
13. **SDK: keep the client, add what every endpoint needs.** `timeoutMs` (default 10 000), a per-call `{ signal }` on reads, `credentials: "omit"`, `TattooApiError` codes `timeout` and `network_error` (status 0) and `retryAfter` from `Retry-After`; a caller's abort rejects with its `AbortError`. React forwards TanStack Query's `signal`. `TattooApiError` keeps its documented name. Rejected: renaming it `ApiError` (clashes with the types package's body type); retries in the SDK (TanStack Query retries).
14. **SDK tests: `node:test` with `tsx`.** Tests in `packages/sdk/test`, typechecked by a test tsconfig; the main tsconfig sets `types: []` so `@types/node` never reaches the SDK source. Rejected: vitest (a new, heavier dependency); Node's own type stripping (needs `.ts` import specifiers).
15. **A small public isolation harness.** `tests/isolation/public_cases.ts` lists each `/api/v1/tenants/:tenant` route (a guard fails for a route without a case); the harness requests studio A's path and fails if the body mentions any of studio B's markers (ids, slug, names) or B's snapshot changes, with a positive control on A's markers. Rejected: reusing `cases.ts` (it attacks with a signed-in actor and B's slug, which on the public API is simply another tenant).
16. **TAT-38's slot, and slug probing.** TAT-38 adds named middleware to the group lists: a per-IP limit between `publicApi` and `publicTenant` and a per-tenant limit after it. It parses the server key there and must not put per-caller headers on cacheable responses. With ruling 6, whether a name was ever any studio's slug becomes public (an old slug answers reads). That is by design, and it corrects TAT-24 ruling 13's premise (its review M-1: a failed rename costs no slot, so probing was never self-limiting): the only bound on probing is TAT-38's per-IP limit, which runs before the lookup for that reason, plus TAT-55's challenge on writes. Rejected: hiding old slugs from anonymous reads (breaks the alias the contract and TAT-48 rely on).

## Pieces

| Piece | Where |
|---|---|
| `isApiRequest`, `READ_METHODS`, `setApiHeaders`, `publicCacheControl` | `app/services/public_api.ts` (type imports only, so `config/cors.ts` can use it) |
| `ApiException`, `apiErrorFor(error, allow)`, `renderApiError(error, ctx)` | `app/services/public_api_errors.ts` |
| Session and shield wrappers | `app/middleware/web_session_middleware.ts`, `web_shield_middleware.ts` (in `router.use`) |
| `publicApi`, `publicTenant`, `publicCache` (named) | `app/middleware/public_*_middleware.ts`; `publicTenantContext(ctx)` |
| `tenantIdForSlug(slug)` | `TenancyService`, the only caller of `tenant_for_slug` |
| `STORED_SLUG` | TAT-24's export from `#modules/tenancy/slugs`, imported, never copied |
| Migration `1791640000000_create_tenant_for_slug_function.ts` | function, `revoke … from public`, grant to `DB_USER` |
| `PublicStudioController.show`, `PublicStudioTransformer` | `app/controllers`, `app/transformers`; route `api.v1.studio` |

Group: `/api/v1` with `publicApi`, inside it `/tenants/:tenant` with `publicTenant`, and `getStudio` with `publicCache()`. Platform-wide endpoints (V1 styles, placements) go in the outer group.

## Error codes

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | Unreadable body (bad JSON or multipart, a non-object JSON body); any other 4xx keeps its status with this code |
| 404 | `not_found` | Unknown slug or one without the stored shape, a write under an old slug, unknown path or record |
| 405 | `method_not_allowed` | Known path, other method (`Allow` header) |
| 413 | `payload_too_large` | Body over the bodyparser limit |
| 415 | `unsupported_media_type` | Unsupported encoding or charset |
| 422 | `validation_failed` | VineJS errors, with `fields` (field path to messages) |
| 429 | `rate_limited` | Limiter error, with `Retry-After` (and its `X-RateLimit-*` headers) |
| 500 | `internal_error` | Anything else |

## Tests

- **Unit:** `apiErrorFor` for each row above, plus `ApiException` and "a thrown error's own message never shows"; `isApiRequest` (URLs that only look like `/api`, a matched pattern beating the URL); `publicCacheControl`.
- **Definer function** (`tenant_for_slug.spec.ts`): current and old slug give the id while the app role alone sees no tenant; a grandfathered slug resolves; unknown, mixed case, `%`, `_`, deleted tenant (current and old) give null; definer, strict, pinned `search_path`, args `requested_slug text`, result `uuid`, PUBLIC can't run it, the app role can, another role owns it. Catalog guard: `DEFINER_FUNCTIONS` gains the function and every entry's argument list.
- **Stateless and CORS** (test-only routes under `/api/v1/__test`): no `Set-Cookie` on 200, 400, 404, 405, 413, 422, 429, 500 and preflights, even with a dashboard session; a POST needs no CSRF token; the dashboard still sets its session and `XSRF-TOKEN` cookies; an `X-Inertia` header changes nothing; simple and preflight CORS headers, no `Allow-Credentials`, refused preflights (PUT, `Authorization`), no CORS on the dashboard; envelope and `no-store` for each error class, no stack.
- **Resolution** (`public_tenant.spec.ts`, test routes under `/api/v1/tenants/:tenant/__test`): current slug; grandfathered slugs (`12345`, `a--b`, `www`, `xn--80ak6aa92e`); old slug GET and HEAD; a write under an old slug is a 404 even with an invalid body; unknown, wrong case, without the stored shape, too long and deleted are the same 404; the request runs with `app.tenant_id` of the resolved tenant and no `app.user_id` and sees only that tenant's row, also for a signed-in owner of another studio.
- **`getStudio`:** exactly `{ data: { slug, name } }` (the contract-shape check TAT-47 generalizes through `tests/helpers/api.ts`); an old slug answers with the current slug; cache headers, ETag and 304; HEAD; an unknown tenant is a 404 (not a 405) and a POST a 405, both `no-store`.
- **Guards** (`api_routes.spec.ts`): every `/api` route runs `publicApi` first and none of `auth`, `guest`, `dbContext`, `tenant`, `role`; every tenant route runs `publicTenant`; no route outside `/api` runs the public middleware; every API GET route has `publicCache` or a reason; test-only routes are skipped.
- **Isolation** (`public_api.spec.ts`): every public case, plus self-tests that a leaking test route and a vacuous positive control are reported.
- **SDK** (`packages/sdk/test/client.test.ts`, mocked fetch): URL and encoding, `Accept`, `credentials: "omit"`, unwrapping, error envelope to `TattooApiError` (with and without fields), `retryAfter`, a non-JSON error, a body without `data`, network error, timeout (also while the body streams), caller abort.

## Docs

`apps/platform/docs/backend.md` (a Public API section; the cross-tenant bullet names both definer functions; TAT-24's "the public API must resolve…" sentence points to it), `apps/platform/database/README.md` (the amended definer rule), `apps/platform/docs/testing.md` (public isolation cases, guards, helpers), `docs/sdk.md` (envelope, codes, caching, aliases, timeout and abort), `docs/architecture.md` (tenant row and caching values), `docs/README.md` (the backend row mentions the public API).

## Not in this ticket

Rate limits and the server key (TAT-38), bot challenge (TAT-55), studio and artist reads (TAT-44), inquiries and the draft's move (TAT-51 / TAT-68), subdomains (TAT-12), SDK wiring in the storefront (TAT-23), React hook tests (TAT-11), schema-validating contract tests (TAT-47). Before any public deploy: TAT-38 (each API request holds a pooled connection for its length, like the dashboard) and TAT-55.

## Verification

`pnpm --filter @tattoo-drip/types generate` leaves no diff after the contract task; `node ace codegen` leaves no diff; the full platform suite, the SDK tests, `pnpm check`, `pnpm typecheck` and `pnpm build` pass; the migration rolls back and re-applies. Then the whole-branch review and the Codex code and security reviews.
