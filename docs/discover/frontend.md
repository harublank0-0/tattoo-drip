# Discover frontend

Discover D05 (foundation) and D06 (homepage, Studio OS marketing). The public site at `tattoodrip.app`: `apps/discover`, a TanStack Start app beside the storefront. It reads only the public [Discover API](api.md) and has no database, no auth and no platform imports. D07–D09 build the rest of its pages on this foundation.

## Architecture

| Path | What |
|---|---|
| `src/router.tsx` | One router per server request and per browser tab: its own `QueryClient` and Discover client, so no request sees another's cache |
| `src/lib/config.ts` | The settings, from `process.env` on the server; `parseDiscoverConfig` names every bad variable, never a value |
| `src/lib/context.ts`, `request.ts` | The router context: `queryClient` and `discover` (`DiscoverRef`: public settings + `createDiscoverClient`). Connected on the server from the settings, in the browser from the dehydrated settings (checked again) |
| `src/lib/query-client.ts` | QueryClient defaults: 60 s fresh (the API's max-age), no retry on the server, transient retries in the browser, pending queries streamed |
| `src/lib/routes.ts` | Every address (`paths`), the navigation and footer lists, Studio OS's sign-in and sign-up links |
| `src/lib/search.ts` | Search-parameter readers (`readQuery`, `readCountry`, `readCity`, `readStyle`, `readStudioSearch`), `studioQuery`, chip labels |
| `src/lib/home.ts` | The homepage's queries (`homeQueries`), limits, thresholds and pure section rules |
| `src/lib/seo.ts` | Head tags, the canonical URL, robots and sitemap text |
| `src/routes/` | File routes (`routeTree.gen.ts` is generated) |
| `src/components/ui` | shadcn-style primitives on Discover's tokens: `Button`, `Input`, `Sheet` |
| `src/components/layout` | The shell: `SiteHeader`, `MobileNav`, `SiteFooter`, `Wordmark`, `NavLink` |
| `src/components/discovery` | Page primitives: `PageContainer`, `EditorialSection`, `SectionHeading`, `PageHeader`, `Breadcrumbs`, `ResponsiveImage`, `DiscoverySearch`, `EmptyState`, `ErrorState`, `LoadingSkeleton`, `NotFoundState`, `RouteErrorState`, `FoundationNotice` |
| `src/components/home` | The homepage's hero and sections (D06) |

The root route (`__root.tsx`) renders the document, the skip link, the header, `<main id="main">` and the footer for every page, inside `DiscoverProvider` (so `@tattoo-drip/react`'s `useDiscover*` hooks work); the QueryClientProvider comes from `setupRouterSsrQueryIntegration`.

## Routes

| Path | Now | Finished in |
|---|---|---|
| `/` | **D06 homepage**: discovery hero, styles, studios, artists, inspiration, places, how booking works, the Studio OS band, a closing call (see Homepage) | D06 |
| `/explore/studios` | **Live data**: the API's first page of studios with `q`, `country`, `city` and `style` (D06), shown as removable chips; rows link to each studio's own site; `noindex` | D07 |
| `/explore/artists` | **Live data** (D06): the API's first page of artists, linking to their page on the studio's site; no filters; `noindex` | D07 |
| `/explore/tattoos` | A `FoundationNotice`; `noindex` | D09 |
| `/for-studios` | **D06**: Studio OS for professionals; indexable | D06 |
| `/pricing` | **D06**: informational, no prices yet; `noindex` until prices are published | D06 (prices later) |
| `/studios/:slug`, `/studios/:studioSlug/artists/:artistSlug`, `/artists/:tenantSlug`, `/tattoos/:id`, `/styles/:slug`, `/locations/:slug` | Not routes yet (404); their builders are in `paths` | D07–D09 |
| `/robots.txt`, `/sitemap.xml` | Server routes, see SEO | D10 |

Link with `paths`, never hand-written strings, and never with Studio OS's legacy paths (`/login`, `/signup`, `/dashboard`, `/t/…`, `/sw.js`…): on `tattoodrip.app` nginx sends them to Studio OS ([domain migration](domain-migration.md#f-legacy-urls)). A test checks every navigation link against the route tree and that list.

## Homepage (D06)

The loader prefetches five reads in parallel with `Promise.allSettled(ensureQueryData(...))` and never throws: `homeQueries(client)` builds the options (tattoos `limit=24`, studios `limit=8`, artists `limit=8`, styles, locations), and the sections read the same options with `useQuery`, so the server's answers are dehydrated and reused (one request each). The loader returns which reads failed (loader data, so server and browser render the same note). A failed or thin read hides only its section; in the browser a failed read is fetched again on mount and its section appears if it succeeds. A hung read is cut off by the server client's timeout (`SERVER_TIMEOUT_MS`, 5 s; the server test checks it); no extra wait was added. No `Cache-Control` is set on pages (takedowns must propagate).

| Section (in order) | Data | Shown when (`HOME_THRESHOLDS`) |
|---|---|---|
| Hero: headline, `DiscoverySearch` (studio names, `?q=` on `/explore/studios`, the only text search the API has), Explore studios, Find artists, a quiet "For tattoo professionals" | tattoos | Always. A collage of the 4 newest photos when there are ≥4 (first eager, `fetchPriority="high"`, preloaded; fixed frames); else typographic, with the three explore links set large |
| Tattoo styles | styles + tattoos | ≥3 styles that each get a different recent photo tagged with them (`pairStylesWithPhotos`, list order, at most 6; no per-style request); each tile → `/explore/studios?style=` |
| Recently listed studios | studios | ≥1. The API's order (`newest`, ties by id): no ranking or featuring. Rows link to `storefrontUrl` |
| Recently added artists | artists + tattoos | ≥2. Work first (their newest recent photo, else their portrait, else their initial), "at Studio · City" or "Independent · City"; link = `storefrontUrl` |
| Fresh from the studios | tattoos | ≥6 photos: those the hero didn't show when 6 remain, else all; at most 12, true proportions, lazy. A photo links to its artist's or studio's page when the homepage's data holds it, else it is not a link (no `/tattoos/:id` before D09). "Explore artwork" → `/explore/tattoos` |
| Find studios near you | locations | ≥2 places (at most 12), grouped by country (`Intl.DisplayNames`), each → `/explore/studios?country=&city=`; no counts |
| How booking works, the Studio OS band (night, → `/for-studios`), the closing call (search, explore links, a small professional link) | static | Always |

Every read failed: one quiet `role="alert"` note with Try again (`router.invalidate()`) under the hero's search; the static bands still render. Alt text comes from the data: the photo's own `alt`, else "Blackwork tattoo by X at Y" (`tattooAlt`).

## Search navigation

`/explore/studios` reads `q` (2–80 characters), `country` (2 letters, upper-cased), `city` (a place slug, only with `country`) and `style` (a slug) with `readStudioSearch`; each is `undefined` when malformed. The loader also reads the style list (never stale) and drops a style it doesn't have, because the API answers an unknown style with a 422, and returns the filters it used as loader data, which the component reads. Chips name the city and style from `/locations` and `/styles` when they loaded, else the slug in words; removing the country removes the city. The search box keeps only `q` (D07 builds the filter bar).

## Marketing pages and calls to action

- **Sign in / Get started** always come from `studioOsLinks(settings.studioOsUrl)` (`APP_URL` + `/login`, `/signup`), never a hard-coded or Discover-origin path.
- **`/for-studios`** (typographic, no screenshots): the hero (Get started, Explore features → `#features`, Sign in), booking and client workflows, the studio website (themes Stencil & Ink and Ink Noir; custom domains named as planned), portfolio and artists, studio or independent artist, the Discover listing (opt-in; "being prepared for launch"), the three real setup steps, a closing Get started. Every claim was checked against `apps/platform` (`start/routes.ts`, `inertia/pages`, `app/modules`) and `apps/storefront/src/routes` when written; change the page with the product.
- **`/pricing`**: Studio OS has no plans or billing code yet, so the page says pricing is being finalised and will be published before billing starts, that nothing on the site takes payment, what is included today, and that Discover has no paid placement. No tiers, figures, trials or discounts. `noindex` until real prices exist.
- **Header** (from `lg`): the three discovery links, then For studios, Pricing, Sign in, Get started; the mobile menu and footer already had Pricing. No legal pages yet: the footer's note stays.

## Data loading pattern

`/explore/studios` is the pattern every data page follows:

```ts
export const Route = createFileRoute("/explore/studios")({
	validateSearch: (search) => (readQuery(search.q) ? { q: readQuery(search.q) } : {}),
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			discoverQueries.studios(context.discover.client, deps.q ? { query: deps.q } : undefined),
		),
	component: Studios, // useSuspenseQuery(discoverQueries.studios(...)) with the same options
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

Origins are https, or http on localhost. All are public: the browser receives them in the router's dehydrated state. None is a secret; a secret added later must stay out of `publicSettings`. `pnpm build` ends with a check that the browser bundle holds no server-only text (`scripts/check-client-bundle.mjs`).

Server-side reads are anonymous for now: the API rate-limits them per address, so before launch (D11) Discover's server needs a key (the blueprint's named server keys, or one of the platform's `STOREFRONT_SERVER_KEYS`) with the visitor's address forwarded, as the storefront does.

## SEO and indexing

- Every page's head is rendered on the server: title (`Page | Tattoo Drip`, or the default), description, canonical (`DISCOVER_URL` + the path, whatever host the request came on), Open Graph and Twitter basics. A page adds its own with `pageMeta({ title, description, noindex })`; the deepest match wins for each tag.
- **Indexing off** (the default): every page has `<meta name="robots" content="noindex, nofollow">` and an `X-Robots-Tag: noindex, nofollow` header, `/robots.txt` disallows everything, `/sitemap.xml` is a 404.
- **Indexing on**: only the paths in `INDEXABLE_PATHS` (`src/lib/seo.ts`: `/` and `/for-studios`) may be indexed, and not if the page passes `noindex: true`; every other page still says noindex. `/robots.txt` allows and names the sitemap, which lists exactly `INDEXABLE_PATHS`. A finished page is added to that list (D06–D10).

## Design system

All tokens are in `src/styles.css`; components use them, never hex values.

- **Semantic tokens** are a plain `@theme`, not `@theme inline` (D06 fix): the utilities read `var(--color-muted-foreground)` and friends, so `.night` really redefines them. Inlined, `text-muted-foreground` stayed paper's ink-muted on night (about 2.6:1).
- **Palette:** paper `#f5f2ec` (page), paper-raised and paper-sunk, ink `#111111`, ink-muted, line and line-strong, accent red `#b4232c` (small accents and focus; text only on paper), and the night set for dark sections (`.night`: `#111111`, night-ink, night-muted, accent-bright `#e5484f` for text and focus there, 4.8:1). Contrast is measured and noted in the file (body text ≥ 6.3:1, control borders ≥ 3:1). shadcn's semantic names (`background`, `foreground`, `muted-foreground`, `border`, `ring`, `primary`) map onto them, and `.night` redefines them for its section.
- **Type:** Eczar 700 (display) and Geist variable (UI and text), vendored from Studio OS with their OFL licences; Latin preloaded, `font-display: swap`. Fluid display sizes `text-display-xl/lg/md` (clamp, phone first); `eyebrow` for small uppercase labels.
- **Layout:** `PageContainer` (90rem wide, or a 48rem reading width) with `page-gutter` (16, 24 then 40px); `EditorialSection` for full-bleed bands with the vertical rhythm (64px, 96px from `lg`), `tone="night"` for a dark one. Breakpoints are Tailwind's (`sm` 40rem, `lg` 64rem: where the header shows every link).
- **Interaction:** 2px-radius buttons (no pills), 44px targets below `lg`, one focus ring (2px accent, 3px offset; accent-bright on night), subtle transitions only, and everything instant under `prefers-reduced-motion`. No animation library.
- **Brand:** the "Tattoo Drip" wordmark in Eczar, as in Studio OS; the favicon is Studio OS's interim mark (TAT-67). No new logo.

## Shell

- **Header:** sticky, 64px, one hairline. From `lg`: the wordmark, "Explore studios", "Find artists", "Tattoo inspiration" (an underline marks the current page, `aria-current`), "For studios", Sign in and Get started (Studio OS). Below `lg`: the wordmark and a menu button.
- **Mobile menu:** a modal sheet (Radix Dialog): focus moves in and is trapped, Escape and Close return focus to the button, the page behind is inert. Two labelled groups (Discover; For businesses, with Pricing, Sign in and Get started). It closes when a link is followed and when the window reaches `lg`.
- **Footer:** a night band with the wordmark, the Explore and For professionals links, the copyright, and a note that the privacy policy and terms are coming before launch: there are no legal pages yet, so nothing links to one (D06 drafts them for review).
- **Search:** `DiscoverySearch` is a real `GET` form inside a `<search>` landmark (a visible label, 2–80 characters, a Clear button; a `pending` search refuses a second submit), so it works without JavaScript; with it, it navigates in the app or calls `onSearch`. Point it only at a route that reads the parameter (today `/explore/studios`).

## Commands

From `apps/discover` (or `pnpm dev:discover` at the root):

- `pnpm dev`: port 3100 (whatever `PORT` the shell has), reads `.env.local` (copy `.env.example`). The platform's `DISCOVER_URL` must be `http://localhost:3100` for the browser's API calls (CORS).
- `pnpm build`: Vite + Nitro to `.output` (a self-contained Node server), then the bundle check. `pnpm start` runs it (`PORT`, default 3000).
- `pnpm test`: `node:test` + `tsx` (`test/`): settings, SEO, routes and navigation, the per-request context, the primitives, the homepage rules (`home.test.ts`), the search readers (`search.test.ts`), and the built server against a stub API serving 0, 3 or 20 of everything, with failing and hanging endpoints (`stub-api.ts`; skipped without a build).
- `pnpm typecheck`, `pnpm generate-routes`. Biome from the root.

## Deployment

Not deployed in D05. Prepared for D11:

- `Dockerfile` target `discover`, with its own build stage, so the platform and storefront images build as before.
- `deploy/compose.yml` service `discover` at `172.30.42.13` (the address `hosts.split.conf`'s upstream names), behind the `discover` profile: a plain `up` doesn't start it. Settings: `deploy/env/discover.env.example`.
- Health: `/` below 500 (it reads no API data). Missing or malformed settings make every request a 500 with the variables named in the log, so the health check fails.
- Hostname routing is nginx's: Discover only on the apex, with the legacy paths redirected ([domain migration](domain-migration.md)). Discover never registers a service worker.

## Deferred

Legal pages (privacy, terms: drafts need the product owner's review; not in D06); published prices on `/pricing`; D07 directories, the filter bar, cursor paging, artist filters and style/location pages; D08 profiles and booking hand-off (Discover links to storefront pages until then); D09 the tattoo gallery and artwork pages (`/tattoos/:id`); D10 sitemaps, structured data, OG images, budgets and the Lighthouse targets; D11 the server key, deployment and cutover.
