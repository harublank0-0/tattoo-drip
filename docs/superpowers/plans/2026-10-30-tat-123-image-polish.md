# TAT-123: studio page image polish (white logos, a favicon from the logo, Back on the work viewer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 1. Header

- **Ticket:** TAT-123 "Studio page image polish: white logos, a favicon from the logo, back button on the work viewer" (Linear estimate 2; this plan's estimate: **5 points**: three separate features, one of them with a migration, a contract field, a dashboard control and an owner-only route; see Risks).
- **Branch:** `harublank00/tat-123-studio-page-image-polish-white-logos-a-favicon-from-the-logo` in the worktree `/home/blank/Coding/tattoo-drip-wt/site-6`, dependencies installed.
- **Base:** local `main` at `d14ad81` (the whole studio website so far: TAT-125, 126, 127, 128, 129 part 4a).
- **Lane:** database `tattoo_drip_uw` (create it the grants-only way of `/home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/run9-tat128-builder-brief.md`, "Environment facts": `CREATE DATABASE`, `setup_roles.sql` without the `ALTER ROLE :"app_user" LOGIN` line, then `pnpm migrate`), platform dev server **3441**, platform tests **3442**, storefront dev **3444**, stand-in API **3445**. Every platform command: `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform DB_DATABASE=tattoo_drip_uw`; test runs also `unset TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS`. Node 24: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`. A RED run that may hit a missing import: wrap it in `timeout 90` (Japa hangs on import errors).
- **Full platform suite** (and any run that includes `setup_roles.spec.ts` or `role_guard.spec.ts`) under both locks, nested: `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock <cmd>`.
- **Never touch** `/home/blank/Coding/tattoo-drip` (the user's checkout), local `main`, `main-integration`, the worktrees `site-1` to `site-4` (TAT-129 part 4b "flash claiming" is being built in parallel and edits flash cards, flash pages, `openapi.yaml`'s flash schemas, `styles.css` and adds migration `1791810000000_add_flash_claiming.ts`), or the servers on 3333 / 3000 / 3401-3405 / 3431-3435.
- **Goal in plain words:** (1) a white or light logo with a see-through background no longer vanishes on the light tile: the platform notices it on upload and puts it on a dark tile, says so, and the owner can switch the tile with one tap; (2) the studio's pages get a browser-tab and home-screen icon made from the logo (a padded square, made at upload, served like the logo's other copies); (3) on a phone, Back closes an open work photo instead of leaving the page.

## 2. Scope fence

**May change (create or modify):**

- Platform code: `app/modules/media/services/image_processor.ts` (two functions, three constants), `app/modules/media/variants.ts` (`ICON_WIDTHS`), `app/modules/media/services/image_service.ts` (`studio_icon` purpose, `storeLogo`, a private split of `store`/`storeBytes`), `app/modules/storefront/look.ts` (the tile list and colours), `app/modules/tenancy/services/tenancy_service.ts` (`setLogo`, `removeLogo`, new `setLogoTile`; `BRAND_IMAGES` keeps the cover only), `app/modules/tenancy/validators/tenant.ts` (`logoTileValidator`), `app/modules/tenancy/look_messages.ts` (three sentences), `app/modules/tenancy/access.ts` (one entry), `app/controllers/studio_logo_controller.ts` (the saved message, new `tile` action), `app/controllers/page_look_controller.ts` (the preview's tile), `app/modules/storefront/services/studio_page_service.ts` (`ShownLogo`), `app/transformers/public_studio_transformer.ts`, `start/routes.ts` (one route), `inertia/components/logo_form.tsx`, `inertia/components/page_look.ts`, `inertia/css/app.css` (one token, one theme alias); new migration `database/migrations/1791820000000_add_logo_tile_and_icon_to_tenants.ts`; generated `database/schema.ts` and `.adonisjs/`.
- Platform tests: `tests/unit/modules/media/image_processor.spec.ts`, `tests/unit/modules/storefront/look.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/functional/tenancy/studio_logo.spec.ts`, new `tests/functional/tenancy/logo_tile_columns.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts`, `tests/functional/api/public_studio.spec.ts`, `tests/functional/storefront/studio_page_service.spec.ts`, `tests/isolation/cases.ts`, `tests/helpers/images.ts` (one helper; `RecordingImageService` only if a test reads its keys for a logo), `tests/helpers/tenants.ts` (`seededStudio`: an icon key and the dark tile), and any spec the type checker or a changed shape breaks (fix the expectation, never the rule).
- Packages: `packages/types/openapi.yaml` (new `Logo` schema), `packages/types/src/index.ts` (`Logo`), generated `packages/types/src/openapi.gen.ts`; fixture `packages/sdk/test/client.test.ts` (its logo gains `tile` and `icon`).
- Storefront: `src/studio/theme/config.ts` (`LogoTile`, `LogoImage`, `readLogoTile`, `ThemeConfig.icon`), `src/studio/components/brand.tsx` (`data-tile`), `src/deposit/loader.ts` and `src/deposit/components/deposit-page.tsx` (the type and `data-tile`), `src/styles.css` (one token, one rule), new `src/studio/icon.ts`, `src/routes/__root.tsx` (the icon links), `src/studio/lightbox.ts`; tests: `test/studio/logo-plate.test.ts`, `test/studio/theme-config.test.ts`, `test/studio/theme-render.test.ts`, `test/deposit/loader.test.ts`, `test/deposit/render.test.ts` (or the deposit test that renders the header), new `test/studio/icon.test.ts`, `test/studio/root-head.test.ts`, new `test/studio/lightbox-history.test.ts`, `test/studio/lightbox-guard.test.ts`, `test/studio/lightbox.test.ts`.
- Docs (Task 8): `apps/storefront/docs/development.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `docs/data-model.md`, `docs/requirements.md`, `docs/sdk.md`.

**NOT in this plan:**

- Anything under flash: `src/studio/flash.ts`, `src/studio/components/flash.tsx`, `src/routes/flash/*`, the platform `flash` module, `FlashDesign` in `openapi.yaml` (TAT-129 4b owns them; the flash pages use no photo viewer, checked below).
- A PWA manifest or 192/512 px icons (the storefront has none, `apps/storefront/public/` holds only `robots.txt`); a crop tool; an icon preview in the dashboard; a separate icon upload.
- Making icons for logos saved before this ships (no backfill: owner decision 4); regenerating the icon when the owner switches the tile (owner decision 3).
- A tile behind the cover, an "accent" or "no tile" option, a tile per colour scheme.
- The viewer's next/previous, swipe, a per-photo address (deep link to an open photo), reopening on Forward (owner decision 5).
- Settings' `window.confirm` for logo removal (the Settings follow-up named in `apps/platform/docs/ui.md`).

## 3. Facts verified on this branch (at `d14ad81`)

**Logo storage (TAT-56).**
- `IMAGE_PURPOSES` (`app/modules/media/services/image_service.ts:32-41`): `studio_logo: { visibility: "public", variants: VARIANT_WIDTHS }`. `store` (108-119) reads the temp file, deletes it, calls `storeBytes` (126-149), which runs `processImage` then writes the copies (`storeVariants`, best effort) and the image under `tenants/<tenant>/<purpose>/<uuid>[.<widths>].<ext>`. `deleteOrThrow` (306-309) treats a missing file as deleted; `filesOf` (320-328) includes every copy the purpose could have made.
- `processImage` (`image_processor.ts:78-82`, `decode` 130-170): PNG stays PNG with its alpha; **JPEG and WebP are flattened on white** (`flatten({ background: "#ffffff" })`, line 155), so only a PNG can be see-through. Images fit 2048 × 2048. Every decode takes one of two slots (`decodeSlot`, line 26). `makeVariants` (95-127) opens its source with `limitInputPixels: MAX_VARIANT_INPUT_PIXELS` (line 16, module-private) and `failOn: "error"`.
- Key grammar (`app/modules/media/variants.ts:7-9`, `NAMED` line 64): widths of 1 to 4 digits, so `<uuid>.32.png` names a 32 px copy `<uuid>.32w.png`.
- Tenant columns: `logo_image_key`, `logo_image_width`, `logo_image_height`, all or none (`tenants_logo_all_or_none`, `database/migrations/1791696000000_add_page_look_to_tenants.ts:47`). Look columns carry **shape-only** checks; which keys exist is the app's list (same migration's comment). Latest migrations: `1791800000000_create_flash_designs_table.ts`, `1791800000001_add_flash_section_to_tenants.ts`; 4b's is `1791810000000`.
- `TenancyService` (`app/modules/tenancy/services/tenancy_service.ts`): `BRAND_IMAGES` (38-51) holds cover and logo; `setLogo` (258) and `removeLogo` (266) call the generic `setImage` (275: store before the lock, `afterRollback` right after the store, lock with `forUpdate`, swap the three columns, delete the old files `afterCommit`) and `removeImage` (303: under the lock, `deleteOrThrow`, then clear the columns). `updateLook` (205) writes only the five look columns.
- `StudioLogoController` (`app/controllers/studio_logo_controller.ts`): `update` flashes "Logo saved."; `destroy` flashes "Logo removed." or "Couldn't remove the logo, try again.". Routes `PUT/DELETE /t/:tenant/settings/logo` (`start/routes.ts:138-143`), `TENANT_ROUTE_ROLES` owners (`app/modules/tenancy/access.ts:43-44`), isolation cases (`tests/isolation/cases.ts:434-448`, snapshot `tenantRow` at line 100).
- `PageLookController.show` (`app/controllers/page_look_controller.ts:60-70`) sends `logo: { previewUrl, width, height }` (the 640 copy); `LogoProps` (`inertia/components/page_look.ts:63`). `LogoForm` (`inertia/components/logo_form.tsx:48`) draws the preview on `bg-logo-plate`; `--logo-plate: #f7f3ee` is in `inertia/css/app.css:141`, aliased at 204. Copy: `LOGO_INTRO` (`page_look.ts:83-84`, pinned verbatim in `tests/unit/inertia/page_look_copy.spec.ts:367-368`) says "on a light tile. A dark logo saved as a PNG with a see-through background works best."; `LOGO_FILE_HELP` (89-90) says only a PNG keeps a see-through background. `takesFocusBack` (`page_look.ts:245`) and look.tsx's `SaveButton` (409-448) give a disabled-while-saving button its focus back.
- Dashboard `Button` is at least 44 px below `lg` (`inertia/components/ui/button.tsx:22-29`).
- Test helpers: `testImages` (`tests/helpers/images.ts:21-53`: `png` is an opaque red 3-channel PNG, `transparentPng` a half see-through green), `uploadOf`, `RecordingImageService` (overrides `store` only), `storedImages(tenant, purpose)` (`tests/helpers/uploads.ts:30`), `failPuts` / `failDeletes` (`tests/helpers/storage_failures.ts:10,35`). `seededStudio` sets a made-up logo key (`tests/helpers/tenants.ts:161-173`). `publicMarkers` (`tests/helpers/public_isolation.ts:12`) include the tenant id, which is in every image URL.
- The cross-app drift precedent: `tests/unit/modules/storefront/look.spec.ts:24-60` reads storefront source and `openapi.yaml` as text.

**Public read and contract.**
- `StudioPage.storefront` is `{ look: PageLook; logo: ShownImage | null }` (`app/modules/storefront/services/studio_page_service.ts:52`); `logoOf` (439-448) builds it from the loaded row, no query. The transformer (`app/transformers/public_studio_transformer.ts:54-74`) writes `branding.logo` as `{ url, width, height, alt: null, variants }`. `public_studio.spec.ts:455-490` pins the exact keys of `storefront` and `branding`, 539-580 the logo's keys; `studio_page_service.spec.ts:520-545` its shape.
- `openapi.yaml`: `Image` (716-738, `additionalProperties: false`), `StorefrontConfiguration.branding.logo` (`oneOf [Image, null]`, ~877-882). `packages/types/src/index.ts:10` exports `Image`; `packages/sdk/test/client.test.ts:745` holds a typed logo fixture.
- Caching: the API's reads `max-age=60, stale-while-revalidate=600`, the storefront's pages `s-maxage=60, stale-while-revalidate=600` (`apps/storefront/src/studio/cache.ts:9`); the look's flash says "up to 15 minutes" (`app/modules/tenancy/look_messages.ts`).

**Storefront logo and head.**
- `parseThemeConfig` (`src/studio/theme/config.ts:255-272`) reads `branding.logo` with `readBrandImage` (190-206: the API's origin only, `safeImageUrl`, sides 1 to 10 000, `readSrcSet` copies). `ThemeConfig.logo: BrandImage | null` (87); `DEFAULT_THEME_CONFIG` (98-106) is frozen.
- `BrandLogo` (`src/studio/components/brand.tsx:20-42`) renders the hero and site-bar logos (`pages.tsx:56-60, 548-553`); the deposit header renders its own `<img className="deposit-logo">` (`src/deposit/components/deposit-page.tsx:101-113`) from `DepositShell.logo: BrandImage | null` (`src/deposit/loader.ts:25,38`).
- `styles.css`: `--logo-plate: #f7f3ee` (line 106, `:root` only); `.profile-logo` (204), `.site-bar-logo` (305), `.deposit-logo` (581): `content-box`, `0.25rem` padding, `background: var(--logo-plate)`. All three are in `@layer components` blocks. `test/studio/logo-plate.test.ts` pins them; `theme-render.test.ts:160,211` pins the logo `<img>` HTML exactly (so a light logo must render byte-for-byte as today).
- `__root.tsx:49-53` ships `{ rel: "icon", href: "data:," }`; the root loader returns the API's `Studio` (`loadStudio`, `src/api/loaders.ts:28-40`); `head` gets `{ loaderData, match, matches }` and `match.context` is the router context (`@tanstack/router-core` `AssetFnContextOptions`, `route.d.ts:300-308`); the API origin is `context.tattoo.connection.apiUrl` (loaders use it, e.g. `src/studio/loaders.ts:503`; the getter throws only before the client is connected, which a successful root loader rules out).

**The work photo viewer.**
- `showPhoto(id)` (`src/studio/lightbox.ts:16-29`) is the only `showModal` caller; `GalleryGrid` (`src/studio/components/gallery.tsx:29-94`) is used by `RecentWork` (home) and `PagedGallery` (`src/studio/paging.tsx:66`, artist page and `/work`). The flash pages do not use it (`rg showPhoto|GalleryGrid src` finds only these). The dialog closes through `<form method="dialog">` (Close) and Escape; its artist link is a plain `<a>` (full navigation).
- Guards: `test/studio/lightbox.test.ts:34-95` (showModal only in lightbox.ts; exactly one `document.` there; components hold no listeners, effects or `window.`; `paging.tsx` the only other DOM user); `test/studio/lightbox-guard.test.ts` stands in `document`, `window.location` and `HTMLDialogElement` and calls `showPhoto` with a fake dialog that has no `addEventListener` (it must gain one).
- The router (`src/router.tsx`): `scrollRestoration: true`, `getScrollRestorationKey: scrollRestorationKey` (the entry's `__TSR_key`, else the path). TanStack's browser history (`@tanstack/history@1.162.4`, `dist/esm/index.js`) replaces **the instance's** `window.history.pushState`/`replaceState` with wrappers that notify the router (which runs `router.load()`, lines 333-342); `History.prototype.pushState` stays the browser's own. On `popstate` it compares `state.__TSR_index` with its current location's: a delta of 0 is a "GO" that runs `router.load()` for the same location, whose loaders answer from the Query cache (`staleTime: "static"`).
- `development.md:81` records the gap: "no history entry, so on Android the system back button leaves the studio page".

**Measured in a scratch probe (sharp 0.35.5, not in the repo):** with the rule below, a white, yellow or orange see-through logo picks dark; black, red (#dd0000), grey (#808080), the helper's half see-through green, an opaque PNG and a fully clear PNG pick light; 60 % white / 40 % black bands pick dark and 40 / 60 light, the same at 64 and 128 px samples. `squareIcon` of a 600 × 200 white logo on `#14110f` gives a 180 × 180 opaque PNG (about 1.2 KB; its 32 px copy about 0.3 KB), corner `(20,17,15)`, centre white; a 40 × 20 logo is enlarged to 144 px wide. `sharp(...).toColourspace("srgb").ensureAlpha()` gives 4 raw channels for grey and palette PNGs.

## 4. Decisions

1. **White logos: detect on upload AND let the owner switch (both).** On upload the platform picks the tile: **dark** when the PNG has see-through pixels and more than half of what can be seen of it (pixels weighted by opacity, on a 64 px sample) is under 3:1 against the light tile (`#f7f3ee`) while less of it is under 3:1 against the dark tile (`#14110f`); **light** otherwise, always for a JPEG/WebP (flattened on white), an opaque PNG (the tile is only a 0.25rem frame around it) or a fully clear one. 3:1 is WCAG 1.4.11's minimum for graphics; "more than half" keeps a black logo with white details on the light tile. The saved message says when it picked dark, and Page look has one button to switch. Why: a warning alone leaves an owner whose only logo is white (common: it is made for black merch and Instagram) with nothing to do; a switch alone relies on the owner noticing an empty-looking preview. Rejected: warn only; switch only; inverting the logo.
2. **The tile is a column, `tenants.logo_tile` (`'light'` default), shape-checked like the look columns; the API serves it as `branding.logo.tile`.** An upload re-decides it (a new logo, a new judgement); the switch only writes this column. The dark tile is the dark paper `#14110f` in both schemes, as the light tile is the light paper in both. Rejected: a strict `in ('light','dark')` check (the look columns' convention is shape only), a per-scheme tile.
3. **The icon is a padded square made at upload: a 180 × 180 PNG (Apple's home-screen size) with a 32 px copy (the browser tab), the logo centred inside an 18 px margin (a tenth: iOS rounds the corners) on the colour of the tile picked at upload, never see-through (a home screen fills transparency with black).** It is a second stored image under a new public purpose `studio_icon` (`variants: [32]`), so it reuses the key grammar, copies, URLs, key check and deletes of every other image; its key is `tenants.logo_icon_key`, null or set only with a logo (check `tenants_logo_icon_needs_logo`). Made and stored best effort after the logo: a failure is logged and leaves the logo without an icon (today's state). Why padded: most logos are wide wordmarks, a crop cuts the text, and a square logo loses only the margin. Rejected: a crop; an icon derived on request (load and a cache to manage); icon copies named under the logo's own key (a new key grammar for every helper); a manifest with 192/512 (no manifest exists).
4. **The icon keeps the tile picked at upload; switching the tile later changes the page's tile only.** Why: the picked tile is by construction the one the logo shows on; regenerating on a switch needs a disk read of the stored logo and a second store-under-lock flow for a rare action. (Owner decision 3.)
5. **The contract gains a `Logo` schema: `Image`'s fields plus `tile` (`light | dark`, unknown → light) and `icon` (`Image | null`).** `branding.logo` becomes `oneOf [Logo, null]`. Why: both only make sense with a logo, so they live inside it (no `icon` without a logo, no tile without a logo), and the `logo: null` fixtures stay valid. Both come from the tenant row already loaded: **no new query** on `getStudio` or Page look. The page cache and the contract stay consistent because the logo, its tile and its icon come from one row in one read and land in one render (head and body); old files are deleted after the commit, so a page cached for up to ~12 minutes may point at a deleted icon (the browser shows its default icon, as it shows a broken logo today), and the next render has the new random URL, so no browser keeps an old favicon.
6. **The storefront reads them through the theme's checks:** `ThemeConfig.logo` becomes a `LogoImage` (`BrandImage` + `tile`), `ThemeConfig.icon` a square `BrandImage` read from `branding.logo.icon` with `readBrandImage`'s rules (the API's origin only). A dark logo renders `data-tile="dark"` and CSS gives it `--logo-plate-dark`; a light one renders exactly as today (no attribute), so every pinned HTML stays. The root route's head links `rel="icon" sizes="32x32"` (the copy), `rel="icon" sizes="180x180"` and `rel="apple-touch-icon"` (the 180 image), all on the API's origin, else keeps `data:,` (no `/favicon.ico` request). No `type` attribute (the storefront cannot check the format). No third-party request: the icon is on the origin the logo already loads from.
7. **Back closes the viewer: one history entry while a photo is open, same address, router state copied.** `showPhoto` pushes `{ ...history.state, tattooDripPhoto: <dialog id> }` with no URL (so the address, its search and hash never change: reload, share and copy give the page itself) through `History.prototype.pushState` (the browser's own; TanStack wraps only the instance's, and would run the route loaders for it). A `popstate` while it is open closes the dialog; a close by Escape, Close or Android's own close request (Chrome closes a modal `<dialog>` on Back itself) calls `history.back()` once if the viewer's entry is still current, and a new photo waits for that back to land. An entry left marked by a reload is reused (`replaceState`), not stacked. The no-JavaScript grid and the no-`<dialog>` fallback (the large photo in its own page) add no entry. The router sees the pops as a same-entry "GO" and answers from cache; the browser check confirms nothing scrolls (contingency in Risks). Rejected: a `#photo` hash (the router treats a hash change as navigation, and a reload would land on a closed dialog); `router.history.push` (a load and scroll handling on every open); `CloseWatcher` alone (not in Safari, Firefox or older Android WebViews).

## 5. Design

**Settings, Page look, "Logo" section** (`LogoForm`; dashboard tokens and shadcn only):

- 375 px and 1280 px, top to bottom: the section title and `LOGO_INTRO`; with a logo, the preview on its tile (`inline-flex self-start rounded-md border p-1` plus `bg-logo-plate` or `bg-logo-plate-dark`, image `h-16 w-auto max-w-48`), then one line `tileLine(tile)` (`text-sm text-muted-foreground`) and the tile button (outline, `self-start`, 44 px below `lg` from `Button`), then the upload form and "Remove logo" as today. Without a logo: `NO_LOGO`, the upload form, no tile line or button.
- The tile button is its own `<Form route="tenant.settings.logo.tile.update">` with a hidden `tile` set to the other tile and `options={{ preserveScroll: true }}`; disabled with "Saving…" while it saves and focus back on it when the save ends (copy look.tsx's `SaveButton` rule with `takesFocusBack`; a component inside `logo_form.tsx`). After the save the props change, so the line, the preview's tile and the button's words follow without a remount.
- Dark mode: the dark tile on the dark surface keeps the preview's `border`, so the tile's edge shows.
- Words (calm studio manager, short, specific; `page_look.ts` unless noted):
  - `LOGO_INTRO`: "Shown above your studio's name, on each artist's page and on the deposit page, on a small tile, and as your page's icon in the browser tab. A PNG with a see-through background works best."
  - `tileLine("light")`: "It sits on a light tile. A white or light logo shows better on a dark one." `tileLine("dark")`: "It sits on a dark tile. A dark logo shows better on a light one."
  - `tileButton(tile, processing)`: "Use a dark tile" / "Use a light tile" / "Saving…".
  - `LOGO_TILE_CLASS`: `{ light: "bg-logo-plate", dark: "bg-logo-plate-dark" }` (literal class names, so Tailwind sees them).
  - `look_messages.ts`: `LOGO_SAVED` "Logo saved." (moved from the controller), `LOGO_SAVED_ON_DARK_TILE` "Logo saved. It's light, so your page shows it on a dark tile. You can change that under Logo.", `LOGO_TILE_SAVED` "Tile saved. It can take up to 15 minutes to show on your page."
  - Validator: "Choose a light or a dark tile." for `tile.required` and `tile.enum`.
- `LOGO_FILE_HELP` and `NO_LOGO` stay.

**Studio pages** (hero, artist page's site bar, deposit header), 375 and 1280, light and dark: a logo with `tile: "dark"` sits on `#14110f` (white on it 18.8:1); over the cover's scrim the dark tile blends in and the white logo reads; a light logo is unchanged. Devanagari names are untouched (the tile is the image's padding only; `content-box` sizes stay, so `logoSizes` and `srcset.test.ts` stay right).

**Head:** a studio with an icon: three `<link>`s on the API's origin; without: `<link rel="icon" href="data:,">`. The not-found and error states with a loaded studio keep its icon; a failed root read keeps `data:,`.

**Viewer:** nothing visible changes; Back (Android button, iOS swipe, desktop Back) closes an open photo and returns focus to its button (the browser's own); Close and Escape as today; the address bar never changes.

**Server vs client:** the tile and the icon are computed on the platform at upload; the storefront only reads checked values; the history entry is browser-only (`lightbox.ts`, no component gains a listener).

## 6. Data and contract

- **Migration** `apps/platform/database/migrations/1791820000000_add_logo_tile_and_icon_to_tenants.ts` (additive; `tenants` already has RLS, so no `enableTenantRls()` and no `EXPECTED_POLICIES` change):
  - `up`: `table.string("logo_tile", 10).notNullable().defaultTo("light")`, `table.string("logo_icon_key", 255).nullable()`; raw `alter table tenants add constraint tenants_logo_tile_format check (logo_tile ~ '^[a-z]{1,10}$')` and `alter table tenants add constraint tenants_logo_icon_needs_logo check (logo_icon_key is null or logo_image_key is not null)`.
  - `down`: drop both constraints, then both columns. Comment: TAT-123, what each column is, shape-only as the look columns.
  - Run `pnpm migrate`, `pnpm exec biome check --write apps/platform/database/schema.ts` (from the root), then `pnpm migrate:rollback` and `pnpm migrate` once to prove `down`.
- **Look module** (`app/modules/storefront/look.ts`): `LOGO_TILES = ["light", "dark"] as const`, `type LogoTile`, `DEFAULT_LOGO_TILE: LogoTile = "light"`, `LOGO_TILE_COLOURS: Record<LogoTile, string> = { light: LIGHT_PAPER, dark: DARK_PAPER }`, `logoTileOf(stored: string): LogoTile` (`isOneOf(LOGO_TILES, stored) ? stored : DEFAULT_LOGO_TILE`).
- **Media:** `ICON_WIDTHS = [32] as const` in `variants.ts` (doc: the browser tab's copy of a 180 px icon); `studio_icon: { visibility: "public", variants: ICON_WIDTHS }, // TAT-123` in `IMAGE_PURPOSES`.
- **Contract** (`packages/types/openapi.yaml`, then `pnpm --filter @tattoo-drip/types generate`; add `export type Logo = Schemas["Logo"];` to `packages/types/src/index.ts`):

  ```yaml
      Logo:
        type: object
        description: |
          The studio's logo (TAT-56) as an `Image` (`alt` is always null: it
          sits beside the studio's name; a PNG keeps its transparency), with the
          tile it sits on and its square icon (TAT-123).
        required: [url, width, height, alt, variants, tile, icon]
        additionalProperties: false
        properties:
          url: { type: string, format: uri, description: Public and absolute. }
          width: { type: integer, minimum: 1 }
          height: { type: integer, minimum: 1 }
          alt: { type: [string, "null"] }
          variants:
            type: array
            maxItems: 8
            description: |
              Smaller copies, narrowest first (320, 640 and 1280 px, those below
              the logo's own width), `[]` when it has none. Build `srcset` from
              these and `url` at `width`.
            items: { $ref: "#/components/schemas/ImageVariant" }
          tile:
            type: string
            enum: [light, dark]
            description: |
              The small tile the logo sits on, in both colour schemes: `light`
              (#f7f3ee) or `dark` (#14110f). Picked when the logo is uploaded (a
              light logo with a see-through background gets the dark one); the
              owner can change it. Treat an unknown value as `light`.
          icon:
            description: |
              A square copy of the logo for the browser tab and a phone's home
              screen, or null (a logo saved before TAT-123, or one whose icon
              could not be made): a 180 x 180 PNG of the logo on the tile picked
              at upload, never see-through, with its 32 px copy in `variants`.
              `alt` is always null.
            oneOf: [{ $ref: "#/components/schemas/Image" }, { type: "null" }]
  ```

  and `StorefrontConfiguration.branding.logo` becomes `oneOf: [{ $ref: "#/components/schemas/Logo" }, { type: "null" }]` (keep its description, pointing to `Logo`).
- **Read model:** `ShownLogo = ShownImage & { tile: LogoTile; icon: ShownImage | null }` in `studio_page_service.ts`; `StudioPage.storefront.logo: ShownLogo | null`. `logoOf` adds `tile: logoTileOf(tenant.logoTile)` and `icon: tenant.logoIconKey ? await this.images.shownImage("studio_icon", tenant.logoIconKey, tenant, { width: ICON_SIZE, height: ICON_SIZE }) : null` (a `const ICON = "studio_icon"` beside `LOGO`). Queries per `getStudio`: unchanged (pinned in `studio_page_service.spec.ts`).
- **Transformer:** `logo` adds `tile: logo.tile` and `icon: logo.icon ? { url, width, height, alt: null, variants: [{ url, width }] } : null`; update its doc comment (the icon key column stays on the row).
- **Route:** `router.put("logo/tile", [controllers.StudioLogo, "tile"]).as("tenant.settings.logo.tile.update")` in the settings group after the logo routes; `"tenant.settings.logo.tile.update": OWNERS` in `TENANT_ROUTE_ROLES`; isolation case `{ method: "PUT", pattern: "/t/:tenant/settings/logo/tile", actor: "owner", body: () => ({ tile: "light" }), ownStatus: 302, snapshot: tenantRow }` (seededStudio's tile is dark, so the owner's own request changes the row); `node ace codegen` and keep the regenerated `.adonisjs/`.
- **Validator:** `logoTileValidator = vine.create({ tile: vine.enum(LOGO_TILES) })` with the message above.
- **SDK/React:** no code change; `packages/sdk/test/client.test.ts`'s logo fixture gains `tile: "light", icon: null` (or a full icon) so it type-checks.

## 7. Tasks

### Task 1: The tile rule and the square icon in the image processor

**Goal:** two pure-ish sharp functions, tested in Node, and the tile list.

**Files:** `apps/platform/app/modules/media/services/image_processor.ts`, `app/modules/media/variants.ts`, `app/modules/storefront/look.ts`, `tests/helpers/images.ts`, `tests/unit/modules/media/image_processor.spec.ts`, `tests/unit/modules/storefront/look.spec.ts`.

- [ ] **Step 1: Test helper.** In `tests/helpers/images.ts` add to `testImages`:

```ts
	/**
	 * A logo on a see-through background (TAT-123): `bands` of opaque colour
	 * side by side, each an equal share of a box with a clear margin around it,
	 * so a test can say how much of a logo is light.
	 */
	logoOnClear: (bands: Rgba[], width = 600, height = 200) => {
		const margin = Math.round(height / 10);
		const bandWidth = Math.floor((width - 2 * margin) / bands.length);
		return canvas(width, height, { r: 0, g: 0, b: 0, alpha: 0 })
			.composite(
				bands.map((colour, index) => ({
					input: {
						create: {
							width: bandWidth,
							height: height - 2 * margin,
							channels: 4,
							background: { ...colour, alpha: 1 },
						},
					},
					top: margin,
					left: margin + index * bandWidth,
				})),
			)
			.png()
			.toBuffer();
	},
```

(export the `Rgba` type if the spec needs it.)

- [ ] **Step 2: Failing tests** in `tests/unit/modules/media/image_processor.spec.ts`, a new group "logoTile and squareIcon (TAT-123)", each input through `processImage` first (that is what the service passes), tiles `{ light: "#f7f3ee", dark: "#14110f" }`:
  - white `[{255,255,255}]`, yellow `{255,204,0}` and orange `{230,126,34}` on clear → `"dark"`;
  - black, red `{221,0,0}` and grey `{128,128,128}` on clear → `"light"`;
  - `[W,W,W,B,B]` → `"dark"`; `[W,W,B,B,B]` → `"light"` (more than half must be hidden);
  - `testImages.png()` (opaque), `testImages.transparentPng()` (half see-through green) and a fully clear PNG (`canvas` with alpha 0) → `"light"`;
  - a JPEG `ProcessedImage` is `"light"` without decoding: `logoTile({ data: Buffer.from("not an image"), format: "jpeg", width: 1, height: 1 }, tiles)` resolves `"light"`;
  - `squareIcon(white 600 × 200, "#14110f")`: `sharp(result).metadata()` is PNG 180 × 180; `stats().isOpaque` true; raw pixel (0,0) is `[20,17,15]`, (90,90) white, (90,40) background (the logo is 144 × 48, centred);
  - `squareIcon(black 40 × 20, "#f7f3ee")`: pixel (20,90) black (enlarged to 144 px wide), (90,50) `[247,243,238]`.
  - Why it fails: `logoTile` and `squareIcon` do not exist (import error: run RED under `timeout 90`).
- [ ] **Step 3: Implement** in `image_processor.ts` (after `makeVariants`):

```ts
/** A logo's two tiles (TAT-123), "#rrggbb": the colour behind it on the studio page. */
export type TileColours = { light: string; dark: string };

/** A logo is judged on a copy at most this many pixels on a side: enough for shares, cheap to read. */
const TILE_SAMPLE = 64;
/** WCAG's minimum for graphics (1.4.11): a pixel under 3:1 against a tile is hard to see on it. */
const MIN_TILE_CONTRAST = 3;
/** The icon's side (TAT-123): Apple's home-screen size; its 32 px copy is the browser tab's (ICON_WIDTHS). */
export const ICON_SIZE = 180;
/** The margin around the logo inside its icon, a tenth of each side, so iOS's rounded corners never cut it. */
export const ICON_PADDING = 18;

function linear(value: number): number {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function hexLuminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((start) =>
		Number.parseInt(hex.slice(start, start + 2), 16),
	);
	return luminance(r, g, b);
}

function contrast(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The tile a logo shows on (TAT-123): "dark" when more than half of what can
 * be seen of it is under 3:1 on the light tile and less of it is under 3:1 on
 * the dark one (a white or yellow logo); "light" otherwise, and always for a
 * logo with nothing see-through (a JPEG, an opaque PNG: the tile is only a thin
 * frame around it) or nothing visible. Pixels count by their opacity, on a copy
 * at most TILE_SAMPLE px on a side. Takes a decode slot; only processImage's
 * output may come in.
 */
export async function logoTile(
	image: ProcessedImage,
	tiles: TileColours,
): Promise<"light" | "dark"> {
	if (image.format !== "png") return "light";
	return decodeSlot(async () => {
		const { data, info } = await sharp(image.data, {
			limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
			failOn: "error",
		})
			.toColourspace("srgb")
			.ensureAlpha()
			.resize({ width: TILE_SAMPLE, height: TILE_SAMPLE, fit: "inside" })
			.raw()
			.toBuffer({ resolveWithObject: true });
		if (info.channels !== 4) {
			throw new Error(`a tile sample came out with ${info.channels} channels`);
		}
		const light = hexLuminance(tiles.light);
		const dark = hexLuminance(tiles.dark);
		let seen = 0;
		let hiddenOnLight = 0;
		let hiddenOnDark = 0;
		let seeThrough = false;
		for (let index = 0; index < data.length; index += 4) {
			const alpha = data[index + 3];
			if (alpha < 255) seeThrough = true;
			if (alpha === 0) continue;
			const weight = alpha / 255;
			const pixel = luminance(data[index], data[index + 1], data[index + 2]);
			seen += weight;
			if (contrast(pixel, light) < MIN_TILE_CONTRAST) hiddenOnLight += weight;
			if (contrast(pixel, dark) < MIN_TILE_CONTRAST) hiddenOnDark += weight;
		}
		if (!seeThrough || seen === 0) return "light";
		return hiddenOnLight > seen / 2 && hiddenOnDark < hiddenOnLight
			? "dark"
			: "light";
	});
}

/**
 * A logo's square icon (TAT-123): an ICON_SIZE px PNG, the logo fitted inside a
 * margin of ICON_PADDING (enlarged when smaller), centred on `background` (a
 * tile's "#rrggbb"), never see-through: a home screen fills transparency with
 * black. Takes a decode slot. Store it with storeBytes: its copies come from
 * its purpose.
 */
export async function squareIcon(
	image: ProcessedImage,
	background: string,
): Promise<Buffer> {
	return decodeSlot(async () => {
		const inner = ICON_SIZE - 2 * ICON_PADDING;
		const fitted = await sharp(image.data, {
			limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
			failOn: "error",
		})
			.resize({ width: inner, height: inner, fit: "inside" })
			.png()
			.toBuffer();
		return sharp({
			create: { width: ICON_SIZE, height: ICON_SIZE, channels: 3, background },
		})
			.composite([{ input: fitted, gravity: "centre" }])
			.png()
			.toBuffer();
	});
}
```

  `variants.ts`: `ICON_WIDTHS = [32] as const` with a one-line doc. `look.ts`: the tile list of section 6 (with docs), plus tests in `look.spec.ts`: `logoTileOf("dark") === "dark"`, `logoTileOf("Dark")`, `logoTileOf("")` and `logoTileOf("accent")` are `"light"`; `LOGO_TILE_COLOURS` equals `{ light: LIGHT_PAPER, dark: DARK_PAPER }`.
- [ ] **Step 4: Run** `cd apps/platform && ENV_PATH=… DB_DATABASE=tattoo_drip_uw node ace test unit --files=image_processor.spec.ts` and `--files=look.spec.ts`: green.
- [ ] **Step 5: Commit**

```
feat(platform): pick a logo's tile and make its square icon in the image processor

logoTile says whether a logo shows on the light or the dark tile: dark when more
than half of what can be seen of it is under 3:1 on the light one (TAT-123).
squareIcon draws it, padded, on a 180 px square of that tile's colour.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 2: Store the tile and the icon with each logo

**Goal:** the migration, the `studio_icon` purpose, `ImageService.storeLogo`, and `TenancyService.setLogo` / `removeLogo` / `setLogoTile`.

**Files:** the migration, generated `database/schema.ts`, `image_service.ts`, `tenancy_service.ts`, `tests/functional/tenancy/logo_tile_columns.spec.ts` (new), `tests/functional/tenancy/studio_logo.spec.ts`, `tests/helpers/images.ts` (`RecordingImageService` if needed).

- [ ] **Step 1: Failing tests.**
  - `logo_tile_columns.spec.ts` (new file, so 4b's edits to `page_look_columns.spec.ts` never conflict), modelled on `page_look_columns.spec.ts`: a new studio reads `logo_tile = 'light'`, `logo_icon_key = null`; the database refuses `logo_tile = 'Dark Tile'` (`tenants_logo_tile_format`) and an icon key without a logo (`tenants_logo_icon_needs_logo`), SQLSTATE 23514. Fails: no columns.
  - `studio_logo.spec.ts` (const `ICON = "studio_icon"`; read a stored file as `sharp(app.tmpPath("storage", "public", key))`):
    - "a white logo with a see-through background goes on the dark tile, with an icon on that tile": `setLogo` with `testImages.logoOnClear([{ r: 255, g: 255, b: 255 }])` → `logoTile === "dark"`, `logoIconKey` matches `^tenants/<id>/studio_icon/.+\.32\.png$`, `storedImages(tenant, ICON)` has 2 files, the icon is 180 × 180 and its pixel (0,0) is `[20,17,15]`.
    - "a dark logo stays on the light tile, and its icon is on the light tile" (the existing red 600 × 200) → `"light"`, icon pixel (0,0) `[247,243,238]`.
    - extend "replacing it deletes the old file…": inside the transaction both icons are there (4 files), after the commit 2; extend "a later failure…": the old icon key stays and `storedImages(tenant, ICON)` is still 2; extend "an unusable file…" and the cross-tenant test: icon files unchanged (2).
    - "an icon that can't be stored leaves the logo saved without one": `failPuts("public", (key) => key.includes("/studio_icon/"))` (restore in `finally`) → `logoImageKey` set, `logoIconKey` null, `storedImages(tenant, ICON)` `[]`.
    - extend "removeLogo deletes the files first…": the icon files are gone before the commit and `logoIconKey` is null; "a failed icon delete fails removeLogo and keeps the logo and its icon key; the retry removes both": `failDeletes("public", (key) => key.includes("/studio_icon/"))` → `ImageDeleteError`, both keys unchanged and the logo's files still there; retry → all gone.
    - "setLogoTile writes the tile and nothing else" (from a copy loaded before, like `page_look.spec.ts:92`), and another tenant's context gets `E_ROW_NOT_FOUND`.
  - Why they fail: no columns, no `storeLogo`, no `setLogoTile`.
- [ ] **Step 2: Migration** (section 6), migrate, format `schema.ts`, rollback and migrate once.
- [ ] **Step 3: `ImageService`.** Add the purpose. Split the upload read out of `store` (a module function `takeUpload(file)` that reads `tmpPath`, deletes it and returns the bytes, with `store`'s error for a missing `tmpPath`), and the part of `storeBytes` after `processImage` into `private async storeProcessed(image: ProcessedImage, { tenant, purpose })` (the current body from `const extension` on). `store` = `storeBytes(await takeUpload(file), …)`; `storeBytes` = `storeProcessed(await processImage(bytes), …)`; behaviour unchanged. Then:

```ts
/** A stored logo (TAT-123): the image, the tile it shows on, and its square icon or null. */
export type StoredLogo = StoredImage & {
	tile: "light" | "dark";
	icon: StoredImage | null;
};

	/**
	 * Stores a studio's logo (TAT-123): `store`'s checks and copies under
	 * `studio_logo`, then, best effort, its tile (logoTile) and its square icon
	 * on that tile's colour under `studio_icon`, with the icon's copy. A failure
	 * after the logo is stored is logged and leaves the light tile or no icon;
	 * the caller registers the cleanup of the logo and of the icon it returns.
	 */
	async storeLogo(
		file: Pick<MultipartFile, "tmpPath">,
		{ tenant, tiles }: { tenant: Pick<Tenant, "id">; tiles: TileColours },
	): Promise<StoredLogo> {
		const image = await processImage(await takeUpload(file));
		const logo = await this.storeProcessed(image, {
			tenant,
			purpose: "studio_logo",
		});
		let tile: "light" | "dark" = "light";
		try {
			tile = await logoTile(image, tiles);
		} catch (error) {
			logger.warn({ err: error }, "a logo's tile could not be picked; using the light one");
		}
		let icon: StoredImage | null = null;
		try {
			icon = await this.storeBytes(await squareIcon(image, tiles[tile]), {
				tenant,
				purpose: "studio_icon",
			});
		} catch (error) {
			logger.warn({ err: error }, "a logo's icon could not be stored; keeping the logo without it");
		}
		return { ...logo, tile, icon };
	}
```

  (`storeBytes` on the icon cleans up its own partial files before it throws.) If a logo test reads `RecordingImageService.keys`, override `storeLogo` there to push the logo's and the icon's keys.
- [ ] **Step 4: `TenancyService`.** Remove `logo` from `BRAND_IMAGES` (it keeps the cover; update its comment). `setLogo` and `removeLogo` keep their docs (extended) and become:

```ts
	async setLogo(
		tenant: Pick<Tenant, "id">,
		upload: Pick<MultipartFile, "tmpPath">,
	): Promise<Tenant> {
		return withTransaction(async (trx) => {
			const stored = await this.images.storeLogo(upload, {
				tenant,
				tiles: LOGO_TILE_COLOURS,
			});
			const icon = stored.icon;
			afterRollback(() => this.images.delete("studio_logo", stored.key));
			if (icon) afterRollback(() => this.images.delete("studio_icon", icon.key));
			const live = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.forUpdate()
				.firstOrFail();
			const previousLogo = live.logoImageKey;
			const previousIcon = live.logoIconKey;
			live.merge({
				logoImageKey: stored.key,
				logoImageWidth: stored.width,
				logoImageHeight: stored.height,
				logoIconKey: icon?.key ?? null,
				logoTile: stored.tile,
			});
			await live.save();
			if (previousLogo) {
				afterCommit(() => this.images.delete("studio_logo", previousLogo));
			}
			if (previousIcon) {
				afterCommit(() => this.images.delete("studio_icon", previousIcon));
			}
			return live;
		});
	}

	async removeLogo(tenant: Pick<Tenant, "id">): Promise<void> {
		await withTransaction(async (trx) => {
			const live = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.forUpdate()
				.firstOrFail();
			if (!live.logoImageKey) return;
			// The icon first: if it fails, the logo is still whole for the retry.
			if (live.logoIconKey) {
				await this.images.deleteOrThrow("studio_icon", live.logoIconKey);
			}
			await this.images.deleteOrThrow("studio_logo", live.logoImageKey);
			live.merge({
				logoImageKey: null,
				logoImageWidth: null,
				logoImageHeight: null,
				logoIconKey: null,
			});
			await live.save();
		});
	}
```

  `setLogoTile(tenant: Pick<Tenant, "id">, tile: LogoTile): Promise<void>`: `withTransaction`, lock the row like `updateLook`, `live.logoTile = tile`, `save()` (only the dirty column is written). Doc: owners only (the route says so), the icon keeps the tile it was made on.
- [ ] **Step 5: Run** `pnpm test functional --files=logo_tile_columns.spec.ts`, `--files=studio_logo.spec.ts`, `--files=image_service.spec.ts`, `--files=page_look.spec.ts` (all with the lane's env): green.
- [ ] **Step 6: Commit**

```
feat(platform): store each studio logo with its tile and a square icon

ImageService.storeLogo stores the logo, picks its tile and stores a 180 px icon
with a 32 px copy under the public studio_icon purpose, best effort. The tenant
row keeps logo_tile and logo_icon_key; replacing or removing the logo takes the
icon with it (TAT-123).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 3: The contract and the public read

**Goal:** `Logo` in the contract; `getStudio` serves `tile` and `icon`.

**Files:** `packages/types/openapi.yaml`, `packages/types/src/index.ts`, generated `openapi.gen.ts`, `packages/sdk/test/client.test.ts`; `studio_page_service.ts`, `public_studio_transformer.ts`; `tests/functional/api/public_studio.spec.ts`, `tests/functional/storefront/studio_page_service.spec.ts`, `tests/helpers/tenants.ts`, `tests/unit/modules/storefront/look.spec.ts`.

- [ ] **Step 1: Failing tests.**
  - `public_studio.spec.ts`: the logo's exact keys become `alt, height, icon, tile, url, variants, width`; for the 600 × 200 red logo `tile === "light"`, `icon` has exactly `alt, height, url, variants, width`, 180 × 180, `alt` null, variant widths `[32]`, every URL on the logo's origin under `/uploads/tenants/<id>/studio_icon/` and fetchable (200); a white see-through logo serves `tile: "dark"`; a row whose logo has no icon (merge `logoImageKey/Width/Height` by hand as `seededStudio` does) serves `icon: null`. The storefront/branding exact-keys test (455-490) is unchanged (`branding` keeps `colors, font, logo`).
  - `studio_page_service.spec.ts:531`: the logo deep-equals the shown image plus `tile` and `icon`; the query count stays as pinned.
  - `look.spec.ts`: `openapi.yaml`'s `Logo.tile` enum lists `LOGO_TILES` (text match, like the file's other contract checks).
  - Why they fail: no `tile` / `icon` in the answer, no `Logo` in the contract.
- [ ] **Step 2:** edit `openapi.yaml` (section 6), `pnpm --filter @tattoo-drip/types generate`, add `Logo` to `index.ts`, fix the SDK fixture.
- [ ] **Step 3:** `ShownLogo`, `logoOf`, the transformer (section 6). `seededStudio` (`tests/helpers/tenants.ts:166-171`) also sets `logoIconKey: \`tenants/${tenant.id}/studio_icon/${randomUUID()}.32.png\`` and `logoTile: "dark"`, so the public isolation suite covers an icon URL (it carries the tenant id, a public marker) and Task 4's isolation case changes a row.
- [ ] **Step 4: Run** `pnpm --filter @tattoo-drip/types typecheck`, `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, and in platform `--files=public_studio.spec.ts`, `--files=studio_page_service.spec.ts`, `--files=studio_page_privacy.spec.ts`, `node ace test unit --files=look.spec.ts`; then `--files=public_api.spec.ts` (the public isolation cases, `tests/functional/isolation/`).
- [ ] **Step 5: Commit** (two commits; the first holds the packages, the second the platform):

```
feat(types): give the studio's logo its tile and square icon

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

```
feat(platform): serve the logo's tile and square icon on the studio read

Both come from the tenant row already loaded: no new query (TAT-123).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 4: The owner's tile switch on Page look

**Goal:** the route, the saved messages, the preview on its tile and the one-tap switch.

**Files:** `start/routes.ts`, `app/modules/tenancy/access.ts`, `app/modules/tenancy/validators/tenant.ts`, `app/modules/tenancy/look_messages.ts`, `app/controllers/studio_logo_controller.ts`, `app/controllers/page_look_controller.ts`, `inertia/components/page_look.ts`, `inertia/components/logo_form.tsx`, `inertia/css/app.css`, `.adonisjs/` (codegen); tests `tests/functional/tenancy/page_look_http.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/isolation/cases.ts`.

- [ ] **Step 1: Failing tests.**
  - `page_look_http.spec.ts` (Settings, Page look: the logo group): "uploading a light logo says it went on the dark tile" (white `logoOnClear` → redirect to look, flash `LOGO_SAVED_ON_DARK_TILE`; a dark logo flashes `LOGO_SAVED`); "the preview carries the tile" (`props.logo.tile`; add `"logoIcon"`, `"logo_icon"` and `"studio_icon"` to the no-key list at line 88: the icon is not in the props at all); "an owner switches the tile, and back" (PUT `/t/<slug>/settings/logo/tile` `{ tile: "dark" }` → 302 to `tenant.settings.look`, flash `LOGO_TILE_SAVED`, row dark; `{ tile: "light" }` → light); "an unknown or missing tile is a field error and nothing changes" (`"blue"`, `{}` → `errors.tile` "Choose a light or a dark tile."); add the tile route to "an artist member gets a 404 on the page and every route" (line 531).
  - `page_look_copy.spec.ts`: `LOGO_INTRO` verbatim (new text), `tileLine` and `tileButton` for both tiles and while saving, `LOGO_TILE_CLASS`; tie `LOGO_TILE_SAVED` to "up to 15 minutes" like `LOOK_SAVED_MESSAGE`.
  - `tests/isolation/cases.ts`: the case of section 6.
  - Why they fail: no route, no messages, no `tile` prop.
- [ ] **Step 2: Server.** Validator and messages (section 5); controller `update` flashes `live.logoTile === "dark" ? LOGO_SAVED_ON_DARK_TILE : LOGO_SAVED` (keep its `InvalidImageError` handling); new action `tile(ctx)`: validate, `this.tenancy.setLogoTile(tenant, data.tile)`, flash `LOGO_TILE_SAVED`, redirect to `tenant.settings.look`; route and role; `PageLookController.logoPreview` adds `tile: logoTileOf(tenant.logoTile)` (pass the tenant's tile in; no query). `node ace codegen`.
- [ ] **Step 3: Dashboard.** `app.css`: `--logo-plate-dark: #14110f;` after `--logo-plate` in `:root` (not in the dark block; extend the comment: the dark tile for a white or light logo, picked at upload, switchable) and `--color-logo-plate-dark: var(--logo-plate-dark);` after line 204. `page_look.ts`: `LogoProps` gains `tile: LogoTile` (`type LogoTile = "light" | "dark"` locally: dashboard modules import no server code), the words of section 5. `logo_form.tsx`: the preview's class from `LOGO_TILE_CLASS[logo.tile]`, then `tileLine`, then a `TileForm` (an Inertia `<Form>` with the hidden `tile` and a `TileButton` that copies look.tsx's `SaveButton` focus rule through `takesFocusBack`); update the component's doc comment.
- [ ] **Step 4: Run** `--files=page_look_http.spec.ts`, `node ace test unit --files=page_look_copy.spec.ts`, then `--files=cross_tenant.spec.ts` (`tests/functional/isolation/`, the cases table) and `--files=tenant_routes.spec.ts`, and `--files=role_guard.spec.ts` **under the locks**, then `pnpm typecheck` in platform.
- [ ] **Step 5: Commit**

```
feat(platform): let owners put their logo on a light or a dark tile

Page look previews the logo on its tile and offers one button to switch it; an
upload that picked the dark tile says so (TAT-123).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 5: The storefront shows a light logo on the dark tile

**Goal:** read `tile` and `icon`; draw the dark tile.

**Files:** `apps/storefront/src/studio/theme/config.ts`, `src/studio/components/brand.tsx`, `src/deposit/loader.ts`, `src/deposit/components/deposit-page.tsx`, `src/styles.css`; tests `test/studio/theme-config.test.ts`, `test/studio/logo-plate.test.ts`, `test/studio/theme-render.test.ts`, `test/deposit/loader.test.ts`, the deposit test that renders the header; platform `tests/unit/modules/storefront/look.spec.ts` (drift guard).

- [ ] **Step 1: Failing tests.**
  - `theme-config.test.ts`, new describe "a logo's tile and icon (TAT-123)": `tile: "dark"` reads `"dark"`; missing, `"Dark"`, `"accent"`, `1`, `null` read `"light"`; an icon on the API's origin, square, with a 32 px copy reads as a `BrandImage` with its `srcSet`; an icon on another origin, not square, or not an object is `null`; an `icon` without a usable logo is `null`; `DEFAULT_THEME_CONFIG.icon` is `null`. Update the existing expectations that list a parsed config or a parsed logo (add `tile: "light"` to logos, `icon: null` to configs).
  - `logo-plate.test.ts`: `--logo-plate-dark` is `#14110f`, defined once, on `:root`, before the dark block; the rule `.profile-logo[data-tile="dark"], .site-bar-logo[data-tile="dark"], .deposit-logo[data-tile="dark"]` sets `background: var(--logo-plate-dark)`; white on it is at least 18:1 (`contrastRatio("#ffffff", plate)`).
  - `theme-render.test.ts`: a logo with `tile: "dark"` renders `data-tile="dark"` on `.profile-logo` and `.site-bar-logo`; the existing light-logo HTML assertions stay byte-for-byte (no attribute). The deposit header's test: a dark logo gives `class="deposit-logo"` with `data-tile="dark"`. `test/deposit/loader.test.ts`: the shell's logo gains `tile: "light"`.
  - Platform `look.spec.ts`: `LOGO_TILE_COLOURS.light` and `.dark` equal the storefront's `--logo-plate` and `--logo-plate-dark` (read `src/styles.css` as text) and the dashboard's (`inertia/css/app.css`).
  - Why they fail: nothing reads `tile`; no token or rule.
- [ ] **Step 2: `config.ts`.** `export type LogoTile = "light" | "dark"`; `export interface LogoImage extends BrandImage { readonly tile: LogoTile }`; `export function readLogoTile(value: unknown): LogoTile` (`"dark"` only for exactly `"dark"`); `ThemeConfig.logo: LogoImage | null` and new `ThemeConfig.icon: BrandImage | null` (doc: the logo's square icon, TAT-123, for the root head only); `DEFAULT_THEME_CONFIG.icon: null`; in `parseThemeConfig`:

```ts
	const logoValue = own(branding, "logo");
	const logo = readBrandImage(logoValue, imageOrigin);
	const icon = logo ? readBrandImage(own(logoValue, "icon"), imageOrigin) : null;
	…
		logo: logo ? { ...logo, tile: readLogoTile(own(logoValue, "tile")) } : null,
		icon: icon && icon.width === icon.height ? icon : null,
```

- [ ] **Step 3: Rendering.** `BrandLogo`'s `image` becomes `LogoImage` and the `<img>` gets `data-tile={image.tile === "dark" ? "dark" : undefined}` (extend its doc). `DepositShell.logo: LogoImage | null`, the deposit header's `logo` prop type, and the same attribute on `.deposit-logo`. `styles.css`: after `--logo-plate` in `:root`, `--logo-plate-dark: #14110f;` with a comment (TAT-123; the dark paper in both schemes, not repeated in the dark block; white on it 18.8:1; the platform picks a logo's tile, `LOGO_TILE_COLOURS`, and the owner can switch it; the dashboard keeps a copy); right after the `.profile-logo` rule the one rule above (specificity 0,2,0 beats each logo's own rule in the same layer). Extend the `--logo-plate` comment ("a white one would vanish on the tile instead" now has its answer).
- [ ] **Step 4: Run** `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, platform `node ace test unit --files=look.spec.ts`.
- [ ] **Step 5: Commit**

```
feat(storefront): show a light logo on a dark tile

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 6: The studio's icon as the favicon

**Goal:** the root head links the icon; `data:,` stays the fallback.

**Files:** new `apps/storefront/src/studio/icon.ts`, `src/routes/__root.tsx`; tests new `test/studio/icon.test.ts`, `test/studio/root-head.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `icon.test.ts`: `iconLinks(null)` is `[{ rel: "icon", href: "data:," }]`; an icon `{ src: A180, width: 180, height: 180, srcSet: "A32 32w, A180 180w" }` gives exactly `[{ rel: "icon", sizes: "32x32", href: A32 }, { rel: "icon", sizes: "180x180", href: A180 }, { rel: "apple-touch-icon", href: A180 }]`; without `srcSet` the first link is left out; `studioIconLinks(studio, ORIGIN)` with a fixture studio whose logo has an icon on `ORIGIN` gives those links, with the icon on another origin or no logo gives the `data:,` stop, and `studioIconLinks(undefined, null)` the stop.
  - `root-head.test.ts`: a source guard: `src/routes/__root.tsx` calls `studioIconLinks(` and no longer holds the literal `"data:,"` (it lives in `icon.ts`).
  - Why they fail: no `icon.ts`.
- [ ] **Step 2: Implement** `src/studio/icon.ts`:

```ts
import type { Studio } from "@tattoo-drip/sdk";
import { type BrandImage, parseThemeConfig } from "./theme/config.ts";
import { storefrontInput } from "./theme/source.ts";

/** A `<link>` of the root head. */
export interface IconLink {
	readonly rel: string;
	readonly href: string;
	readonly sizes?: string;
}

/** No icon: a stop, so the browser does not ask for /favicon.ico. */
const NO_ICON: IconLink[] = [{ rel: "icon", href: "data:," }];

/**
 * The browser tab's and home screen's icon (TAT-123): the logo's square icon,
 * checked by parseThemeConfig (the API's origin, square). Its narrowest copy
 * (the 32 px one) for the tab, the icon itself for larger screens and as the
 * Apple touch icon; without an icon, the stop. Pure.
 */
export function iconLinks(icon: BrandImage | null): IconLink[] {
	if (!icon) return NO_ICON;
	const links: IconLink[] = [];
	const first = icon.srcSet?.split(", ")[0]?.split(" ");
	const width = first ? Number.parseInt(first[1] ?? "", 10) : Number.NaN;
	if (first && Number.isInteger(width) && width < icon.width) {
		links.push({ rel: "icon", sizes: `${width}x${width}`, href: first[0] });
	}
	links.push(
		{ rel: "icon", sizes: `${icon.width}x${icon.height}`, href: icon.src },
		{ rel: "apple-touch-icon", href: icon.src },
	);
	return links;
}

/** The root head's icon links for the studio the root loader read, if it read one. */
export function studioIconLinks(
	studio: Studio | undefined,
	imageOrigin: string | null,
): IconLink[] {
	return iconLinks(
		studio ? parseThemeConfig(storefrontInput(studio), imageOrigin).icon : null,
	);
}
```

  `__root.tsx`: replace the `data:,` entry and its comment with `...studioIconLinks(loaderData, loaderData ? match.context.tattoo.connection.apiUrl : null)` and a comment (the studio's icon from its logo, TAT-123, else a stop for the `/favicon.ico` request); `match` is already destructured there. The router's `links` type is the `<link>` element's attributes, so `sizes` needs no cast.
- [ ] **Step 3: Run** `pnpm --filter @tattoo-drip/storefront test` and `typecheck`.
- [ ] **Step 4: Commit**

```
feat(storefront): use the studio's logo icon as the page's favicon

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 7: Back closes the work photo viewer

**Goal:** the history entry in `lightbox.ts`, with every fallback intact.

**Files:** `apps/storefront/src/studio/lightbox.ts`; tests new `test/studio/lightbox-history.test.ts`, `test/studio/lightbox-guard.test.ts`, `test/studio/lightbox.test.ts`.

- [ ] **Step 1: Failing tests.** `lightbox-history.test.ts` stands in the browser like `lightbox-guard.test.ts` (save and restore `document`, `window`, `HTMLDialogElement`, `History` in `afterEach`): a `Target` class with `addEventListener(type, fn, { once })`, `removeEventListener`, `dispatch(type)` and `count(type)`; a `FakeHistory` class (the `History` global) with `entries`, `index`, `calls`, a `state` getter, `pushState` / `replaceState` that record `"push"` / `"replace"` (plus the URL when one is passed) and store a `structuredClone` of the state, `back()` that only records `"back"`, and `pop(delta = -1)` that moves the index and dispatches `popstate` on the window; the instance's own `pushState` / `replaceState` are overwritten with functions that throw (TanStack wraps the instance's; they must not be used); a `FakeDialog` (`Target` with `open`, `showModal()`, `close()` that dispatches `close` once). Router state `{ key: "k1", __TSR_key: "k1", __TSR_index: 3 }`. Cases (the logic was run in a scratch copy of these fakes; all pass):
  1. Opening a photo adds one entry at the same address with the router's own state: `calls` `["push"]`, `history.state` deep-equals the router state plus `tattooDripPhoto: "work-photo-1"`.
  2. Back (`pop()`) closes the photo and takes nothing more off: `calls` still `["push"]`, no `popstate` listener left, state is the router's.
  3. Close (`dialog.close()`) calls `back()` once; a second photo clicked before the pop lands does not open; after `pop()` no listener is left and the second photo opens with a new push (`["push", "back", "push"]`).
  4. An entry a reload left behind (state already marked) is reused: `["replace"]`.
  5. A close after the entry is no longer current (set `index = 0` without a pop) calls no `back()`.
  6. Without `<dialog>`: the large photo opens (`location.assign`) and `calls` is `[]`.
  - Why it fails: `showPhoto` adds no entry (`calls` is `[]`), `PHOTO_ENTRY` does not exist.
- [ ] **Step 2: Implement** `lightbox.ts` (keep the existing doc and fallback; add to the doc: the entry, why `History.prototype`, what the router sees):

```ts
/**
 * The history state key of an open photo's entry (TAT-123): its dialog id.
 * The rest of the entry's state is the router's own, copied.
 */
export const PHOTO_ENTRY = "tattooDripPhoto";

/** While a closed photo's entry is being taken off (`history.back()`), until the browser has moved. */
let leaving = false;

export function showPhoto(id: string): void {
	const dialog = document.getElementById(id);
	if (!dialog) return;
	if (
		typeof HTMLDialogElement === "undefined" ||
		!(dialog instanceof HTMLDialogElement) ||
		typeof dialog.showModal !== "function"
	) {
		const large = dialog.querySelector("img");
		if (large?.src) window.location.assign(large.src);
		return;
	}
	if (dialog.open || leaving) return;
	dialog.showModal();
	addEntry(dialog, id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Back closes the photo (TAT-123): one entry while it is open, at the same
 * address (no URL is passed) with the router's state copied, so the router
 * sees the entry it is on and a reload or a copied address is the page
 * itself. The browser's own pushState (History.prototype): TanStack's history
 * wraps window.history.pushState and would run the page's loaders for it.
 * Back fires popstate: close. Escape, Close or Android's close request close
 * the dialog: take the entry off with one back(), if it is still current.
 */
function addEntry(dialog: HTMLDialogElement, id: string): void {
	const history = window.history;
	const state: unknown = history.state;
	const own = isRecord(state) ? state : {};
	const entry = { ...own, [PHOTO_ENTRY]: id };
	// An entry a reload left behind (a photo was open) is reused, not stacked.
	if (PHOTO_ENTRY in own) History.prototype.replaceState.call(history, entry, "");
	else History.prototype.pushState.call(history, entry, "");

	const stop = () => {
		window.removeEventListener("popstate", onBack);
		dialog.removeEventListener("close", onClose);
	};
	function onBack() {
		stop();
		if (dialog.open) dialog.close();
	}
	function onClose() {
		stop();
		const current: unknown = window.history.state;
		if (!isRecord(current) || current[PHOTO_ENTRY] !== id) return;
		leaving = true;
		window.addEventListener(
			"popstate",
			() => {
				leaving = false;
			},
			{ once: true },
		);
		window.history.back();
	}
	window.addEventListener("popstate", onBack);
	dialog.addEventListener("close", onClose);
}
```

- [ ] **Step 3: Guards.** `lightbox-guard.test.ts`: its `page()` also stands in `window.history` (a `FakeHistory`-like object with `state`), `window.addEventListener`/`removeEventListener` and the `History` global, and its `FakeDialog` gains `addEventListener`/`removeEventListener`, so "with a real dialog it opens it once" still passes (it now also adds an entry). `lightbox.test.ts`: rename the second test ("…guards a browser without `<dialog>`, and adds one history entry at the same address") and add: `lightbox.ts` calls `History.prototype.pushState.call(history, entry, "")` (no URL), never `window.history.pushState(` or `location.hash`; `document.` still exactly once; `addEventListener` appears in no component (unchanged rule).
- [ ] **Step 4: Run** `pnpm --filter @tattoo-drip/storefront test`, `typecheck`.
- [ ] **Step 5: Commit**

```
feat(storefront): close the photo viewer with the back button

Opening a photo adds one history entry at the same address with the router's
own state; Back closes the viewer, and Close or Escape takes the entry off
again (TAT-123).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 8: Docs, the browser check and the gates

- [ ] **Step 1: Docs** (section 8).
- [ ] **Step 2: Browser check** (section 9) with Playwright (`playwright-core` and Chromium as in the TAT-128 brief), screenshots and scripts in a scratch folder outside the repo.
- [ ] **Step 3: Gates** (section 10).
- [ ] **Step 4: Commit**

```
docs: logo tiles, the logo's icon and the viewer's back button (TAT-123)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

## 8. Docs to update

- `apps/storefront/docs/development.md`: the viewer bullet (line 81): replace "and no history entry, so on Android … (accepted …)" with the entry (`PHOTO_ENTRY`, same address, the router's state copied, `History.prototype.pushState`, Back closes, Close/Escape/Android's close request take the entry off, a click while that back is pending waits, a reload's leftover entry is reused, the fallbacks add none, Forward does not reopen, following the artist link and coming back without the back-forward cache leaves one extra Back), and name `lightbox-history.test.ts`. The images bullet (line 109): the dark tile (`--logo-plate-dark`, `data-tile="dark"` only when dark, the platform's rule in one sentence, the owner's switch), and replace "There is still no favicon from the logo: most logos are not square." with the icon (`ThemeConfig.icon`, `src/studio/icon.ts`, the three links, the `data:,` stop, the API's origin only).
- `apps/platform/docs/backend.md`: the Studio logo bullet (line 79): `storeLogo`, the tile rule, the `studio_icon` purpose (180 px + 32 px copy, `ICON_WIDTHS`), best effort, `logo_tile` / `logo_icon_key`, removal deletes the icon first, `setLogoTile`; the copies bullet (72): `studio_icon` gets 32 px.
- `apps/platform/docs/ui.md`: the Page look bullet (line 32): the tile line and button (`TileForm`, focus back), the preview on `LOGO_TILE_CLASS`, and "`--logo-plate` … is the one dashboard token that is light in both schemes" becomes the two tile tokens, both the same in both schemes.
- `docs/data-model.md` (StorefrontConfiguration row, line 69): `logo_tile` and `logo_icon_key`.
- `docs/requirements.md:142`: owners can put the logo on a light or a dark tile (picked for them on upload), and the logo also gives the page's browser and home-screen icon.
- `docs/sdk.md`: one sentence on `storefront.branding.logo` (`tile`, `icon`).

## 9. Acceptance and browser check

**Measurable:**
- `getStudio` and Page look make no more queries than today (the pinned counts).
- The icon is a 180 × 180 opaque PNG with one 32 × 32 copy, under `tenants/<id>/studio_icon/`, both under 5 KB for the test logos.
- The tile rule's cases of Task 1 hold; white on the dark tile ≥ 18:1 (test).
- The tile button is ≥ 44 px tall at 375 px; the preview's tile matches the stored tile.
- No new runtime dependency; no request to any origin but the storefront's and the API's.

**Browser check** (lane servers: platform 3441, storefront 3444 with `API_URL=http://localhost:3441 STOREFRONT_URL=http://localhost:3444`; a studio with a Devanagari name and artist name, `seed:dev` for photos; 375 × 812 and 1280 × 800, light and dark):
1. Page look: upload a white see-through PNG (make it with sharp in the scratch folder) → the dark-tile message, preview on the dark tile, "Use a light tile" (44 px at 375); tap → "Tile saved…", light preview, focus still on the button; upload a dark logo → "Logo saved.", light tile; remove → no tile line. Dark mode: the dark tile's border shows.
2. Studio page, artist page and deposit page: the logo on the tile the dashboard shows, in both schemes; over the cover, the dark tile reads.
3. Head: `link[rel=icon][sizes="32x32"]` → the `.32w.png` copy on the API's origin, 200, `image/png`, 32 × 32; `apple-touch-icon` → 180 × 180; a studio without a logo: `data:,` and no `/favicon.ico` request; every request is to `localhost:3444` or `localhost:3441`.
4. Viewer on `/`, `/artists/<slug>` and `/work` after "Show more": note `scrollY`, open a photo (URL unchanged, `history.state.tattooDripPhoto` set), `page.goBack()` → dialog closed, URL and `scrollY` unchanged, the extra photos still there, focus on the photo's button; `goBack()` again leaves the page. Close and Escape → closed, `history.state` unmarked, the next `goBack()` leaves. Reload with a photo open → no viewer; open another, Back closes it, Back leaves. JavaScript off → the grid, buttons do nothing. `addInitScript(() => { delete window.HTMLDialogElement })` → a click opens the large photo; Back returns. A flash design page: unchanged.

## 10. Final gates

- Root: `pnpm check`, `pnpm typecheck`, `pnpm build`.
- Platform: empty `queue_jobs` in `tattoo_drip_uw` first, then the full suite once, under both locks, in the background (`timeout -s KILL 2400`, `PORT=3442 SESSION_DRIVER=memory`), read the `Tests N passed` line.
- Storefront: `pnpm --filter @tattoo-drip/storefront test`, `build`, then `check:page`.
- Packages: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`.
- `git status` clean; `ls apps/platform/database/migrations | tail -3` ends with `1791820000000_add_logo_tile_and_icon_to_tenants.ts`.

## 11. Review focus

- **Tenant isolation and file safety:** the icon key is always under the tenant's own `studio_icon/` folder (`assertKeyOf` with the new purpose); the tile route is owners only with an isolation case; `setLogo`'s order (store before the lock, both `afterRollback`s with no `await` in between, old logo and icon deleted only after the commit); `removeLogo` deletes files before clearing columns and keeps the logo whole when the icon fails; no orphan icon on rollback, replace or a failed icon store.
- **Information exposure:** no key or column in Page look props or the API (`logoIconKey` never leaves the row); the icon URL is public by design.
- **Image processing:** `logoTile` and `squareIcon` take decode slots and read only `processImage`'s output (`limitInputPixels`); a failure never fails the upload; the 64 px sample and the channel check.
- **The history entry:** the address never changes; the router's state is copied; `History.prototype` (not the wrapped instance method); no stacking; the `leaving` window cannot stick (back() is called only when the viewer's entry is current, so there is an entry to go back to); the fallbacks add nothing; no listener in a component.
- **Contract:** `Logo` matches the transformer exactly (`additionalProperties: false`); `tile` unknown → light on the storefront; the icon must be square and on the API's origin.
- **Accessibility:** the tile button's name says what it does, 44 px, focus kept after the save; the preview's alt text unchanged; focus returns to the photo button after Back.
- **Query counts:** unchanged on `getStudio` and Page look.

## 12. Risks and rollback

- **TanStack's same-entry "GO" load on Back/Close** runs the loaders from cache and its scroll restoration restores the snapshot it just took; the browser check measures `scrollY`. If it jumps: register the viewer's `popstate` listeners with `{ capture: true }` and call `event.stopImmediatePropagation()` for the viewer's own pops only (capture listeners on `window` run before the router's), and record the ruling.
- **Chrome's own close request** (Android Back closes a modal `<dialog>` through `CloseWatcher`): handled as a close (one `back()`); the browser check covers Escape, which takes the same path on desktop Chromium.
- **Misjudged tile:** the owner switches it; the icon keeps the upload's tile (owner decision 3).
- **Cached pages** may point at a replaced logo's deleted icon for up to ~12 minutes: the browser shows its default icon (same as a broken logo today).
- **Merge with 4b:** both add a migration on `tenants` (4b's `1791810000000` sorts before this `1791820000000`), edit `openapi.yaml` (different schemas), `styles.css` (different blocks), `tests/helpers/tenants.ts` `seededStudio` and `database/schema.ts` (regenerate after the merge): additive; keep both sides.
- **Estimate:** 5 points, not 2: three features, a migration, a contract schema, an owner route and a dashboard control.
- **Rollback:** revert the branch's commits; `pnpm migrate:rollback` drops the two columns and checks; icon files left under `tenants/*/studio_icon/` are public copies of public logos and can be deleted by hand.

## Owner decisions (defaults the builder uses)

1. **Light logos:** detected on upload (dark tile for a mostly light see-through PNG), the saved message says so, and Page look has a one-tap switch. Default: yes, all three.
2. **Icon shape:** a padded square (logo centred, a tenth margin, on its tile's colour), not a crop. Default: padded.
3. **Icon tile:** the icon keeps the tile picked at upload; a later switch changes the page's tile only. Default: yes; regenerate on switch as a follow-up if an owner asks.
4. **No backfill:** a logo saved before this ships gets its icon and tile check when it is uploaded again; until then its page keeps today's no-icon stop. Default: no backfill (pre-launch).
5. **Viewer history:** Back closes the photo; Forward does not reopen it; the address never names a photo. Default: as stated.
