# TattooDrip Discover: implementation blueprint

Prompt 00 output. It covers the repository audit, the architecture and the prompt roadmap; it is revised with the product owner's approved decisions (2026-11-06). The status table below says what has been implemented since.

This file is the plan Discover prompts work from. The dated `docs/superpowers/specs/` files are per-feature history, and this is a multi-prompt plan, so it lives at the requested path. Each Discover prompt still writes its own dated spec and plan there, as usual.

**Status:**

| Item | State |
|---|---|
| Repository audit | Complete |
| Product boundaries and domains | Decided |
| Roadmap D01–D11 | Defined |
| D01: domain migration preparation | Done: [domain migration](domain-migration.md); the production cutover is D11 |
| D02: discovery database foundation | Done: [database security](database-security.md) |
| D03: public Discover API, SDK client, React hooks | Done: [Discover API](api.md); deviations in C.4 below |
| D04: Studio OS publication controls | Done: [publication controls](publication-controls.md); deviations in C.5 below |
| D05: Discover app scaffold and design system | Done: [frontend](frontend.md); deviations in C.6 below |
| D06: homepage and Studio OS marketing | Done: [frontend](frontend.md#homepage-d06); deviations in C.7 below |
| D06.5: country-aware discovery foundation | Done: [frontend](frontend.md#country); as built in C.8 below |
| D07: studio and artist directories, style and location pages | Done: [frontend](frontend.md#directories-d07); as built in C.9 below |
| D08: public profiles and storefront booking hand-off | Done: [frontend](frontend.md#profiles-d08); as built in C.10 below |
| D09: tattoo inspiration gallery and artwork detail | Done: [frontend](frontend.md#gallery-d09), [artwork pages](frontend.md#artwork-pages-d09), [API](api.md#gallery-search-and-the-artwork-read-d09); as built in C.11 below |
| D10: SEO, accessibility, performance | In progress (phase A done: technical, international and structured-data SEO, sitemaps, robots, indexing and error semantics: [frontend](frontend.md#seo-and-indexing), [API](api.md#sitemap-lists-d10); as built in C.12 below). Phase B: performance, images, caching, accessibility, security |

Status legend: **Done** = in code, with tests where noted. **Partial** = exists, but not in the form Discover needs. **Planned** = only in docs. **Missing** = searched for and absent. **Unverified** = not checked against a running system.

---

## Approved decisions

| Area | Decision | Where this plan applies it |
|---|---|---|
| Apps | `apps/platform`, `apps/storefront`, new `apps/discover`; `packages/{types,sdk,react}` | [C](#c-architecture) |
| Domains | `tattoodrip.app` Discover and marketing; `app.tattoodrip.app` Studio OS; `api.tattoodrip.app` API; `*.tattoodrip.page` storefronts | [C](#c-architecture), D01/D11 |
| Data access | Discover has no database access; it reads only through the public Discover API. Studio OS data stays the source of truth; no duplicate authoritative records | [C](#c-architecture), [D](#d-data-model-gap-analysis) |
| Cross-tenant security | A dedicated, read-only, minimum-privilege discovery boundary. Its privileges and RLS behaviour are verified by tests; a view is not assumed to be secure | [C.2](#c2-cross-tenant-read-boundary) |
| Launch | Build now. Promote at about 15–20 eligible studios (a business target, never coded). Handle few studios gracefully. No fake listings, reviews, popularity or statistics | [J](#j-launch-strategy-risks-and-open-questions) |
| Market | Nepal first; country-aware schema; English first, i18n-ready | [D](#d-data-model-gap-analysis), [H](#h-seo-and-routing-strategy) |
| Studio listing | Explicit owner opt-in; completeness validation; platform takedown | [D.3](#d3-publication-rules) |
| Artist listing | Inherits studio eligibility; individual opt-out; owner-controlled equivalent for independents | [D.3](#d3-publication-rules) |
| Artist identity | Stable internal ids; affiliations preserved; studio-scoped slugs; no global social network | [D.2](#d2-artist-identity-and-affiliation) |
| Search | PostgreSQL for the MVP | [F](#f-search-strategy) |
| Artwork SEO | Canonical to the storefront only when content is substantially duplicated | [H](#h-seo-and-routing-strategy) |
| Booking | Storefront booking only; Discover attribution that can't be forged | [E.2](#e2-booking-hand-off-and-attribution) |
| Pricing / monetisation | Informational pricing page; no paid listings | [G](#g-uiux-blueprint) |
| Analytics | First-party only; no third-party scripts | [E.2](#e2-booking-hand-off-and-attribution) |
| Legal | Privacy, terms, listing consent, takedown process. Claude drafts clearly marked text from product requirements; it is not legally approved and is published only after the product owner reviews it | D04, D06 |
| Domain migration | D01 prepares and tests without touching live DNS or traffic; D11 cuts over after E2E | [I](#i-implementation-prompts) |

---

## A. Executive summary

- **Today:**
  - The repo is a pnpm monorepo. One AdonisJS 7 modular monolith (`apps/platform`) owns all data and serves the Studio OS dashboard (Inertia + React, SSR off), the public REST API `/api/v1` and a queue worker.
  - A TanStack Start storefront (`apps/storefront`) serves `*.tattoodrip.page`.
  - `packages/{types,sdk,react}` hold the contract, the client and the hooks.
  - Production is one self-hosted server: Docker Compose + nginx behind a Cloudflare Tunnel (`deploy/`). `tattoodrip.app` currently serves the dashboard and the API.
- **The constraint:**
  - Every public read is single-tenant: PostgreSQL row-level security scopes the app role to one `app.tenant_id` per transaction.
  - The SDK client is bound to one tenant.
  - The storefront resolves one studio per request.
  - Discover is the first cross-tenant reader.
- **Plan:**
  - A new `apps/discover` reads a new platform-wide `/api/v1/discover/*` API through a new SDK client.
  - The API reads a `discovery` schema of views. A dedicated NOLOGIN role that is subject to RLS owns them, and that role is limited by column grants and by RLS policies scoped to it. The app role's existing policies are untouched.
  - Booking stays on the storefront, with signed referral attribution.
  - The domain split is prepared in D01 and cut over in D11.

---

## B. Existing architecture inventory

### Workspace and deploy

| Area | What it is | Status | Evidence |
|---|---|---|---|
| Tooling | pnpm 12.8.1 workspaces, Node 24.3.0, TypeScript 6, Biome 2.4, husky + commitlint | Done | `package.json`, `pnpm-workspace.yaml`, `.nvmrc` |
| `apps/platform` | AdonisJS 7, Lucid/Postgres 18, VineJS, session auth (email + password; no OAuth), Japa | Done | `adonisrc.ts`, `config/inertia.ts` (`ssr.enabled: false`) |
| `apps/storefront` | TanStack Start/Router/Query/Form, React 19, Tailwind v4, shadcn | Done | `apps/storefront/src/**` |
| `packages/types` / `sdk` / `react` | Contract + generated types; one-tenant client; TanStack Query hooks | Done | `packages/*/src` |
| `packages/ui` | Shared UI | Missing ("added when the first component is actually shared", `docs/architecture.md`) | — |
| CI | Biome, typecheck, types drift, build, migrate, schema drift, tests | Done | `.github/workflows/ci.yml` |
| Deploy | Compose `postgres`, `web`, `worker`, `storefront`, `nginx`, `cloudflared`. nginx sends `tattoodrip.app` to web and `tattoodrip.page` / `*.tattoodrip.page` to storefront. Media on `media.tattoodrip.app` (R2) | Done | `deploy/compose.yml`, `deploy/nginx/` (`common.conf`, `hosts.current.conf`), `deploy/README.md` |
| Vercel | `apps/storefront/vercel.json`, a row in `docs/architecture.md` | Stale | Replaced by `docs/superpowers/specs/2026-10-31-single-server-deploy-design.md` |

**How the parts communicate:**
- The storefront SSR calls `API_URL/api/v1/tenants/<slug>/…` through the SDK. It sends `STOREFRONT_SERVER_KEY` (rate limiting only) and `X-Visitor-IP`.
- The browser posts inquiries and deposit proofs directly to the API (CORS allowlist of the studio pages, the dashboard and Discover since D01; never credentials).
- The dashboard is Inertia over the host-only `__Host-td-session` cookie (cookie session store).

### Backend

| Capability | Status | Evidence |
|---|---|---|
| Modules | Done | `app/modules/{artists,clients,flash,identity,inquiries,media,notifications,payments,projects,references,reports,scheduling,storefront,studio_content,tenancy}` |
| Routes | Done | `start/routes.ts`: guest auth; `/t/:tenant/*` (auth, dbContext, tenant, role, `TENANT_ROUTE_ROLES`); account; `/api/v1` with platform-wide `/styles` and `/tenants/:tenant/{,artists,artists/:artist,work,work/:photo,flash,flash/:design,inquiries,deposits/:token}` |
| API tenant resolution | Done | `PublicTenantMiddleware`: `STORED_SLUG`, then `tenant_for_slug()` SECURITY DEFINER, then a transaction with `app.tenant_id` |
| RLS | Done | `database/helpers/tenant_rls.ts`; tables `ENABLE` (not `FORCE`) RLS. App role `NOSUPERUSER NOBYPASSRLS` (`database/setup_roles.sql`). Three SECURITY DEFINER functions are the only cross-tenant paths (`database/README.md`) |
| Envelopes, errors, cache, limits | Done | `app/services/public_api.ts`, `publicCache()` (60 s + SWR 600 + ETag), `PublicGateMiddleware`, `apiLimit({ name: "tenantReads" })`, `STOREFRONT_SERVER_KEYS` |
| Pagination | Done | Keyset `(created_at, id)` cursor (`app/modules/artists/work_cursor.ts`); `{ data, nextCursor, filters }`, 24 by default and 48 at most |
| Isolation tests | Done | `tests/isolation/public_cases.ts`, `tests/functional/rls/catalog_guard.spec.ts` |
| Link builders | Done | `app/services/storefront_url.ts` (`studioPageUrl`, `artistPageUrl`, `galleryPageUrl`, `artworkPageUrl`): the only place studio links are built |
| `APP_URL` consumers | Done | `start/env.ts`, `app/services/app_origin.ts` (production host rules), `config/app.ts`, `config/drive.ts`, invitation, alert and chat links, emails |
| Search extensions | Missing | No `pg_trgm`, `unaccent` or FTS |
| Billing, admin/moderation, marketing pages | Missing | `/` redirects to `/dashboard` or `/login` (TAT-100) |

### Studio OS data relevant to Discover

| Need | Status | Where |
|---|---|---|
| Studio vs independent | Done | `tenants.type` (`studio` / `independent`), chosen at onboarding |
| Name, slug (+ history), intro, cover, logo, socials, contact, timezone | Done | `tenants`, `tenant_slugs`; settings `profile`, `look` |
| Structured location | **Missing** | `tenants.address` is free text (300) |
| Whole-studio listing switch, takedown | **Missing** | No tenant visibility column |
| Artist profile: `id` (UUIDv7), name, slug, bio, photo, `visible`, accepting flags, `styles[]` ≤5, socials, optional `user_id` | Done | `artists` |
| Artist slug uniqueness | Per tenant only | `artists_tenant_slug_live_unique`; no slug history |
| Same person across tenants | Partial | One `User`, one `artists` row per tenant (`docs/data-model.md`) |
| Portfolio: `alt`, `styles[]` ≤3, `healed`, `hidden` (publish), ≤100 per artist | Done | `artist_work_photos`; Portfolio workspace with bulk publish/unpublish (`inertia/pages/portfolio/index.tsx`) |
| Styles | Done | `app/modules/artists/styles.ts` (18), `GET /api/v1/styles` |
| Booking | Done (request-first) | Storefront `/book?artist=&flash=&artwork=`; inquiry, quote, deposit |
| Inquiry source | Partial | `SOURCE_CHANNELS` (self-reported: instagram…other); no referral field |
| Reserved slugs | Partial | Has `explore`, `studios`, `artists`, `search`; lacks `discover`, `tattoos` |

### Storefront and SDK

| Capability | Status | Evidence |
|---|---|---|
| Routes, host→tenant, old-slug 302 | Done | `src/routes/*`, `src/tenancy/{host,handle,lookup}.ts` |
| Themes `stencil-and-ink`, `ink-noir` | Done | `src/studio/theme/*` |
| SEO (head, canonical, OG, `TattooParlor` JSON-LD, sitemap/robots per studio) | Done | `src/studio/seo.ts`, `src/studio/sitemap.ts` |
| Booking deep links | Done | `src/studio/request.ts` (`artist`, `flash`, `artwork`); other params dropped |
| Custom domains (TAT-79) | Planned | `foreign` branch placeholder |
| SDK: one tenant per client; `styles.list` platform-wide; `TattooApiError` | Done | `packages/sdk/src/client.ts`, `errors.ts` |
| React keys `["tattoo-drip","tenant",…]` and `["tattoo-drip","styles"]` | Done | `packages/react/src/queries.ts` |

---

## C. Architecture

### C.1 Applications and communication

**`apps/discover`** (TanStack Start, SSR) on `tattoodrip.app`:
- No database, no auth, no cookies.
- Reads only `/api/v1/discover/*` and `/api/v1/styles`, via `createDiscoverClient`.
- Sends a server key and `X-Visitor-IP` on SSR, like the storefront.
- "Sign in" and "Register" link to `app.tattoodrip.app`; onboarding already asks studio vs independent.

The storefront was rejected as Discover's home: its middleware, router context, root loader, head and theme all require one studio, and that is a security property. The platform's Inertia pages were rejected too: SSR is off, and it would put crawler traffic on the session host.

```text
browser ─► tattoodrip.app         apps/discover (SSR, CDN-cached)
             │ createDiscoverClient
             ▼
          api.tattoodrip.app/api/v1/discover/*   platform: discovery module (read-only tx, no tenant/user context)
             │ SELECT on discovery.* views only
             ▼
          discovery views ─(owned by tattoo_drip_discovery: NOLOGIN, NOBYPASSRLS, column grants, RLS TO itself)─► tenants, artists, artist_work_photos

profile CTA ─► https://<slug>.tattoodrip.page/book?artist=…&ref=<signed>   (storefront booking, unchanged)
```

**Shared code.** Discover owns its design tokens. Extract `packages/ui` only for primitives both apps use: a responsive image from API `variants`, and the JSON-LD serializer.

### C.2 Cross-tenant read boundary

**How PostgreSQL behaves here** (to be proven by tests in D02, not assumed):
- A view without `security_invoker` reads its base tables with the **view owner's** privileges, and RLS is evaluated **for the view owner**.
- The table owner is exempt from RLS: tables use `ENABLE`, not `FORCE`.
- So a view owned by the migration owner would bypass RLS entirely, and its `WHERE` clause would be the only boundary. **That is not acceptable.**
- With `security_invoker = true`, the caller's RLS applies. The app role has no tenant context in a discovery request and would see nothing, unless permissive policies are added for the app role. That would widen every app-role query, so it is also rejected.

**Design: three independent layers.** Each layer alone stops the obvious leaks.

| Layer | Mechanism |
|---|---|
| 1. A dedicated owner role | `tattoo_drip_discovery`: `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, owns every `discovery.*` view. The views are `security_barrier`, not `security_invoker`, and RLS on the base tables applies to it |
| 2. Column privileges | The role gets column-level `SELECT` on public columns only: tenants (id, slug, type, name, intro, place, cover/logo keys and sizes, socials, public contact, timezone, listing and suspension columns, `deleted_at`), artists (public profile + `visible`, `discovery_listed`, `deleted_at`), photos (public fields + `hidden`, suspension). No grant on deposit settings, payment methods, members, `user_id`, clients, inquiries, projects, payments, references, alerts or any other table |
| 3. RLS policies scoped `TO tattoo_drip_discovery`, `FOR SELECT` only | tenants: listed, not suspended, not deleted. artists: visible, `discovery_listed`, not deleted, tenant passes. photos: not hidden, not suspended, artist passes. Policies `TO` this role do not apply to the app role, so its tenant isolation is unchanged. Keep the policies acyclic (artists → tenants, photos → artists → tenants, never back) to avoid RLS recursion |
| View predicates | Each view repeats the same eligibility predicate. That is defence in depth, and it lets the planner use the indexes |
| Caller | The app role gets `USAGE` on schema `discovery` and `SELECT` on its views. Nothing new on base tables, no write grants. Discover requests run in a `READ ONLY` transaction with neither `app.tenant_id` nor `app.user_id` set, so a stray tenant-model query returns no rows |

- **Product rules are kept out of the security layer.** Completeness thresholds live in the `discovery` service (tunable in code). Visibility, listing and suspension (what may never leak) live in the database.
- **A separate LOGIN role** for discovery reads was considered. It is not needed: the app role with no context already reads zero tenant rows. Revisit if the Discover API ever moves to its own process.
- **Operational notes:**
  - Roles are cluster objects. Create `tattoo_drip_discovery` in `database/setup_roles.sql` (dev, CI) and in the deploy runbook.
  - Migrations fail with a clear error when the role is missing.
  - The migration owner must be able to `ALTER VIEW … OWNER TO tattoo_drip_discovery` (membership or superuser; check on managed Postgres).
  - Update `database/README.md`: SECURITY DEFINER functions are no longer the only cross-tenant path, and add the discovery-view rules.
- **Automated verification (D02):**
  - **Catalog checks:**
    - View owner.
    - `reloptions` contain `security_barrier` and not `security_invoker`.
    - Role attributes (`rolbypassrls = false`, `rolsuper = false`, `rolcanlogin = false`).
    - `has_column_privilege` true only for the whitelist and false for sensitive columns.
    - The app role's privileges on base tables are unchanged.
    - `EXPECTED_POLICIES` includes the `TO tattoo_drip_discovery` policies.
  - **Behaviour checks:**
    - `SET ROLE tattoo_drip_discovery` (in tests) cannot read unlisted, suspended, deleted, hidden or unpublished rows, even from base tables directly.
    - It cannot read any non-whitelisted column or any other table.
    - The app role still sees no base rows without a tenant context.
    - Writes through the views fail.
    - Every `/api/v1/discover/*` route has an isolation case.
    - A visibility parity test compares storefront and Discover on the same fixtures (a hidden artist or photo disappears from both).

---

### C.3 As built in D02 (deviations from C.2 and D.1)

The implementation follows C.2, adjusted where the code or measurements required. Each change is explained in [database security](database-security.md).

- **Where the role comes from.** `tattoo_drip_discovery` is created by `setup_roles.sql`, the repository's place for roles, not by a migration. The migration refuses to run without it.
- **Policy shape.** A restrictive policy carries the full rule. The permissive policy checks only the row's own columns. A photo's rule reads `artists`, whose own restrictive policy brings the studio's rule with it. With the full rule in both, the newest-photos page took 340 ms instead of 2 ms.
- **No `security_barrier` on the views.** RLS makes it redundant, and it cost the newest-first index (145 ms against 2 ms).
- **No trigram or GIN indexes.** Under RLS, a caller's non-leakproof condition cannot be an index condition, and trial indexes were ignored. Name search scans listed rows (under 1 ms). The style filter scans too (~117 ms at 50,000 photos), which D03 must measure.
- **Studios.** No `discovery.places` view and no derived studio-styles column. The app reads `places` directly; a studio's styles come from its shown artists in `discovery.artists`.
- **Contact details are not in the views.** Phone, email and address stay on the studio page.
- **Listing consent.** `discovery_listed_at` doubles as the consent timestamp: a listing requires it, by CHECK constraint.
- **Takedowns.** Per studio and per photo, as planned. The artist flag is the artist's own opt-out.
- **Styles.** They stay the code list `TATTOO_STYLES` with slug arrays. No second taxonomy table.

### C.4 As built in D03 (deviations from C.2, D.1 and the D03 row)

Details and measurements are in [Discover API](api.md).

- **Read transaction.** Each read runs in a savepoint of the request transaction that clears the context, sets `transaction_read_only` and is always rolled back (`readDiscovery`), not in a separate read-only transaction.
- **No transformers.** `DiscoveryService` writes each answer field by field from the views' columns, so a new view column cannot reach a response.
- **Referral columns.** `inquiries.referral_source` and `referral_issued_at` (when Discover made the link) instead of `referral_surface`; the token carries no surface. Both or neither, by CHECK. The intake half of the D04 row ("the intake stores verified referral") is done; the storefront keeping `ref` on `/book` is still D08.
- **No named server keys.** Deferred to D05, which adds the app that needs one; D03's endpoints work with or without a storefront key.
- **Isolation cases.** Discover routes have no tenant, so instead of `public_cases.ts` entries they have a route-stack test (`api_routes.spec.ts`) and the visibility tests of `discover.spec.ts`. A storefront parity test was not added: both sides are tested against the same rules (`visible`, `hidden`, `deleted_at`) on their own fixtures.
- **Tattoo feed query.** The page is read from `discovery.artworks` alone and only its rows are joined (3.8 ms instead of 119 ms). The style filter (~85 ms) stays under the 100 ms target; a country-wide filter matching every listed studio (90–105 ms) is at or just over it. Neither justified a materialised view (see [Discover API](api.md#performance)).
- **Providers.** A separate `DiscoverProvider`, since generalising `TattooProvider` would change every studio hook.

### C.5 As built in D04 (deviations from D.3 and the D04 row)

Details in [publication controls](publication-controls.md).

- **"Shown" is "listed".** D.3's product rule (a studio shown only when complete: city, branding, ≥6 photos) is not applied: the D03 API shows every listed business. Only the city is required to list; branding, a description and the photo thresholds are recommendations in the readiness checklist.
- **Status from the views.** The five product statuses are derived on each read; "listed" also requires the public view to return the business.
- **Consent version.** `tenants.discovery_consent_version` and `discovery_consented_by_user_id` are new (migration `1791890000000`), beside `discovery_listed_at`; `artist_work_photos.discovery_suspension_note` records a photo takedown's reason.
- **Artist re-listing.** An owner may turn any artist's Discover switch off, but turn it back on only for a profile no login manages (or their own).
- **No setup-checklist step**, since Discover is optional; **no `ref` forwarding on `/book`** (D08, as the D03 notes say); **no Cloudflare purge** in `discover:suspend`.

### C.6 As built in D05 (deviations from the D05 row)

Details in [frontend](frontend.md).

- **Routes** follow the D05 prompt: `/explore/studios`, `/explore/artists`, `/explore/tattoos`, `/locations/:slug` (not `/studios`, `/artists`, `/places`). `/explore/studios` reads live data as the loading pattern; the other unfinished pages say they are coming and are `noindex`.
- **No named server keys yet**: server reads are anonymous (per-address limits); a key with visitor forwarding is needed before launch (D11).
- **No message catalog, `packages/ui`, JSON-LD helpers or 503 page**: the copy lives in the components, the primitives in `apps/discover`, structured data is D10, and an API failure is the route's error state. `DISCOVER_INDEXING`, robots and the sitemap stub are in.
- **Compose service** behind a `discover` profile and a separate Docker build stage, so production builds and starts nothing new before D11.

### C.7 As built in D06 (deviations from G and the D06 row)

Details in [frontend](frontend.md#homepage-d06).

- **No legal pages.** `/terms` and `/privacy` were left out of D06 by the product owner's prompt; the footer still says they are coming.
- **Homepage order** follows the D06 prompt: hero, styles, studios, artists, inspiration, places, how booking works, the Studio OS band, a closing call. No city picker in the hero (the places section does the job); the search covers studio names only, the one text search the API has.
- **Artists** include studio artists and independents (G's "Independent artists" section is broader); studios and artists use the API's `newest` order, headed "Recently listed" / "Recently added".
- **`/explore/studios`** takes `country`, `city` and `style` as plain parameters with chips (no D07 filter bar); `/explore/artists` is a live first page. Unknown styles are dropped before the API (it would 422).
- **`/pricing` stays `noindex`**: no prices exist (no billing code in the platform). `/for-studios` is indexable.
- **Token fix:** the semantic colour tokens were `@theme inline`, so `.night` never overrode them; they are a plain `@theme` now.
- **Not measured:** the D06 row's Lighthouse targets need a deployed build with real images (D10).

### C.8 As built in D06.5 (country-aware discovery; not in the original roadmap)

Details in [frontend](frontend.md#country).

- **Local-first, never restrictive.** Each page lists one country's studios, artists and photos: `?country=` (any assigned ISO code), else the `td_country` cookie, else the trusted geolocation header, else `DISCOVER_DEFAULT_COUNTRY`; cookie and header count only for `DISCOVER_MARKETS`. Country is a relevance filter only: no profile, tenant, currency, auth or residence rule depends on it.
- **No API change.** `/discover/studios`, `/artists` and `/tattoos` already took `country`; `/locations` has none and stays as it is (small reference data, filtered in the app). Styles stay global.
- **One cookie,** `td_country`, host-only, Lax, HttpOnly, a year, market codes only, set by `POST /preferences/country` (a no-JavaScript form with a same-origin redirect, or fetch).
- **Geolocation off by default.** nginx (split layout) passes Cloudflare's country as `X-Discover-Country` only from cloudflared and always overwrites it; Discover reads it only when `DISCOVER_GEO_HEADER` names it, after D11 checks Cloudflare's overwriting and the closed origin port. No third-party geolocation, GPS or analytics.
- **Caching:** HTML is now `private, no-store` with `Vary: Cookie` (it set nothing before); no edge caching of Discover's HTML until D10/D11 design a keyed strategy. **SEO:** canonicals stay path-only, explicit `?country=` pages are `noindex`, nothing redirects by country; location pages (D07/D10) are the crawlable geographic entry points.

### C.9 As built in D07 (deviations from G, H and the D07 row)

Details in [frontend](frontend.md#directories-d07).

- **No API change.** `/discover/studios` and `/artists` already took `q`, `country`, `city`, `style`, `sort` (`newest`, `name`, `-name`), `cursor` and `limit` (artists also `independent`), with keyset cursors and no totals.
- **Routes** stay under `/explore/studios` and `/explore/artists` (C.6). Style pages are `/styles/:slug`; location pages are `/locations/:country` and `/locations/:country/:city` with a country slug (`nepal`, pinned per market, else the English name slugified) instead of H's `/places/np/kathmandu`: no two-letter segments (H's i18n rule). Only configured markets have location pages; an unknown city is a 404, never a guess.
- **Paging:** "Next page" / "First page" links (and "Previous page" from the history entry) instead of a "Show more" that accumulates: each page is its own SSR address that survives reloads, sharing and back/forward. No count (the API has none).
- **Filter bar:** native selects (style, city, sort; who for artists) above the results, a sheet on mobile, a plain GET form without JavaScript. No style chips row (the select is the chip-less equivalent; active filters are chips).
- **Recent work in rows** comes from one shared photo read per filter set (48 newest), not a per-row read.
- **Profiles stay on the storefront** (`profileDestination`) until D08 flips `PROFILE_PAGES`.
- **Indexing:** bare directories, style and location pages become indexable once DISCOVER_INDEXING is on (H); any parameter, an empty hub or a 404 stays noindex. The sitemap still lists static pages only (styles and places are D10's).

### C.10 As built in D08 (deviations from E.2, G, H and the D08 row)

Details in [frontend](frontend.md#profiles-d08) and [booking hand-off](frontend.md#booking-hand-off-d08).

- **No API change.** The D03 detail reads already hold what a profile needs (a studio's artists and 12 newest photos; an artist's bio, links and 12 photos) and a signed `bookingUrl`, so each profile is one read (a studio's artist also reads the studio's artists, in parallel, optional). No tattoos or artists list is read for a profile.
- **Routes** as H: `/studios/:studioSlug`, `/studios/:studioSlug/artists/:artistSlug`, `/artists/:tenantSlug`. Old slugs and an independent's slug under `/studios/` are 301s; everything the API doesn't show is the same 404 (noindex, no metadata). `PROFILE_PAGES` is on: every list, hub and homepage link goes to the profiles; photos link to their artist's profile.
- **Booking hand-off:** "Request a session" / "Request with <artist>" (the storefront takes requests, not bookings) to the API's `bookingUrl`, accepted only on the studio's own host and `/book`, https (http on localhost), rebuilt with only `artist` (the profile's own) and `ref`; otherwise "Booking isn't available online". No `flash` or `artwork` from profiles (portfolio photos are not flash; "request similar" is D09). E.2's `/book?artist=<slug>` already existed in the storefront, so no preselection change was needed.
- **Referral** as D03 built it (not E.2's key id and `surface`): Discover carries the platform's token and never signs one. The one missing hop, the storefront's `/book` dropping `ref`, is closed: it keeps a token-shaped `ref` and sends it as `referral` (URL only, no storage; `Referrer-Policy: strict-origin-when-cross-origin`). Verified end to end on PostgreSQL (`discover_referral.spec.ts`: profile API → intake → `referral_source = 'discover'`; another studio's link records nothing).
- **Custom domains** (TAT-79) are not served by the platform, so `storefrontUrl` is always the `{tenant}` host; the hand-off accepts whatever host the API names for both links.
- **SEO:** self-canonical profiles (H: a distinct summary, never the storefront's canonical), OG image from the cover or newest work, indexable by shape when `DISCOVER_INDEXING=on`. **Deferred to D10:** JSON-LD (the D08 row) and profile sitemaps, built with D10's structured data and sitemaps.
- **Design:** editorial hero (cover or work, else type), About only with real text, a night portfolio at true proportions, work-first artist tiles, a Booking band, related links by the profile's own place; a sticky phone booking bar that rests above the footer. No reviews, ratings, counts or favourites.

### C.11 As built in D09 (deviations from G, H and the D09 row)

Details in [gallery](frontend.md#gallery-d09), [artwork pages](frontend.md#artwork-pages-d09) and [API](api.md#gallery-search-and-the-artwork-read-d09).

- **Routes** as H: the gallery is `/tattoos` (`paths.tattoos()`), and D05's `/explore/tattoos` is a 301 to it with the query kept; the nav, footer, homepage, hubs and profiles link `/tattoos`. Artwork pages are `/tattoos/:slug`, the slug being the photo's id (no title exists to make a readable one; `<readable>-<id>` and other letter cases resolve by the id and 301 to it).
- **API:** two additive changes, no migration and no index. `/discover/tattoos` takes `q` (the studios' rule; alt text, artist, business and style names, through the D02 views; counted as a search), and `/discover/tattoos/:id` answers `artistAcceptingInquiries`. The D03 detail read and its `bookingUrl` (`/book?artwork=<id>&ref=…`, which the storefront already reads as "Request a similar tattoo") were enough otherwise. No related endpoint: related work is two list reads (the artist's, the style's in the page's country), merged and de-duplicated in Discover.
- **Gallery:** D07's toolbar, sheet, chips and Next/First/Previous paging (not a "Show more"; no sort control: the API has one order), CSS-columns masonry at true proportions (first 4 eager), a debounced search (400 ms; first update of a burst pushes, the rest replace) that stays a GET form without JavaScript. One artist's or studio's work (`?artist=`, `?studio=`, from a profile's "All work" link) is global unless `?country=` is named.
- **Artwork page:** artwork first, metadata only from the answer (no size, placement, duration or price), "Request a similar tattoo" through `bookingLinks` (now also keeping the page's own `artwork`), Share / Copy link, "View full size" instead of a lightbox, related work, history-based "Back to the gallery".
- **Canonical:** self-canonical at the canonical slug, indexable by shape once `DISCOVER_INDEXING=on`, not H's launch default (a canonical to the storefront's `/gallery/:id`): the page adds related work and style and place context. D10's "artwork canonical decision" can still switch it. No artwork sitemap or structured data (D10).
- **Not measured:** the search's cost on the D02 rehearsal data (D10's performance pass).

### C.12 As built in D10 phase A (deviations from H and the D10 row)

Details in [SEO and indexing](frontend.md#seo-and-indexing) and [API](api.md#sitemap-lists-d10).

- **Robots:** one decision per page, in the root route (`pageState`, `robotsValue`), from every match: a 404, an error, any query string, a route's `staticData.noindex` or a loader's `noindex`. Indexing off: `noindex, nofollow` (meta and `X-Robots-Tag`, as before). Indexing on: H's `noindex, follow` for every page that isn't indexable (filters, searches, sorts, cursors, `?country=`, empty hubs, `/pricing`, 404s, errors), in the meta and the header alike. Pages no longer emit their own robots tag.
- **Canonicals** as H and D07–D09: `DISCOVER_URL` + the path, no query, no trailing slash but the root's; none on a 404 or an error page. **Artwork canonical decision: self-canonical** (C.11 kept): the page carries related work, style and place context the storefront's `/gallery/:id` hasn't, and is in the sitemaps.
- **International:** no hreflang (no translations exist; `og:locale` omitted too). Location pages are the country entry points, self-canonical, indexable when populated, `noindex, follow` when empty.
- **Structured data:** H's `TattooParlor`, `Person` with `worksFor`, `BreadcrumbList`; plus `WebSite` (with a `SearchAction` on `/explore/studios?q=`) and `Organization` on the home page, `ImageObject` on artwork pages. `url` is Discover's own profile (not H's storefront: the page's canonical); `sameAs` the https social links. No `ItemList` (list pages carry their breadcrumbs only). Only on indexable 200 pages.
- **Sitemaps:** H's index, but its children are `static`, `styles`, `locations`, and paged `studios`, `artists` and `tattoos` (`places.xml` is `locations.xml`; artwork pages are listed, being self-canonical), read from a new API sitemap list (identifiers only, 5,000 a page, keyset by id) instead of the 48-row lists. Cached an hour (`public, max-age=3600`). No `lastmod`: the views expose no modification time.
- **robots.txt** as before; nothing is disallowed while indexing is on (crawlers must see each page's noindex).

## D. Data model gap analysis

### D.1 Changes (conceptual; additive migrations)

| Change | Rationale |
|---|---|
| `tenants.discovery_listed boolean not null default false`, `discovery_listed_at` | Explicit opt-in; existing tenants stay unlisted |
| `tenants.discovery_suspended_at`, `discovery_suspension_note` | Platform takedown, overrides opt-in |
| `artist_work_photos.discovery_suspended_at` | Takedown of one image (e.g. a copyright complaint) without suspending the studio |
| `artists.discovery_listed boolean not null default true` | Individual opt-out; effective only while the studio is eligible |
| `places` (platform reference data, no RLS, read-only for app roles): `id`, `country_code char(2)`, `region`, `slug`, `name`, `unique (country_code, slug)`; seeded with curated Nepal cities | Country-aware, curated locations; URL slugs. Translations later in `place_names (place_id, locale, name)` |
| `tenants.place_id` (nullable) | Studio and independent location; keep free-text `address` for display. Lat/long deferred |
| `inquiries.referral_source`, `referral_surface` (nullable, frozen like other submitted fields by `inquiries_guard_update`) | Verified Discover attribution, separate from the self-reported `source_channel` |
| `RESERVED_SLUGS` + `discover`, `tattoos` | Avoid confusing `.page` subdomains |
| `pg_trgm`; GIN trigram on `lower(tenants.name)`, `lower(artists.name)`; GIN on `artists.styles`, `artist_work_photos.styles`; global `artist_work_photos (created_at desc, id desc) where not hidden`; partial `tenants (place_id) where discovery_listed and deleted_at is null and discovery_suspended_at is null` | Cross-tenant filters and search; existing indexes lead with `tenant_id` |
| Derived studio styles | From listed artists and published photos in a view, not a column |

Views: `discovery.studios`, `discovery.artists`, `discovery.artworks`, `discovery.places` (places with ≥1 eligible studio). They are read live from the authoritative tables, with no copies.

### D.2 Artist identity and affiliation

**What exists:**
- An `artists` row is one person's profile *within one tenant*. Its `id` is a stable UUIDv7, its slug is unique only per tenant, and it has no slug history.
- `user_id` optionally links the profile to a login. The same user can hold profiles in several tenants.
- An independent artist is a tenant with `type = independent` and its own artist row(s).

**MVP model:**
- **An `artists` row is an affiliation profile.** Its `id` is the stable public identifier in the API. URLs use slugs.
  - Studio artist: `/studios/:studioSlug/artists/:artistSlug`.
  - Independent artist: `/artists/:tenantSlug`. Tenant slugs are one global namespace with history.
  - Never assume a global artist slug.
- **Life events with today's data:**

  | Event | What happens |
  |---|---|
  | Works at two studios | Two affiliation profiles |
  | Moves studio | The old affiliation is hidden or deleted (its URL 404s); a new one is created in the new tenant |
  | Becomes independent | A new `independent` tenant with its own profile |

  None of this needs a conventional multi-artist studio, and Discover shows each affiliation honestly.
- **Not in the MVP:** a global person identity, linking profiles across studios, follower or social features.
- **Future, additive (not built now):**
  - A platform-owned `artist_identities` table (`id`, `handle`), referenced by `artists.identity_id`.
  - It is linked only by the person themself (a signed-in user who is linked to each profile), never inferred from `user_id`, which is private.
  - Handles come from the same global slug registry, so `/artists/:handle` can never collide with independent tenants' `/artists/:tenantSlug`.
  - With it, old affiliation URLs can redirect to the person. Artist slug history can be added then if renames become an issue.

### D.3 Publication rules

| Subject | Rule |
|---|---|
| Studio eligible (security, in the database) | `discovery_listed` and not suspended and not deleted |
| Studio shown (product, in the service) | Eligible **and** complete: `place_id` set; branding (logo or cover); a meaningful published portfolio. Proposed default: ≥6 published photos across listed artists, with ≥1 listed artist having ≥3. Constants in the `discovery` module |
| Artist shown | The studio is shown; the artist is `visible`, `discovery_listed` and not deleted; ≥3 published photos (default) |
| Artwork shown | Its artist is shown; not `hidden`; not suspended |
| Independent artist | The tenant's owner controls `discovery_listed`. With one artist row, the Studio OS UI shows a single "List me on TattooDrip" switch, and the artist-level switch is hidden. The same completeness rules apply |
| Who can change what | Studio listing, place, branding: owners (`TENANT_ROUTE_ROLES`). Artist opt-out: owners, or the linked artist on their own profile (same rule as `ArtistService.findEditable`). Suspension: operator only (`node ace discover:suspend` / `discover:restore`, no admin UI) |
| Not eligible / unpublished / suspended / deleted | Absent from lists, filters and sitemaps; its pages are a 404 (never 403/410, so they don't reveal existence). The storefront is unaffected by a Discover suspension |
| Propagation | Immediate at the API. Caches (60 s + SWR 600 s, Discover pages likewise) mean up to about 11 minutes; the suspend command can purge the Cloudflare cache when configured |
| Consent | Turning listing on records `discovery_listed_at` after the owner accepts the listing terms (the right to publish the photos, clients' consent for recognisable bodies or faces) |

---

## E. API gap analysis

### E.1 Discover API

**Reuse:**
- `GET /api/v1/styles`.
- Envelopes, `ApiException`, `publicCache()`, `PublicGateMiddleware`, server keys.
- The cursor encoding pattern.
- `ImageService` URL and variant shaping.
- `storefront_url.ts`. Add `bookingUrl(template, slug, { artist?, artwork?, flash?, ref? })` there.

**New group `/api/v1/discover`** (outside the tenant group; contract first in `openapi.yaml`):

| Operation | Path | Notes |
|---|---|---|
| `listDiscoverStudios` | `GET /discover/studios?q&place&style&type&sort&cursor&limit` | `filters` = matching places and styles |
| `getDiscoverStudio` | `GET /discover/studios/{slug}` | Summary, shown artists, ≤12 newest works, `links` (`site`, `book`, `gallery`); an old slug returns the current `slug` (Discover 301s) |
| `listDiscoverArtists` | `GET /discover/artists?q&place&style&independent&cursor&limit` | Item: `id`, `slug`, `name`, `studio { slug, name, type }`, styles, photo, place |
| `getDiscoverArtist` | `GET /discover/studios/{slug}/artists/{artist}` | An independent tenant's artist view comes from `getDiscoverStudio` with `type: independent` |
| `listDiscoverArtworks` | `GET /discover/artworks?style&place&healed&studio&cursor&limit` | Newest first |
| `getDiscoverArtwork` | `GET /discover/artworks/{id}` | `links.page` (storefront artwork page), `links.requestSimilar` |
| `listDiscoverPlaces` | `GET /discover/places` | Places with eligible studios and counts |

**Validation:**
- `q`: trimmed, NFC-normalised, 2–80 characters, no control characters.
- `place`: `country/city` slugs, shape-checked, then looked up.
- `style`: from `STYLE_SLUGS`.
- `sort`: an enum.
- `limit`: 1–48.
- `cursor`: opaque, length- and shape-checked.
- Malformed input is `validation_failed` (422); an unknown place or style is an empty page (matching the work filters' behaviour). Pages of things that don't exist or aren't shown are 404.

**Limits:**
- `apiLimit({ name: "discoverReads" })` per caller.
- A stricter `discoverSearch` limit when `q` is present.
- The existing gate counts every call.
- Discover SSR uses its own server key: generalise `STOREFRONT_SERVER_KEYS` to named keys.

**Caching and execution:**
- `publicCache()` on every read.
- Requests run in a read-only transaction without tenant or user context.

**Responses:** schemas with `additionalProperties: false`; every string is plain text.

**SDK / React:**
- `createDiscoverClient({ baseUrl, key?, fetch?, timeoutMs? })` in `packages/sdk`, sharing the request, error, timeout and browser-key internals. `createTattooClient` stays one-tenant.
- `discoverKeys` (`["tattoo-drip","discover",…]`), `discoverQueries` and `useDiscover*` in `packages/react`.
- D03 chooses between a `DiscoverProvider` and generalising `TattooProvider`, by the smaller diff.

**Studio OS:**
- Settings routes for listing, each with a `TENANT_ROUTE_ROLES` entry and cross-tenant tests.
- An artist-form field.
- Preview via the Discover API.

### E.2 Booking hand-off and attribution

- **One booking system.** Discover links to storefront routes only:
  - `/book?artist=<slug>`
  - `/book?artwork=<id>&artist=<slug>`
  - `/book?flash=<id>`
  - `/artists/<slug>`, `/gallery/<id>`
- **Signed referral.**
  - The platform builds every booking link in Discover API responses with `ref=<token>`.
  - The token is HMAC-SHA256 (with a key id, for rotation) over `{ src: "discover", surface: "studio"|"artist"|"artwork", tenant, iat }`. The key is a platform-only secret; Discover never holds it.
  - The storefront `/book` keeps `ref` (today it drops unknown params) and sends it with `inquiries.create`.
  - The platform verifies the signature, the tenant match and its age (≤30 days, which tolerates cached pages and shared links). Only then does it record `referral_source = discover` and `referral_surface`. Anything else is stored as null; it is never rejected, so it never blocks a booking.
  - The token holds no personal data, sets no cookie and does no cross-site tracking.
  - It proves only "arrived through a link TattooDrip generated". It is labelled as such in Studio OS and is not used for billing or commissions.
  - The customer's self-reported `source_channel` stays separate.
- **Analytics (first-party):**
  - Inquiry referral counts per studio, which `metrics:pilot` and future Studio OS analytics can read.
  - Aggregate page and search counts from nginx/Cloudflare logs.
  - No third-party scripts, no per-visitor identifiers in the MVP.

---

## F. Search strategy

**MVP: PostgreSQL only.**

| Concern | Approach |
|---|---|
| Name search | `pg_trgm` GIN on `lower(name)`; match by `%`/`ilike`, rank by `similarity()` |
| Full-text | Optional over intro and bio with the `simple` config (no Nepali stemmer); only if trigram on names proves insufficient |
| Filters | `place_id =`, `styles && array[…]` (GIN), `type`, `healed` |
| Facets | `filters` lists the places and styles with ≥1 match; counts optional |
| Sorting (deterministic) | Browse: `newest` → `(listed_at or created_at desc, id desc)`; `name` → `(lower(name), id)`; both keyset-paginated. Relevance (`q` only): `(similarity desc, lower(name), id)`, offset inside an opaque cursor, capped at 10 pages |
| No fake signals | No popularity, rating or "trending" ordering in the MVP |
| Performance gate (D02/D03) | Seed 500 studios, 2,000 artists and 50,000 artworks; `EXPLAIN ANALYZE`; DB p95 < 100 ms per list call. If the derived-styles predicate is slow, add an indexed materialized view refreshed by a job: the first sanctioned denormalisation |
| Mixed scripts | Seed Devanagari and Latin names; verify trigram behaviour in D02 |

**A search engine becomes worthwhile when:**
- Thousands of studios span several countries.
- Transliteration or typo-tolerant instant search, geo-radius ranking or personalisation is needed.
- p95 stays over budget after indexing.

It would then be fed from the discovery views, which stay authoritative.

---

## G. UI/UX blueprint

**Identity ("editorial ink"):**
- Near-black immersive surfaces for imagery and warm paper surfaces for reading.
- TattooDrip red (`#c62835`; `#f0646e` text on dark) only for primary actions, the active nav marker and focus.
- Eczar display (Devanagari-capable) with Geist UI and body.
- Hairline borders, 4–8 px radius, no shadows, glass or decorative gradients (one image scrim at most).
- 150–200 ms motion that respects reduced motion.
- WCAG 2.1 AA; 44 px touch targets.

**Navigation:**
- Header: wordmark, then Tattoos · Artists · Studios, then a prominent search (a full-screen sheet on mobile), then "For studios" and "Sign in" (to `app.`).
- Footer: cities, styles, for studios, pricing, terms, privacy.

**Homepage (discovery first; marketing is one band, not the page):**
1. Hero: search (style, artist or studio) and a city picker over a mosaic of real recent work.
2. Styles rail (real photos).
3. Cities.
4. Fresh work (masonry).
5. Studios: an editorial list rows ordered by recently listed; no "featured" or paid placement.
6. Independent artists.
7. How booking works (request, quote and deposit, session; on the studio's own site).
8. A Studio OS band linking to `/for-studios`.
9. Footer.

Every section hides itself when it has too little real data. A Discover with 3 studios must still look intentional.

**Page patterns:**

| Pattern | Design |
|---|---|
| Directories | Count, a URL-synced filter bar (style chips, city, sort), a filters sheet on mobile, list rows with a strip of recent work (not uniform cards), SSR first page + cursor "Show more", skeleton loading matching the final layout, helpful empty states |
| Gallery | Masonry with true aspect ratios (zero CLS); detail is its own URL |
| Studio profile | Cover, logo, name, city, styles, open-now (client side); **Request a tattoo** and **Visit studio site**; artists; ≤12 works linking to the full gallery on the storefront; address text with a maps link (no embeds) |
| Artist profile | Portrait, affiliation ("at {studio}" or "Independent · {city}"), styles, bio excerpt, works, booking CTA |
| Artwork | Large image, artist, studio, styles, healed; **Request something similar**; more by the artist, more in the style |
| Marketing | `/for-studios`, `/pricing` (informational; no checkout; "billing coming" wording only if true), `/terms`, `/privacy` |

**Mobile:**
- Single column, 2-column masonry.
- A sticky bottom booking CTA on profiles.
- 320/640 variants; first image eager, the rest lazy.

**Branding:**
- Shared wordmark, red and Geist with Studio OS, but no dashboard layouts (no sidebars, stat cards or tables).
- Studio themes stay on storefronts.

---

## H. SEO and routing strategy

| Route | Purpose | Indexing |
|---|---|---|
| `/` | Discover home | yes (when launch flag on) |
| `/tattoos`, `/artists`, `/studios` | Directories | page 1, unfiltered |
| `/studios/:slug` | Studio profile (an independent tenant 301s to `/artists/:slug`) | yes |
| `/studios/:slug/artists/:artist` | Studio-affiliated artist | yes |
| `/artists/:slug` | Independent artist (tenant slug) | yes |
| `/tattoos/:id` | Artwork detail | see the canonical rule |
| `/styles`, `/styles/:style` | Style hubs | yes |
| `/places/:country/:city` | City hubs (`/places/np/kathmandu`) | yes |
| `/for-studios`, `/pricing`, `/terms`, `/privacy` | Marketing and legal | yes |
| `/sitemap.xml` (index), `/robots.txt` | Crawl | — |

- **Changes from the original proposal:**
  - `/explore/*` is dropped.
  - `/auth/*` is replaced by links to `app.tattoodrip.app`.
  - Studio artists are nested, because slugs are per tenant.
  - No 2-letter top-level segments, which keeps `/{locale}/…` free for i18n later.
- **Canonicals:**
  - Profiles and hubs are self-canonical. They are distinct pages (location, styles, comparison context, ≤12 works, intro excerpt) and never re-host the full gallery, FAQ, policies or flash.
  - **Artwork detail rule:** if the page is substantially the storefront's (the same image and caption with little else), it sets `rel=canonical` to the storefront `/gallery/:id` and stays out of Discover's sitemap. That is the default at launch.
  - Once Discover adds substantial unique context (style and location hub context, related work), D10 may switch it to self-canonical by an explicit decision.
  - Filtered, sorted or paged URLs are `noindex, follow` with a canonical to the hub.
- **Structured data:**
  - `TattooParlor` (`url` = the storefront, `sameAs` = the socials).
  - `Person` with `worksFor`.
  - `BreadcrumbList`, `ItemList`.
  - No `AggregateRating` or reviews (none exist; none are invented).
- **Sitemaps:** an index of `studios.xml`, `artists.xml`, `places.xml`, `styles.xml` and static pages, from paged API reads, cached 1 h.
- **Launch control:**
  - `DISCOVER_INDEXING=off|on` (an environment flag, not a count) sends `noindex` and a disallowing `robots.txt` until the business decides to launch.
  - The pages work either way.
- **i18n readiness:**
  - All copy goes through a message catalog from D05 (English only).
  - `lang`, `og:locale` and hreflang come from one locale setting.
  - Place names are translatable through `place_names`.
- **Performance budgets:**
  - SSR with `s-maxage=60, stale-while-revalidate=600`, keyed by Host.
  - srcset from existing variants.
  - LCP < 2.5 s on 4G, CLS < 0.05, ≤150 kB gzipped JS on content pages.

---

## I. Implementation prompts

Prompts are prefixed **D** to avoid confusion with the Studio OS redesign prompts. Each prompt follows the house workflow:
- Contract first.
- Narrow checks, then the relevant gates.
- Isolation tests for tenant data.
- Regenerated files committed.
- Stop at the end; never start the next prompt.

| # | Objective | Major tasks | Depends on | Acceptance criteria |
|---|---|---|---|---|
| **D01** | Domain architecture and migration preparation (no live DNS or traffic change) | Inventory every host assumption (`APP_URL` consumers, `checkAppOrigin`, cookie policy, Shield/CSRF, CORS, email and chat links, `config/drive.ts`, storefront `API_URL`, `MEDIA_URL`, Turnstile hostnames, nginx, cloudflared); nginx server blocks for `app.` (dashboard; the platform still answers `/api` there, unused) and `api.` (`/api` only), apex legacy redirect map and `/api` proxy window prepared but inactive; env examples; a local/staging rehearsal with the new hostnames; cutover and rollback runbook draft; fix stale host and Vercel docs | Approved | All suites pass; a local rehearsal on new hosts covers login, CSRF writes, invitations, password reset, storefront SSR, browser intake and deposit upload, and old-URL redirects; production config unchanged and still valid |
| **D02** | Discovery database foundation | Migrations (D.1), `tattoo_drip_discovery` role in `setup_roles.sql` and the runbook, views, column grants, `TO`-scoped policies, `pg_trgm` + indexes, `places` seed, catalog guard + privilege/RLS tests (C.2), visibility parity test, volume seeder + EXPLAIN, DB README update | D01 not required | Every C.2 verification passes; app-role privileges unchanged; DB p95 budget met on seeded data |
| **D03** | Public Discover API, SDK client, React hooks | Contract; `app/modules/discovery`; controllers and transformers; validation; limits; named server keys; read-only transaction; `bookingUrl` + signed `ref`; isolation cases; `createDiscoverClient`; keys, queries, hooks; tests | D02 | Responses match the contract; no private field reachable; cursor ordering deterministic; limits enforced; SDK and React tests green |
| **D04** | Studio OS publication controls | Settings "TattooDrip listing" (opt-in + terms consent, place picker, completeness checklist from the API, preview); artist opt-out (owner or linked artist); independent single switch; setup-checklist item; `discover:suspend` / `discover:restore` (studio, artwork); storefront `/book` keeps `ref`, the intake stores verified referral | D03 | Off by default; changes reflected immediately in the API; role and cross-tenant tests; forged, expired or other-tenant `ref` stored as null without blocking the inquiry |
| **D05** | Discover app scaffold and premium design system | `apps/discover` (TanStack Start, Tailwind v4, tokens, Eczar/Geist, message catalog); env validation; per-request client; layout, nav, footer; SEO and JSON-LD helpers; robots and sitemap skeleton; `DISCOVER_INDEXING`; 404/503; loading and empty-state primitives; Dockerfile target, compose service and nginx block (inactive); CI; browser-bundle secret check; minimal `packages/ui`; `apps/discover/AGENTS.md` | D03 | Builds, typechecks and tests in CI; SSR heads correct; no secret in the client bundle |
| **D06** | Homepage and SaaS marketing | Home IA (G) with real data and graceful small-data states; `/for-studios`; `/pricing` (informational); `/terms`, `/privacy` (Claude drafts them, marked as drafts, from product requirements; published only after review) | D05 | Mobile Lighthouse ≥ 90 performance and accessibility; renders well with 0, 3 and 20 studios; no fabricated numbers |
| **D07** | Studio and artist directories; style and location pages | Shared list and filter pattern; `/studios`, `/artists`; `/styles/:style`; `/places/:country/:city`; URL-synced filters; cursor "Show more" | D05 | Filters round-trip via URL; noindex and canonical rules (H); keyboard-operable filters |
| **D08** | Public profiles and storefront booking hand-off | Studio, studio-artist and independent-artist profiles; old-slug 301s; JSON-LD; booking CTAs with signed `ref` | D07, D04 | Every CTA lands on a working storefront page; a Discover-originated inquiry records `referral_source = discover` |
| **D09** | Tattoo gallery and artwork details | `/tattoos` masonry and filters; `/tattoos/:id` with the canonical rule; "request similar"; related work | D07 | Zero CLS; lazy-loading verified; canonical per H |
| **D10** | SEO, accessibility, performance | Sitemap index, structured-data validation, OG images, budgets, WCAG 2.1 AA audit, reduced motion; artwork canonical decision | D06–D09 | Rich-results validation passes; budgets met; axe clean |
| **D11** | E2E QA, production domain cutover, launch readiness | Playwright journeys (search, filter, profile, booking hand-off, delist, suspend); load test; staged cutover per the runbook: add `app.` / `api.` hostnames, then storefront `API_URL`, then `APP_URL`, then deploy Discover and switch the apex with legacy redirects and the `/api` proxy; smoke tests; monitoring; rollback (restore the old apex server block and envs); indexing flag left to the business decision | D01–D10 | Journeys green; smoke tests pass on new hosts; old links redirect; rollback rehearsed; the sign-in impact matches the runbook |

**D01 verification checklist** (each item is recorded with evidence: a file reference, a test or a rehearsal result):

| Area | What to verify |
|---|---|
| Cookies | `__Host-td-session`, `XSRF-TOKEN` and `app_theme` on `app.` (`remember_web` is only ever cleared): host-only, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` (`#services/cookie_policy`); none of them set on `api.` or the apex |
| CSRF | Shield accepts dashboard writes on `app.` and refuses cross-origin ones; Inertia's `X-XSRF-TOKEN` round trip; the API group stays CSRF-free and cookieless |
| OAuth redirects | None exist today (email + password; no `@adonisjs/ally`). Confirm that, and record that any future OAuth callback registers on `app.` |
| API origins | Storefront `API_URL` (server) and the dehydrated browser `apiUrl`; Discover's API base; CORS on `api.`: an allowlist of the studio pages, `APP_URL` and `DISCOVER_URL`, `Vary: Origin`, never credentials, the existing headers; `MEDIA_URL` unchanged; any CSP `connect-src` |
| `APP_URL` consumers | `checkAppOrigin` with the new hosts; email, invitation, alert and chat links; `config/drive.ts` |
| Cloudflare and proxy | Tunnel public hostnames for `app.` and `api.` (prepared, not created); Always Use HTTPS; the edge certificate covers them; cache keyed by Host, with no caching of dashboard responses; `CF-Connecting-IP` → `X-Forwarded-For` trust (`TRUST_PROXY`, nginx `set_real_ip_from`); Turnstile hostnames unchanged (`tattoodrip.page`) |
| Redirect compatibility | Apex legacy paths 301 to `app.`; `/api/*` proxied, not redirected, on the apex during the window |
| Rollback | Restoring the previous nginx include and env values returns today's behaviour: the live layout is `nginx.conf` unchanged, checked by the nginx harness; a rollback on a real stack is part of the D11 production-mode rehearsal |

**Sessions at cutover:**
- `__Host-td-session` is host-only and production sessions live in the cookie, so a session cannot move from `tattoodrip.app` to `app.tattoodrip.app` without handing credentials across hosts.
- A single-use, short-lived handoff token is technically possible, but it adds a credential-transfer endpoint.
- Default: one planned sign-in, announced in the dashboard beforehand, at a low-traffic time.
- A handoff is built only if the product owner wants it, with a security review.
- A shared `Domain=tattoodrip.app` cookie is rejected: it would expose sessions to Discover and every subdomain.

---

## J. Launch strategy, risks and open questions

**Launch strategy:**
- Build now. Discover may be deployed, dark or unpromoted, once D11 cuts over.
- Promotion and `DISCOVER_INDEXING=on` are business decisions, made at about 15–20 eligible studios whose listings are verified.
- No technical rule depends on a studio count.
- No fake listings, reviews, popularity, statistics or "featured" placements.
- No paid listings in the MVP.
- Before launch, update `docs/roadmap.md` and `docs/requirements.md`: Discover replaces the "Marketplace: not yet" stance.

**Risks:**

| Risk | Mitigation |
|---|---|
| The new cross-tenant path widens the security model | Three-layer boundary (C.2), catalog and privilege tests, `TO`-scoped policies that leave app-role isolation unchanged, a security review at D02 |
| RLS policy recursion or performance with nested `exists` | Acyclic policies; EXPLAIN on seeded data; indexes on predicate columns |
| Visibility drift between storefront and Discover | A parity test on shared fixtures |
| Referral forgery or privacy | HMAC token minted and verified only by the platform; null on failure; no personal data; not used for money |
| Domain cutover breaks links or sessions | D01 rehearsal, staged D11 cutover, redirect and proxy window (≥30 days: invitations live 7 d), rollback plan |
| Cold start | Sections hide without data; small-data designs; promotion gated by the business target |
| Stale caches after delisting or takedown | Documented ~11-minute worst case; optional Cloudflare purge in `discover:suspend` |
| Mixed-script search quality | Seeded tests; documented upgrade path |
| Managed Postgres limits (extensions, role creation, `ALTER … OWNER`) | Checked in D02 against the provider, as was done for `btree_gist` |
| Doc drift | Fix `docs/architecture.md` (Vercel, hosts, Portfolio as V1) and `docs/data-model.md` (FlashDesign as V1) in D01/D02 |

**Open questions (defaults apply if unanswered):**
1. **Completeness thresholds.** Default: ≥6 published photos per studio, ≥3 per shown artist, plus a logo or cover and a city.
2. **The curated Nepal city list.** Default: seeded from current pilot studios plus the major cities; the operator adds more on request.
3. **Session handoff at cutover.** Default: none, one announced sign-in.
4. **Legal texts and listing consent wording.** The product owner provides requirements. Claude prepares draft terms, privacy and consent text, each marked "Draft: not legally reviewed". The wording is reviewed before D04 and D06 make it public; until then drafts ship behind the indexing flag or stay unpublished.
5. **Referral token lifetime.** Default: 30 days.
