# Discover API

Discover D03. The public, cross-studio read API that Discover (D05 onward) is built on, its SDK client and React hooks, and the booking referral. The contract is `packages/types/openapi.yaml` (the `Discover` tag); this page covers what the contract can't: the boundary, the rules behind each answer, and the limits.

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
| `/tattoos` | `listDiscoverTattoos` | Published photos, newest first only. `country`, `city`, `style`, `studio`, `artist` (uuid), `healed`, `cursor`, `limit` |
| `/tattoos/:tattoo` | `getDiscoverTattoo` | One published photo by id, with its place, its page on the studio's site and a `bookingUrl` naming it (`artwork`) |
| `/styles` | `listDiscoverStyles` | The platform's fixed style list, in its order |
| `/locations` | `listDiscoverLocations` | The places at least one listed business is in, by country and name |

Rules:

- **404 for everything not shown.** Unknown, never listed, opted out, taken down, deleted, a hidden or opted-out artist, a hidden or taken-down photo, an artist at another studio, a studio slug asked for as an independent artist and the reverse: all the same `404 not_found`, with no hint of which. Lists simply leave such rows out.
- **Old slugs:** a studio's old slug resolves through the existing `tenant_for_slug()` (SECURITY DEFINER, returns an id only). The view then decides, so an unlisted studio's old slug is the same 404. The answer names the current slug: Discover links by it.
- **No invented numbers.** Lists order by name or by date only. There are no popularity, trending, review, booking or engagement figures.
- **Plain text.** Every string is plain text: render it as text.

## Parameters and validation

Vine validators (`#modules/discovery/validators/discover`) read the query string only. A malformed value is `422 validation_failed` with `fields`:

| Parameter | Rule |
|---|---|
| `q` | 2–80 characters, trimmed; a case-insensitive substring of the name (`strpos(lower(name), lower(q))`, so `%` and `_` are literal). Also counts against `discoverSearch` |
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

## Limits and caching

- The gate's generic per-caller budgets still apply (`callerReads`).
- `discoverReads`: 200 reads per caller per 5 minutes (`apiLimit` on the whole group).
- `discoverSearch`: 60 searches per caller per 5 minutes, counted only when `q` is present (each one scans the listed names).
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
- **Hand-off still to do (D08):** the storefront's `/book` route doesn't yet keep `ref`. It must forward `ref` from the URL to `inquiries.create({ referral })`. The SDK already sends `referral` as a form field.

## SDK and React

```ts
import { createDiscoverClient } from "@tattoo-drip/sdk";

const discover = createDiscoverClient({ baseUrl: "https://api.tattoodrip.app" });
const page = await discover.studios.list({ query: "ink", country: "NP", city: "kathmandu" });
const next = await discover.studios.list({ query: "ink", country: "NP", city: "kathmandu", cursor: page.nextCursor ?? undefined });
const studio = await discover.studios.get("black-needle");
```

- `createDiscoverClient({ baseUrl, key?, fetch?, timeoutMs? })` (`packages/sdk/src/discover.ts`) has no tenant. Its resources are `studios.list/get/artists/artist`, `artists.list/independent`, `tattoos.list/get`, `styles.list` and `locations.list`. Lists return the whole page (`{ data, nextCursor }`); single reads unwrap `data`. `query` travels as the API's `q`. Path segments are encoded.
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
- `tests/functional/api/discover_referral.spec.ts`: attribution persisted with `sourceChannel` intact; none, empty, garbage, oversized, forged, another studio's and expired tokens all still give a 201 with nothing stored; a query-string token ignored; the guard refusing a later change.
- `tests/unit/modules/discovery/{referral,cursor}.spec.ts`: signing, hour-stable link tokens, expiry, studio binding, clock skew, tampering, a re-spelt signature, wrong key, version and purpose, malformed input; cursor round trips, cross-sort, canonical spelling, real instants.
- `tests/functional/api/api_routes.spec.ts`: the ten Discover routes are GET-only, limited, cached and tenantless.
- D02's `tests/functional/rls/discovery.spec.ts` still proves the boundary itself.
- `packages/sdk/test/discover.test.ts` and `packages/react/test/discover.test.ts`: URLs, parameter serialisation, encoding, errors, timeout, cancellation, keys (stability, separation, no collisions), signal forwarding.

## Limitations and follow-ups

- **Discover SSR server key (D05).** The blueprint's "named server keys" are not built. Until D05, Discover's SSR can call with no key (anonymous, per address) or with a storefront key. D05 generalises `STOREFRONT_SERVER_KEYS` to named keys when `apps/discover` exists.
- **`ref` forwarding (D08).** The storefront drops `ref` on `/book` today. Attribution works end to end only once it forwards it.
- **Takedown latency.** The public cache can serve a removed row for up to 2 minutes; there is no purge.
- **Search.** Substring search on names only (no bio, style text or ranking), as the D02 plan set out.
- **Profile caps.** A studio profile lists up to 100 artists and an artist's or studio's 12 newest photos. Use the list endpoints with `studio` or `artist` for the rest.
