# Discover frontend

Discover D05. The public site at `tattoodrip.app`: `apps/discover`, a TanStack Start app beside the storefront. It reads only the public [Discover API](api.md) and has no database, no auth and no platform imports. D06–D09 build its pages on this foundation.

## Architecture

| Path | What |
|---|---|
| `src/router.tsx` | One router per server request and per browser tab: its own `QueryClient` and Discover client, so no request sees another's cache |
| `src/lib/config.ts` | The settings, from `process.env` on the server; `parseDiscoverConfig` names every bad variable, never a value |
| `src/lib/context.ts`, `request.ts` | The router context: `queryClient` and `discover` (`DiscoverRef`: public settings + `createDiscoverClient`). Connected on the server from the settings, in the browser from the dehydrated settings (checked again) |
| `src/lib/query-client.ts` | QueryClient defaults: 60 s fresh (the API's max-age), no retry on the server, transient retries in the browser, pending queries streamed |
| `src/lib/routes.ts` | Every address (`paths`), the navigation and footer lists, Studio OS's sign-in and sign-up links |
| `src/lib/seo.ts` | Head tags, the canonical URL, robots and sitemap text |
| `src/routes/` | File routes (`routeTree.gen.ts` is generated) |
| `src/components/ui` | shadcn-style primitives on Discover's tokens: `Button`, `Input`, `Sheet` |
| `src/components/layout` | The shell: `SiteHeader`, `MobileNav`, `SiteFooter`, `Wordmark`, `NavLink` |
| `src/components/discovery` | Page primitives: `PageContainer`, `EditorialSection`, `SectionHeading`, `PageHeader`, `Breadcrumbs`, `ResponsiveImage`, `DiscoverySearch`, `EmptyState`, `ErrorState`, `LoadingSkeleton`, `NotFoundState`, `RouteErrorState`, `FoundationNotice` |

The root route (`__root.tsx`) renders the document, the skip link, the header, `<main id="main">` and the footer for every page, inside `DiscoverProvider` (so `@tattoo-drip/react`'s `useDiscover*` hooks work); the QueryClientProvider comes from `setupRouterSsrQueryIntegration`.

## Routes

| Path | D05 | Finished in |
|---|---|---|
| `/` | A short front page: the pitch, the studio search, the three explore links, the Studio OS band | D06 |
| `/explore/studios` | **Live data**: the API's first page of studios, with `?q=` search; rows link to each studio's own page | D07 |
| `/explore/artists`, `/explore/tattoos`, `/for-studios`, `/pricing` | A `FoundationNotice` saying the page is coming, with a real link; `noindex` | D06–D09 |
| `/studios/:slug`, `/studios/:studioSlug/artists/:artistSlug`, `/artists/:tenantSlug`, `/tattoos/:id`, `/styles/:slug`, `/locations/:slug` | Not routes yet (404); their builders are in `paths` | D07–D09 |
| `/robots.txt`, `/sitemap.xml` | Server routes, see SEO | D10 |

Link with `paths`, never hand-written strings, and never with Studio OS's legacy paths (`/login`, `/signup`, `/dashboard`, `/t/…`, `/sw.js`…): on `tattoodrip.app` nginx sends them to Studio OS ([domain migration](domain-migration.md#f-legacy-urls)). A test checks every navigation link against the route tree and that list.

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
- **Indexing on**: only the paths in `INDEXABLE_PATHS` (`src/lib/seo.ts`, `/` today) may be indexed, and not if the page passes `noindex: true`; every other page still says noindex. `/robots.txt` allows and names the sitemap, which lists exactly `INDEXABLE_PATHS`. A finished page is added to that list (D06–D10).

## Design system

All tokens are in `src/styles.css`; components use them, never hex values.

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
- `pnpm test`: `node:test` + `tsx` (`test/`): settings, SEO, routes, the per-request context, the primitives, and the built server (skipped without a build).
- `pnpm typecheck`, `pnpm generate-routes`. Biome from the root.

## Deployment

Not deployed in D05. Prepared for D11:

- `Dockerfile` target `discover`, with its own build stage, so the platform and storefront images build as before.
- `deploy/compose.yml` service `discover` at `172.30.42.13` (the address `hosts.split.conf`'s upstream names), behind the `discover` profile: a plain `up` doesn't start it. Settings: `deploy/env/discover.env.example`.
- Health: `/` below 500 (it reads no API data). Missing or malformed settings make every request a 500 with the variables named in the log, so the health check fails.
- Hostname routing is nginx's: Discover only on the apex, with the legacy paths redirected ([domain migration](domain-migration.md)). Discover never registers a service worker.

## Deferred

D06 homepage and marketing pages (`/for-studios`, `/pricing`, legal drafts); D07 directories, filters, cursor paging and style/location pages; D08 profiles and booking hand-off; D09 the tattoo gallery and artwork pages; D10 sitemaps, structured data, OG images and budgets; D11 the server key, deployment and cutover.
