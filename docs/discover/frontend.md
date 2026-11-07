# Discover frontend

Discover D05 (foundation), D06 (homepage, Studio OS marketing), D06.5 (country-aware discovery), D07 (directories, style and location pages), D08 (public profiles and the storefront booking hand-off) and D09 (the tattoo gallery and artwork pages). The public site at `tattoodrip.app`: `apps/discover`, a TanStack Start app beside the storefront. It reads only the public [Discover API](api.md) and has no database, no auth and no platform imports. D10–D11 finish SEO, performance and the launch on this foundation.

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
| `src/lib/search.ts` | Search-parameter readers (`readQuery`, `readCountry`, `readCity`, `readStyle`, `knownStyle`) and the router's text-only search parser (`parseSearchText`, `stringifySearchText`) |
| `src/lib/directory.ts` | The directories' URL contract (D07): `readDirectorySearch`, `directoryQuery`, `changeSearch`/`applyFilters`/`chooseCity`, chips, recent-work pairing (pure) |
| `src/lib/directory-loader.ts` | The directories' shared loader, head and list hook |
| `src/lib/hubs.ts` | The style and location pages' queries (`styleQueries`, `locationQueries`, `HUB_LIMITS`) |
| `src/lib/destinations.ts` | `profileDestination`: where a studio or artist links (Discover's profile since D08), `tattooProfile` (a photo's artist's profile), `tattooDestination` (a photo's artwork page, D09) |
| `src/lib/gallery.ts`, `gallery-loader.ts` | D09: the gallery's URL contract (`readGallerySearch`, `resolveGallery`, `galleryQuery`, `changeGallery`, chips, titles), the search box's rule (`nextSearch`, `SEARCH_DEBOUNCE_MS`), the loader and head (pure but for the loader) |
| `src/lib/artwork.ts` | D09: the artwork slug (`readArtworkSlug`), title and SEO, the related reads and their merge (`relatedQueries`, `relatedWork`), the loader (404, 301), the gallery's history mark |
| `src/lib/profiles.ts` | D08: the profiles' queries, loaders (404, 301), slug readers, head data, "near here" links |
| `src/lib/booking.ts` | D08: the booking hand-off (`bookingLinks`): which API links may be linked, rebuilt from their checked parts (D09: an artwork's `artwork`) |
| `src/lib/home.ts` | The homepage's queries (`homeQueries`), limits, thresholds and pure section rules |
| `src/lib/seo.ts` | Head tags, the canonical URL, robots and sitemap text |
| `src/routes/` | File routes (`routeTree.gen.ts` is generated) |
| `src/components/ui` | shadcn-style primitives on Discover's tokens: `Button`, `Input`, `Sheet` |
| `src/components/layout` | The shell: `SiteHeader`, `MobileNav`, `SiteFooter`, `Wordmark`, `NavLink`; `country-selector.tsx` (the selector, the mobile Country group, `EmptyMarket`) |
| `src/components/discovery` | Page primitives: `PageContainer`, `EditorialSection`, `SectionHeading`, `PageHeader`, `Breadcrumbs`, `ResponsiveImage`, `DiscoverySearch`, `EmptyState`, `ErrorState`, `LoadingSkeleton`, `NotFoundState`, `RouteErrorState`, `FoundationNotice` |
| `src/components/home` | The homepage's hero and sections (D06) |
| `src/components/directory` | D07: `DirectoryPage` (search, toolbar, chips, states, paging), `filters.tsx` (`FilterToolbar`, `MobileFilters`, `ActiveFilters`), `Pagination`, `StudioResults`, `ArtistResults`, and the hub pieces (`HubSection`, `WorkColumns`, `LinkList`, `MoreLink`) |
| `src/components/gallery` | D09: `artwork-tile.tsx` (`ArtworkTile`, `ArtworkColumns`, `ArtworkCredit`: every photo tile on Discover), `gallery-page.tsx`, `gallery-search.tsx` (the debounced search), `artwork-page.tsx` (`ArtworkImage`, `FullSizeLink`, `ShareActions`, `BackToGallery`) |
| `src/components/profile` | D08: `profile.tsx` (`ProfileHero`, `HeroMedia`, `BookingActions`, `StickyBooking`, `Portfolio`, `StyleLinks`, `SocialLinks`, `Facts`, `PlainText`, `RelatedLinks`) and `artist-profile.tsx` (both artist pages) |

The root route (`__root.tsx`) renders the document, the skip link, the header, `<main id="main">` and the footer for every page, inside `DiscoverProvider` (so `@tattoo-drip/react`'s `useDiscover*` hooks work); the QueryClientProvider comes from `setupRouterSsrQueryIntegration`.

## Routes

| Path | Now | Finished in |
|---|---|---|
| `/` | **D06 homepage**: discovery hero, styles, studios, artists, inspiration, places, how booking works, the Studio OS band, a closing call (see Homepage) | D06 |
| `/explore/studios` | **D07 directory**: the page's country's listed studios; name search, city, style, sort, cursor paging (see Directories); indexable only bare | D07 |
| `/explore/artists` | **D07 directory**: the same contract plus `independent`; work-first cards | D07 |
| `/styles/:slug` | **D07 style page**: one style's studios, artists and work in the page's country; unknown slug 404 | D07 (sitemap D10) |
| `/locations/:country`, `/locations/:country/:city` | **D07 location pages**: a market's or a city's studios, artists, places and styles; never by the visitor's country; non-market or unknown city 404 | D07 (sitemap D10) |
| `/tattoos` | **D09 gallery**: published photos in the page's country; search, style, city, artist or studio, cursor paging (see Gallery); indexable only bare | D09 |
| `/tattoos/:slug` | **D09 artwork page** (see Artwork pages); the slug is the photo's id | D09 |
| `/explore/tattoos` | **301** to `/tattoos`, query string kept (D05's placeholder address) | D09 |
| `/for-studios` | **D06**: Studio OS for professionals; indexable | D06 |
| `/pricing` | **D06**: informational, no prices yet; `noindex` until prices are published | D06 (prices later) |
| `/studios/:studioSlug` | **D08 studio profile** (see Profiles) | D08 |
| `/studios/:studioSlug/artists/:artistSlug` | **D08 studio artist profile** | D08 |
| `/artists/:tenantSlug` | **D08 independent artist profile**, by their business's slug | D08 |
| `/robots.txt`, `/sitemap.xml` | Server routes, see SEO | D10 |
| `/preferences/country` | Server route: `POST` saves the country preference (see Country); `GET` redirects home | D06.5 |

Link with `paths`, never hand-written strings, and never with Studio OS's legacy paths (`/login`, `/signup`, `/dashboard`, `/t/…`, `/sw.js`…): on `tattoodrip.app` nginx sends them to Studio OS ([domain migration](domain-migration.md#f-legacy-urls)). A test checks every navigation link against the route tree and that list; the server tests check every internal `href` on the homepage, directories, style, location and profile pages with `hasRoute` (static `ROUTE_FILES` plus the dynamic `ROUTE_PATTERNS`), and that the route tree has no dynamic route that isn't listed. `REDIRECT_FILES` lists the addresses that only redirect (`/explore/tattoos`): routes exist for them, and no page links to them.

## Homepage (D06)

The loader prefetches five reads in parallel with `Promise.allSettled(ensureQueryData(...))` and never throws: `homeQueries(client, country)` builds the options (tattoos `limit=24`, studios `limit=8`, artists `limit=8`, each with the page's `country`; styles; locations, kept to the page's country by `placesIn`), and the sections read the same options with `useQuery`, so the server's answers are dehydrated and reused (one request each). The loader returns which reads failed (loader data, so server and browser render the same note). A failed or thin read hides only its section; in the browser a failed read is fetched again on mount and its section appears if it succeeds. A hung read is cut off by the server client's timeout (`SERVER_TIMEOUT_MS`, 5 s; the server test checks it); no extra wait was added. Pages are `Cache-Control: private, no-store` (D06.5; see Country): takedowns propagate and no shared cache keeps one visitor's country for another. A country whose studios read answers empty shows "No studios are listed in India yet." with buttons for the other markets, above the static bands (`EmptyMarket`); it never fills in with another country's listings.

| Section (in order) | Data | Shown when (`HOME_THRESHOLDS`) |
|---|---|---|
| Hero: headline, `DiscoverySearch` (studio names, `?q=` on `/explore/studios`), Explore studios, Find artists, a quiet "For tattoo professionals" | tattoos | Always. A collage of the 4 newest photos when there are ≥4 (first eager, `fetchPriority="high"`, which React 19 turns into a `<link rel="preload">`; fixed frames); else typographic, with the three explore links set large |
| Tattoo styles | styles + tattoos | ≥3 styles that each get a different recent photo tagged with them (`pairStylesWithPhotos`, list order, at most 6; no per-style request); each tile → `/styles/:slug` (D07) |
| Recently listed studios | studios | ≥1. The API's order (`newest`, ties by id): no ranking or featuring. Rows link through `profileDestination` (the studio's profile since D08) |
| Recently added artists | artists + tattoos | ≥2. Work first (their newest recent photo, else their portrait, else their initial), "at Studio · City" or "Independent · City"; link = `profileDestination` |
| Fresh from the studios | tattoos | ≥6 photos: those the hero didn't show when 6 remain, else all; at most 12, true proportions, lazy. A photo opens its artwork page (D09), its artist's name (a separate link in the caption) their profile. "Explore artwork" → `/tattoos`. The hero's collage photos open their artwork pages too |
| Find studios near you | locations | ≥2 of the page's country's places (at most 12), under its name (→ `/locations/:country`), each → `/locations/:country/:city` (D07); no counts |
| How booking works, the Studio OS band (night, → `/for-studios`), the closing call (search, explore links, a small professional link) | static | Always |

Every read failed: one quiet `role="alert"` note with Try again (`router.invalidate()`) under the hero's search; the static bands still render. Alt text comes from the data: the photo's own `alt`, else "Blackwork tattoo by X at Y" (`tattooAlt`).

## Directories (D07)

`/explore/studios` and `/explore/artists` share one contract (`src/lib/directory.ts`) and one shell (`DirectoryPage`); their results are distinct (`StudioResults`, `ArtistResults`).

**The API's contract** ([API](api.md)): `q` (2–80 characters, a case-insensitive substring of the name: "Search studios by name", nothing semantic), `country`, `city` (needs `country`), `style` (a slug from `/styles`; an unknown one is a 422), `sort` (`newest`, the default: most recently listed / added; `name`; `-name`; ties by id), `independent` (artists only), `limit` (1–48) and `cursor`: opaque keyset paging, `nextCursor` null on the last page, a cursor valid only with the same filters and sort. There are no totals or page numbers, so Discover shows none.

**The address** (`readDirectorySearch`, the route's `validateSearch`; every key, `undefined` when malformed):

| Parameter | Read as | Sent to the API |
|---|---|---|
| `q` | 2–80 characters, no control character (the API's rule); the router keeps every search value as text (`parseSearchText`), so `?q=true`, `?q=null` and `?q=007` are those searches | as `q` |
| `country` | An assigned ISO code | The address's, else the visitor's (`context.country`): always one country |
| `city` | A place slug, only when `country` is in the address | When the address's country is the page's |
| `style` | A slug, then checked against `/styles` (an unknown one is dropped; so is one that can't be checked while `/styles` fails, and the page says "Styles are unavailable right now, so this list isn't filtered by style.") | as `style` |
| `sort` | `name` or `-name` (an explicit allow-list; `newest` is the default and left out) | as `sort` |
| `independent` | `true` / `false`, artists only | as `independent` |
| `cursor` | base64url, at most 1000 | as `cursor`; a cursor the API refuses (422) redirects to the same filters without it |
| `limit` | not read | always 24 (`DIRECTORY_LIMIT`) |

Anything else (`page`, `limit`, `sort=rating`…) is ignored. Beside the list the loader reads the places, the style list and the page's recent photos (`directoryWorkQuery`: the same country, city and style, 48, the same for every page and sort, so paging reuses it); a row shows its own work from it. Only the list failing is an error (the route's error state with Try again, HTTP 500); the others are optional.

**Changes reset paging.** Every link and control builds its address with `changeSearch`/`applyFilters`: a filter, search, sort or country change drops `cursor`; a new country drops `city` and keeps `q` and `style` (as `switchCountryPath`); choosing a city with an implicit country writes the page's country into the address (a city slug is unique per country only, and a shared link must mean the same for everyone). Chips (search, city, style, who) each remove only themselves; Clear all and Reset keep only the address's own country.

**Paging.** "Next page" is a real link to `?cursor=<nextCursor>` with the same filters (SSR, shareable, back/forward). On a later page "First page" is a link; "Previous page" appears when the tab came by "Next page": the earlier cursors ride in the history entry's state (`directoryTrail`), never the URL, and render after hydration only. Browser back/forward simply revisit the addresses.

**Controls.** From `lg`: a toolbar above the results (Style, City: the page's country's places, Works: artists only, Sort; native selects applied together with a visible Apply, never on change, so arrowing through a closed select doesn't navigate (WCAG 3.2.2); Reset) and the chips. Below `lg`: the search, then "Filters (n)" (n = city, style, who) opening the `Sheet` with the same controls, applied together with Apply or cleared with Reset; Radix traps focus, closes on Escape and returns focus to the button; 48px controls. Without JavaScript the toolbar is the same GET form at every width (`noscript:` variant, `@media (scripting: none)`; the country rides along as a hidden field), and the search form carries the filters as hidden fields. The search is an explicit submit (`DiscoverySearch` with `onSearch`): no routing per keystroke, no autocomplete.

**States.** While the next address loads, the current page stays mounted, its results dimmed and `aria-busy`. The directory routes have no `pendingComponent`: after `pendingMs` it would hide the page (Suspense) and take focus from the control that applied the change. An `<output>` announces "24 studios shown, more on the next page." politely. Empty with a search or filters: what matched nothing, Clear filters, All of <country> (with a city), style pages, other markets (the D06.5 country form). Empty with nothing chosen: `EmptyMarket` ("No studios are listed in India yet."). An empty later page: "No more studios" with First page. Never another country's listings.

**Results.** Rows link to the Discover profiles (D08, through the router: `ProfileLink`). While `PROFILE_PAGES` was off (D07) every link left Discover and told screen readers where it went (`artistSiteNote`); that note now appears only for an external destination. Studios: editorial rows, picture first (a strip of three recent photos, else the cover, else one photo, else the logo, else the name's initial set in type; never stock), name, city and region, styles, "View studio". No description, artist count or figures: the list has none. Artists: work first (one large photo and up to two more, else the portrait, else the initial), name, "at Studio · City" or "Independent · City", styles.

## Style and location pages (D07)

- **`/styles/:slug`** (`paths.style`): the slug must be on `/styles` (unknown or malformed: the 404 page; the list failing: the error page). Country-aware like the directories (`?country=`, else the visitor's), with the country in each query key and, when explicit, in every link the page makes. Reads `styleQueries`: 6 studios, 8 artists, 12 photos with that `style` (the tattoos endpoint filters by style). The intro is generic ("Studios and artists in Nepal who work in blackwork…"): the API has no style descriptions, so none is invented. Sections: recent work (≥3 photos), studios and artists each with "Browse all <style> studios/artists" → the filtered directory, other styles. Nothing listed: an honest empty state, other styles, and `noindex`.
- **`/locations/:country`** and **`/locations/:country/:city`** (`paths.location(code)`, `paths.city(code, slug)`): explicit geography. The country segment is a stable slug of the ISO code (`countrySlug`: a pinned slug for the configured markets, `NP` → `nepal`, `IN` → `india`, else the English name slugified, `US` → `united-states`); `countryFromSlug` maps it back, for configured markets only, by that one spelling (`/locations/np`, `/locations/Nepal` and a non-market are 404s). Add a market's pinned slug when adding a market, so an ICU rename can never move its pages. The city segment is the API's place slug (unique per country).
- **They never change meaning by visitor.** Location loaders pass their own country and city to `locationQueries` and never read `context.country`: the cookie, geolocation and even `?country=` don't change what they list (the header's selector still shows the visitor's country).
- **Policy.** A country page exists only for a configured market (`DISCOVER_MARKETS`), even with nothing listed (then an empty state with the other markets' pages, `noindex`). A city page exists only when `/locations` (places with at least one listed business) has that slug in that country; anything else is a 404, and when `/locations` can't be read the page is the error state, never a guess. A listed place whose rows have gone (a takedown) is an empty state.
- Country page: its places (→ city pages; optional: when `/locations` fails the page has no Cities section, while the city page is the error state), 6 studios, 8 artists, recent work, "All studios/artists in <country>" → `?country=`. City page: studios, artists, the styles their rows name (each → the city's filtered directory), recent work, the country's other places.

## Profile destinations

Every studio and artist link in a list goes through `profileDestination(entity)` (`src/lib/destinations.ts`), and since D08 `PROFILE_PAGES` is true: `href` is Discover's own profile, built from the API's identifiers: a studio's (current) slug; a studio's artist by studio slug and artist slug (unique per studio only, so `maya` at two studios is two profiles, tested); an independent artist by their business's (tenant's) slug, never their own. Since D09 every photo tile (`ArtworkTile`: home, hubs, profiles, the gallery, related work) opens its artwork page (`tattooDestination`, by the photo's id), and its caption links the artist's profile from the photo's own data (`tattooProfile`: `studio.type`, `studio.slug`, `artist.slug`) as a separate link: one primary link per tile, never nested. Directory rows stay whole-row profile links. Internal links go through the router (`ProfileLink`); the storefront stays the profile's booking and "Visit studio site" action. Setting `PROFILE_PAGES` false restores D07's storefront links (kept for a rollback; tests cover both).

## Profiles (D08)

**Data.** One detail read per page, by the address's identifiers, through `discoverQueries` (`src/lib/profiles.ts`), on the server with `ensureQueryData` and in the component with the same options:

| Route | Read | Holds |
|---|---|---|
| `/studios/:studioSlug` | `getDiscoverStudio` | Summary, intro, social links, up to 100 artists, the 12 newest photos, `bookingUrl` |
| `/studios/:studioSlug/artists/:artistSlug` | `getDiscoverStudioArtist` + `listDiscoverStudioArtists` (in parallel; the second optional: its failure hides "More artists") | Artist summary, bio, social links, 12 newest photos, `bookingUrl` (names the artist) |
| `/artists/:tenantSlug` | `getDiscoverIndependentArtist` | The same as a studio's artist; `studio` is their own business |

The detail answers already hold the portfolio (12) and a studio's artists, so no tattoos or artists list is read. No read sends `country`.

**Visibility.** A slug the API can't take (studio: 3–63, `[a-z0-9-]`; artist 2–63) is the 404 page without a request. The API's 404 (unknown, never listed, opted out, hidden, taken down, deleted, another studio's artist, an independent under `/studios/:slug/artists/…`, a studio under `/artists/…`) is `notFound()` (`rethrowMissing`): HTTP 404, `noindex`, the generic "Nothing here" page with no title, image or name from the profile. A transient failure is `RouteErrorState` (500). An old slug (the answer names another) is a **301** to the current address; a listed independent's slug under `/studios/` is a 301 to `/artists/:slug` (blueprint H; one more read, only after the 404). The stub (`test/stub-api.ts`) mirrors these rules; the platform's own are in `tests/functional/api/discover.spec.ts`.

**Freshness.** HTML stays `private, no-store` (as every page), so a withdrawn or taken-down profile is a 404 on the next request; the API's own `public, max-age=60, stale-while-revalidate=60` is the only delay (up to 2 minutes), and the browser's query cache keeps a profile 60 s within a tab.

**Country.** Profiles are global: no country is read or sent, nothing is filtered or redirected by it; the place shown is the profile's own (`placeLine`). The header still shows the visitor's country. "Near here" links use the profile's place: for a market its city and country pages, else the directory filtered to that country and city (`nearbyLinks`); "Back to studios" / "Back to artists" go to the directories as they are (the visitor's country).

**Design.** `ProfileHero`: breadcrumbs, eyebrow, the one h1 (with the logo, or the portrait when the hero shows work), the place and style links (→ `/styles/:slug`), then the picture and the booking actions. On a phone they stack identity, picture, booking; from `lg` the picture takes the right column. The picture is the cover (a studio), else the newest photo, else the portrait (an artist), else the name in type on night; it loads first (`fetchPriority="high"`, eager) in a fixed frame (4:5 phone, 3:2, then 4:3), no overlay. Then: About (intro or bio as plain text, paragraphs kept, beside `Facts`: where, artists or studio, https social links) only when there is an intro, bio or link; the portfolio (night, columns at true proportions, lazy; a studio's captions name the artist and link their profile); a studio's artists, work first (`ArtistResults` with the portfolio); an artist's "More artists at <studio>" (compact, optional read); a Booking band; Keep exploring. Empty sections are not rendered. Below `lg` a booking bar is `sticky` at the bottom of the page content (`StickyBooking`): it rests above the footer at the end, so it never covers content or the footer, comes last in the tab order, and `scroll-padding-bottom` (styles.css, only while it exists) keeps a focused control clear of it.

## Booking hand-off (D08)

- **Words.** The storefront takes requests, not instant bookings: "Request a session" (studio), "Request with <artist>", "Request a similar tattoo" (an artwork, D09), secondary "Visit studio site" / "View on studio site" / "Visit their site", and a note: "It's a request, not an instant booking". An artist with `acceptingInquiries` false says "<name> isn't taking new requests right now." and offers the studio's general request (the same link without `artist`); an independent then has none.
- **Destination.** Only the API's `bookingUrl` and `storefrontUrl` (the platform builds both from `STOREFRONT_URL` for that studio: `bookingPageUrl`, `studioPageUrl`). `bookingLinks` (`src/lib/booking.ts`) accepts them only when both are https, or http on `localhost`/`*.localhost`; have no user name or password; share scheme and host (port included); and the booking path is the storefront's `/book`. It then rebuilds the link from those parts: the origin, `/book`, `artist` (only on an artist profile and only that artist's own slug, which is what the storefront's `?artist=` preselects, checked against that studio's artists), `ref` (by shape). `artwork` (D09: only on an artwork page and only that photo's own id, a lowercase uuid: the storefront's "Request a similar tattoo", which checks the photo with the API and names its artist). Nothing else survives, nothing comes from the browser's address, and Discover has no redirect endpoint. Anything else is no link: "Booking isn't available online from Discover right now." Never `flash`: portfolio photos are not flash designs.
- **Custom domains** (TAT-79) are planned, not served: `storefrontUrl` is always the `{tenant}` subdomain. When the platform resolves verified custom domains into it, `bookingLinks` accepts them unchanged (it compares the booking host with the API's own site host, not with a pattern).
- **Referral.** Discover never mints or holds a token or key: the platform signs `ref` into every profile's `bookingUrl` (`linkReferral`, hour-stable, 30 days, studio-bound; [API](api.md#referral)). Discover only carries it. The storefront keeps `?ref=` on `/book` (and through `/request`'s 301) and sends it as the inquiry's `referral`; the platform verifies it for that studio and stores `referral_source = 'discover'` apart from `sourceChannel`. A missing, malformed, expired, forged or other studio's token records nothing and never refuses the request. Nothing is stored in the browser; the token is in the URL only, so navigating elsewhere on the studio site before sending drops it (best-effort attribution by design). `/book` sends `Referrer-Policy: strict-origin-when-cross-origin`, so other sites (the bot challenge, chat links) see the origin only. The token is not secret (it says only "Discover linked to studio X in hour T") and is never logged by Discover.

## Gallery (D09)

`/tattoos` (`src/routes/tattoos/index.tsx`, `src/lib/gallery.ts`) follows the directories' pattern (D07): one URL contract, the loader reads exactly what the address says, every control writes the address.

**The address** (`readGallerySearch`, the route's `validateSearch`; every key, `undefined` when malformed):

| Parameter | Read as | Sent to the API |
|---|---|---|
| `q` | 2–80 characters, no control character | as `q`: alt text, artist, studio and style names ([API](api.md#gallery-search-and-the-artwork-read-d09)) |
| `country` | An assigned ISO code | The address's, else the visitor's (`context.country`), except on one artist's or studio's work (below) |
| `city` | A place slug, only with `country` in the address | When the address's country is the page's |
| `style` | A slug, checked against `/styles` (unknown dropped; unchecked when `/styles` fails, said on the page) | as `style` |
| `artist` | A uuid, lower-cased | as `artist` |
| `studio` | A business's slug | as `studio` |
| `cursor` | base64url, at most 1000 | as `cursor`; one the API refuses redirects to the same filters without it |
| `limit`, `sort`, anything else | not read | always 24, newest first (the API's only order: no sort control) |

- **Country.** One country system (D06.5): `?country=`, else the visitor's. A profile's "All work by …" (`?artist=`) or "All work at …" (`?studio=`) is global like the profile, so the gallery sends no country then unless the address names one (and has no city filter); its chip ("By Sita Rai", "At Black Needle", names from the page's photos) removes it. When no photo on the page names them (nothing listed, or an unknown slug), the page says "this artist" / "this studio" ("Tattoos from this studio", "At this studio"): the address's text is never shown as a name.
- **Search.** `DiscoverySearch`, still a GET form with the other filters as hidden fields (no JavaScript: Enter submits). With JavaScript (`GallerySearchBox`) the results follow the typing: 400 ms (`SEARCH_DEBOUNCE_MS`) after the last keystroke a valid search (`nextSearch`: 2–80 characters, changed) is written to the address; the first update of a burst adds a history entry and later ones replace it, so Back returns to the previous search (or the gallery before it), not through every keystroke. A burst ends with a pause of 1.5 s after the last keystroke (`SEARCH_BURST_GAP_MS`, `startsBurst`), when the box loses focus (a pending search applies then), on Enter or on Clear, so a search typed later is its own history entry; Enter applies at once; Clear (an emptied box) removes the search at once. The box is controlled and never remounted, so focus stays while results load; a search changed elsewhere (a chip, back/forward) refills it. One character keeps the current results. The results' `<output>` announces "12 tattoos shown." politely.
- **Filters.** D07's `FilterToolbar` / `MobileFilters` / `ActiveFilters` with `kind="tattoos"`: style and city (the country's places), applied together with Apply, a sheet below `lg`, the same GET form without JavaScript; no sort and no "who". `Pagination` is D07's ("Next page", "First page", "Previous page" from the history entry): each page is its own SSR address, shareable and back/forward-safe, rather than a "Show more" that accumulates (as D07 decided).
- **Masonry.** CSS columns (2, 3 from `sm`, 4 from `lg`), each photo in a frame of its own proportions (`ArtworkTile`: `ResponsiveImage` with width, height and `aspect-ratio`, so nothing moves as it loads; a failed image keeps a neutral frame with its alt text). The first 4 load eagerly, the first of them with `fetchPriority="high"`, the rest lazily; a later page loads every image lazily. Columns flow top to bottom, as every work section since D07. A card: the image linking to the artwork page (the gallery's cards leave a mark in the history entry, see Back to the gallery) and a caption with the artist (their profile, a separate link), the studio's name or "Independent", the first style. The list has no place per photo, so cards name no city.
- **States.** Loading keeps the current photos mounted, dimmed and `aria-busy` (no `pendingComponent`). Nothing in the market: `EmptyMarket` ("No tattoos are listed in India yet.", the other markets). No match: what matched nothing, Clear filters, All of <country> (with a city), other styles, other markets. An empty later page: "No more tattoos" with First page. The list failing: the route's error state (Try again, 500). A search the API rate-limits (429 with `q`: server renders share one anonymous budget until D11's server key, see Settings, and typing reads often) is not an error: the loader returns `busy` and the page keeps its header, search box (the query in it), filters and chips, with "Searching is busy right now. Try again in a moment." (an `<output>`, announced politely) and Try again (a link to the same address; with JavaScript it re-runs the loader in place), and no results or paging. It answers 200 and is noindex (it has `q`); the failed read isn't cached or sent to the browser as an answer (`private, no-store`, failed queries aren't dehydrated, the browser doesn't retry a 429). A 429 without a search, and every other transient failure, stays the error state.
- **Head.** "Tattoo inspiration from Nepal", "Blackwork tattoos in Pokhara", "Tattoos by Sita Rai", "Tattoos matching "koi"". Any parameter is `noindex`; the bare page is in `INDEXABLE_PATHS` (and so the sitemap) once indexing is on.

## Artwork pages (D09)

`/tattoos/:slug` (`src/routes/tattoos/$slug.tsx`, `src/lib/artwork.ts`): one published photo, artwork first.

- **Slug.** The API's photo id, the only stable public identifier (a photo has no title; its alt text may change). Canonical: the id in lower case (`paths.tattoo`). `readArtworkSlug` also takes `<readable>-<id>` and any letter case, resolving by the id part only, and the page 301s to the canonical address after the read; nothing is resolved by text. No id (`/tattoos/nope`): the 404 page without a request.
- **Data.** `getDiscoverTattoo` (required: the API's 404, the same for every reason, is `notFound()`; a transient failure the error page), then two optional reads composed from the tattoos list's own filters, in parallel: the artist's newest (`artist=<id>`, global) and the photo's first style in the page's country (`style`, `country`: `?country=`, else the visitor's; `loaderDeps` names it). `relatedWork` leaves out the current photo and any photo twice (the style section drops what the artist's shows), at most 8 each. A failed related read hides its section.
- **Layout.** Breadcrumbs, then the image (eager, `fetchPriority="high"`, its own ratio, never taller than 80% of the screen: a tall piece narrows), "View full size" (the API's largest copy; a plain link, no lightbox), and beside it from `lg` (below on a phone): "Tattoo" or "Healed tattoo", the one h1 (the studio's own alt text, else "Blackwork tattoo by Sita Rai"), facts from the data only (artist → profile, studio → profile or "Independent artist", styles → style pages, where → the city page for a market, else text, "Healed" when it is), the booking actions, Share and Back to the gallery. Then "More by <artist>" (night; "All work by …" → `/tattoos?artist=`) and "More <style> work" ("Recently published in <country>"; "All <style> tattoos" → `/tattoos?style=`, with an explicit country kept). No size, placement, duration, price, likes or counts: the API has none.
- **Booking.** `bookingLinks(tattoo, undefined, tattoo.id)`: "Request a similar tattoo" to the storefront's `/book?artwork=<id>&ref=…`, "View on studio site" (its gallery page) or "View on their site". An artist who isn't taking requests (`artistAcceptingInquiries` false): "<name> isn't taking new requests right now." and, for a studio's piece, "Request a similar tattoo at <studio>" (the same link: the storefront then offers the studio's general request with the piece linked); an independent's has none. No safe link: "Booking isn't available online from Discover right now."
- **Share.** `navigator.share` when the browser has it (a "Share" button), and always "Copy link" (the Clipboard API) with a visible confirmation ("Link copied", or how to copy by hand) in a polite live region; both real buttons, hidden without JavaScript. The address shared is the canonical one (`DISCOVER_URL` + the path).
- **Back to the gallery.** A gallery card's link leaves `{ fromGallery: true }` in the new history entry (never in the URL); when the page has it, "Back to the gallery" goes back in history, to the gallery as it was (search, filters, page, scroll). Otherwise (a shared link, a related photo, a profile) it is a plain link to `/tattoos`.
- **SEO.** Title ("Blackwork tattoo by Sita Rai at Black Needle, Kathmandu"), description, `og:image` (the artwork) with `summary_large_image`, all from the answer; canonical: the canonical slug's path. Indexable by pattern (a lowercase uuid) once `DISCOVER_INDEXING=on`; `?country=` variants, other spellings (301) and 404s never. Blueprint H's launch default (a canonical to the storefront's `/gallery/:id`) is not applied: the page adds related work, style and place context the storefront page doesn't have, so it is self-canonical; D10's artwork canonical decision can still switch it. HTML stays `private, no-store`.

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

- A plain form post (no JavaScript) gets a `303` to `return`, a same-origin path (`safeReturnPath`: one leading `/`, no `//`, backslash, scheme or control character; anything else is `/`), with its `country` replaced and its `city` and `cursor` dropped (`switchCountryPath`: the API ties a cursor to the sort only, so the new country's list would start part-way through).
- The selector's fetch (`Accept: application/json`) gets `{ country }`.
- A code that isn't a market is never saved (`422` for the fetch; the form goes back unchanged). A cross-site post (`Sec-Fetch-Site` other than `same-origin` or `none`) is a `403`.

**Switching** (`country-selector.tsx`). Every control is a real `<form method="post">` of country buttons, so it works without JavaScript. With it, the selector posts by fetch, sets the tab's `preference`, then either navigates to the same address with `country` replaced and `city` and `cursor` dropped (`q`, `style` and the path kept), when the address names a country or has a cursor (`countrySwitchTarget`), or re-runs the loaders (`router.invalidate()`). A failed fetch falls back to the plain post.

- **Desktop** (from `lg`): a disclosure (`<details>`, uncontrolled so a fast Escape and Enter can't be undone by a late render) naming the current country, opening a small panel of country buttons; the current one has `aria-current` and a check. Enter or a click opens it, Escape or a press outside closes it, focus returns to the trigger after a switch. From `lg` to `xl` the trigger drops its icons and cuts a long name, so the header stays on one line at 1024px.
- **Mobile:** a labelled "Country" group in the menu sheet, 48px rows; the sheet closes after a switch and Radix returns focus to the menu button.
- **One market:** the country is shown as text (and in the sheet, "Discover lists studios in Nepal for now."): a picker with one choice is noise. A page with an explicit non-market `?country=` still offers the market.

**Empty market.** Home, `/explore/studios` and `/explore/artists` (no `q` or filters) say "No studios are listed in India yet." (or artists) with buttons for the other markets. They never borrow another country's listings.

**Trusted header and nginx.** Discover never reads `CF-IPCountry` (the setting refuses it): a visitor can send it. In the split layout (`deploy/nginx/hosts.split.conf`), nginx makes `$discover_country` from `CF-IPCountry` only on a connection from cloudflared (`172.30.42.20`, matched on `$realip_remote_addr`, the same trust as the visitor's address in `common.conf`) and only as two letters. Discover's location always sets `X-Discover-Country` from it, empty (not sent) for anyone else, so a visitor's own header never passes. The tunnel is the only way in, so no Cloudflare IP list is needed. `deploy/test/nginx/run.sh` checks it. Geolocation stays off (`DISCOVER_GEO_HEADER` unset) until D11 has verified that Cloudflare overwrites a visitor's own `CF-IPCountry` and that Discover's port is not published ([domain migration](domain-migration.md), step 15). The compose service publishes no port; only the stack's network reaches it.

**Caching.** Every HTML response (the root route's `headers`) is `Cache-Control: private, no-store` with `Vary: Cookie`, because the header and the lists depend on the cookie and the geolocation header. `Vary` is only a second line. Before D06.5 pages set no `Cache-Control`. `/robots.txt` (`public, max-age=300`), the sitemap and the hashed static assets keep their own headers. Cloudflare doesn't cache HTML by default; no cache rule may cover Discover's pages until D10/D11 design a keyed strategy.

**SEO.** The canonical stays the path alone, so `?country=` variants never canonicalise as separate pages, and a page with an explicit `?country=` is `noindex` (meta and `X-Robots-Tag`) whatever `DISCOVER_INDEXING` says. Nothing ever redirects by country. A crawler without a cookie or header gets the default country, deterministically; a crawler that comes through Cloudflare with geolocation on gets its own country. Crawlable geographic entry points are D07's location pages (`/locations/nepal`, `/locations/nepal/kathmandu`), which never depend on the visitor's country. `DISCOVER_INDEXING` behaves as before.

**Directories vs location pages.** Directories and style pages follow the page's country (explicit `?country=`, else the visitor's); location pages always list their own. A crawler without a cookie sees the default country on a directory or style page, deterministically.

**Profiles (D08).** Global: no profile is hidden, filtered or redirected by country, and profile links never carry `country` (see Profiles).

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
- Validate search params before they reach the API (`readQuery`: 2–80 characters, no control character, as the API requires). The router parses search values as text, never JSON (`parseSearchText`/`stringifySearchText` in `src/router.tsx`); readers take strings (`readIndependent` reads `"true"`). `validateSearch` must return every key it owns, `undefined` when malformed: the router merges its result over the raw search, so a key left out keeps the raw value.
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

Server-side reads are anonymous for now: the API rate-limits them per address (a rate-limited gallery search shows a "busy" notice, see Gallery; other pages show the error state), so before launch (D11) Discover's server needs a key (the blueprint's named server keys, or one of the platform's `STOREFRONT_SERVER_KEYS`) with the visitor's address forwarded, as the storefront does.

## SEO and indexing

- Every page's head is rendered on the server: title (`Page | Tattoo Drip`, or the default), description, canonical (`DISCOVER_URL` + the path, whatever host the request came on), Open Graph and Twitter basics. A page adds its own with `pageMeta({ title, description, noindex })`; the deepest match wins for each tag.
- **Indexing off** (the default): every page has `<meta name="robots" content="noindex, nofollow">` and an `X-Robots-Tag: noindex, nofollow` header, `/robots.txt` disallows everything, `/sitemap.xml` is a 404.
- **Indexing on**: only the paths in `INDEXABLE_PATHS` (`src/lib/seo.ts`: `/`, `/for-studios` and, since D07, the bare `/explore/studios` and `/explore/artists`) and those matching `INDEXABLE_PATTERNS` (D07: `/styles/<slug>`, `/locations/<slug>` and `/locations/<slug>/<slug>`; D08: the three profile shapes) may be indexed, and not if the page passes `noindex: true`; every other page still says noindex. `/robots.txt` allows and names the sitemap, which lists exactly `INDEXABLE_PATHS`. A finished page is added to that list (D06–D10).
- **D07 rules.** A directory with any parameter (filters, search, sort, cursor, `?country=`) passes `noindex` (`hasSearchParams`): filter combinations are never indexable (blueprint H; the meta says `noindex, nofollow`, not H's `noindex, follow`: D10 decides). Style and location pages are the canonical discovery destinations, indexable by shape once DISCOVER_INDEXING is on; an unknown slug is a 404 (noindex), and a page with nothing listed passes `noindex`. Canonicals stay the path alone on `DISCOVER_URL` (an index route's trailing `/` is dropped: `/locations/nepal`). Titles say what the page lists ("Blackwork tattoo studios in Kathmandu", "Tattoo studios and artists in Kathmandu, Nepal"), server-rendered from loader data. With indexing off nothing changes.
- **Sitemap.** Still the static `INDEXABLE_PATHS`; style and place URLs need the API's lists at request time, so D10 adds `styles.xml` and `places.xml`. A style page's listings follow the visitor's country (a crawler gets the default); D10 may add per-country style URLs if that proves thin.
- **D09.** The bare gallery (`/tattoos`) is in `INDEXABLE_PATHS`; artwork pages match `INDEXABLE_PATTERNS` only at their canonical (lowercase uuid) slug. Any gallery parameter, an explicit `?country=`, a 404 or a 301 is never indexed (see Gallery and Artwork pages).
- **D08 profiles.** Title ("Black Needle, tattoo studio in Kathmandu, Nepal", "Maya, tattoo artist at Black Needle, Kathmandu", "…, independent tattoo artist in …"), description (the intro or bio cut at a word, else a plain sentence from the data), `og:image` (the cover, else the newest photo, else the portrait) with `twitter:card` `summary_large_image`, all server-rendered from loader data. The canonical is Discover's own path (no query), never the storefront's: a profile is a distinct discovery summary (place, styles, at most 12 works, the studio's other artists, Discover's links) and the studio site is the studio's full branded site (gallery, policies, flash, booking), so neither duplicates the other (blueprint H). Indexable by shape once `DISCOVER_INDEXING=on` (`INDEXABLE_PATTERNS`: `/studios/<slug>`, `/studios/<slug>/artists/<slug>`, `/artists/<slug>`); only a shown profile at its current address answers 200 there (404s and 301s otherwise); `?country=` variants stay noindex. Profile sitemaps and JSON-LD are D10's (structured data and sitemaps are built together there).

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
- **Search:** `DiscoverySearch` is a real `GET` form inside a `<search>` landmark (a visible label, 2–80 characters, a Clear button; a `pending` search refuses a second submit; `hidden` fields keep a page's other parameters), so it works without JavaScript; with it, it navigates in the app or calls `onSearch`. Point it only at a route that reads the parameter (`/explore/studios`, `/explore/artists`, `/tattoos`).

## Commands

From `apps/discover` (or `pnpm dev:discover` at the root):

- `pnpm dev`: port 3100 (whatever `PORT` the shell has), reads `.env.local` (copy `.env.example`). The platform's `DISCOVER_URL` must be `http://localhost:3100` for the browser's API calls (CORS).
- `pnpm build`: Vite + Nitro to `.output` (a self-contained Node server), then the bundle check. `pnpm start` runs it (`PORT`, default 3000).
- `pnpm test`: `node:test` + `tsx` (`test/`): settings, SEO, routes and navigation, the per-request context, the primitives, the homepage rules (`home.test.ts`), the search readers (`search.test.ts`), the directories' address (`directory.test.ts`), destinations (`destinations.test.ts`), the booking hand-off (`booking.test.ts`), the profile rules (`profiles.test.ts`), the gallery's address and search rule (`gallery.test.ts`), artwork slugs, words, related merge and booking (`artwork.test.ts`), country resolution, location slugs, the cookie and the preference endpoint (`country.test.ts`), and the built server (`server.test.ts`, D07's `server-d07.test.ts`, D08's `server-d08.test.ts`, D09's `server-d09.test.ts`, helpers in `built-server.ts`) against a stub API serving 0, 3, 20 or 40 of everything (plus D08's detail reads with the API's 404 rules, old slugs, hidden rows and replaceable booking links, and D09's artwork read with hidden photos and `artistAcceptingInquiries`), honouring `q` (on photos: alt, artist, studio and style names), `country`, `city`, `style`, `independent`, `studio`, `sort`, `limit` and `cursor` like the API (an offset cursor; divergences in `stub-api.ts`), with failing and hanging endpoints (skipped without a build).
- `pnpm typecheck`, `pnpm generate-routes`. Biome from the root.

## Deployment

Not deployed in D05. Prepared for D11:

- `Dockerfile` target `discover`, with its own build stage, so the platform and storefront images build as before.
- `deploy/compose.yml` service `discover` at `172.30.42.13` (the address `hosts.split.conf`'s upstream names), behind the `discover` profile: a plain `up` doesn't start it. Settings: `deploy/env/discover.env.example`.
- Health: `/` below 500 (it reads no API data). Missing or malformed settings make every request a 500 with the variables named in the log, so the health check fails.
- Hostname routing is nginx's: Discover only on the apex, with the legacy paths redirected ([domain migration](domain-migration.md)). Discover never registers a service worker.

## Deferred

Legal pages (privacy, terms: drafts need the product owner's review; not in D06); turning geolocation on (D11, after the checks above); a keyed edge cache for country pages (D10/D11); published prices on `/pricing`; a `/styles` index and per-country style URLs (D10, if needed); each directory row's own recent work by a per-row read, if the shared read (the filters' 48 newest photos) proves too thin; the artwork pages' canonical decision, artwork sitemaps and `VisualArtwork` structured data (D10); a lightbox on artwork pages (a "View full size" link today); a search measured on the rehearsal data (D10: the tattoo search's query plan, an alt-text substring match plus artist, studio and style name subqueries with no trigram index under RLS, must be measured there; 2-letter queries match style names broadly by design); profile JSON-LD and profile sitemaps (D10); keeping the referral across a visitor's navigation on the studio site (URL-only today); custom-domain storefront URLs (TAT-79, platform side); D10 sitemaps, structured data, OG images, budgets and the Lighthouse targets; D11 the server key, deployment and cutover.
