# Discover API

Discover D03 (D09 added the gallery's search and the artwork page's booking flag; D10 the sitemap lists). The public, cross-studio read API that Discover (D05 onward) is built on, its SDK client and React hooks, and the booking referral. The contract is `packages/types/openapi.yaml` (the `Discover` tag); this page covers what the contract can't: the boundary, the rules behind each answer, and the limits.

Nothing here changes a studio's own API (`/api/v1/tenants/:tenant/*`) or the storefront.

## Boundary

- Every Discover read goes through the D02 `discovery` views and `public.places`, and through nothing else ([database security](database-security.md)). The views return only what a listed studio publishes. A row they don't return doesn't exist for Discover.
- `readDiscovery(fn)` (`#modules/discovery/read`) runs each read in a savepoint of the request's transaction. The savepoint clears `app.tenant_id` and `app.user_id`, sets `transaction_read_only`, and is always rolled back. A read has no tenant or user context and cannot write, and the rollback undoes every setting it made.
- It uses the app role's normal connection: no owner connection, no new login role, and no tenant routes or middleware (`publicTenant`, `TENANT_ROUTE_ROLES`).
- Every value from a request is a bound parameter. The SQL around it is fixed text: the sort's `ORDER BY` and keyset condition come from a three-entry `switch` (`sortSql`), and filters append fixed fragments. No identifier, operator or `ORDER BY` is ever built from input.
- `DiscoveryService` (`#modules/discovery/services/discovery_service`) writes out every answer field by field, from the views' public columns. No row is serialised as a whole, so a column added to a view later can't leak through.

## Endpoints

All `GET`, under `/api/v1/discover`, with the public API's envelopes (`{ data }`, or for lists `{ data, nextCursor }`; errors `{ error: { code, message, fields? } }`).

| Path | Operation | Answers |
|---|---|---|
| `/studios` | `listDiscoverStudios` | Listed studios (`type: studio` only: independent artists are artists). `q`, `country`, `city`, `style`, `sort`, `cursor`, `limit` |
| `/studios/:studio` | `getDiscoverStudio` | One listed studio by its current or an old slug, with up to 100 artists by name, its 12 newest photos, its social links and a `bookingUrl` |
| `/studios/:studio/artists` | `listDiscoverStudioArtists` | That studio's shown artists, by name |
| `/studios/:studio/artists/:artist` | `getDiscoverStudioArtist` | One artist at that studio (an artist slug is unique per studio only), with bio, social links, 12 newest photos and a `bookingUrl` naming the artist |
| `/artists` | `listDiscoverArtists` | Shown artists of every listed business. `q`, `country`, `city`, `style`, `studio` (slug), `independent`, `sort`, `cursor`, `limit` |
| `/artists/:artist` | `getDiscoverIndependentArtist` | A listed independent artist by their business's slug (their first-made shown profile) |
| `/tattoos` | `listDiscoverTattoos` | Published photos, newest first only. `q` (D09), `country`, `city`, `style`, `studio`, `artist` (uuid), `healed`, `cursor`, `limit` |
| `/tattoos/:tattoo` | `getDiscoverTattoo` | One published photo by id (any letter case), with its place, `artistAcceptingInquiries` (D09), its page on the studio's site and a `bookingUrl` naming it (`artwork`) |
| `/styles` | `listDiscoverStyles` | The platform's fixed style list, in its order |
| `/locations` | `listDiscoverLocations` | The places at least one listed business is in, by country and name |
| `/sitemap/studios`, `/sitemap/artists`, `/sitemap/tattoos` | `listDiscoverSitemapStudios`, `…Artists`, `…Tattoos` | D10: the canonical identifiers of every shown studio, artist profile and photo, keyset-paged by id (see Sitemap lists) |

Rules:

- **404 for everything not shown.** Unknown, never listed, opted out, taken down, deleted, a hidden or opted-out artist, a hidden or taken-down photo, an artist at another studio, a studio slug asked for as an independent artist and the reverse: all the same `404 not_found`, with no hint of which. Lists simply leave such rows out.
- **Old slugs:** a studio's old slug resolves through the existing `tenant_for_slug()` (SECURITY DEFINER, returns an id only). The view then decides, so an unlisted studio's old slug is the same 404. The answer names the current slug: Discover links by it.
- **No invented numbers.** Lists order by name or by date only. There are no popularity, trending, review, booking or engagement figures.
- **Plain text.** Every string is plain text: render it as text.

## Parameters and validation

Vine validators (`#modules/discovery/validators/discover`) read the query string only. A malformed value is `422 validation_failed` with `fields`:

| Parameter | Rule |
|---|---|
| `q` | 2–80 characters, trimmed, no control character; a case-insensitive substring of the name (`strpos(lower(name), lower(q))`, so `%` and `_` are literal). Also counts against `discoverSearch`. On `/tattoos` (D09) it matches a photo whose alt text, artist's name, business's name (studio or independent) or style name contains it (see Gallery search) |
| `country` | ISO 3166-1 alpha-2, upper-cased (`np` → `NP`) |
| `city` | A place slug; needs `country` (a city slug is unique per country only: "Name the country of the city (country=NP).") |
| `style` | A slug from the style list |
| `sort` | `newest` (default: `listed_at` for studios, `created_at` for artists), `name` or `-name` (`lower(name)`, ties by id). Tattoos are `newest` only |
| `cursor` | Opaque; at most 1000 characters; must be a canonical cursor of the same sort |
| `limit` | 1–48, default 24 |
| `independent`, `healed` | Booleans. `healed=false` is the same as leaving it out |
| `artist` | A uuid, in any letter case |

An unknown place, studio slug or artist is an empty page, not an error, as in the studio gallery's filters.

**Cursors** (`#modules/discovery/cursor`) use keyset paging: base64url of the JSON `[sort, value, id]`, where `value` is `lower(name)` or the instant as the database wrote it (UTC, microseconds, so a JavaScript date never rounds it). Only one spelling decodes. A cursor of another sort, a non-uuid id, an impossible date (31 February) or a control character is a 422 on `cursor`. Rows added while someone pages are never repeated or skipped. Rows that tie on the sort value (the same name under `lower()`, the same instant) are ordered by id. Pass `nextCursor` back with the same filters and sort; it is null on the last page.

## Gallery search and the artwork read (D09)

- **`q` on `/tattoos`.** The same validation as the studios' and artists' `q` (the shared `q()` rule: trimmed, 2–80, `NO_CONTROL`, 422 on `q`). A photo matches when `q` is a case-insensitive substring (`strpos(lower(…), lower(?))`, `%` and `_` literal) of its own alt text (the only public text a photo has: there is no title or caption column), of its artist's name (`discovery.artists`), of its business's name (`discovery.studios`, studios and independents) or of the name of a style it is tagged with. Style names are the platform's fixed list (`TATTOO_STYLES`): the slugs whose name contains `q` are found in the app (`stylesNamed`) and bound as one array (`w.styles && ?::varchar[]`; none is an empty array, which overlaps nothing). Every value is a bound parameter; the SQL is fixed text. It reads only the D02 views, combines with every other filter, keeps newest first with the id as tie-break, and its cursor is the same `newest` cursor (bound to the sort, as every cursor). A search counts against `discoverSearch`.
- **No index.** Substring matching can't use a B-tree, and a trigram index would need `pg_trgm` and, under RLS, a leakproof operator (D02: a non-leakproof operator is never an index condition). The page is still read from `discovery.artworks` alone inside the `LIMIT` subquery, walking the newest-first index (`artist_work_photos_discovery_newest`) and checking each row; the name subqueries are uncorrelated, so PostgreSQL can evaluate each once (a hashed subplan). A rare match scans every published photo before the page fills. Measured in D10 phase B on a local synthetic set (400 listed businesses, 1,600 artists, 36,800 published photos; Postgres 16, as `tattoo_drip_app`): a matching first page 5 ms, a search that matches nothing (every published photo checked) 33 ms. Linear in the published photos, so re-measure on the rehearsal data before the photo count grows by an order of magnitude; the search budget and the 60-second cache sit in front.
- **`artistAcceptingInquiries`** on `/tattoos/:tattoo`: the photo's artist's own `accepting_inquiries` (a column the view already exposes). The booking link still names the photo when it is false: the storefront then offers the studio's general request with the piece linked; Discover says the artist isn't taking requests (frontend, "Artwork pages").
- **The artwork's `bookingUrl`** (D03, unchanged): the studio site's `/book?artwork=<photo id>&ref=<token>`. The storefront's `/book` reads `artwork` as a gallery photo's id (its "Request a similar tattoo"), checks it with the studio's own API and names the photo's artist; portfolio photos are not flash, so never `flash`.
- Everything not shown is the same 404 as before (unknown, never listed, opted out, taken down, unpublished, a hidden, opted-out or deleted artist): `tests/functional/api/discover_gallery.spec.ts`.

## Sitemap lists (D10)

Discover's sitemaps (frontend, "Sitemaps") need every shown studio, artist profile and photo. Paging the lists 48 rows at a time would cost hundreds of reads an hour against the anonymous `discoverReads` budget (about 780 for the rehearsal data's 37,000 photos alone), so three small lists answer identifiers only:

| Path | A row | Which rows |
|---|---|---|
| `/sitemap/studios` | `{ slug }` | `discovery.studios` of `type = 'studio'` (as `/studios`) |
| `/sitemap/artists` | `{ slug, studio: { slug, type } }` | Every `discovery.artists` row at a studio; for an independent business only the profile `/artists/:slug` shows (its first-made shown artist, as `getDiscoverIndependentArtist`), so each profile address appears once |
| `/sitemap/tattoos` | `{ id }` | Every `discovery.artworks` row (as `/tattoos`) |

- **Same eligibility:** the same D02 views through `readDiscovery`, so a row the lists don't show (unlisted, opted out, hidden, taken down, deleted) is in no sitemap list either. Fixed SQL, bound values (`DiscoveryService.sitemapStudios/Artists/Tattoos`).
- **Paging:** by id, `id > cursor` (keyset; the ids are uuidv7, so new rows land at the end and earlier pages keep their boundaries). `limit` 1–5,000 (default 5,000); `nextCursor` is the page's last id, null on the last page. A cursor that isn't a uuid, or a bad `limit`, is a 422.
- **No modification time:** the views expose `listed_at` and `created_at` only, neither of which says when a page changed, so no `updatedAt` is returned and Discover's sitemaps have no `lastmod`. Adding one means a column in the views (D02's boundary) and is left for later.
- **Cost:** each read counts against `discoverReads` and its own `discoverSitemap` budget (60 per caller per 5 minutes). Measured in D10 phase B on the synthetic set above: studios 0.2 ms, artists 3 ms, but a photos page 76 ms at 36,800 published photos: under the views' RLS the planner reads every published photo (tenants → artists → photos) and keeps the 5,000 lowest ids (top-N sort), so each page costs the whole list and an index walk of N photos costs about N²/5,000 row reads. Acceptable now (the index is cached an hour and read by crawlers only); before the photo count reaches the hundreds of thousands, give the walk an index-ordered plan (a leakproof-safe path on the primary key) and re-measure.
- One route (`/discover/sitemap/:kind`, `kind` matched to the three names; anything else is the router's 404), GET only, cached like every Discover read. Specs: `tests/functional/api/discover_sitemap.spec.ts`.

## Limits and caching

- The gate's generic per-caller budgets still apply (`callerReads`).
- `discoverReads`: 200 reads per caller per 5 minutes (`apiLimit` on the whole group).
- `discoverSearch`: 60 searches per caller per 5 minutes, counted only when `q` is present (each one scans the listed names; on `/tattoos`, D09, the published photos). Discover's gallery searches as the visitor types (debounced, 400 ms, at least 2 characters), so a burst of typing can spend several.
- `discoverSitemap` (D10): 60 sitemap-list reads per caller per 5 minutes (up to 5,000 rows each).
- Over budget: `429 rate_limited` with `Retry-After`.
- Every read is `Cache-Control: public, max-age=60, stale-while-revalidate=60` with `Vary: Origin` and an `ETag` (`If-None-Match` gets a 304). Something unlisted or hidden can therefore still be served from a cache for up to 2 minutes. Takedowns that need to be faster need a CDN purge, which doesn't exist yet (see Limitations).
- CORS comes from D01: only allowlisted origins (the studio sites, `APP_URL`, `DISCOVER_URL`) are echoed, never `*`, never with credentials.

## Referral

Discover's booking links carry a signed referral token, so an inquiry that came from Discover is attributed and the attribution can't be forged. It is attribution only: it never authorises anything, grants no access and never blocks an inquiry.

- **Token** (`#modules/discovery/referral`): `<payload>.<signature>`, both base64url. The payload is the JSON `{ v: 1, p: "booking_referral", iss: "discover", sid: <studio id>, iat, exp }`, in whole seconds, 30 days (`REFERRAL_TTL_SECONDS`). Nothing about a person is in it. The signature is HMAC-SHA256 over the payload text, with a key derived from `APP_KEY` by HKDF for this purpose alone. Rotating `APP_KEY` invalidates every token, which only drops attribution.
- **Where it appears:** every `bookingUrl` (studio, artist and tattoo details) is the studio site's `/book`, with `artist` or `artwork` where it applies and `ref=<token>`. The token is signed with the start of the current hour (`linkReferral`), so a profile's body and ETag stay the same for the hour and a revalidation gets a 304; a link therefore keeps its attribution for just under 30 days (30 days less the time into the hour it was made). The token is not secret: it only says "Discover linked to studio X in hour T".
- **Verification:** `verifyReferral(token, studioId)` never throws. It checks length (≤ 512), shape, then the signature in constant time before parsing the payload (and only its one canonical spelling), then version, purpose and issuer, then the times (`iat` up to 5 minutes ahead is tolerated, `exp` must be in the future), then the studio. Every failure is a reason, used only to drop the attribution.
- **At the intake** (`createInquiry`): the form's `referral` field (body only, never the query string; not a validator field, so a bad one never produces a field error) is verified for the studio in the path. A valid one sets `inquiries.referral_source = 'discover'` and `referral_issued_at`, the hour the link was made (migration `1791880000000_add_inquiry_referral`; both or neither, checked by the database). Anything else, including another studio's token, an expired, forged or garbage one, or none, stores nulls and the inquiry goes through as usual (201). `inquiries_guard_update` freezes both columns, so the attribution is written once.
- **Separate from `sourceChannel`,** which stays what the client said ("How did you hear about us?").
- **Hand-off (D08):** Discover's profiles link to `bookingUrl` as it is (after checking it, [frontend](frontend.md#booking-hand-off-d08)); the storefront's `/book` keeps a token-shaped `ref` and sends it as the inquiry's `referral` (the SDK sends it as a form field). No API change was needed.

## SDK and React

```ts
import { createDiscoverClient } from "@tattoo-drip/sdk";

const discover = createDiscoverClient({ baseUrl: "https://api.tattoodrip.app" });
const page = await discover.studios.list({ query: "ink", country: "NP", city: "kathmandu" });
const next = await discover.studios.list({ query: "ink", country: "NP", city: "kathmandu", cursor: page.nextCursor ?? undefined });
const studio = await discover.studios.get("black-needle");
```

- `createDiscoverClient({ baseUrl, key?, fetch?, timeoutMs? })` (`packages/sdk/src/discover.ts`) has no tenant. Its resources are `studios.list/get/artists/artist`, `artists.list/independent`, `tattoos.list/get`, `styles.list`, `locations.list` and (D10) `sitemap.studios/artists/tattoos` (a whole page, `{ data, nextCursor }`; no React hooks: only Discover's server reads them). Lists return the whole page (`{ data, nextCursor }`); single reads unwrap `data`. `query` travels as the API's `q` (studios, artists and, since D09, tattoos: `DiscoverTattoosListQuery`). Path segments are encoded.
- It shares `createTransport` (`packages/sdk/src/transport.ts`) with `createTattooClient`: no cookies, a timeout (`timeout`), the caller's `signal` (rejects with its `AbortError`), `TattooApiError`, and the refusal of a `key` in a browser. `createTattooClient` is unchanged and still needs its tenant.
- React (`packages/react`): `DiscoverProvider` / `useDiscoverClient` (separate from `TattooProvider`, which holds one studio's client); `discoverKeys`, all under `["tattoo-drip", "discover", …]`, so they never collide with a studio's `["tattoo-drip", "tenant", <slug>, …]` or the studio client's styles; `discoverQueries.*` for `useQuery` and SSR prefetch, each forwarding TanStack Query's `signal`; and the hooks `useDiscoverStudios`, `useDiscoverStudio`, `useDiscoverStudioArtists`, `useDiscoverStudioArtist`, `useDiscoverArtists`, `useDiscoverIndependentArtist`, `useDiscoverTattoos`, `useDiscoverTattoo`, `useDiscoverStyles`, `useDiscoverLocations`. A list's key holds its whole query (filters, sort, cursor), so each page is its own cache entry. Styles never go stale; everything else follows the app's defaults.

## Performance

Measured with `EXPLAIN ANALYZE` as the app role, with no context, read-only, on the D02 rehearsal data: 503 tenants (450 listed), 2,000 artists, 50,000 photos (36,938 published), PostgreSQL 18.6. Times are execution times of the exact service SQL:

| Query | Time |
|---|---|
| Studios, newest / by name with a cursor / search `q` / city + style | 0.4 / 0.6 / 0.3 / 1.0 ms |
| Studio by slug; its artists; its styles (24 studios) | 0.1; 0.4; 0.6 ms |
| Artists by name / newest with a style / in a country | 0.4 / 2.3 / 3.2 ms |
| Tattoos, newest page 1 / a cursor page | 3.8 / 2.8 ms |
| Tattoos in a city / of one studio / healed / of one artist | 4.5 / 0.8 / 1.7 / under 2 ms |
| Tattoos with a style (common or rare) | about 80 ms |
| Tattoos in a whole country where every listed studio is | 90–105 ms |
| One tattoo by id; locations | 1.7; 0.1 ms |

- The tattoo feed reads its page from `discovery.artworks` alone, inside a `LIMIT` subquery, and joins only those rows to their artist and studio. The first version joined the three views first. PostgreSQL then read every published photo before sorting: 119 ms for page 1.
- The style filter (`styles @> array[?]`) can't use an index: under RLS a non-leakproof operator is never an index condition (D02). It is still under the 100 ms target (about 85 ms, re-measured 2026-11-07).
- A country-wide filter that matches every listed studio is the slowest case, because the planner switches to a hash semi-join: 90 to 105 ms across runs, so at or just over the 100 ms target. The rehearsal data puts all 450 listed studios in one country, the worst case; with businesses spread across countries the filter is selective. Precomputing the ids as an array was slower (164 ms). A city filter, the selective case, takes 4.5 ms.
- No Redis or materialised view was added: nothing measured needs one, and the 60-second public cache sits in front.

## Tests

- `tests/functional/api/discover.spec.ts`: every endpoint and its exact field sets; filters, search, both name sorts, cursor paging across every sort, including rows that tie on the sort value; profiles' ETags holding across seconds (304); old slugs; independents vs studios. Never shown: never listed, opted out, taken down, hidden or opted-out or deleted artist, hidden or taken-down photo, unknown and wrong-studio paths (each a 404 and absent from every list). Also no private words in any answer, no context and still writable after the reads, 422s for every malformed parameter and cursor, and both rate limits.
- `tests/functional/api/discover_gallery.spec.ts` (D09): `q` on `/tattoos` (alt text, artist, studio and style names; case and `%`/`_` literal; no match; a never-listed studio's matching photo absent), combined with every filter and the country, cursor paging with ties and a stable order, the 422s (length, control characters), the search budget, and rows leaving the search when hidden, taken down or opted out; the detail's fields, attribution, place, `artistAcceptingInquiries`, the booking link's shape (`/book`, exactly `artwork` and `ref`, the studio's own origin, the token bound to that studio) and the same 404 body for every reason, plus cross-tenant isolation.
- `tests/functional/api/discover_referral.spec.ts`: attribution persisted with `sourceChannel` intact; none, empty, garbage, oversized, forged, another studio's and expired tokens all still give a 201 with nothing stored; a query-string token ignored; the guard refusing a later change. D08: the hand-off end to end: a studio artist's `bookingUrl` from the profile API (the studio's host, `/book`, `artist`), its `ref` sent as `referral` records the attribution with the preferred artist; one studio's link used at another studio records nothing.
- `tests/unit/modules/discovery/{referral,cursor}.spec.ts`: signing, hour-stable link tokens, expiry, studio binding, clock skew, tampering, a re-spelt signature, wrong key, version and purpose, malformed input; cursor round trips, cross-sort, canonical spelling, real instants.
- `tests/functional/api/discover_sitemap.spec.ts` (D10): each sitemap list's rows and fields (identifiers only; one profile per independent, the one its detail read answers), unpublished, taken-down and hidden photos, hidden artists and suspended or never-listed studios absent, keyset paging (every row once, in id order, an upper-case cursor, a cursor past the end), the 422s, the `discoverSitemap` budget and no private field.
- `tests/functional/api/api_routes.spec.ts`: the eleven Discover routes are GET-only, limited, cached and tenantless.
- D02's `tests/functional/rls/discovery.spec.ts` still proves the boundary itself.
- `packages/sdk/test/discover.test.ts` and `packages/react/test/discover.test.ts`: URLs, parameter serialisation, encoding, errors, timeout, cancellation, keys (stability, separation, no collisions), signal forwarding.

## Limitations and follow-ups

- **Discover SSR server key (D05).** The blueprint's "named server keys" are not built. Until D05, Discover's SSR can call with no key (anonymous, per address) or with a storefront key. D05 generalises `STOREFRONT_SERVER_KEYS` to named keys when `apps/discover` exists.
- **Takedown latency.** The public cache can serve a removed row for up to 2 minutes; there is no purge.
- **Search.** Substring search on names only for studios and artists (no bio or ranking), as the D02 plan set out; photos (D09) also on their alt text and style names. No ranking: newest first.
- **Profile caps.** A studio profile lists up to 100 artists and an artist's or studio's 12 newest photos. Use the list endpoints with `studio` or `artist` for the rest.
