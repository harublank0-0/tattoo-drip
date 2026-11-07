# Discover frontend

Discover D05 (foundation), D06 (homepage, Studio OS marketing), D06.5 (country-aware discovery) and D07 (directories, style and location pages). The public site at `tattoodrip.app`: `apps/discover`, a TanStack Start app beside the storefront. It reads only the public [Discover API](api.md) and has no database, no auth and no platform imports. D08–D10 build the rest of its pages on this foundation.

## Architecture

| Path | What |
|---|---|
| `src/router.tsx` | One router per server request and per browser tab: its own `QueryClient` and Discover client, so no request sees another's cache |
| `src/lib/config.ts` | The settings, from `process.env` on the server; `parseDiscoverConfig` names every bad variable, never a value |
| `src/lib/country.ts` | Country codes and names, the resolution order, the preference cookie, return paths and switch addresses, location slugs (`countrySlug`, `countryFromSlug`; pure; see Country) |
| `src/lib/preference.ts` | `POST /preferences/country`: saves the preference cookie |
| `src/lib/context.ts`, `request.ts` | The router context: `queryClient`, `discover` (`DiscoverRef`: public settings + `createDiscoverClient`) and `preference` (the visitor's country preference). Connected on the server from the settings and the request, in the browser from the dehydrated state (checked again). The root route adds `country`, the page's resolved country |
| `src/lib/query-client.ts` | QueryClient defaults: 60 s fresh (the API's max-age), no retry on the server, transient retries in the browser, pending queries streamed |
| `src/lib/routes.ts` | Every address (`paths`), the routes that exist (`ROUTE_FILES`, `ROUTE_PATTERNS`, `hasRoute`), the navigation and footer lists, Studio OS's sign-in and sign-up links |
| `src/lib/search.ts` | Search-parameter readers (`readQuery`, `readCountry`, `readCity`, `readStyle`, `knownStyle`) |
| `src/lib/directory.ts` | The directories' URL contract (D07): `readDirectorySearch`, `directoryQuery`, `changeSearch`/`applyFilters`/`chooseCity`, chips, recent-work pairing (pure) |
| `src/lib/directory-loader.ts` | The directories' shared loader, head and list hook |
| `src/lib/hubs.ts` | The style and location pages' queries (`styleQueries`, `locationQueries`, `HUB_LIMITS`) |
| `src/lib/destinations.ts` | `profileDestination`: where a studio or artist links (the storefront now, Discover's profile from D08) |
| `src/lib/home.ts` | The homepage's queries (`homeQueries`), limits, thresholds and pure section rules |
| `src/lib/seo.ts` | Head tags, the canonical URL, robots and sitemap text |
| `src/routes/` | File routes (`routeTree.gen.ts` is generated) |
| `src/components/ui` | shadcn-style primitives on Discover's tokens: `Button`, `Input`, `Sheet` |
| `src/components/layout` | The shell: `SiteHeader`, `MobileNav`, `SiteFooter`, `Wordmark`, `NavLink`; `country-selector.tsx` (the selector, the mobile Country group, `EmptyMarket`) |
| `src/components/discovery` | Page primitives: `PageContainer`, `EditorialSection`, `SectionHeading`, `PageHeader`, `Breadcrumbs`, `ResponsiveImage`, `DiscoverySearch`, `EmptyState`, `ErrorState`, `LoadingSkeleton`, `NotFoundState`, `RouteErrorState`, `FoundationNotice` |
| `src/components/home` | The homepage's hero and sections (D06) |
| `src/components/directory` | D07: `DirectoryPage` (search, toolbar, chips, states, paging), `filters.tsx` (`FilterToolbar`, `MobileFilters`, `ActiveFilters`), `Pagination`, `StudioResults`, `ArtistResults`, `ResultsSkeleton`, and the hub pieces (`HubSection`, `WorkColumns`, `LinkList`, `MoreLink`) |

The root route (`__root.tsx`) renders the document, the skip link, the header, `<main id="main">` and the footer for every page, inside `DiscoverProvider` (so `@tattoo-drip/react`'s `useDiscover*` hooks work); the QueryClientProvider comes from `setupRouterSsrQueryIntegration`.

## Routes

| Path | Now | Finished in |
|---|---|---|
| `/` | **D06 homepage**: discovery hero, styles, studios, artists, inspiration, places, how booking works, the Studio OS band, a closing call (see Homepage) | D06 |
| `/explore/studios` | **D07 directory**: the page's country's listed studios; name search, city, style, sort, cursor paging (see Directories); indexable only bare | D07 |
| `/explore/artists` | **D07 directory**: the same contract plus `independent`; work-first cards | D07 |
| `/styles/:slug` | **D07 style page**: one style's studios, artists and work in the page's country; unknown slug 404 | D07 (sitemap D10) |
| `/locations/:country`, `/locations/:country/:city` | **D07 location pages**: a market's or a city's studios, artists, places and styles; never by the visitor's country; non-market or unknown city 404 | D07 (sitemap D10) |
| `/explore/tattoos` | A `FoundationNotice`; `noindex` | D09 |
| `/for-studios` | **D06**: Studio OS for professionals; indexable | D06 |
| `/pricing` | **D06**: informational, no prices yet; `noindex` until prices are published | D06 (prices later) |
| `/studios/:slug`, `/studios/:studioSlug/artists/:artistSlug`, `/artists/:tenantSlug`, `/tattoos/:id` | Not routes yet (404); their builders are in `paths`, reached only through `profileDestination` | D08–D09 |
| `/robots.txt`, `/sitemap.xml` | Server routes, see SEO | D10 |
| `/preferences/country` | Server route: `POST` saves the country preference (see Country); `GET` redirects home | D06.5 |

Link with `paths`, never hand-written strings, and never with Studio OS's legacy paths (`/login`, `/signup`, `/dashboard`, `/t/…`, `/sw.js`…): on `tattoodrip.app` nginx sends them to Studio OS ([domain migration](domain-migration.md#f-legacy-urls)). A test checks every navigation link against the route tree and that list; the server tests check every internal `href` on the homepage, directories, style and location pages with `hasRoute` (static `ROUTE_FILES` plus the dynamic `ROUTE_PATTERNS`), and that the route tree has no dynamic route that isn't listed.

## Homepage (D06)

The loader prefetches five reads in parallel with `Promise.allSettled(ensureQueryData(...))` and never throws: `homeQueries(client, country)` builds the options (tattoos `limit=24`, studios `limit=8`, artists `limit=8`, each with the page's `country`; styles; locations, kept to the page's country by `placesIn`), and the sections read the same options with `useQuery`, so the server's answers are dehydrated and reused (one request each). The loader returns which reads failed (loader data, so server and browser render the same note). A failed or thin read hides only its section; in the browser a failed read is fetched again on mount and its section appears if it succeeds. A hung read is cut off by the server client's timeout (`SERVER_TIMEOUT_MS`, 5 s; the server test checks it); no extra wait was added. Pages are `Cache-Control: private, no-store` (D06.5; see Country): takedowns propagate and no shared cache keeps one visitor's country for another. A country whose studios read answers empty shows "No studios are listed in India yet." with buttons for the other markets, above the static bands (`EmptyMarket`); it never fills in with another country's listings.

| Section (in order) | Data | Shown when (`HOME_THRESHOLDS`) |
|---|---|---|
| Hero: headline, `DiscoverySearch` (studio names, `?q=` on `/explore/studios`, the only text search the API has), Explore studios, Find artists, a quiet "For tattoo professionals" | tattoos | Always. A collage of the 4 newest photos when there are ≥4 (first eager, `fetchPriority="high"`, which React 19 turns into a `<link rel="preload">`; fixed frames); else typographic, with the three explore links set large |
| Tattoo styles | styles + tattoos | ≥3 styles that each get a different recent photo tagged with them (`pairStylesWithPhotos`, list order, at most 6; no per-style request); each tile → `/styles/:slug` (D07) |
| Recently listed studios | studios | ≥1. The API's order (`newest`, ties by id): no ranking or featuring. Rows link through `profileDestination` (the storefront today) |
| Recently added artists | artists + tattoos | ≥2. Work first (their newest recent photo, else their portrait, else their initial), "at Studio · City" or "Independent · City"; link = `profileDestination` |
| Fresh from the studios | tattoos | ≥6 photos: those the hero didn't show when 6 remain, else all; at most 12, true proportions, lazy. A photo links to its artist's or studio's page when the homepage's data holds it, else it is not a link (no `/tattoos/:id` before D09). "Explore artwork" → `/explore/tattoos` |
| Find studios near you | locations | ≥2 of the page's country's places (at most 12), under its name (→ `/locations/:country`), each → `/locations/:country/:city` (D07); no counts |
| How booking works, the Studio OS band (night, → `/for-studios`), the closing call (search, explore links, a small professional link) | static | Always |

Every read failed: one quiet `role="alert"` note with Try again (`router.invalidate()`) under the hero's search; the static bands still render. Alt text comes from the data: the photo's own `alt`, else "Blackwork tattoo by X at Y" (`tattooAlt`).

## Directories (D07)

`/explore/studios` and `/explore/artists` share one contract (`src/lib/directory.ts`) and one shell (`DirectoryPage`); their results are distinct (`StudioResults`, `ArtistResults`).

**The API's contract** ([API](api.md)): `q` (2–80 characters, a case-insensitive substring of the name: "Search studios by name", nothing semantic), `country`, `city` (needs `country`), `style` (a slug from `/styles`; an unknown one is a 422), `sort` (`newest`, the default: most recently listed / added; `name`; `-name`; ties by id), `independent` (artists only), `limit` (1–48) and `cursor`: opaque keyset paging, `nextCursor` null on the last page, a cursor valid only with the same filters and sort. There are no totals or page numbers, so Discover shows none.

**The address** (`readDirectorySearch`, the route's `validateSearch`; every key, `undefined` when malformed):

| Parameter | Read as | Sent to the API |
|---|---|---|
| `q` | 2–80 characters (a number the router parsed is text) | as `q` |
| `country` | An assigned ISO code | The address's, else the visitor's (`context.country`): always one country |
| `city` | A place slug, only when `country` is in the address | When the address's country is the page's |
| `style` | A slug, then checked against `/styles` (an unknown or uncheckable one is dropped) | as `style` |
| `sort` | `name` or `-name` (an explicit allow-list; `newest` is the default and left out) | as `sort` |
| `independent` | `true` / `false`, artists only | as `independent` |
| `cursor` | base64url, at most 1000 | as `cursor`; a cursor the API refuses (422) redirects to the same filters without it |
| `limit` | not read | always 24 (`DIRECTORY_LIMIT`) |

Anything else (`page`, `limit`, `sort=rating`…) is ignored. Beside the list the loader reads the places, the style list and the page's recent photos (`directoryWorkQuery`: the same country, city and style, 48, the same for every page and sort, so paging reuses it); a row shows its own work from it. Only the list failing is an error (the route's error state with Try again, HTTP 500); the others are optional.

**Changes reset paging.** Every link and control builds its address with `changeSearch`/`applyFilters`: a filter, search, sort or country change drops `cursor`; a new country drops `city` and keeps `q` and `style` (as `switchCountryPath`); choosing a city with an implicit country writes the page's country into the address (a city slug is unique per country only, and a shared link must mean the same for everyone). Chips (search, city, style, who) each remove only themselves; Clear all and Reset keep only the address's own country.

**Paging.** "Next page" is a real link to `?cursor=<nextCursor>` with the same filters (SSR, shareable, back/forward). On a later page "First page" is a link; "Previous page" appears when the tab came by "Next page": the earlier cursors ride in the history entry's state (`directoryTrail`), never the URL, and render after hydration only. Browser back/forward simply revisit the addresses.

**Controls.** From `lg`: a toolbar above the results (Style, City: the page's country's places, Works: artists only, Sort; native selects that apply on change; Reset) and the chips. Below `lg`: the search, then "Filters (n)" (n = city, style, who) opening the `Sheet` with the same controls, applied together with Apply or cleared with Reset; Radix traps focus, closes on Escape and returns focus to the button; 48px controls. Without JavaScript the toolbar is a plain GET form at every width with an Apply button (`noscript:` variant, `@media (scripting: none)`; the country rides along as a hidden field), and the search form carries the filters as hidden fields. The search is an explicit submit (`DiscoverySearch` with `onSearch`): no routing per keystroke, no autocomplete.

**States.** While the next address loads, the current results stay, dimmed and `aria-busy`; after a second the route's `pendingComponent` (a skeleton shaped like the rows) takes over. An `<output>` announces "24 studios shown, more on the next page." politely. Empty with a search or filters: what matched nothing, Clear filters, All of <country> (with a city), style pages, other markets (the D06.5 country form). Empty with nothing chosen: `EmptyMarket` ("No studios are listed in India yet."). An empty later page: "No more studios" with First page. Never another country's listings.

**Results.** Studios: editorial rows, picture first (a strip of three recent photos, else the cover, else one photo, else the logo, else the name's initial set in type; never stock), name, city and region, styles, "Visit studio site". No description, artist count or figures: the list has none. Artists: work first (one large photo and up to two more, else the portrait, else the initial), name, "at Studio · City" or "Independent · City", styles.

## Style and location pages (D07)

- **`/styles/:slug`** (`paths.style`): the slug must be on `/styles` (unknown or malformed: the 404 page; the list failing: the error page). Country-aware like the directories (`?country=`, else the visitor's), with the country in each query key and, when explicit, in every link the page makes. Reads `styleQueries`: 6 studios, 8 artists, 12 photos with that `style` (the tattoos endpoint filters by style). The intro is generic ("Studios and artists in Nepal who work in blackwork…"): the API has no style descriptions, so none is invented. Sections: recent work (≥3 photos), studios and artists each with "Browse all <style> studios/artists" → the filtered directory, other styles. Nothing listed: an honest empty state, other styles, and `noindex`.
- **`/locations/:country`** and **`/locations/:country/:city`** (`paths.location(code)`, `paths.city(code, slug)`): explicit geography. The country segment is a stable slug of the ISO code (`countrySlug`: a pinned slug for the configured markets, `NP` → `nepal`, `IN` → `india`, else the English name slugified, `US` → `united-states`); `countryFromSlug` maps it back, for configured markets only, by that one spelling (`/locations/np`, `/locations/Nepal` and a non-market are 404s). Add a market's pinned slug when adding a market, so an ICU rename can never move its pages. The city segment is the API's place slug (unique per country).
- **They never change meaning by visitor.** Location loaders pass their own country and city to `locationQueries` and never read `context.country`: the cookie, geolocation and even `?country=` don't change what they list (the header's selector still shows the visitor's country).
- **Policy.** A country page exists only for a configured market (`DISCOVER_MARKETS`), even with nothing listed (then an empty state with the other markets' pages, `noindex`). A city page exists only when `/locations` (places with at least one listed business) has that slug in that country; anything else is a 404, and when `/locations` can't be read the page is the error state, never a guess. A listed place whose rows have gone (a takedown) is an empty state.
- Country page: its places (→ city pages), 6 studios, 8 artists, recent work, "All studios/artists in <country>" → `?country=`. City page: studios, artists, the styles their rows name (each → the city's filtered directory), recent work, the country's other places.

## Profile destinations

D08 builds `/studios/:slug`, `/studios/:studioSlug/artists/:artistSlug` and `/artists/:tenantSlug`; until then no Discover page links to them. Every studio and artist link goes through `profileDestination(entity)` (`src/lib/destinations.ts`): today `href` is the API's `storefrontUrl` (`external: true`); `profile` is the planned path from the API's identifiers: a studio's slug; a studio's artist by studio slug and artist slug (unique per studio only, so `maya` at two studios gets two destinations, tested); an independent artist by their business's (tenant's) slug, never their own. D08 sets `PROFILE_PAGES` to true and every link moves at once (homepage, directories, hubs, photo links).

## Marketing pages and calls to action

- **Sign in / Get started** always come from `studioOsLinks(settings.studioOsUrl)` (`APP_URL` + `/login`, `/signup`), never a hard-coded or Discover-origin path.
- **`/for-studios`** (typographic, no screenshots): the hero (Get started, Explore features → `#features`, Sign in), booking and client workflows, the studio website (themes Stencil & Ink and Ink Noir; custom domains named as planned), portfolio and artists, studio or independent artist, the Discover listing (opt-in; "being prepared for launch"), the three real setup steps, a closing Get started. Every claim was checked against `apps/platform` (`start/routes.ts`, `inertia/pages`, `app/modules`) and `apps/storefront/src/routes` when written; change the page with the product.
- **`/pricing`**: Studio OS has no plans or billing code yet, so the page says pricing is being finalised and will be published before billing starts, that nothing on the site takes payment, what is included today, and that Discover has no paid placement. No tiers, figures, trials or discounts. `noindex` until real prices exist.
- **Header** (from `lg`): the three discovery links, then For studios, Pricing, Sign in, Get started; the mobile menu and footer already had Pricing. No legal pages yet: the footer's note stays.

## Country

D06.5: Discover is local-first and globally accessible. Each page lists one country's studios, artists, photos and places: the visitor's own by default, any other on request. The country is a relevance filter only. It never hides a public profile, and it has nothing to do with tenants, currency, sign-in or where anyone lives.

**Resolution** (`src/lib/country.ts`), strongest first:

| Source | Taken when |
|---|---|
| `url`: the page's `?country=` | Any assigned ISO 3166-1 alpha-2 code (a static list of the 249; Intl also names `EU`, `UK`, `XK`, `ZZ`…, and Cloudflare sends `XX` and `T1`). A country that isn't a market may be browsed explicitly: it shows the honest empty state |
| `cookie`: `td_country` | It names a market |
| `geo`: the trusted proxy's header | `DISCOVER_GEO_HEADER` is set, and the header names a market |
| `fallback` | `DISCOVER_DEFAULT_COUNTRY` |

A malformed code (`XX1`, `nepal`) is ignored, never a 422 from the API. Names come from `Intl.DisplayNames(["en"])`, a fixed locale, so the server's HTML and the browser's hydration agree.

**Per request, never module state.** `getRouter()`'s server branch (`src/lib/request.ts`) reads this request's `Cookie` and, only when configured, the trusted header (`getRequest()` from `@tanstack/react-start/server`) into `context.preference` (cookie, geo or fallback). The root route's `validateSearch` reads `?country=` for every page, and its `beforeLoad` returns `country` (`pageCountry`: the address's, else the preference), which every loader and component reads as `context.country`. The preference goes to the browser in the dehydrated state beside the settings (checked again on hydrate: a market code and a known source); the root match's `country` is dehydrated with the matches, so the browser hydrates exactly what the server rendered.

**Queries.** Studios, artists and photos send `country` to the API (each accepts it; an unassigned code would be an empty page, a malformed one a 422, which the readers prevent), so it is part of every query key: `discoverKeys.studios({ country: "NP" })` and `({ country: "IN" })` are separate entries, and a late answer for the previous country can never fill the new one's. `/locations` has no country filter: it is small reference data, so pages keep their country's places (`placesIn`). Styles are global. Loaders list `country` in `loaderDeps`.

**The preference cookie.** `td_country=<market>`: host-only (no `Domain`, so it never reaches Studio OS or a studio's site), `Path=/`, `SameSite=Lax`, `HttpOnly` (only the server reads it; the page knows the country from its router context), `Secure` when `DISCOVER_URL` is https, `Max-Age` one year. Only a market is ever stored. No other cookie exists. It is set only by `POST /preferences/country` (`src/lib/preference.ts`), fields `country` and `return`:

- A plain form post (no JavaScript) gets a `303` to `return`, a same-origin path (`safeReturnPath`: one leading `/`, no `//`, backslash, scheme or control character; anything else is `/`), with its `country` replaced and its `city` dropped (`switchCountryPath`).
- The selector's fetch (`Accept: application/json`) gets `{ country }`.
- A code that isn't a market is never saved (`422` for the fetch; the form goes back unchanged). A cross-site post (`Sec-Fetch-Site` other than `same-origin` or `none`) is a `403`.

**Switching** (`country-selector.tsx`). Every control is a real `<form method="post">` of country buttons, so it works without JavaScript. With it, the selector posts by fetch, sets the tab's `preference`, then either navigates to the same address with `country` replaced and `city` dropped (`q`, `style` and the path kept), when the address names a country, or re-runs the loaders (`router.invalidate()`). A failed fetch falls back to the plain post.

- **Desktop** (from `lg`): a disclosure (`<details>`, uncontrolled so a fast Escape and Enter can't be undone by a late render) naming the current country, opening a small panel of country buttons; the current one has `aria-current` and a check. Enter or a click opens it, Escape or a press outside closes it, focus returns to the trigger after a switch. From `lg` to `xl` the trigger drops its icons and cuts a long name, so the header stays on one line at 1024px.
- **Mobile:** a labelled "Country" group in the menu sheet, 48px rows; the sheet closes after a switch and Radix returns focus to the menu button.
- **One market:** the country is shown as text (and in the sheet, "Discover lists studios in Nepal for now."): a picker with one choice is noise. A page with an explicit non-market `?country=` still offers the market.

**Empty market.** Home, `/explore/studios` and `/explore/artists` (no `q` or filters) say "No studios are listed in India yet." (or artists) with buttons for the other markets. They never borrow another country's listings.

**Trusted header and nginx.** Discover never reads `CF-IPCountry` (the setting refuses it): a visitor can send it. In the split layout (`deploy/nginx/hosts.split.conf`), nginx makes `$discover_country` from `CF-IPCountry` only on a connection from cloudflared (`172.30.42.20`, matched on `$realip_remote_addr`, the same trust as the visitor's address in `common.conf`) and only as two letters. Discover's location always sets `X-Discover-Country` from it, empty (not sent) for anyone else, so a visitor's own header never passes. The tunnel is the only way in, so no Cloudflare IP list is needed. `deploy/test/nginx/run.sh` checks it. Geolocation stays off (`DISCOVER_GEO_HEADER` unset) until D11 has verified that Cloudflare overwrites a visitor's own `CF-IPCountry` and that Discover's port is not published ([domain migration](domain-migration.md), step 15). The compose service publishes no port; only the stack's network reaches it.

**Caching.** Every HTML response (the root route's `headers`) is `Cache-Control: private, no-store` with `Vary: Cookie`, because the header and the lists depend on the cookie and the geolocation header. `Vary` is only a second line. Before D06.5 pages set no `Cache-Control`. `/robots.txt` (`public, max-age=300`), the sitemap and the hashed static assets keep their own headers. Cloudflare doesn't cache HTML by default; no cache rule may cover Discover's pages until D10/D11 design a keyed strategy.

**SEO.** The canonical stays the path alone, so `?country=` variants never canonicalise as separate pages, and a page with an explicit `?country=` is `noindex` (meta and `X-Robots-Tag`) whatever `DISCOVER_INDEXING` says. Nothing ever redirects by country. A crawler without a cookie or header gets the default country, deterministically; a crawler that comes through Cloudflare with geolocation on gets its own country. Crawlable geographic entry points are D07's location pages (`/locations/nepal`, `/locations/nepal/kathmandu`), which never depend on the visitor's country. `DISCOVER_INDEXING` behaves as before.

**Directories vs location pages.** Directories and style pages follow the page's country (explicit `?country=`, else the visitor's); location pages always list their own. A crawler without a cookie sees the default country on a directory or style page, deterministically.

**Profiles (D08).** No profile route exists yet. Storefront and profile links come from the API as they are (through `profileDestination`) and never carry `country`; a profile must never be hidden or redirected by country.

**Local development.**

- Add a market: `DISCOVER_MARKETS=NP,IN` in `.env.local` (restart `pnpm dev`). A market with no listed studio shows the empty state.
- Simulate geolocation: `DISCOVER_GEO_HEADER=X-Discover-Country`, then `curl -H 'X-Discover-Country: IN' http://localhost:3100/`, or a browser extension that sets the header. Without the setting the header is ignored.
- Try a country without the selector: `/?country=IN`; clear the preference by deleting the `td_country` cookie.

## Data loading pattern

`/explore/studios` is the pattern every data page follows (D07: the loader is shared, `loadDirectory` in `src/lib/directory-loader.ts`):

```ts
export const Route = createFileRoute("/explore/studios")({
	validateSearch: (search) => readDirectorySearch(search, "studios"), // every key
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => loadDirectory("studios", context, deps), // ensureQueryData + rethrowUnavailable
	head: ({ match }) => directoryHead("studios", match),
	component: Studios, // useSuspenseQuery(discoverQueries.studios(client, directoryQuery(filters, "studios")))
});
```

- The loader runs on the server for the first page and in the browser after; the server's result is streamed into the browser's cache, so the component's `useSuspenseQuery` doesn't fetch again.
- Use `discoverQueries` / `discoverKeys` from `@tattoo-drip/react` (D03); never a second client or a hand-made key. Each query forwards TanStack Query's `signal`: a component's query is cancelled when nothing observes it any more (a loader's prefetch is not tied to the navigation).
- Validate search params before they reach the API (`readQuery`: 2–80 characters, as the API requires). `validateSearch` must return every key it owns, `undefined` when malformed: the router merges its result over the raw search, so a key left out keeps the raw value.
- A loader ends with `.catch(rethrowUnavailable)` (`src/lib/api-errors.ts`): the server's error reaches the browser as a plain `Error`, so a transient failure (no answer, timeout, 5xx, 429) is rethrown with a marked message that `RouteErrorState` recognises on both sides ("Discover is unavailable for a moment", Try again; HTTP 500). An empty answer shows `EmptyState`. Never invent rows, figures or reviews.
- The root layout reads no API data, so the shell, `/robots.txt` and the health check never wait on the API.

## Settings

| Variable | Required | Meaning |
|---|---|---|
| `API_URL` | yes | The platform API's origin; the SDK appends `/api/v1`. The browser calls it too (the platform's CORS allows `DISCOVER_URL`, D01) |
| `MEDIA_URL` | no | Where public photos are served from (the platform's `R2_PUBLIC_URL`); default: `API_URL` |
| `DISCOVER_URL` | yes | Discover's own origin: canonical and social URLs. The platform's `DISCOVER_URL` is the same value |
| `APP_URL` | yes | Studio OS's origin: Sign in (`/login`) and Get started (`/signup`). Must differ from `DISCOVER_URL`'s host |
| `DISCOVER_INDEXING` | no | `on` lets search engines in; anything else unset or `off` |
| `DISCOVER_MARKETS` | no | The countries Discover is local-first for, comma-separated ISO 3166-1 alpha-2 codes, in the selector's order. Default `NP` |
| `DISCOVER_DEFAULT_COUNTRY` | no | A visitor's country with no preference; one of the markets. Default: the first market |
| `DISCOVER_GEO_HEADER` | no | The header the trusted proxy sets to the visitor's country (`X-Discover-Country` behind `deploy/nginx`). Unset: geolocation off (the default). `CF-IPCountry` is refused |

Origins are https, or http on localhost. All but `DISCOVER_GEO_HEADER` (server only) are public: the browser receives them in the router's dehydrated state. None is a secret; a secret added later must stay out of `publicSettings`. `pnpm build` ends with a check that the browser bundle holds no server-only text (`scripts/check-client-bundle.mjs`).

Server-side reads are anonymous for now: the API rate-limits them per address, so before launch (D11) Discover's server needs a key (the blueprint's named server keys, or one of the platform's `STOREFRONT_SERVER_KEYS`) with the visitor's address forwarded, as the storefront does.

## SEO and indexing

- Every page's head is rendered on the server: title (`Page | Tattoo Drip`, or the default), description, canonical (`DISCOVER_URL` + the path, whatever host the request came on), Open Graph and Twitter basics. A page adds its own with `pageMeta({ title, description, noindex })`; the deepest match wins for each tag.
- **Indexing off** (the default): every page has `<meta name="robots" content="noindex, nofollow">` and an `X-Robots-Tag: noindex, nofollow` header, `/robots.txt` disallows everything, `/sitemap.xml` is a 404.
- **Indexing on**: only the paths in `INDEXABLE_PATHS` (`src/lib/seo.ts`: `/`, `/for-studios` and, since D07, the bare `/explore/studios` and `/explore/artists`) and those matching `INDEXABLE_PATTERNS` (D07: `/styles/<slug>`, `/locations/<slug>` and `/locations/<slug>/<slug>`) may be indexed, and not if the page passes `noindex: true`; every other page still says noindex. `/robots.txt` allows and names the sitemap, which lists exactly `INDEXABLE_PATHS`. A finished page is added to that list (D06–D10).
- **D07 rules.** A directory with any parameter (filters, search, sort, cursor, `?country=`) passes `noindex` (`hasSearchParams`): filter combinations are never indexable (blueprint H; the meta says `noindex, nofollow`, not H's `noindex, follow`: D10 decides). Style and location pages are the canonical discovery destinations, indexable by shape once DISCOVER_INDEXING is on; an unknown slug is a 404 (noindex), and a page with nothing listed passes `noindex`. Canonicals stay the path alone on `DISCOVER_URL` (an index route's trailing `/` is dropped: `/locations/nepal`). Titles say what the page lists ("Blackwork tattoo studios in Kathmandu", "Tattoo studios and artists in Kathmandu, Nepal"), server-rendered from loader data. With indexing off nothing changes.
- **Sitemap.** Still the static `INDEXABLE_PATHS`; style and place URLs need the API's lists at request time, so D10 adds `styles.xml` and `places.xml`. A style page's listings follow the visitor's country (a crawler gets the default); D10 may add per-country style URLs if that proves thin.

## Design system

All tokens are in `src/styles.css`; components use them, never hex values.

- **Semantic tokens** are a plain `@theme`, not `@theme inline` (D06 fix): the utilities read `var(--color-muted-foreground)` and friends, so `.night` really redefines them. Inlined, `text-muted-foreground` stayed paper's ink-muted on night (about 2.6:1).
- **Palette:** paper `#f5f2ec` (page), paper-raised and paper-sunk, ink `#111111`, ink-muted, line and line-strong, accent red `#b4232c` (small accents and focus; text only on paper), and the night set for dark sections (`.night`: `#111111`, night-ink, night-muted, accent-bright `#e5484f` for text and focus there, 4.8:1). Contrast is measured and noted in the file (body text ≥ 6.3:1, control borders ≥ 3:1). shadcn's semantic names (`background`, `foreground`, `muted-foreground`, `border`, `ring`, `primary`) map onto them, and `.night` redefines them for its section.
- **Type:** Eczar 700 (display) and Geist variable (UI and text), vendored from Studio OS with their OFL licences; Latin preloaded, `font-display: swap`. Fluid display sizes `text-display-xl/lg/md` (clamp, phone first); `eyebrow` for small uppercase labels.
- **Layout:** `PageContainer` (90rem wide, or a 48rem reading width) with `page-gutter` (16, 24 then 40px); `EditorialSection` for full-bleed bands with the vertical rhythm (64px, 96px from `lg`), `tone="night"` for a dark one. Breakpoints are Tailwind's (`sm` 40rem, `lg` 64rem: where the header shows every link).
- **Interaction:** 2px-radius buttons (no pills), 44px targets below `lg`, one focus ring (2px accent, 3px offset; accent-bright on night), subtle transitions only, and everything instant under `prefers-reduced-motion`. No animation library.
- **Brand:** the "Tattoo Drip" wordmark in Eczar, as in Studio OS; the favicon is Studio OS's interim mark (TAT-67). No new logo.

## Shell

- **Header:** sticky, 64px, one hairline. From `lg`: the wordmark, "Explore studios", "Find artists", "Tattoo inspiration" (an underline marks the current page, `aria-current`), the country (D06.5), "For studios", Sign in and Get started (Studio OS). Below `lg`: the wordmark and a menu button.
- **Mobile menu:** a modal sheet (Radix Dialog): focus moves in and is trapped, Escape and Close return focus to the button, the page behind is inert. Three labelled groups (Discover; Country; For businesses, with Pricing, Sign in and Get started). It closes when a link is followed and when the window reaches `lg`.
- **Footer:** a night band with the wordmark, the Explore and For professionals links, the copyright, and a note that the privacy policy and terms are coming before launch: there are no legal pages yet, so nothing links to one (D06 drafts them for review).
- **Search:** `DiscoverySearch` is a real `GET` form inside a `<search>` landmark (a visible label, 2–80 characters, a Clear button; a `pending` search refuses a second submit; `hidden` fields keep a page's other parameters), so it works without JavaScript; with it, it navigates in the app or calls `onSearch`. Point it only at a route that reads the parameter (`/explore/studios`, `/explore/artists`).

## Commands

From `apps/discover` (or `pnpm dev:discover` at the root):

- `pnpm dev`: port 3100 (whatever `PORT` the shell has), reads `.env.local` (copy `.env.example`). The platform's `DISCOVER_URL` must be `http://localhost:3100` for the browser's API calls (CORS).
- `pnpm build`: Vite + Nitro to `.output` (a self-contained Node server), then the bundle check. `pnpm start` runs it (`PORT`, default 3000).
- `pnpm test`: `node:test` + `tsx` (`test/`): settings, SEO, routes and navigation, the per-request context, the primitives, the homepage rules (`home.test.ts`), the search readers (`search.test.ts`), the directories' address (`directory.test.ts`), destinations (`destinations.test.ts`), country resolution, location slugs, the cookie and the preference endpoint (`country.test.ts`), and the built server (`server.test.ts`, D07's `server-d07.test.ts`, helpers in `built-server.ts`) against a stub API serving 0, 3, 20 or 40 of everything, honouring `q`, `country`, `city`, `style`, `independent`, `studio`, `sort`, `limit` and `cursor` like the API (an offset cursor; divergences in `stub-api.ts`), with failing and hanging endpoints (skipped without a build).
- `pnpm typecheck`, `pnpm generate-routes`. Biome from the root.

## Deployment

Not deployed in D05. Prepared for D11:

- `Dockerfile` target `discover`, with its own build stage, so the platform and storefront images build as before.
- `deploy/compose.yml` service `discover` at `172.30.42.13` (the address `hosts.split.conf`'s upstream names), behind the `discover` profile: a plain `up` doesn't start it. Settings: `deploy/env/discover.env.example`.
- Health: `/` below 500 (it reads no API data). Missing or malformed settings make every request a 500 with the variables named in the log, so the health check fails.
- Hostname routing is nginx's: Discover only on the apex, with the legacy paths redirected ([domain migration](domain-migration.md)). Discover never registers a service worker.

## Deferred

Legal pages (privacy, terms: drafts need the product owner's review; not in D06); turning geolocation on (D11, after the checks above); a keyed edge cache for country pages (D10/D11); published prices on `/pricing`; a `/styles` index and per-country style URLs (D10, if needed); D08 profiles and booking hand-off (flip `PROFILE_PAGES`; Discover links to storefront pages until then); each directory row's own recent work by a per-row read, if the shared read (the filters' 48 newest photos) proves too thin; D09 the tattoo gallery and artwork pages (`/tattoos/:id`); D10 sitemaps, structured data, OG images, budgets and the Lighthouse targets; D11 the server key, deployment and cutover.
