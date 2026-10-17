# Mobile-first dashboard shell (TAT-67)

Date: 2026-10-16
Refs: TAT-67 (Mobile-first PWA dashboard shell). Builds on the dashboard layout from TAT-25 (tenant routes and switcher), the Inbox badge from TAT-46 part 2 (`inboxCount`), and the nav overflow stopgap in #20. Calendar (TAT-50) and Clients (TAT-41) are not built yet; they add their nav entries when they ship.

## Goal

Owners and artists use the dashboard one-handed on a phone through the day; the front desk uses a laptop. The dashboard should feel like an installed app on a phone: navigation in thumb reach with the inbox badge always visible, an icon on the home screen, nothing scrolling sideways, and a clear screen instead of a browser error when there is no connection. The laptop layout stays comfortable.

No migration, no API, SDK or OpenAPI changes, and no change to any page's content beyond where it sits in the shell.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Scope | The navigation shell, the landing screen and installability (manifest, icons, an app-shell service worker). "Works on a slow connection" becomes a short rules checklist in the UI docs plus a follow-up ticket | Slow-connection work touches every page's data and forms, not the shell |
| First screen | No home screen: owners land on the Inbox, artists on Projects. The placeholder Dashboard page goes away | An empty home screen helps no one; a "Today" summary can come with the calendar |
| Nav destinations | Only what is built: owners get Inbox, Projects, Settings; artists get Projects. Artists moves inside Settings | No dead "coming soon" tabs for pilot users; Calendar and Clients are one entry each later |
| Phone navigation | A bottom tab bar, with a slim top bar for the studio switcher and an account menu | Thumb reach, the badge always visible, the usual installed-app pattern |
| Desktop navigation | A left sidebar mirroring the tabs | One navigation model on both sizes, with room for Calendar and Clients |
| Offline | The service worker caches only the app's code, styles and icons and shows an offline page; it never stores pages or client data | Nothing personal lingers on a phone after logout |
| App icon | A simple placeholder "TD" mark, replaceable later | No brand mark exists yet (the header still shows the AdonisJS logo) |
| How to build the installable part | Hand-written: a static manifest, a short service worker, icons generated once with `sharp` and committed | vite-plugin-pwa (Workbox) assumes a single-page app with an `index.html`, while Adonis renders HTML on the server; it adds a dependency for an "offline page only" worker |

## The shell

### One nav list

`tenantNav` moves out of `inertia/layouts/app.tsx` into `inertia/components/shell/nav_items.ts`, a plain function of the shared `tenant` and `inboxCount` props:

| Role | Items |
|---|---|
| owner | Inbox (badge: `inboxCount` when above zero), Projects, Settings |
| artist | Projects |

`NavItem` gains `matches?: string[]`: extra path prefixes (relative to the tenant, e.g. `"/artists"`) that also mark the item current. Settings matches `/settings` and `/artists`. The rule "show the tab bar only with two or more items" lives here too (`showTabBar(items)`), so it is unit-tested with the list. Adding Calendar or Clients later is one entry in this file.

### Below 1024px (phones, portrait tablets)

- **Top bar:** the studio switcher on the left (today's `TenantSwitcher`, unchanged), and an account menu on the right behind an avatar with the user's initials (`user.initials`). The menu holds the user's name and email, the light/dark switch (today's `ThemeToggle` behavior), and Log out (today's `session.destroy` form).
- **Bottom tab bar:** fixed to the bottom, one tab per item: icon above the label, the badge on the Inbox tab, the current tab marked `aria-current="page"`, the bar labelled as the primary navigation. It pads for the safe area (`env(safe-area-inset-bottom)`), and the page content gets matching bottom padding so the bar never covers the last row. Hidden when there are fewer than two items (artists, until Calendar ships).

### From 1024px up

A left sidebar of about 240px: the studio switcher at the top, the items in the middle (icon and label, the badge on Inbox), the account menu at the bottom. No top bar, no tab bar.

### Shared behavior

- Both renderings come from the same items and the same `NavLink` active rule (exact or prefix match, plus `matches`).
- A slim "You're offline" bar shows at the top of the content while `navigator.onLine` is false (from the browser's `online` / `offline` events) and disappears when the connection returns.
- Flash toasts stay as they are.
- `AppLayout` is only used on tenant pages (login, signup and onboarding use `AuthLayout`; the marketing and error pages use `MarketingLayout`), so the shell can rely on the `tenant` prop; it renders no navigation if it is missing.

### Landing

- `GET /t/:tenant` (`tenant.dashboard`) stops rendering the placeholder and redirects: owners to `tenant.inbox.index`, artists to `tenant.projects.index`. It keeps its name, so the studio switcher's links and `/dashboard` (which picks the user's last studio) keep working and now land on the work list.
- `inertia/pages/dashboard.tsx` is deleted, and the Dashboard nav item goes away.

### Settings

- The Settings side list becomes Studio profile, Payments, Artists.
- The artist pages (`artists/index`, `artists/form`) render inside `SettingsLayout` (`[AppLayout, SettingsLayout]`) instead of their own page frame. Their URLs stay `/t/:tenant/artists` and their route group keeps its own owners-only check, so TAT-30 can still open them to artists by changing one allow list.

### Branding

- A placeholder mark replaces the AdonisJS logo in `inertia/components/logo.tsx`: the "TD" mark plus the "Tattoo Drip" name, used by the app shell and by `AuthLayout` and `MarketingLayout`. Its accessible name is "Tattoo Drip".
- Page titles read "… - Tattoo Drip" (`inertia/app.tsx`, the default app name when `VITE_APP_NAME` is unset), and the Edge template's fallback `<title>` is "Tattoo Drip".

## Installable

### The mark and icons

- One source file: `resources/brand/mark.svg`, a white "TD" monogram on a near-black (`#18181b`) rounded square.
- `scripts/generate_icons.ts` (run by hand with `sharp`, already a dependency) writes to `public/icons/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (the mark inside the central 80% safe zone on a full-bleed background, so Android can crop it to any shape), `apple-touch-icon.png` (180px) and `favicon.svg` (a copy of the mark) plus `favicon-32.png`. The outputs are committed; replacing the brand later means replacing `mark.svg` and running the script again.

### Manifest

`public/manifest.webmanifest`:

| Field | Value |
|---|---|
| `name`, `short_name` | "Tattoo Drip" |
| `id`, `start_url` | `/dashboard` (your last studio's work list) |
| `scope` | `/` |
| `display` | `standalone` |
| `background_color` | `#ffffff` |
| `theme_color` | `#18181b` |
| `icons` | the 192 and 512 icons (`purpose: "any"`) and the maskable 512 (`purpose: "maskable"`) |

### The page head

`resources/views/inertia_layout.edge` adds: the manifest link, the favicons, the Apple touch icon, `apple-mobile-web-app-title` "Tattoo Drip", `mobile-web-app-capable`, two `theme-color` metas (light `#ffffff`, dark `#09090b`, by `prefers-color-scheme`), and `viewport-fit=cover` on the viewport meta.

### Service worker

`public/sw.js`, plain JavaScript of roughly 60 to 80 lines, served at `/sw.js` so its scope is the whole app:

- **Install:** store `/offline.html` and the icons in a versioned cache (`td-shell-v1`); activate at once.
- **Activate:** delete caches with any other name; take control of open pages.
- **Page loads** (`request.mode === "navigate"`): always go to the network. Only when the network fails, answer with the stored `/offline.html`. A server error page is still shown as is.
- **Hashed build files** (same-origin `GET /assets/*`): answer from the cache when present; otherwise fetch, store a successful response, and answer. The cache keeps at most 100 entries, dropping the oldest, so old builds cannot pile up.
- **Everything else is not intercepted:** Inertia's JSON visits, form posts and other non-GET requests, `/files` (signed private images), `/uploads`, other origins. No page or client data is ever stored, so logout has nothing to clear.
- **Registration:** `inertia/app.tsx` registers `/sw.js` after the page loads, in production builds only (`import.meta.env.PROD`), so Vite's hot reload in development is untouched.

### Offline page

`public/offline.html`: self-contained (no app code; inline styles; light and dark by `prefers-color-scheme`), with the mark, "You're offline", "Tattoo Drip needs a connection to show your studio." and a **Try again** button that reloads.

### Not included

An in-app "Install" button (Android shows its own prompt; on iPhone, Share → Add to Home Screen), push notifications (TAT-52), offline data.

## Phones and slow connections (rules)

Added to `apps/platform/docs/ui.md` as a checklist for every page:

- Lists are paginated (25 per page, as today) and props carry only what the screen shows.
- Images in lists and grids are lazy-loaded thumbnails, never the full-size file.
- Forms disable their button and say "Saving…" while a request is in flight.
- Optimistic UI only for reversible single-field changes (notes, "Mark contacted"); never for money, quotes, status moves, or accepting and declining.
- Touch targets are at least 44px; nothing is wider than 375px.

A follow-up ticket (created when this ships) applies them to the existing pages: thumbnails for reference images (the grid loads the full images today), the Decline in-flight state, optimistic notes and contact.

## Tests

- **Landing:** `/t/:tenant` redirects owners to the Inbox and artists to Projects. Its isolation case changes from 200 to 302. `tenant_routes.spec.ts` uses `/t/black-needle` as "any tenant page" for its membership and middleware tests: where they assert a 200 or the `dashboard` component for an allowed member, they assert the redirect instead (the 404s for strangers and unknown slugs are unchanged).
- **Installable files:** `/manifest.webmanifest` is served with a JSON content type and has the name, `start_url`, `scope`, `display` and icons; every icon it lists exists under `public/icons/` with the stated size. `/sw.js` and `/offline.html` are served.
- **Nav list (unit):** owner items and their order, artist items, the Inbox badge only above zero, Settings current on `/settings/*` and `/artists/*`, `showTabBar` false below two items.
- **Artists inside Settings:** the artist pages still render for owners (their existing tests) and still 404 for artists.
- **Not automated** (the repo has no browser tests): the service worker, the layouts and the offline bar. They are in the browser pass.

## Browser pass (in the PR)

- At 375px, 768px and 1280px: the tabs or sidebar, the badge, the account menu, the theme switch, Log out, Settings → Artists, the landing after login.
- With a production build (`pnpm build`, then the built server): install on Android Chrome and on iPhone (Share → Add to Home Screen) and open from the icon; DevTools → Network → Offline shows the offline page on a reload; with the app open, going offline shows the offline bar.

## Docs

- `apps/platform/docs/ui.md`: an "App shell" note (one nav list in `shell/nav_items.ts`, adding a destination is one entry, the 1024px breakpoint, the tab bar rule, the service worker caches only `/assets/*` and the offline page) and the slow-connection rules above.
- `apps/platform/docs/backend.md`: the tenancy bullet's "land on `/dashboard`" sentence says it now lands on the role's work list.
- `README.md`: how to try the installed app locally (a production build; the service worker is off in development).

## Carry-forwards

Posted when the PR is ready: TAT-50 and TAT-41 (add their nav entry in `nav_items.ts`; Calendar becomes the artists' second tab, which turns their tab bar on), TAT-30 (the artist pages stay at `/t/:tenant/artists`, now shown under Settings), TAT-82 (the service worker stores no pages or data; history encryption is still needed).

## Not in this ticket

A home or "Today" screen, Calendar and Clients pages, the slow-connection pass on existing pages, a real brand mark, an install button, push notifications, offline data, any change to page content.

## Assumptions the user can overrule at review

The 1024px breakpoint; "TD" on near-black as the placeholder; the theme colors; tab labels with icons (Inbox: `Inbox`, Projects: `ClipboardList`, Settings: `Settings` from lucide); the offline page wording; the 100-entry asset cache cap; the account menu's contents.

## Verification

`PORT=3402 node ace test` passes; `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
