# TattooDrip Discover: implementation blueprint

Prompt 00 output (2026-11-06). It covers the repository audit, the architecture decision and the prompt roadmap. Nothing here is implemented. This file is the plan Discover prompts work from. The dated `docs/superpowers/specs/` files are per-feature history, and this is a multi-prompt plan, so it lives at the requested path. Each Discover prompt still writes its own dated spec and plan there, as usual.

Status legend: **Done** = in code, with tests where noted. **Partial** = exists, but not in the form Discover needs. **Planned** = only in docs. **Missing** = searched for and absent. **Unverified** = not checked against a running system.

---

## A. Executive summary

- **Today:**
  - The repo is a pnpm monorepo with one AdonisJS 7 modular monolith (`apps/platform`). It owns all data and serves the Studio OS dashboard (Inertia + React, SSR **disabled**), the public REST API `/api/v1` and a queue worker.
  - A TanStack Start storefront (`apps/storefront`) serves `*.tattoodrip.page`.
  - `packages/{types,sdk,react}` hold the OpenAPI contract, the client and the hooks.
  - Production runs on one self-hosted server: Docker Compose + nginx behind a Cloudflare Tunnel (`deploy/`). **`tattoodrip.app` is already the dashboard *and* API host.**
- **The constraint that shapes everything:**
  - Every public read is single-tenant. PostgreSQL row-level security scopes the app role to one `app.tenant_id` per transaction.
  - The SDK client is bound to one tenant.
  - The storefront resolves one studio per request before any route runs.
  - Discover is the first feature that must read *across* tenants.
- **Recommendation:**
  1. **New app `apps/discover` (TanStack Start, SSR) on the apex `tattoodrip.app`.**
  2. **Move the dashboard to `app.tattoodrip.app` and the API to `api.tattoodrip.app`.**
  3. **Give the API a small, explicit cross-tenant read surface.** These are owner-owned `security_barrier` views in a `discovery` schema. They expose only whitelisted public columns of opted-in, live, visible rows. A new platform `discovery` module serves them under `/api/v1/discover/*`.
  4. **Add a separate `createDiscoverClient` to the SDK, plus `discover*` hooks.**
  5. **Use PostgreSQL search (pg_trgm + GIN arrays) for the MVP, with no external search engine.**
  6. **Discover profiles summarise and link out.** Booking stays on the storefront (`/book?artist=…`, `?artwork=…`, `?flash=…`), and the storefront keeps canonical ownership of full studio content.
- **Product tension to resolve first:** the current docs defer this direction. `docs/requirements.md` lists "Marketplace" under "Not yet"; `docs/roadmap.md` lists it under "Later, maybe never". `docs/research.md` says discovery needs "hundreds of active studio pages" first. See [J](#j-architectural-risks-and-decisions).

---

## B. Existing architecture inventory

### Workspace

| Area | What it is | Status | Evidence |
|---|---|---|---|
| Tooling | pnpm 12.8.1 workspaces, Node 24.3.0, TypeScript 6, Biome 2.4, husky + commitlint | Done | `package.json`, `pnpm-workspace.yaml`, `.nvmrc` |
| Root scripts | `dev`, `build`, `typecheck`, `test`, `check` (all recursive) | Done | `package.json` |
| `apps/platform` | AdonisJS 7, Lucid/Postgres 18, VineJS, session auth, Tuyau, Japa. Inertia SSR off | Done | `adonisrc.ts`, `config/inertia.ts` (`ssr.enabled: false`) |
| `apps/storefront` | TanStack Start/Router/Query/Form, React 19, Tailwind v4, shadcn (new-york) | Done | `apps/storefront/src/**` |
| `packages/types` | `openapi.yaml` and generated `openapi.gen.ts` | Done | CI checks that the generated file does not drift |
| `packages/sdk` | `createTattooClient({ baseUrl, tenant, key?, fetch?, timeoutMs? })`, `TattooApiError` | Done | `packages/sdk/src/client.ts`, `errors.ts` |
| `packages/react` | `TattooProvider`, `tattooQueries`, `tattooKeys`, hooks | Done | `packages/react/src/{provider,queries,hooks}.tsx?` |
| `packages/ui` | Shared UI | Missing (docs: "added when the first component is actually shared") | `docs/architecture.md` |
| CI | One job: Biome, typecheck, types drift, build, migrate, schema drift, tests | Done | `.github/workflows/ci.yml` |
| Deploy | Compose: `postgres`, `web`, `worker`, `storefront`, `nginx`, `cloudflared`. nginx routes `tattoodrip.app` to web and `tattoodrip.page` / `*.tattoodrip.page` to storefront. Media on `media.tattoodrip.app` (R2) | Done | `deploy/compose.yml`, `deploy/nginx/nginx.conf`, `deploy/README.md` |
| Vercel | `apps/storefront/vercel.json` and a row in `docs/architecture.md` | Stale: replaced by the single-server deploy | `docs/superpowers/specs/2026-10-31-single-server-deploy-design.md` |

**How the parts communicate:**
- The storefront server calls `API_URL/api/v1/tenants/<slug>/…` through the SDK. It sends `STOREFRONT_SERVER_KEY` (rate limiting only) and `X-Visitor-IP`.
- The browser calls the API directly for inquiries and deposits (CORS `*`, no credentials).
- The dashboard is Inertia over session cookies (`__Host-td-session`, host-only).
- Nothing else talks to the database.

### Backend (apps/platform)

| Capability | Status | Evidence / notes |
|---|---|---|
| Modules | Done | `app/modules/{artists,clients,flash,identity,inquiries,media,notifications,payments,projects,references,reports,scheduling,storefront,studio_content,tenancy}`. Controllers and transformers stay flat in `app/controllers`, `app/transformers` |
| Routes | Done | `start/routes.ts`: guest auth pages; `/t/:tenant/*` (auth + dbContext + tenant + role, `TENANT_ROUTE_ROLES`); account pages; `/api/v1` (`publicApi`) with platform-wide `/styles` and a tenant group `/tenants/:tenant/{,artists,artists/:artist,work,work/:photo,flash,flash/:design,inquiries,deposits/:token}` |
| Public vs authenticated | Done | The API is stateless and cookieless; `auth`/`tenant`/`dbContext` must never be added to API routes (`docs/backend.md`, Public API) |
| Tenant resolution (API) | Done | `PublicTenantMiddleware`: `STORED_SLUG` shape check, then `tenant_for_slug()` SECURITY DEFINER, then one transaction with `app.tenant_id` set. Old slugs work for reads only |
| RLS | Done | `database/helpers/tenant_rls.ts`, `tenant_isolation` policy on every tenant-owned table. `tenants_select` allows only the current tenant or the user's memberships. Three SECURITY DEFINER functions are the only cross-tenant paths (`database/README.md`) |
| Responses and errors | Done | `{ data }` / `{ error: { code, message, fields? } }`, `ApiException`, `API_ERRORS` (`app/services/public_api.ts`) |
| Pagination | Done | Keyset cursor `(created_at, id)`, base64url, 24 a page by default and 48 at most, `{ data, nextCursor, filters }` (`app/modules/artists/work_cursor.ts`, `WorkPhotoService.page`) |
| Caching | Done | `middleware.publicCache()`: `public, max-age=60, stale-while-revalidate=600` + ETag. Everything else is `no-store` |
| Rate limits | Done | `PublicGateMiddleware` per caller, `apiLimit({ name: "tenantReads" })` per studio, server keys `STOREFRONT_SERVER_KEYS` (`app/services/server_keys.ts`, `api_limits.ts`) |
| Isolation tests | Done | `tests/isolation/public_cases.ts`: every `/api` tenant route needs a case |
| Public link builders | Done | `app/services/storefront_url.ts`: `studioPageUrl`, `artistPageUrl`, `galleryPageUrl`, `artworkPageUrl`, the only place links are built |
| Images | Done | `ImageService` purposes (`artist_photo`, `artist_work_photo`, `studio_cover`, `studio_logo`, `studio_icon`, `flash_design` are public). Keys are `tenants/<id>/<purpose>/…`. Variants at 320/640/1280 are made in the request |
| Search extensions (`pg_trgm`, `unaccent`, FTS) | Missing | No migration mentions them |
| Billing / subscriptions | Missing | No code; `/pricing` would be marketing copy only |
| Platform admin / moderation | Missing | The only operator tool is the `metrics:pilot` ace command |
| Marketing / landing page | Missing | `/` redirects to `/dashboard` or `/login` ("TAT-100: there is no landing page") |

### Studio OS data relevant to Discover

| Need | Status | Where |
|---|---|---|
| Studio vs independent artist | Done | `tenants.type` enum `studio`/`independent`, chosen at onboarding (`inertia/pages/onboarding/create_tenant.tsx`) |
| Studio name, slug, intro, cover, logo, social links, contact, timezone | Done | `tenants` columns (`database/schema.ts` `TenantSchema`); settings pages `profile`, `look` |
| Slug history and redirects | Done | `tenant_slugs` (one platform namespace; old slugs redirect) |
| Structured location (country / region / city / coordinates) | **Missing** | `tenants.address` is one free-text `varchar(300)`; `Contact.address` in the contract is a string |
| Whole-studio publish or discovery switch | **Missing** | Every live tenant's storefront is public; there is no tenant-level visibility column |
| Artists: name, slug, bio, photo, `visible`, accepting inquiries and flash, `styles[]` (≤5), social links, optional `user_id` | Done | `artists` (+ `1791700000000_add_styles_and_social_links_to_artists.ts`) |
| Artist slug global uniqueness | **No**: unique per tenant (`artists_tenant_slug_live_unique`) | Needed for Discover URLs |
| One person across tenants | Partial | One `User`, one `Artist` row per tenant; no global artist identity (`docs/data-model.md`) |
| Portfolio: work photos with `alt`, `styles[]` (≤3), `healed`, `hidden` (publish), newest first, ≤100 per artist | Done | `artist_work_photos`; Portfolio workspace with bulk publish/unpublish/move (`inertia/pages/portfolio/index.tsx`, `tenant.portfolio.bulk`) |
| Style taxonomy | Done (code list) | `app/modules/artists/styles.ts`: 18 fixed styles; `GET /api/v1/styles` |
| Studio specialties | Derivable | Union of visible artists' and published photos' styles; no column needed |
| Flash designs | Done | `flash_designs`, public flash reads (docs list FlashDesign as V1 entity; stale) |
| Booking | Done (request-first) | Storefront `/book` with `?artist=`, `?flash=`, `?artwork=`; inquiry → quote → deposit. Instant slots are V1 (contract operations tagged `V1`, no routes) |
| Inquiry source | Done | `SOURCE_CHANNELS = instagram, facebook, tiktok, google, friend, other` (`app/modules/inquiries/models/inquiry.ts`); no TattooDrip/Discover channel, no referral param |
| Reserved slugs | Done | `RESERVED_SLUGS` has `explore`, `studios`, `artists`, `search`; **not** `discover` or `tattoos` |

### Storefront (apps/storefront)

| Capability | Status | Evidence |
|---|---|---|
| Routes | Done | `/`, `/artists`, `/artists/:slug`, `/gallery`, `/gallery/:photo`, `/flash`, `/flash/:id`, `/book`, `/deposit`, `/about`, `/services`, `/faq`, `/contact`, `/policies`, `/aftercare`, `/sitemap.xml`, `/robots.txt`; 301s from `/work` and `/request` |
| Host → tenant | Done | `src/tenancy/host.ts` (`landing` / `tenant` / `none` / `foreign`), `src/tenancy/handle.ts`. Apex and `www` serve a static landing at `/` and 404 elsewhere; old slugs 302 |
| Custom domains (TAT-79) | Planned | `foreign` branch placeholder only |
| Themes | Done | `stencil-and-ink` (default) and **`ink-noir`** (`src/studio/theme/{config,registry}.tsx`, `ink-noir/`); accent, font, logo, hero, section order |
| Data | Done | A per-request SDK client and QueryClient (`src/api/context.ts`); loaders use `tattooQueries` with `staleTime: "static"`; page `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600` |
| SEO | Done | `src/studio/seo.ts`: title, description, OG, Twitter, absolute canonical on the studio origin; `TattooParlor` JSON-LD on home only; per-studio sitemap and robots; noindex on 404s and the deposit page |
| Images | Done | `readSrcSet` (`src/studio/srcset.ts`) from API variants; lazy grids, eager hero |
| Not reusable for Discover as-is | — | The middleware, router context, root loader, `SiteRef`, root head and theme `<html>` all assume exactly one studio |

### SDK

| Capability | Status |
|---|---|
| One tenant per client, `tenantRoot` computed eagerly | Done |
| Platform-wide methods `styles.list` (and V1 `placements.list`) on `apiRoot` | Done; this is the precedent for non-tenant resources |
| React keys `["tattoo-drip","tenant",tenant,…]`; non-tenant `["tattoo-drip","styles"]`; `baseUrl` not in keys | Done |
| Discover, directory or search resources | Missing |

---

## C. Architecture recommendation

### Options

| | A. New `apps/discover` (TanStack Start) | B. Extend `apps/storefront` | C. Inertia pages in `apps/platform` |
|---|---|---|---|
| Separation | Clean: no tenant context | Every root concern gets a "no studio" branch; a tenant-leak risk in shared context | Mixes the public crawler surface with the cookie/session app |
| SEO / SSR | Full SSR, own origin | Full SSR, but on `tattoodrip.page` (the studio domain) | Inertia SSR is off; enabling it affects the whole dashboard |
| Shared UI | Storefront patterns copied or extracted to `packages/ui` | Direct reuse | Studio OS components (wrong look for a public site) |
| SDK fit | New `createDiscoverClient` | Needs a tenant-optional client anyway | Calls services directly, so Discover would bypass the API (against "studio page = external storefront") |
| Deploy | +1 container, nginx server block, Docker target | None new | None new |
| Domain | `tattoodrip.app` apex (needs the dashboard move) | `tattoodrip.page` apex, or path carve-outs | `tattoodrip.app`, but colliding with `/login`, `/t/*`… |
| Effort | Medium (scaffold) | Medium-high (risky refactor of tenancy core) | Low to start, high to make it a good public site |
| Scalability | Independent caching, scaling, release cadence | Couples Discover releases to every studio page | Couples it to the dashboard |

**Recommendation: Option A.** Option B is the "no new app" instinct, but the storefront's tenant-per-request design is a deliberate security property (`src/tenancy/*`). Bolting a tenantless mode onto it costs about as much as a scaffold and weakens that property. Option C loses SSR and puts anonymous crawler traffic on the session host.

### Shape

```text
browser ─► tattoodrip.app            apps/discover (TanStack Start SSR, no auth, no DB)
                │ createDiscoverClient (server key + X-Visitor-IP on SSR)
                ▼
           api.tattoodrip.app/api/v1/discover/*   platform: discovery module
                │ reads discovery.* views (cross-tenant, public columns only)
                ▼
           PostgreSQL (tenants, artists, artist_work_photos remain the source of truth)

Discover profile ─► https://<slug>.tattoodrip.page/book?artist=…  (storefront booking, unchanged)
"For studios" / "Sign in" ─► app.tattoodrip.app/signup | /login  (Studio OS, unchanged)
```

- **Domains.**
  - Discover takes the apex `tattoodrip.app` (and `www` → apex 301).
  - The dashboard moves to `app.tattoodrip.app` (`APP_URL`). The API moves to `api.tattoodrip.app` (storefront and Discover `API_URL`). Both are served by the same `web` container through two nginx `server_name`s.
  - Keep apex redirects for legacy dashboard paths for at least 30 days: `/login`, `/signup`, `/dashboard`, `/onboarding`, `/account`, `/t/*`, `/verify-email*`, `/confirm-email`, `/forgot-password*`, `/reset-password*`, `/invitations*`. Invitation links live 7 days, verification 24 h, resets 60 min.
  - Keep `/api/v1/*` *proxied*, not redirected, on the apex for the same window: multipart POSTs and CORS don't follow redirects well.
  - `__Host-td-session` is host-only, so the move signs everyone out once.
  - The `checkAppOrigin` rule (APP_URL not on, under or above `tattoodrip.page`) still holds.
  - Turnstile stays on `tattoodrip.page`; Discover has no forms in the MVP.
- **No auth in Discover.** "Register as studio / artist" links to `app.tattoodrip.app/signup`; onboarding already asks studio vs independent. Discover sets no cookies and renders tenant text as text, as the storefront rules require.
- **Shared code.** Discover owns its own design tokens; the storefront already accepts token copies. Extract `packages/ui` only for what both apps actually use: a responsive image primitive with srcset from `variants`, and the JSON-LD serializer. That fits the architecture doc's "first component actually shared" trigger. Do not move storefront themes.
- **Storefront integration.**
  - Discover never re-hosts booking.
  - Deep links come from the API, built by `storefront_url.ts` (the one link builder). Add a `bookingUrl(template, slug, { artist?, artwork?, flash? })` helper there.
  - Add an attribution parameter (for example `?via=tattoodrip`) that the storefront maps to a new `tattoodrip` source channel. This gives measurable evidence of Discover's value for the roadmap gates.

### Cross-tenant data access (the core backend decision)

| Approach | Verdict |
|---|---|
| Permissive RLS `SELECT` policies keyed by a new `app.discovery` setting | Rejected: whole rows (deposit %, `user_id`, private texts) become reachable to any code that sets the flag; easy to misuse from existing services |
| SECURITY DEFINER functions returning ids, then per-tenant hydration | Rejected: N tenant transactions per page; the house rule "returns ids only" makes listing impractical |
| Denormalised `discovery_*` tables kept in sync by services or triggers | Deferred: duplicates authoritative data and adds sync bugs. Revisit only if view performance fails (see [F](#f-search-strategy)) |
| **Owner-owned `security_barrier` views in a `discovery` schema; the app role gets `USAGE` on the schema and `SELECT` on the views only** | **Recommended.** Live data with no duplication. The column whitelist and the eligibility predicate live in one SQL place. A non-`security_invoker` view runs with its owner's rights, and the owner bypasses RLS (`ENABLE`, not `FORCE`). There are no write grants. This parallels the existing definer-function exception and is auditable |

Rules to add to `database/README.md` (Prompt D02):
- Views are created only by migrations and owned by the owner role.
- Every view is `security_barrier`, lists columns explicitly (never `*`), and repeats every visibility predicate: tenant listed, not suspended, not deleted; artist visible, listed, not deleted; photo not hidden.
- The app role gets `SELECT` on the views only.
- `tests/functional/rls/catalog_guard.spec.ts` asserts the exact view list, its grants and its column lists.
- An isolation spec proves that hidden, unlisted, deleted and suspended rows never appear.

---

## D. Data model gap analysis

All changes are additive migrations, specified conceptually here.

| Change | Table | Rationale |
|---|---|---|
| `discovery_listed boolean not null default false`, `discovery_listed_at timestamptz` | `tenants` | Explicit owner opt-in. Default **off** for existing and new tenants |
| `discovery_suspended_at timestamptz`, `discovery_suspension_note varchar(300)` | `tenants` | Platform takedown switch, set by an operator ace command (there is no admin UI). Wins over the owner's opt-in |
| `discovery_listed boolean not null default true` | `artists` | An artist can stay on their studio page but leave Discover. Owner and the linked artist may switch it (same rule as the profile edit). Only effective while the tenant is listed |
| `places` (platform reference data, not tenant-owned, no RLS): `id`, `country_code char(2)` (ISO 3166-1), `region` (nullable), `slug`, `name`, `unique (country_code, slug)`; seeded for Nepal (Kathmandu, Lalitpur, Bhaktapur, Pokhara, Chitwan, Butwal, Biratnagar, Dharan…) | new | City browsing needs stable URL slugs and international growth. A code list like `TATTOO_STYLES` doesn't scale across countries. Read-only for the app role |
| `place_id uuid null references places`, `country_code char(2) null` | `tenants` | Structured location for studios *and* independent artists (an artist inherits the tenant's place). Keep free-text `address` for display |
| Latitude / longitude | — | **Defer** (advanced geospatial is out of MVP scope); add nullable `numeric` columns only when distance search is planned |
| Derived studio specialties | view, not column | Union of listed artists' `styles` plus published photos' `styles` |
| Profile completeness | view predicate, not column | Eligible = listed, `place_id` set, ≥1 listed visible artist with ≥3 published photos, cover or logo present. Proposed defaults; product to confirm |
| `discover` and `tattoos` in `RESERVED_SLUGS` | code | Cheap safety if Discover ever uses a `.page` subdomain |
| `tattoodrip` in `SOURCE_CHANNELS` | code + migration if the column is constrained | Attribution of Discover-originated inquiries; extend `metrics:pilot` |

**Indexes and extensions** (owner role; check the managed-Postgres allowlist, as was done for `btree_gist`):

- `create extension pg_trgm`. GIN trigram indexes on `lower(tenants.name)` and `lower(artists.name)`.
- GIN on `artists.styles` and `artist_work_photos.styles`. The existing array filters run inside one tenant; cross-tenant filters need GIN.
- A global feed index on `artist_work_photos (created_at desc, id desc) where not hidden`. Existing indexes lead with `tenant_id`.
- A partial index on `tenants (place_id) where discovery_listed and deleted_at is null and discovery_suspended_at is null`.

**Views** (`discovery` schema):

| View | Columns (public only) |
|---|---|
| `discovery.studios` | id, slug, type, name, intro, place, cover/logo keys and sizes, social links, `contact` (already public on the studio page), timezone, derived styles, listed_at |
| `discovery.artists` | id, tenant_id, tenant slug and type, slug, name, bio, photo, styles, accepting_inquiries, social links |
| `discovery.artworks` | id, tenant_id, artist_id, image key and size, alt, styles, healed, created_at |

Never expose deposit settings, payment methods, members, `user_id`, clients, inquiries, projects or reference images.

**Identifiers:**
- Tenant slugs are one global namespace with history, so they work as Discover studio and independent-artist ids.
- Artist slugs are unique per tenant only, so a studio artist is identified by `(studioSlug, artistSlug)`.
- A renamed artist slug has no history (the storefront 404s), and Discover inherits that.
- One person in two studios has two Discover profiles. That is acceptable for the MVP; a global artist identity is a later decision.

---

## E. API gap analysis

**Reuse unchanged:**
- `GET /api/v1/styles`
- Every `/tenants/:tenant/*` read, still used by the storefront.
- The storefront `/book` deep-link params.
- `storefront_url.ts` builders.
- `ImageService` URL and variant shaping.
- `publicCache()`, `PublicGateMiddleware`, `ApiException`.
- The cursor helpers, generalised.

**New, platform-wide group `/api/v1/discover`.** Outside the tenant group, no `publicTenant`, `publicCache()`, its own `apiLimit({ name: "discoverReads" })`. Contract first:

| Operation | Path | Notes |
|---|---|---|
| `listDiscoverStudios` | `GET /discover/studios?q&place&style&type&sort&cursor&limit` | `sort`: `relevance` (only with `q`), `newest`, `name`. Returns `{ data, nextCursor, filters }`; `filters` = the places and styles that actually match |
| `getDiscoverStudio` | `GET /discover/studios/{slug}` | Summary + listed artists + 12 newest artworks + `links` (`site`, `book`, `gallery`); an old slug answers with the current `slug` so Discover can 301 |
| `listDiscoverArtists` | `GET /discover/artists?q&place&style&independent&cursor&limit` | Each item carries `studio: { slug, name, type }` |
| `getDiscoverArtist` | `GET /discover/studios/{slug}/artists/{artist}` | Independent tenants: `GET /discover/studios/{slug}` with `type: independent` gives the artist view (see routes) |
| `listDiscoverArtworks` | `GET /discover/artworks?style&place&healed&studio&cursor&limit` | Newest first, keyset `(created_at, id)` |
| `getDiscoverArtwork` | `GET /discover/artworks/{id}` | Includes `links.page` (storefront artwork page, the canonical) and `links.requestSimilar` (`/book?artwork=`) |
| `listDiscoverPlaces` | `GET /discover/places` | Places with ≥1 eligible studio, with counts; drives the city hubs |

**Conventions:**
- Same envelopes and codes.
- Every string is plain text.
- 404 for anything not eligible: never 403, never reveal unlisted existence.
- The opaque cursor may wrap an offset for `relevance` sorting, capped (for example 10 pages).
- `limit` 1–48, default 24.

**Platform internals:**
- A new `app/modules/discovery/` (services over the views, read-only Lucid models or `dbClient()` queries).
- Transformers in `app/transformers/discover_*`.
- `DISCOVER_SERVER_KEYS`, or generalise `STOREFRONT_SERVER_KEYS` to named server keys.
- Isolation cases in `tests/isolation/public_cases.ts` (extend it for non-tenant routes).
- Studio OS Inertia routes for the listing settings, each with a `TENANT_ROUTE_ROLES` entry and cross-tenant tests.

**SDK / React:**
- Add `createDiscoverClient({ baseUrl, key?, fetch?, timeoutMs? })` in `packages/sdk`, reusing the request, error, timeout and browser-key internals.
- Don't make `tenant` optional in `createTattooClient`: that would weaken the one-tenant type guarantee the storefront relies on.
- Add `discoverQueries` / `discoverKeys` (`["tattoo-drip","discover",…]`) and `useDiscover*` hooks in `packages/react`.
- Generalise `TattooProvider` to accept either client, or add a `DiscoverProvider`; decide in D03, preferring the smaller diff.

---

## F. Search strategy

**MVP: PostgreSQL only.**
- **Names:** `lower(name) % lower(:q)` or `ilike '%' || :q || '%'`, backed by trigram GIN, ranked by `similarity()` and then name.
  - These are proper nouns, often mixed Latin and Devanagari. Trigrams handle partial matches and typos better than FTS here.
  - Verify Devanagari behaviour with seed data in D02.
- **Filters:**
  - `place_id =` (city).
  - `styles && array[...]` (GIN) for style.
  - `tenants.type` for independent.
  - A studio matches a style through its derived styles.
- **Full-text search on intro and bio:** defer. Use the `simple` config if it's added later; there is no Nepali stemmer.
- **Facets:** `filters` lists the styles and places with ≥1 match (unnest + distinct over the views). Exact counts are optional.
- **Performance gate (D02/D03):**
  - `EXPLAIN ANALYZE` on seeded data: 500 studios, 2,000 artists, 50,000 artworks.
  - Target p95 < 100 ms for list endpoints at the DB.
  - If the derived-styles predicate is slow, add an indexed materialized view refreshed by a job. That is the first sanctioned denormalisation step.
- **When a search engine becomes worthwhile:**
  - Thousands of studios across several countries.
  - Multilingual relevance (transliteration of Nepali names), typo-tolerant instant search, geo-radius ranking blended with relevance, or personalised ranking.
  - Sustained search p95 above budget after indexing.
  - Then Meilisearch or Typesense would be fed from the views, which stay the source of truth.

---

## G. UI/UX blueprint

**Design-system direction ("editorial ink"):**
- **Surfaces:** near-black canvas (`#0f0f10`-ish) for immersive gallery and hero sections; warm paper (`#f6f3ee`-ish) for reading sections (profiles, marketing copy, footer).
- **Brand:** TattooDrip red (`--brand #c62835`, the Studio OS token; `#f0646e` text on dark) used *only* for primary actions, the active nav marker and focus. Never for decoration or large fills.
- **Type:** Eczar (already the wordmark and studio face; supports Devanagari) for display headings at large sizes with tight leading. Geist for UI and body, as in Studio OS. A fluid type scale.
- **Shape:** radius 4–8 px, hairline borders, no shadows, no glass, no gradients except a single image scrim for legibility.
- **Motion:** 150–200 ms, opacity and transform only, honour `prefers-reduced-motion`.
- **Accessibility:** contrast targets carried over from the Stencil & Ink spec (4.5:1 body, 3:1 large and UI). 24 px minimum targets (Studio OS convention), 44 px on touch.
- **Imagery leads:** true aspect ratios from API `width`/`height` (zero CLS), masonry or justified rows for artwork, never uniform crop grids for portfolios.

**Global navigation:**
- Wordmark, then Tattoos · Artists · Studios, then a search field (a full-screen sheet on mobile), then "For studios" and "Sign in" (both to `app.`).
- A sticky, compact bar on scroll.
- Footer: cities, styles, for studios, pricing, terms and privacy.

**Homepage information architecture:**
1. Hero: a mosaic of recent real artwork, a single search ("style, artist or studio") and a city selector.
2. Browse by style: a horizontal rail of style tiles, each using a real photo.
3. Cities: text-led list or rail, from `listDiscoverPlaces`.
4. Fresh ink: a masonry of the newest artworks, linking to `/tattoos`.
5. Studios to know: an editorial list row (cover strip, name, city, styles), ordered by "recently listed" or "most complete". No paid placement.
6. Independent artists: a portrait row.
7. How booking works: three steps (request, quote and deposit, session), linking to studios' own booking pages.
8. A Studio OS band on dark: value proposition and CTA to `/for-studios`.
9. Footer.

**Page patterns:**

| Pattern | Design |
|---|---|
| Directories (`/studios`, `/artists`) | Title + result count; a filter bar (style chips, city select, sort) synced to the URL; a sheet of filters on mobile; *list rows* with an image strip (3 recent works) instead of uniform cards; SSR first page + "Show more" by cursor; designed empty states |
| Tattoo gallery (`/tattoos`) | Full-bleed masonry, style chips, healed toggle; detail opens as its own page (shareable URL), no modal-only state |
| Studio profile | Cover band, logo, name, city, derived styles, open-now (client-side, from hours), primary CTA **Request a tattoo** (storefront `/book`), secondary **Visit studio site**; artists strip; 12 works plus "Full gallery on {studio}'s site"; address text with a maps link (no embeds, no third-party scripts) |
| Artist profile | Portrait, name, studio affiliation (or "Independent artist" + city), styles, bio excerpt, works, CTA `/book?artist=` |
| Artwork detail | Large image, artist, studio, styles, healed; **Request something similar** (`/book?artwork=&artist=`); more by this artist, more in this style |
| Marketing (`/for-studios`, `/pricing`) | Paper surfaces, product screenshots of Studio OS, the Studio OS dark/red identity in framed shots only |

**Mobile:**
- Single column, thumb-reach primary CTA (a sticky bottom "Request a tattoo" on profiles).
- Filters in a sheet; 2-column masonry.
- Images from 320/640 variants, the first image eager and the rest lazy.

**Branding:**
- Discover and Studio OS share the wordmark, the red and Geist.
- Studio OS is a dense charcoal tool; Discover is an image-first editorial surface. Never reuse dashboard layouts (sidebars, stat cards, tables) on Discover.
- Studio storefronts keep their own themes. Discover shows studio content in Discover's frame, never the studio's theme colours.

---

## H. SEO and routing strategy

**Final routes** (`apps/discover`):

| Route | Purpose | Index |
|---|---|---|
| `/` | Discover home | yes |
| `/tattoos` | Artwork gallery | page 1 only |
| `/tattoos/:id` | Artwork detail | `canonical` → storefront `/gallery/:id`; not in the Discover sitemap |
| `/artists` | Artist directory | page 1 only |
| `/artists/:slug` | Independent artist (tenant `type = independent`, tenant slug) | yes |
| `/studios` | Studio directory | page 1 only |
| `/studios/:slug` | Studio profile (an independent tenant 301s to `/artists/:slug`) | yes |
| `/studios/:slug/artists/:artist` | Studio-affiliated artist | yes |
| `/styles`, `/styles/:style` | Style hubs (artworks, artists and studios for a style) | yes |
| `/places/:country/:city` | City hub (e.g. `/places/np/kathmandu`) | yes |
| `/for-studios`, `/pricing` | Studio OS marketing | yes |
| `/terms`, `/privacy` | Legal (absent today; needed for a public site) | yes |
| `/sitemap.xml` (index), `/robots.txt` | Crawl | — |
| `/login`, `/signup`, `/dashboard`, `/t/*`, account-link paths | 301 to `app.tattoodrip.app` (transition), never Discover pages | no |

**Changes from the proposal:**
- `/explore/*` is dropped: a segment that adds no meaning, with the directories at `/studios`, `/artists` and `/tattoos`.
- `/artists/:slug` alone can't name a studio artist (slugs are per tenant), hence the nested route.
- `/auth/*` is replaced by links to the existing platform auth pages. Discover has no auth layer.
- Location and style landing pages are added: they are the highest-value search entry points ("tattoo studio in Kathmandu").

**Canonical and duplicate-content policy:**

| Content | Canonical owner | How |
|---|---|---|
| Full studio site (gallery, FAQ, policies, flash, booking) | `<slug>.tattoodrip.page` | Discover never reproduces the full gallery, FAQ, policies or flash; it links out |
| Studio and artist *discovery profiles* | `tattoodrip.app` (self) | A distinct page type: location, derived styles, comparison context, ≤12 works, ≤300-character intro excerpt. JSON-LD `TattooParlor` / `Person` with `url` = the storefront and `sameAs` = the socials |
| Individual artwork | Storefront `/gallery/:id` | Discover's `/tattoos/:id` sets a cross-domain `rel=canonical` to the storefront, so the studio earns the image ranking |
| Filtered, sorted or cursor pages | The unfiltered hub | `noindex, follow` + canonical to page 1 or hub. Crawl coverage comes from sitemaps, not deep pagination |

- **Other head tags:** unique `<title>`/description per page, OG and Twitter cards (cover or photo 1280 variant), `BreadcrumbList` on hubs and profiles, `ItemList` on directories. `lang="en"` for the MVP; hreflang when a second language ships.
- **Sitemaps:** an index with `studios.xml`, `artists.xml`, `places.xml`, `styles.xml` and static pages, generated from paged API reads (cached 1 h), with `lastmod` where known. No artwork URLs (they canonicalise to storefronts, whose own sitemaps could add artwork pages later).
- **Eligibility:**
  - Only eligible profiles render. Everything else is a 404: unlisted, suspended, incomplete, hidden or deleted.
  - The existing 60 s + 600 s SWR caching means a delisting can take up to about 11 minutes to disappear. Document it, and add a Cloudflare purge to the suspension command if needed.
- **Performance:**
  - SSR with page cache headers like the storefront's (`s-maxage=60, stale-while-revalidate=600`), keyed by Host at Cloudflare.
  - srcset from existing variants; no on-the-fly image service.
  - Budgets: LCP < 2.5 s on 4G, CLS < 0.05, JS < 150 kB gzipped on content pages.

---

## I. Revised implementation prompts

Prefix **D** to avoid confusion with the Studio OS redesign prompts. Order: backend before frontend data pages, and the domain move before launch.

| # | Objective | Major tasks | Depends on | Deliverables | Acceptance criteria |
|---|---|---|---|---|---|
| **D01** | Domain split | nginx server blocks for `app.` and `api.`; cloudflared hostnames; `APP_URL` and `API_URL` env; apex legacy redirects and an `/api` proxy window; runbook and `docs/architecture.md`/`deploy.md` updates (incl. removing the stale Vercel row) | Product sign-off | Config + docs | Dashboard, email links, storefront SSR, browser intake and deposit upload all work on new hosts; old links redirect; the platform's `checkAppOrigin` boots in production mode |
| **D02** | Discovery data foundation | Migrations: tenant listing and suspension, artist `discovery_listed`, `places` + Nepal seed, `place_id`; `pg_trgm`; indexes; `discovery` views + grants; DB README rules; catalog guard; isolation specs; seeders for volume tests; `RESERVED_SLUGS` additions | D00 decisions | Migrations, regenerated `schema.ts`, tests | Hidden, unlisted, suspended and deleted rows absent from every view (tests); app role can't write or read beyond the views; EXPLAIN on seeded data within budget |
| **D03** | Discover API + SDK | Contract first; `discovery` module services, controllers, transformers; `bookingUrl` link builder; cache and limits; server key; SDK `createDiscoverClient`; React keys and hooks; SDK/React tests | D02 | API, types, SDK, hooks | Every operation matches `openapi.yaml`; isolation cases pass; cursors stable; no private field in any response (schema `additionalProperties: false`) |
| **D04** | Studio OS publication controls | Settings page "TattooDrip listing" (owner): opt-in switch, place picker, completeness checklist, preview link; artist form switch; setup checklist item; optional place step in onboarding; `discover:suspend` / `discover:restore` ace commands | D02 (D03 for preview links) | Inertia pages, routes, `TENANT_ROUTE_ROLES`, tests | Listing is off by default; toggling it changes API results immediately; artists can only change their own switch; cross-tenant tests |
| **D05** | Discover app foundation + design system | `apps/discover` scaffold (TanStack Start, Tailwind v4, tokens, fonts); config/env validation; SDK wiring per request; layout, nav, footer; SEO head and JSON-LD helpers; robots, sitemap skeleton; 404/503; Dockerfile target, compose service, nginx; CI; minimal `packages/ui` extraction (image + srcset) | D01 (deploy), D03 (client) | App skeleton, design tokens, docs (`apps/discover/AGENTS.md`) | Builds, typechecks and tests in CI; SSR pages with correct heads; no secret in the browser bundle (port the storefront's bundle check) |
| **D06** | Homepage + marketing | Home IA from G; `/for-studios`, `/pricing` (content from product), `/terms`, `/privacy` | D05, D03 | Pages | Lighthouse ≥ 90 performance and accessibility on mobile; content renders with empty or small data sets gracefully |
| **D07** | Directories + hubs | `/studios`, `/artists` (shared list/filter pattern), `/styles/:style`, `/places/:country/:city`; URL-synced filters; cursor "Show more" | D05 | Pages | Filters round-trip via URL; noindex and canonical rules from H; keyboard-operable filters |
| **D08** | Profiles + storefront hand-off | Studio, studio-artist and independent-artist profiles; old-slug 301s; JSON-LD; booking deep links with attribution; storefront `?via=` → `tattoodrip` source channel; `metrics:pilot` attribution | D07, D03 | Pages, small storefront and platform change | Every CTA lands on a working storefront page; an inquiry made via Discover records the `tattoodrip` channel |
| **D09** | Tattoo gallery + artwork detail | `/tattoos` masonry, filters, `/tattoos/:id` with cross-domain canonical, "request similar", related works | D07 | Pages | Zero CLS; lazy-loading verified; canonical points at the storefront |
| **D10** | SEO, performance, accessibility pass | Sitemap index, structured-data validation, OG images, budgets, WCAG 2.1 AA audit, reduced motion | D06–D09 | Fixes + checklist | Rich-results test passes; budgets met; axe clean |
| **D11** | QA and launch readiness | Playwright journeys (find, filter, profile, book hand-off, delist), load test of discover endpoints, runbook (suspension, cache purge), launch gate on listed-studio count | All | Tests, runbook | Journeys green in CI; delisting verified end to end within the documented TTL |

**Changes from the proposed sequence:**
- The data model and API move ahead of every data-driven page; the proposal had the homepage before the data.
- The domain split is added as an explicit prompt; it was missing and is a launch blocker.
- Publication controls move from 08 to D04, so real opted-in data exists while the UI is built.
- The studio and artist directories are combined (same pattern).
- Hubs join the directories.
- Storefront attribution is folded into profiles.
- Marketing pages stay with the homepage. They have no data dependency, so they could ship first if a marketing launch is wanted before Discover is live.

---

## J. Architectural risks and decisions

**Decisions requiring product-owner approval:**

1. **Strategy change.** The docs defer a marketplace or discovery site ("Not yet" / "Later, maybe never"; research: "hundreds of active studio pages" first). The default is to proceed, but gate *public launch and indexing* on a minimum number of eligible studios (proposed 15–20). Until then, ship `/`, `/for-studios` and `/pricing` with directories `noindex`. Update `roadmap.md` and `requirements.md` when approved.
2. **Domain move.** Dashboard to `app.tattoodrip.app`, API to `api.tattoodrip.app`, Discover on the apex. The alternative, path carve-outs on one host, is fragile and gets more so with every dashboard route.
3. **Opt-in defaults.** Tenant listing off by default (recommended) vs on; artist switch default on under a listed studio.
4. **Completeness rule.** ≥1 listed artist with ≥3 published photos, a city, and a cover or logo.
5. **Locations.** A curated `places` list seeded for Nepal; owners pick from it, and a missing city is added by the operator. The other option is free text plus normalisation.
6. **Artist identity.** One Discover profile per tenant-artist (no global person). Independent tenants are presented as artists at `/artists/:tenantSlug`.
7. **Artwork pages.** Discover artwork pages canonicalise to storefronts, so Discover gives up image-search ranking to the studios.
8. **Pricing page.** No billing exists. Pricing is static copy until billing is built (and the price is still being validated per `roadmap.md`).
9. **Analytics.** Storefronts forbid third-party scripts. Should Discover follow (recommended: yes, using server-side counts and source attribution), or allow a privacy-friendly analytics script?
10. **Legal and moderation.** Terms and privacy for tattoodrip.app; listing consent text (studios confirm they may publish the photos, including clients' bodies); takedown via `discover:suspend`; no review queue in the MVP.
11. **Language.** English only for the MVP; Nepali later (Eczar and Geist fallbacks cover Devanagari).

**Technical risks:**

| Risk | Mitigation |
|---|---|
| The cross-tenant views widen the RLS model | Explicit column lists, `security_barrier`, `SELECT`-only grants, catalog guard on view definitions and grants, isolation specs, a README rule. A security review in D02 |
| Visibility rules duplicated between `visibleArtistSql` and the views | One SQL predicate per view; a test that compares storefront and Discover visibility on the same fixtures |
| Domain move breaks live links or sessions | Redirect and proxy window, one-time sign-out notice, staged deploy with rollback (keep the old `server_name` until verified) |
| Cold start: empty directories look broken | Launch gate (decision 1); designs that read well with 5 studios; city and style hubs only render when non-empty |
| Stale caches after delisting | Documented 11-minute worst case; optional Cloudflare purge in the suspension command |
| Search quality on mixed scripts | Trigram + seed tests in D02; documented upgrade path to a search engine |
| Single-server capacity (one box runs everything) | Discover pages are CDN-cacheable; discover API cached 60 s; measure in D11 |
| Doc drift | `docs/architecture.md` (Vercel row, `app.`/`api.` hosts, Portfolio as V1) and `docs/data-model.md` (FlashDesign as V1) are already stale; fix them in D01/D02 |

**Recommended defaults when no answer arrives:**
- Listing off by default.
- Artist switch on.
- Curated places.
- Artwork canonicals to storefronts.
- No third-party scripts.
- English only.
- Domain split in D01.
- Indexing held until the launch gate.
