# Studio site 4a/5 (TAT-129): flash designs, flash pages and flash requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Artists keep flash designs (picture, name, size, optional price) on their profile page, owners everyone's, and each artist gets a "Taking flash requests" switch; the public site shows the designs in a Flash home section, on each artist's page, on `/flash` (by artist) and on `/flash/<id>`, whose "Request this design" opens `/request?flash=<id>` with the design shown and the form filled in; the inquiry records the design, its project carries it, and the inbox and the project page show it.

**Architecture:** A new `flash` module owns `flash_designs` (tenant-owned, RLS, hard-deleted with its files like work photos; a design that an inquiry or project names cannot be deleted, because those keys are `NO ACTION`: the studio hides it instead). `artists.accepting_flash` is the switch; `inquiries.flash_design_id` (frozen by the inquiry guard trigger like everything submitted) and `tattoo_projects.flash_design_id` record the design. Two public reads, `listFlash` (plan 2's keyset cursor, an artist filter and an artists facet) and `getFlashDesign`, give each design a server-computed `requestable`; intake takes `flashDesignId` and names the artist from the design. The storefront adds a pure `flash.ts`, stateless components, `/flash` and `/flash/$id`, a `flash` home section in the ordered section list (`work, artists, flash, info, inquiry`), the artist page's flash, and the request page's design summary, through a new optional `intro` slot on `InquirySection` (plan 3 as built has none). **Every design here can be tattooed again** (the owner's default): "one of a kind", claiming, the claimed warnings and the claimed-designs setting are plan 4b, so nothing in 4a can show a taken design as available.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, Inertia + React + shadcn (dashboard), PostgreSQL 18, OpenAPI 3.1 + openapi-typescript, `@tattoo-drip/sdk` / `@tattoo-drip/react`, TanStack Start (storefront), Japa and `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md`, sections "Home" (Flash), "Artist page" (their flash), "Flash (`/flash`, new) and one design (`/flash/<id>`, new)", "Request page" (`?flash=<id>`), "Chat button" (the flash subject), "Flash designs (new)" (all but "one of a kind" and claiming), "Flash while an artist's books are closed", "Requests for a flash design" (the first two bullets), "My calls" 1, 5, 7 and 8, "Docs to update when it ships". Ticket 4 of the split, first half; plan 4b (`2026-10-30-studio-site-4b-flash-claiming.md`) adds one of a kind and claiming. Plans 1, 2, 3 and 5 (TAT-125, TAT-126, TAT-127, TAT-128) are built and in local main; this plan uses them **as built** (checked against `50b71cd`):

- Platform: `#modules/artists/work_cursor` (`WorkCursor`, `encodeWorkCursor`, `decodeWorkCursor`); `#modules/storefront/validators/work` (`WORK_PAGE_SIZE`, `MAX_WORK_PAGE`, `CURSOR_MESSAGE`, `listWorkValidator`); `WorkPhotoService` (`add`'s lock-and-count order, `page`'s `cursor_at` read, the private `lockArtist` and the module function `mayEdit`, the overridable `countPhotos`); `PublicWorkController.index`; `StudioPageService(artists, images, workPhotos, hours)`; `#modules/storefront/look` (`SECTION_KEYS = ["work", "artists", "info", "inquiry"]`, `DEFAULT_SECTIONS`, `sectionList`, `sectionsOf`); `inertia/components/page_look.ts` (`SECTION_WORDS`, in the server's order); the section migrations `1791700000002_add_work_section_to_tenants` and `1791790000001_add_good_to_know_section_to_tenants` (normalise-then-insert) and their spec `tests/functional/tenancy/good_to_know_section_migration.spec.ts`; `tests/unit/modules/storefront/look.spec.ts`'s drift tests (storefront lists, contract enum, `sections.maxItems`).
- Storefront (`apps/storefront/src/studio/`): `loaders.ts` with `studioPageData(studio, artists, origin, imageOrigin = null, recentWork: unknown = null, theme = parseThemeConfig(…))`, `artistPageData(studio, artists, slug, origin, imageOrigin = null, portfolio = NO_PORTFOLIO)`, `requestPageData(studio, artists, search, origin, imageOrigin = null)`, `workPageData`, `loadStudioPage` (reads Recent work **only when `theme.sections` includes `work`**), `loadArtistPage`, `loadRequestPage` (studio and artists only), `loadWorkPage`, the exported `logReadFailed(what, context, error)` (logs `"<what> read failed"` with `{ slug, status, code }`), `channelsFor`; `request.ts` (`RequestSearch = { artist?: string }`, `readRequestSearch`, `RequestLink`, `requestLink(studio, artist)`); `chat.ts` (`chatLinks(studio, subject)`: "Hi, I'm asking about {subject}"); `links.ts` (`requestHref(search)`, `workHref`, `portfolioHref`, `isAllowedHref`); `inquiry.ts` (`InquiryState`, `inquiryState`, `inquiryChannels(studio, artist: InquiryArtist | null)`); `seo.ts` (`requestPageSeo(studio, artist, origin, open = true)`, `artistPageSeo`'s `sameName` rule, `trimDescription` from `text.ts`); `gallery.ts` (`galleryView`, `RECENT_WORK_COUNT`); `srcset.ts` (`largeSource`, the `rem` / `viewportCalc` helpers and `PAGE_GUTTER_REM`); `theme/config.ts` (`readBrandImage`, `SECTION_KEYS`, `THEME_SECTIONS`); `view-model.ts` (`ArtistView` with `accepting`, `closedMessage` (null while accepting), `requestHref`; `findArtist`, `ARTIST_SLUG`); `text.ts` (`cleanLine`); `../intake/template.ts` (`fill`); `../api/loaders.ts` (`rethrowAsNotFound`, `loadStudio`); `components/pages.tsx` with the **unexported** `SiteBar({ studio, theme, requestLink })` and `StudioAside({ studio })`, the exported `SiteFooter({ studioName })`, `StudioSection` (a `switch` over the keys), `ArtistPage`, `RequestPage`, `WorkPage`; `components/chat.tsx` (`ChatButton({ chat, studioName })`); `components/inquiry.tsx` (`InquirySection({ state, channels, challengeSiteKey })`, always the page's `h1`, open: "Send your idea" then `BookingStrip`, closed: "Inquiries"; no slot); `src/intake/components/intake-mount.tsx` (`intakeFormKey(state)`); `src/routes/request.tsx` (`validateSearch: readRequestSearch`, `loaderDeps: ({ search }) => readRequestSearch(search)`).

## Global Constraints

- **Base: local `main` once TAT-127 is merged into it** (it then holds TAT-125, `origin/main` 1559f58 with the TAT-84 fix, TAT-126, TAT-128 and TAT-127). This plan was committed on TAT-127's tip `50b71cd` on the branch `harublank00/tat-129-studio-site-45-flash-designs-flash-pages-flash-requests-and` (Linear TAT-129) in the worktree `/home/blank/Coding/tattoo-drip-wt/site-4`; the builder rebases that one commit onto local main before Task 1 (Task 1, Step 1). Plan 4b stacks on this branch's final tip.
- **Lane.** Database `tattoo_drip_site` (migrated through `1791790000001`; a QA login exists; never drop or recreate it). **Never touch the user's database `tattoo_drip`, the servers on ports 3333 and 3000 or the checkout `/home/blank/Coding/tattoo-drip`** (read only as `ENV_PATH`). Every platform command runs with `DB_DATABASE=tattoo_drip_site` and `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform` (the worktree has no `.env`; never read any `.env`). Unset `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS` for test runs. Tests use `PORT=3402`; a platform dev server for the browser pass uses 3401, the storefront 3404.
- Node 24: prefix commands with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`.
- A spec run that hits a missing import hangs Japa: run platform RED steps as `timeout 90 ... > /tmp/site4-red.log 2>&1` and expect exit 124 plus the "Cannot find module" line. Never two platform suites at once; a **full** platform suite runs only under `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock <command>` (another session runs suites too). Narrow storefront runs: `pnpm --filter @tattoo-drip/storefront exec node --import tsx --test <files>`.
- **Migrations sort after TAT-128's `1791790000001_add_good_to_know_section_to_tenants`**: this plan's are `1791800000000_create_flash_designs_table` (Task 1) and `1791800000001_add_flash_section_to_tenants` (Task 9); plan 4b's sorts after both. A section migration rebuilds every stored list from the keys it knows and drops the others, so one that sorted before TAT-128's would lose `flash` on any database that runs them in order. After each migrate, `ls apps/platform/database/migrations | tail -3` ends with this plan's.
- **Section keys, everywhere, in this order: `work, artists, flash, info, inquiry`** (spec "Home": Recent work, Artists, Flash, Good to know, "Got an idea?"): platform `SECTION_KEYS` and `DEFAULT_SECTIONS`, storefront `SECTION_KEYS` and `THEME_SECTIONS["stencil-and-ink"].order`, the dashboard's `SECTION_WORDS`, the contract's `StorefrontSection.type` enum, and `StorefrontConfiguration.sections.maxItems` = 5 (`look.spec.ts` compares all of them).
- Dashboard: no Inertia `optimistic` anywhere under `apps/platform/inertia/` (`tests/unit/inertia/slow_connection_source.spec.ts` fails on any); the contact recording stays in `inertia/hooks/use-contact-recording.ts`, untouched here. No `window.confirm` in new components (`inline_confirms_source.spec.ts`).
- Storefront components stay stateless: no `useState`, `useEffect`, `useRef`, `tabIndex`, `.focus(`, `addEventListener` or `document.` under `src/studio/components/` (the source guard in `test/studio/lightbox.test.ts` scans every file there, the new `flash.tsx` included).
- `/flash` is a real page from Task 8 on. Until now it was the storefront's example of an unknown path: `scripts/check-page.mjs` (the not-found loop), and as an unmatched path in the routers that `test/studio/search.test.ts` and `test/studio/root-head.test.ts` build themselves, and in a comment in `src/studio/seo.ts` (`rootMeta`). Task 8 changes them.
- Limits: a design's **name** 1 to 80 characters and its **size** ("About 3 in") 1 to 60, each one line (no control characters or line and paragraph separators, the work photo description's rule); an optional **price** in whole rupees from 1 to 1,00,00,000, stored in paisa with `currency` `NPR`; **up to 100 designs per artist**. Pictures go through `ImageService` with a new public purpose `flash_design` (the photos' 320, 640 and 1280 px copies).
- Order: **newest first everywhere**, `created_at desc, id desc`; no manual reordering (spec call 1).
- Flash rules, enforced by the server: a design is **requestable** while it is shown, its artist is visible and that artist takes flash requests (`accepting_flash`), whatever their books (`accepting_inquiries`) say; a custom request naming an artist whose books are closed stays the 409 `artist_not_accepting`. New and existing artists take flash requests (`accepting_flash` defaults to true).
- Public reads show shown designs of visible artists only: never a hidden design, never a hidden or deleted artist's, in data, filters, the design read or intake.
- Sizes: the API's `limit` is 1 to 48, default 24. The home section shows **6**, the artist page **12** (then "All flash by {name}"), `/flash` **24** a page with a "Show more" link to the next cursor page (no JavaScript paging).
- Paths (spec call 5): `/flash`, `/flash?artist=<slug>`, `/flash/<id>` (a lowercase UUID), `/request?flash=<id>`. A malformed, unknown, hidden or stale `flash` on `/request` is the request page with a note, never a not-found; a malformed id on `/flash/<id>` is the not-found without an API call.
- Empty sections hide (spec call 7): no shown design, no Flash section on the home page or artist page. A studio that hides Flash in Page look costs the API no flash read on its home page (as Recent work).
- Images: grids use the copies with `srcset` (`flashGridSizes`), the design page the widest copy up to 1280 px (`largeSource`) with `flashDesignSizes`; pictures are drawn whole (`object-fit: contain`), never cropped.
- Caching: storefront pages keep `pageCacheHeaders`; the two new API reads use `middleware.publicCache()`.
- All text is plain text. The public API sends only what the contract lists (exact-fields tests; `assertApiData` also checks every answer against `openapi.yaml`).
- The storefront's default-theme snapshot (`test/studio/default-theme.snapshot.json`) must not change: nothing new renders without flash data.
- Deploy order: the platform before the storefront; every storefront flash read that fails on the home or artist page hides its section and is logged with `logReadFailed("Flash", …)` (the request page's design read: `logReadFailed("Flash design", …)`).
- Copy, exactly (new words; spec words in bold): storefront `studioCopy.flash` = `{ title: "Flash", allFlash: "All flash", allBy: "All flash by {name}", pageTitle: "Flash", by: "by {name}", request: "Request this design", requestTitle: "Ask for this design", closed: "Not taking flash requests right now", closedNamed: "{name} isn't taking flash requests right now.", alt: "{name}, a flash design by {artist}", altNoArtist: "{name}, a flash design", size: "Size", price: "Price", status: "Status", available: "Available", empty: "No flash designs yet.", noMatch: "No flash designs by this artist.", showAll: "Show all flash", filterNav: "Whose flash", all: "All", gone: "This flash design isn't on {studio}'s page any more. Tell them about your idea instead.", failed: "We couldn't load this flash design. You can still send your idea: name the design in it.", ideaStart: "The {name} flash" }` and `studioCopy.chat.flash` = `"the {name} flash"` (so the WhatsApp message is **"Hi, I'm asking about the Moth flash"**); API `flash_unavailable` message "This flash design isn't available any more."; dashboard words in Task 3.
- Never edit generated files: `packages/types/src/openapi.gen.ts` (`pnpm --filter @tattoo-drip/types generate`), `apps/platform/database/schema.ts` (`pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`), `apps/platform/.adonisjs/` (`node ace codegen`), `apps/storefront/src/routeTree.gen.ts` (`pnpm --filter @tattoo-drip/storefront generate-routes`, footer from `pnpm build`).
- Conventional Commits with area scopes (`platform`, `types`, `sdk`, `react`, `storefront`, `docs`): the subject lowercase after the colon and at most 100 characters in all, a body (if any) wrapped at 100, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Check each with `printf '%s' "<message>" | pnpm exec commitlint` before committing.

## Review Focus

1. **A design that changes while the client types** (hidden, its artist hidden, or the artist's flash switched off): the API refuses (`flash_unavailable`, or `artist_not_accepting`), and the form shows a notice with the studio's chat links, never an error under the artist picker the flash form doesn't show. Pinned in Task 6 (`inquiries.spec.ts`) and Task 10 (`problems.test.ts`).
2. **A request address we didn't write:** `/request?flash=` with an uppercase, cut-off, unknown or another studio's id, or with `fbclid`; `/flash/NOT-A-UUID`; `/flash?artist=Sita`. The request page is the general form (with the "isn't on the page" note for a well-formed unknown id), never a not-found; the design page is the not-found with no API call; `/flash` ignores the bad filter. Pinned in Task 8 (`flash.test.ts`, `loaders.test.ts`) and Task 10 (`request.test.ts`, `request-route.test.ts`, `loaders.test.ts`).
3. **Hidden designs and hidden or deleted artists' designs** never surface: not in `data`, `filters`, the design read, nor through intake. Pinned in Task 5 (`public_flash.spec.ts`), Task 6 and the isolation cases.
4. **A failed flash read** (an older platform's 404, a 5xx, the network) never takes the home page or an artist page down: the section hides and one log line says so. Pinned in Task 8 and Task 9 (`loaders.test.ts`).
5. **Removing a design a request or project names:** refused with words, the files untouched and the design still listed (the studio hides it instead). Pinned in Task 1 (`flash_service.spec.ts`) and Task 2 (`flash_http.spec.ts`).
6. **Every stored section list after the flash migration** (boundary lists included: eight keys, repeats, unknown keys, 100 characters, lists that already hold `flash`, lists without `artists` or `info`): it stays within the column's check, keeps the owner's order and gets `flash` once, right after `artists` (else before `info`, else before `inquiry`); `down()` gives back exactly what TAT-128's migration left. Pinned in Task 9 (`flash_section_migration.spec.ts`, run through TAT-126's, TAT-128's and this migration in order).

---

### Task 1: The flash module: table, columns and service

**Files:**
- Create: `apps/platform/database/migrations/1791800000000_create_flash_designs_table.ts`
- Create: `apps/platform/app/modules/flash/models/flash_design.ts`, `apps/platform/app/modules/flash/services/flash_service.ts`, `apps/platform/app/modules/flash/errors.ts`
- Modify: `apps/platform/app/modules/media/services/image_service.ts` (`IMAGE_PURPOSES.flash_design`)
- Modify: `apps/platform/app/services/db_errors.ts` (`isForeignKeyViolation`)
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts` (`lockEditable`; `ArtistInput.acceptingFlash`, `profileFields`, `createOwnerProfile`), `apps/platform/app/modules/artists/services/work_photo_service.ts` (its private `lockArtist` and its module function `mayEdit` move to `artist_service.ts`; it calls `lockEditable` and the imported `mayEdit`)
- Regenerate: `apps/platform/database/schema.ts`
- Modify (tests and helpers): `apps/platform/tests/helpers/artists.ts` (`addFlashDesign`, `artistInput` default `acceptingFlash: true`), `tests/helpers/pipeline.ts` (`makeProject` takes `flashDesignId`), `tests/functional/rls/catalog_guard.spec.ts` (`EXPECTED_POLICIES.flash_designs`), `tests/functional/media/image_service.spec.ts` (only if it pins the purpose list)
- Test: `apps/platform/tests/functional/flash/flash_service.spec.ts` (new), `apps/platform/tests/functional/rls/flash_designs.spec.ts` (new), `tests/functional/artists/artist_service.spec.ts`

**Interfaces:**
- Produces (model `FlashDesign`, `#modules/flash/models/flash_design`, plain `FlashDesignSchema`, no soft deletes): `id`, `tenantId`, `artistId`, `imageKey`, `width`, `height`, `name`, `size`, `price: number | null` (paisa), `currency`, `hidden: boolean`, `createdAt`, `updatedAt`. `Inquiry.flashDesignId` and `TattooProject.flashDesignId` (`string | null`) and `Artist.acceptingFlash: boolean` come from the regenerated schema.
- Produces (`#modules/flash/errors`): `FlashLimitError`, `FlashInUseError` (a request or project names the design).
- Produces (`#services/db_errors`): `isForeignKeyViolation(error: unknown, constraint: string): boolean` (SQLSTATE 23503 and that constraint, in the style of `isUniqueViolation`).
- Produces (`#modules/artists/services/artist_service`): the method `lockEditable(trx: QueryClientContract, tenant: TenantRef, editor: ProfileEditor, artistId: string): Promise<Artist>` and the exported function `mayEdit(editor: ProfileEditor, linkedUserId: string | null): boolean` (WorkPhotoService's private `lockArtist` and its module function `mayEdit`, moved here unchanged; WorkPhotoService and FlashService use both, the editor check before any decode included; WorkPhotoService's constructor stays `(images, artists)`). `ArtistInput.acceptingFlash: boolean`.
- Produces (`FlashService`, `#modules/flash/services/flash_service`, `@inject()` with `ImageService` and `ArtistService` (value imports with the `biome-ignore` line); `export const MAX_FLASH_DESIGNS = 100`):
  - `export type NewFlashDesign = { name: string; size: string; price: number | null }` (paisa); `export type FlashDetails = NewFlashDesign & { hidden: boolean }`; `export type FlashFilter = { artistIds: readonly string[] }`.
  - `list(tenant, artist: Artist): Promise<FlashDesign[]>`: the artist's designs, hidden ones too, newest first.
  - `findEditable(tenant, editor: ProfileEditor, designId: string): Promise<{ design: FlashDesign; artist: Artist }>`: the tenant's design whose artist `ArtistService.findEditable` allows; anything else E_ROW_NOT_FOUND.
  - `add(tenant, editor, artist: Artist, upload: Upload, details: NewFlashDesign): Promise<FlashDesign>`: `WorkPhotoService.add`'s order exactly (the editor check and an unlocked count before any decode, `ImageService.store` with `afterRollback` right after, `lockEditable`, the count again under the lock, then the insert, `hidden` false); `FlashLimitError` at 100; `InvalidImageError` as it comes.
  - `update(tenant, editor, design: FlashDesign, details: FlashDetails): Promise<FlashDesign>`: under `lockEditable` and a fresh read of the row; name and size trimmed. The picture never changes (a new picture is a new design).
  - `remove(tenant, editor, design: FlashDesign): Promise<void>`: under `lockEditable`, the row delete first, in a nested `withTransaction` (its savepoint; a 23503 on `inquiries_flash_design_fk` or `tattoo_projects_flash_design_fk` becomes `FlashInUseError` before any file is touched), then `images.deleteOrThrow("flash_design", key)` (an `ImageDeleteError` rolls the row back; a missing file counts as deleted, so a retry finishes).
  - `page(tenant, filter: FlashFilter, after: WorkCursor | null, limit: number): Promise<{ designs: FlashDesign[]; next: WorkCursor | null }>`: shown designs of `filter.artistIds`, newest first, `limit + 1` rows, the cursor read as `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at` from `$extras` exactly as `WorkPhotoService.page`; no query for `[]`.
  - `artistsWithDesigns(tenant, artistIds: readonly string[]): Promise<Set<string>>`: which of them have a shown design; one query; none for `[]`.
  - `findShown(tenant, designId: string, artistIds: readonly string[]): Promise<FlashDesign | null>`: the design when it is shown and its artist is one of `artistIds`.
  - `forIds(tenant, ids: readonly string[]): Promise<Map<string, FlashDesign>>`: any of the tenant's designs, hidden ones too (the dashboard's reads); no query for `[]`.
  - `protected countDesigns(tenant, artistId, client?)`: the hook a test overrides to stage a racing upload (as `RacingService` does with `countPhotos` in `work_photo_service.spec.ts`).
- Produces (test helpers): `addFlashDesign(tenant, artist, over?: Partial<{ name: string; size: string; price: number | null; hidden: boolean; key: string; createdAt: DateTime }>)` (a made-up key `tenants/<id>/flash_design/<uuid>.320-640-1280.png`, 1200 × 1200, in the style of `addWorkPhoto`); `makeProject(tenant, client, { flashDesignId })`.

- [ ] **Step 1: Set up the worktree**

`cd /home/blank/Coding/tattoo-drip-wt/site-4`. Check that TAT-127 is merged: `git merge-base --is-ancestor harublank00/tat-127-studio-site-35-request-page-sticky-header-and-chat-button main && echo merged` (if it prints nothing, stop and tell the coordinator). Then `git rebase main`: only this plan's commit moves (`git log --oneline main..HEAD` shows exactly `docs: plans 4a and 4b for the studio site (TAT-129)`). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile`, then `pnpm migrate` in `apps/platform` with the Global Constraints' environment.
Expected: nothing to migrate (`tattoo_drip_site` holds every migration through `1791790000001`); `git status` clean.

- [ ] **Step 2: Write the failing tests**

`flash_designs.spec.ts` (the RLS spec, in the style of `artist_work_photos.spec.ts`, raw rows as the app role):
- "under context A only A's rows come back; with no context none".
- "an insert with another tenant's id fails the policy check".
- "a design cannot name another tenant's artist (composite foreign key)".
- "a width or height of zero, and a price of zero, are refused": the messages name `flash_designs_size_positive` and `flash_designs_price_positive`.
- "an inquiry or a project cannot name another tenant's design".
- "a design an inquiry names cannot be deleted, nor one a project names": the errors name `inquiries_flash_design_fk` and `tattoo_projects_flash_design_fk`.
- "update and delete of another tenant's rows affect zero rows".

`flash_service.spec.ts`:
- "an owner adds a design to any artist and an artist to their own; listed newest first, shown, the price in paisa": `add(..., { name: "Moth", size: "About 3 in", price: 300_000 })` with `testImages.png(1200, 1200)`; `list()[0]` has those values, `hidden` false, `currency` "NPR", a key under `tenants/<id>/flash_design/`.
- "the 101st design is refused before it is decoded": 100 rows by `addFlashDesign`, then `add` rejects with `FlashLimitError` and the drive's keys are unchanged.
- "two uploads racing for the 100th place: the second is refused under the lock and its file is deleted" (a subclass overriding `countDesigns`, as the work photo race test does).
- "update saves the name, size, price and hidden, trimmed; the picture stays": `{ name: "  Moth  ", size: "About 4 in", price: null, hidden: true }` reads back `"Moth"`, `"About 4 in"`, `null`, `true`, same `imageKey`.
- "remove deletes the row and then the files; a file that can't be deleted keeps the row" (`failDeletes("public", …)` from `#tests/helpers/storage_failures`, as `work_photo_service.spec.ts` uses it: the design is still listed).
- "a design that a request or a project names can't be removed: FlashInUseError, row and files untouched" (an inquiry row with `flash_design_id`, then a project row; no delete reaches the drive).
- "an artist unlinked meanwhile, or a deleted artist, can't update or remove: E_ROW_NOT_FOUND".
- "findEditable: another tenant's design, another artist's for an artist member and an unknown id are E_ROW_NOT_FOUND".
- "page: shown designs of the given artists, newest first; the cursor visits each once across ties; nothing and no query for no artists" (5 designs, 3 sharing one `createdAt`, `limit` 2: pages of 2, 2, 1, the last `next` null; a hidden one never appears).
- "artistsWithDesigns counts shown designs only; findShown is null for a hidden design or an artist not given; forIds gives hidden ones too".
- "another tenant's designs never appear, from this tenant's context" (`inTenant` of the other studio for `page`, `findShown`, `forIds`).

`artist_service.spec.ts`: "an artist takes flash requests by default and the switch is saved": `create` with `artistInput()` reads back `acceptingFlash` true; `update` with `acceptingFlash: false` reads back false; `createOwnerProfile`'s profile has true.

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test functional --files=flash_service.spec.ts > /tmp/site4-red.log 2>&1`, then `PORT=3402 pnpm test functional --files=flash_designs.spec.ts --files=artist_service.spec.ts`
Expected: exit 124 with "Cannot find module '#modules/flash/services/flash_service'"; FAIL (no table, no column).

- [ ] **Step 4: Write the migration**

`1791800000000_create_flash_designs_table.ts`, `up`: create `flash_designs` (`id` uuid primary key, default `uuidv7()`; `tenant_id` to `tenants` on delete cascade; `artist_id` with `tenantReference(table, "artist_id", "artists")`; `image_key` varchar(255), `width`, `height` integer; `name` varchar(80); `size` varchar(60); `price` integer nullable; `currency` varchar(3) not null default `'NPR'`; `hidden` boolean not null default false; `created_at` not null, `updated_at` nullable, both `useTz`), checks `flash_designs_size_positive` (`width > 0 and height > 0`) and `flash_designs_price_positive` (`price is null or price > 0`), indexes `flash_designs_newest` (`tenant_id, created_at, id`) and `flash_designs_artist_newest` (`tenant_id, artist_id, created_at, id`), then `enableTenantRls("flash_designs")` (it adds the `UNIQUE (tenant_id, id)` the keys below need). `artists` gets `accepting_flash` boolean not null default true. `inquiries` and `tattoo_projects` each get `flash_design_id` uuid nullable, an index on `(tenant_id, flash_design_id)` and, by raw SQL, `<table>_flash_design_fk` foreign key `(tenant_id, flash_design_id)` references `flash_designs (tenant_id, id)` (no action: the names `FlashService.remove` recognizes). `inquiries_guard_update` needs no change: it freezes every column it does not name, so the new one is frozen. `down` drops them in reverse (with `disableTenantRls`). The doc comment says why a referenced design is never deleted. Run `pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`; `pnpm migrate:rollback` and `pnpm migrate` again both succeed and leave `git diff database/schema.ts` as after the first run; `ls database/migrations | tail -2` ends with `1791790000001_add_good_to_know_section_to_tenants.ts`, `1791800000000_create_flash_designs_table.ts`.

- [ ] **Step 5: Implement** the purpose (`flash_design: { visibility: "public", variants: VARIANT_WIDTHS }, // TAT-129`), the error helper, `lockEditable`, the model, the errors and the service per Interfaces; add `acceptingFlash` wherever `ArtistInput` is built (`profileFields`, `createOwnerProfile` with true, the test helper), `flash_designs: ["tenant_isolation:ALL"]` to `EXPECTED_POLICIES`, and the helpers. The service's doc comment states the rules: newest first, up to 100 per artist under the artist's lock, hard delete, a named design is hidden rather than deleted.

- [ ] **Step 6: Run the tests to verify they pass**

Run: the commands of Step 3 without `timeout`, plus `--files=work_photo_service.spec.ts --files=catalog_guard.spec.ts --files=image_service.spec.ts --files=inquiries_table.spec.ts --files=tattoo_projects_table.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): flash designs per artist, and a flash switch for each artist" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: The dashboard's flash routes and the "Taking flash requests" switch

**Files:**
- Create: `apps/platform/app/modules/flash/validators/flash_design.ts`, `apps/platform/app/controllers/flash_designs_controller.ts`
- Modify: `apps/platform/start/routes.ts` (the artists group), `apps/platform/app/modules/tenancy/access.ts`
- Modify: `apps/platform/app/modules/artists/validators/artist.ts` (`acceptingFlash`), `apps/platform/app/controllers/artists_controller.ts` (`toInput`, `toProps`, the `flashDesigns` prop on the edit page and `[]` on the new-artist page)
- Modify: `apps/platform/inertia/components/artists.ts` (`ArtistProps.acceptingFlash`)
- Regenerate: `apps/platform/.adonisjs/`
- Modify (tests): `tests/helpers/tenants.ts` (`seededStudio` seeds `flashDesign`), `tests/isolation/cases.ts`, `tests/functional/tenancy/role_access.spec.ts` (`ARTIST_ROUTES`)
- Test: `apps/platform/tests/functional/flash/flash_http.spec.ts` (new), `tests/functional/artists/artist_form.spec.ts`, `tests/functional/artists/own_profile.spec.ts`

**Interfaces:**
- Consumes: `FlashService`, `MAX_FLASH_DESIGNS`, `FlashLimitError`, `FlashInUseError` (Task 1).
- Produces (validators, `#modules/flash/validators/flash_design`): `MAX_FLASH_NAME = 80`, `MAX_FLASH_SIZE = 60`, `MAX_FLASH_PRICE = 10_000_000` (rupees); `addFlashDesignValidator` (`picture: imageFile()`, `name`, `size`, `price` whole rupees or null) and `updateFlashDesignValidator` (`name`, `size`, `price`, `shown: vine.boolean().optional()`).
- Produces (routes, in the artists group beside the work photo routes, each `:id` with `router.matchers.uuid()`, `MEMBERS` in `TENANT_ROUTE_ROLES`): `POST /t/:tenant/artists/:id/flash` (`tenant.artists.flash.store`, `:id` the artist, multipart), `PUT /t/:tenant/artists/flash/:id` (`tenant.artists.flash.update`), `DELETE /t/:tenant/artists/flash/:id` (`tenant.artists.flash.destroy`). Each loads first (`findEditable`) and validates after; every write redirects to `tenant.artists.edit` of the design's artist.
- Produces (artist form prop): `flashDesigns: { id: string; name: string; size: string; price: number | null; priceText: string | null; hidden: boolean; thumbnailUrl: string }[]`, newest first (`price` in whole rupees for the form, `priceText` from `formatMoney` in `#modules/projects/quotes`, `thumbnailUrl` the 320 px copy); the new-artist page (`create`) passes `flashDesigns: []` as it passes `workPhotos: []`. `ArtistProps.acceptingFlash: boolean`; the artist form posts `acceptingFlash` (a checkbox; missing is false, like `acceptingInquiries`).
- Produces (test fixture): `Studio.flashDesign`: a shown design of `artistProfile`, named `${name} Moth`, price NPR 3,000.

- [ ] **Step 1: Write the failing tests**

`flash_http.spec.ts` (with `assertValidationError`):
- "an owner adds a design with a picture, name, size and price": fields `name` "Moth", `size` "About 3 in", `price` "3000" and a `picture` part: redirect to the artist's edit page, flash success "Design added.", the row's `price` 300000.
- "the price may be left empty": `price` "" stores null.
- "a bad price is a field error and nothing is stored": `0`, `12.5`, `10000001`, `abc` each give the `price` error "Enter whole rupees from 1 to 1,00,00,000, or leave it empty.".
- "a missing picture, name or size is a field error with its words": `picture` "Choose a picture of the design."; `name` "Give the design a name, up to 80 characters on one line."; `size` "Say how big it is, like About 3 in: up to 60 characters on one line." (a name of 81 characters and a size with a line break give the same words).
- "a file that isn't an image is a field error on picture" (the `InvalidImageError` message).
- "the 101st design is a field error on picture and stores nothing": "This artist already has 100 flash designs. Remove one to add another.".
- "an artist adds and edits their own designs; another artist's design or artist is a 404 with any body".
- "a save with shown unchecked hides the design; checked shows it again": `shown` missing gives `hidden` true, `shown` "1" false; flash "Design saved.".
- "remove: 'Design removed.' and the row is gone; a design a request names stays, with the error flash 'Clients asked for this design, so it can't be removed. Hide it instead.'".
- "the edit page lists the artist's designs newest first, hidden ones too, each with exactly id, name, size, price, priceText, hidden and thumbnailUrl": a NPR 3,000 design gives `price` 3000 and `priceText` "NPR 3,000"; the new-artist page's `flashDesigns` is `[]`.

`artist_form.spec.ts`: "Taking flash requests saves; unchecked means not taking them": `acceptingFlash` "1" stores true, missing stores false; the edit page's `artist.acceptingFlash` follows. `own_profile.spec.ts`: "an artist switches their own flash requests off".

`cases.ts`: three cases, after the work photo ones: `POST /t/:tenant/artists/:id/flash` (`resource: "artistProfile"`, `files: async () => [await imagePart("picture")]`, body name/size), `PUT /t/:tenant/artists/flash/:id` and `DELETE /t/:tenant/artists/flash/:id` (`resource: "flashDesign"`; the update's body `{ name: "Moth, smaller", size: "About 2 in", shown: "1" }`), `ownStatus` 302, snapshot `flashDesignRows` (every column, ordered by `artist_id`, `created_at`, `id`, like `workPhotoRows`). `ARTIST_ROUTES` gains the three names, kept sorted (`tenant.artists.flash.destroy`, `.store`, `.update` after `tenant.artists.edit`).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=flash_http.spec.ts --files=artist_form.spec.ts --files=own_profile.spec.ts --files=tenant_routes.spec.ts`
Expected: FAIL (404s, unknown field, no entries).

- [ ] **Step 3: Implement** the validators (the one-line regex and `SimpleMessagesProvider` with the words above), the controller (`asFieldErrors` like `WorkPhotosController`'s: `FlashLimitError` and `InvalidImageError` become `picture` errors; `FlashInUseError` and `ImageDeleteError` ("Couldn't remove the design, try again.") become error flashes), the routes with comments in the group's style, the role entries, the artist validator's `acceptingFlash: vine.boolean().optional()`, `toInput` (`acceptingFlash: data.acceptingFlash ?? false`), `toProps`, and the edit page's `flashDesigns` (loaded after `findEditable`). Run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=cross_tenant.spec.ts --files=role_access.spec.ts --files=artists_page.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): add, edit, hide and remove flash designs from the artist's page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: The dashboard's Flash section on the artist page

**Files:**
- Create: `apps/platform/inertia/components/flash.ts` (words and small rules), `apps/platform/inertia/components/flash_tray.tsx`
- Modify: `apps/platform/inertia/pages/artists/form.tsx` (the "Flash" section under "Work photos"; the `acceptingFlash` checkbox after `acceptingInquiries`), `apps/platform/inertia/components/inline_confirm.tsx` (an optional `ariaLabel` for the trigger)
- Test: `apps/platform/tests/unit/inertia/flash_copy.spec.ts` (new)

**Interfaces:**
- Consumes: the `flashDesigns` prop and routes (Task 2); `InlineConfirm`, `useFormSheet` / `FormSheetPanel` (`components/form_sheet.tsx`), `ignoreHeldEnter` (`components/confirm.ts`), `PHOTO_ACCEPT` (`components/photos.ts`), `Field*` components.
- Produces (`components/flash.ts`, no imports): `FlashDesignProps` (Task 2's shape); `MAX_FLASH_DESIGNS = 100` (equal to the server's: the test compares); `flashCount(n)`; `flashIntro(owner)`; `FLASH_CREATE_NOTE`; `FLASH_FULL`; `NO_FLASH`; `REMOVE_FLASH_QUESTION`, `REMOVE_FLASH_CONFIRM`, `REMOVE_FLASH_KEEP`; `designNote(design)`; `editDesignLabel(name)`; `removeDesignLabel(name)`; `FLASH_OPEN_LABEL`; `FLASH_OPEN_HELP`; field words `PICTURE_LABEL`, `NAME_HELP`, `SIZE_HELP`, `PRICE_LABEL`, `PRICE_HELP`, `SHOWN_LABEL`, `SHOWN_HELP`.
- Produces (component): `FlashTray({ tenantSlug, artistId, designs }: { tenantSlug: string; artistId: string; designs: FlashDesignProps[] })`. `InlineConfirm` gains `ariaLabel?: string` (the trigger's accessible name when its visible `label` is not unique on the page; omitted, nothing changes).

- [ ] **Step 1: Write the failing unit test** in `flash_copy.spec.ts` (loading `components/flash.js` like `photos_copy.spec.ts` does, with its `@ts-expect-error TS6305` line)

```ts
assert.equal(flash.MAX_FLASH_DESIGNS, MAX_FLASH_DESIGNS); // the server's, from #modules/flash/services/flash_service
assert.equal(flash.flashCount(3), "3 of 100 designs");
assert.equal(flash.flashCount(1), "1 of 100 designs");
assert.equal(flash.flashIntro(true), "Flash designs this artist offers. Clients see them on the studio page, newest first, and can ask for one.");
assert.equal(flash.flashIntro(false), "Flash designs you offer. Clients see them on the studio page, newest first, and can ask for one.");
assert.equal(flash.FLASH_CREATE_NOTE, "Once the artist is saved, you can add their flash designs here.");
assert.equal(flash.FLASH_FULL, "That's 100 designs, the most an artist can show. Remove one to add another.");
assert.equal(flash.NO_FLASH, "No flash designs yet.");
assert.equal(flash.REMOVE_FLASH_QUESTION, "Remove this design? Clients won't see it any more, and it can't be brought back.");
assert.equal(flash.REMOVE_FLASH_CONFIRM, "Remove design");
assert.equal(flash.REMOVE_FLASH_KEEP, "Keep the design");
assert.equal(flash.designNote({ size: "About 3 in", priceText: "NPR 3,000", hidden: false }), "About 3 in · NPR 3,000");
assert.equal(flash.designNote({ size: "About 3 in", priceText: null, hidden: true }), "About 3 in · Hidden");
assert.equal(flash.editDesignLabel("Moth"), "Edit Moth");
assert.equal(flash.removeDesignLabel("Moth"), "Remove Moth");
assert.equal(flash.FLASH_OPEN_LABEL, "Taking flash requests");
assert.equal(flash.FLASH_OPEN_HELP, "Clients can ask for this artist's flash designs, even while the books are closed.");
assert.equal(flash.PRICE_HELP, "In whole rupees. Leave it empty to agree the price with each client.");
assert.equal(flash.SIZE_HELP, "In words, as you'd say it to a client.");
assert.equal(flash.SHOWN_HELP, "Uncheck to take it off the studio page for now. Requests already sent keep it.");
```
(`PICTURE_LABEL` "Picture", `NAME_HELP` "Up to 80 characters.", `PRICE_LABEL` "Price (optional)", `SHOWN_LABEL` "Show on the studio page".)

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=flash_copy.spec.ts > /tmp/site4-red.log 2>&1`
Expected: exit 124, "Cannot find module" for `components/flash.js`.

- [ ] **Step 3: Implement the words, then the tray and the form changes**

`FlashTray`, laid out like `WorkPhotoTray`: first the add form (`<Form route="tenant.artists.flash.store">`, `options={{ preserveState: "errors" }}` so a success clears the file input, as the artist form does): `PICTURE_LABEL` file input (`accept={PHOTO_ACCEPT}`), "Name" (placeholder "Moth", `NAME_HELP`), "Size" (placeholder "About 3 in", `SIZE_HELP`), `PRICE_LABEL` (`inputMode="numeric"`, `PRICE_HELP`), each with its `FieldError`, then "Add design"; while `designs.length >= 100` show `FLASH_FULL` instead. Then `flashCount` in an `<output>` with a ref (the confirm's `fallback`, like `WorkPhotoTray`'s `countLine`), then the designs newest first as a list (`<ul>`): a row is the 320 px thumbnail (96 px, `object-contain`, `loading="lazy"`, `alt` the name), the name (`wrap-anywhere`), `designNote`, and two buttons: "Edit" (`aria-label` `editDesignLabel`, `aria-haspopup="dialog"`, `onKeyDown={ignoreHeldEnter}`) opening the tray's **one** `FormSheetPanel` (`useFormSheet()`, mounted once, the design's id in state, `available` false once the design is gone, as `WorkPhotoTray` does), and "Remove" through `InlineConfirm` outside the sheet (`label` "Remove", `ariaLabel` `removeDesignLabel(name)`, `question` `REMOVE_FLASH_QUESTION`, `confirmLabel` `REMOVE_FLASH_CONFIRM`, `keepLabel` `REMOVE_FLASH_KEEP`, `busyLabel` "Removing…", `onConfirm` a `router.delete` with `preserveScroll` and `onFinish: finished`). The sheet holds `<Form route="tenant.artists.flash.update">` keyed by the design's id and stored values: Name, Size, Price (whole rupees), a `SHOWN_LABEL` checkbox (`name="shown"`, `value="1"`, `SHOWN_HELP`) and "Save design" (`FormSheetActions`; the sheet's `onStart` / `onSuccess` / `onError` / `onFinish` close it on success and keep it open with the error under its field on a refusal). `NO_FLASH` when the list is empty. In `form.tsx`: `ArtistForm` takes the `flashDesigns` prop and renders a "Flash" `Section` after "Work photos", outside the profile's `<Form>` (`description={artist ? flashIntro(owner) : undefined}`; `<FlashTray …/>`, or `FLASH_CREATE_NOTE` before the artist exists), and the `acceptingFlash` checkbox (`defaultChecked={artist?.acceptingFlash ?? true}`, `FLASH_OPEN_LABEL`, `FLASH_OPEN_HELP`) right after "Accepting new inquiries". No `optimistic`, no `window.confirm`. Shadcn components and tokens only; follow `apps/platform/docs/ui.md`. Run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test unit --files=flash_copy.spec.ts --files=inline_confirms_source.spec.ts --files=confirm_and_sheets.spec.ts --files=slow_connection_source.spec.ts --files=tap_targets.spec.ts`, then `pnpm typecheck`
Expected: PASS and clean. The list, sheet and confirm are checked in Task 11's browser pass.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): a Flash section on the artist's page and the flash switch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: The contract, the SDK and the React hooks

**Files:**
- Modify: `packages/types/openapi.yaml`; regenerate `packages/types/src/openapi.gen.ts`
- Modify: `packages/types/src/index.ts`, `packages/sdk/src/client.ts`, `packages/react/src/queries.ts`, `hooks.ts`, `index.ts`
- Modify: `docs/sdk.md` ("Public API by stage"; a flash paragraph after the gallery's)
- Test: `packages/sdk/test/client.test.ts`, `packages/react/test/lists.test.ts`

**Interfaces:**
- Produces (contract): operations `listFlash` and `getFlashDesign` (tag `MVP`); schemas `FlashDesign`, `Price`, `FlashFilters`; `InquiryInput.flashDesignId` (so `InquiryForm` too, through its `allOf`); the error code `flash_unavailable` (409, `createInquiry`).
- Produces (types): `FlashDesign`, `Price`, `FlashFilters`, `ListFlashQuery` (`NonNullable<operations["listFlash"]["parameters"]["query"]>`), `FlashPage` (its 200 body).
- Produces (SDK): `client.flash.list(query?: ListFlashQuery, call?: RequestOptions): Promise<FlashPage>` (the whole body, like `work.list`); `client.flash.get(id: string, call?: RequestOptions): Promise<FlashDesign>` (`data`; a 404 is `not_found`). `inquiries.create` sends `flashDesignId` like every other field (it appends every field of the input; no code change; a test pins it).
- Produces (React): `tattooKeys.flash(tenant, query?)` = `[...tattooKeys.tenant(tenant), "flash", query ?? {}]`, `tattooKeys.flashDesigns(tenant)` = `[...tattooKeys.tenant(tenant), "flash-design"]`, `tattooKeys.flashDesign(tenant, id)` = `[...tattooKeys.flashDesigns(tenant), id]`; `tattooQueries.flash(client, query?)`, `tattooQueries.flashDesign(client, id)` (no `staleTime`); `useFlash(query?)`, `useFlashDesign(id)`.

- [ ] **Step 1: Write the failing tests**

`client.test.ts`:
- "flash.list sends the filters like a form and returns the whole page": `flash.list({ artist: "sita", cursor: "next page", limit: 6 })` calls `${T}/flash?artist=sita&cursor=next+page&limit=6` with `credentials` `"omit"` and resolves to `{ data: [], nextCursor: null, filters: { artists: [] } }` as sent; `flash.list()` calls `${T}/flash`.
- "flash.get reads one design by id, encoded": `flash.get("0199f000-0000-7000-8000-000000000001")` calls `${T}/flash/0199f000-0000-7000-8000-000000000001` and resolves to the body's `data`; a 404 envelope rejects with a `TattooApiError` of code `not_found`.
- "inquiries.create sends flashDesignId as a form field": the `FormData` holds `flashDesignId`.

`lists.test.ts`: `tattooQueries.flash(client).queryKey` is `[...tenant, "flash", {}]` and with `{ artist: "sita" }` ends in it; `tattooQueries.flashDesign(client, id).queryKey` is `[...tenant, "flash-design", id]`, so `tattooKeys.flashDesigns(tenant)` prefixes it; fetching each through a `QueryClient` calls the URL once.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/sdk test` and `pnpm --filter @tattoo-drip/react test`
Expected: FAIL (`flash` is undefined).

- [ ] **Step 3: Change the contract and regenerate**

```yaml
/tenants/{tenant}/flash:
  parameters: [{ $ref: "#/components/parameters/Tenant" }]
  get:
    operationId: listFlash
    tags: [MVP]
    summary: The studio's flash designs, newest first, a page at a time
    # description: every shown design of every visible artist (one whose books are closed too),
    # newest first; `requestable` says whether createInquiry takes a request for it now; an artist
    # that matches nothing is an empty page; cacheable; under an old slug it answers like the current one.
    parameters:
      - { name: artist, in: query, description: An artist's slug (getArtist), schema: { type: string, pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$" } }
      - { name: cursor, in: query, description: The previous page's `nextCursor`, as sent, with the same filter, schema: { type: string, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" } }
      - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 48, default: 24 } }
    responses:
      "200": # CacheControl, ETag; body additionalProperties false, required [data, nextCursor, filters]:
        # data: array of FlashDesign, maxItems 48; nextCursor: [string, "null"]; filters: FlashFilters
      # "304" NotModified; "404" NotFound; "422" ValidationError (a malformed parameter or cursor,
      # with fields, as listWork's); "429" RateLimited; default Error
/tenants/{tenant}/flash/{design}:
  parameters: [Tenant, { name: design, in: path, required: true, schema: { type: string, format: uuid } }]
  get:
    operationId: getFlashDesign
    tags: [MVP]
    summary: One shown flash design of a visible artist
    # responses: "200" { data: FlashDesign } cacheable; "304"; "404" (unknown, hidden, a hidden or
    # deleted artist's); "429"; default
```
Written out in full in the file's style (`listWork` is the model). `FlashDesign` (additionalProperties false, every property required): `id` (uuid, "What `createInquiry` takes as `flashDesignId`; the design's page is `/flash/<id>`"), `name` (maxLength 80), `size` (maxLength 60, "In words, such as About 3 in"), `price` (`oneOf [Price, null]`, "null when the studio keeps the price to itself"), `image` (`Photo`: "the page builds the alt from the name and the artist"), `artist` (`{ slug, name }`, required, additionalProperties false), `requestable` (boolean: "Whether createInquiry takes a request for it now: the artist takes flash requests, whatever their books say. False: show it greyed with the artist's closedMessage."). `Price` (required `[amount, currency, text]`, additionalProperties false; not `Money`, which has no text): `amount` (integer, paisa), `currency` (`NPR`), `text` ("NPR 3,000"; show it as it is). `FlashFilters` (required `[artists]`, additionalProperties false): `artists`: array of `{ slug, name }`, "The visible artists with a shown design, by name, whatever `artist` asks: offer only these.". `InquiryInput.flashDesignId`: `[string, "null"]`, uuid, "A flash design from `listFlash`. The inquiry then asks for that design and its artist: leave `preferredArtistId` out or give the design's artist.". `createInquiry`'s description and its 409 add `flash_unavailable` ("the design is hidden, its artist hidden, or unknown") and say a request for a design whose artist takes no flash requests is `artist_not_accepting`; `ErrorResponse.code`'s endpoint codes list `flash_unavailable`. Run `pnpm --filter @tattoo-drip/types generate`.

- [ ] **Step 4: Implement the types, SDK and hooks** per Interfaces, and update `docs/sdk.md`: the MVP row adds `flash.list` and `flash.get`, the V1 row drops `flash`; one paragraph after the gallery's: `client.flash.list({ artist?, cursor?, limit? })` gives `{ data, nextCursor, filters }`, newest first, 24 a page, cached for 60 seconds; `client.flash.get(id)`; `requestable`; `createInquiry`'s `flashDesignId` and `flash_unavailable`; React `useFlash`, `useFlashDesign`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, then `pnpm typecheck` (root)
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add packages docs/sdk.md
git commit -m "feat(types): listFlash, getFlashDesign and an inquiry's flashDesignId" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: The public flash endpoints

**Files:**
- Create: `apps/platform/app/modules/storefront/validators/flash.ts`, `apps/platform/app/controllers/public_flash_controller.ts`, `apps/platform/app/transformers/public_flash_design_transformer.ts`
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts` (a fifth constructor dependency, `FlashService`; `flash`, `flashDesign`)
- Modify: `apps/platform/start/routes.ts`; regenerate `apps/platform/.adonisjs/`
- Modify: `apps/platform/tests/isolation/public_cases.ts`, `tests/helpers/public_isolation.ts` (`publicMarkers` adds `flashDesign.id` and `.name`), `tests/functional/storefront/studio_page_service.spec.ts` (its `pagesWith` builds `new StudioPageService(artists, images, new WorkPhotoService(images, artists), new OpeningHoursService(), new FlashService(images, artists))`)
- Test: `apps/platform/tests/functional/api/public_flash.spec.ts` (new), `tests/functional/storefront/studio_page_service.spec.ts`

**Interfaces:**
- Consumes: `FlashService.page`, `artistsWithDesigns`, `findShown` (Task 1); `decodeWorkCursor`, `CURSOR_MESSAGE`, `MAX_WORK_PAGE`, `WORK_PAGE_SIZE`; the contract (Task 4).
- Produces (`#modules/storefront/validators/flash`): `listFlashValidator` (`artist` the `ARTIST_SLUG` regex, `cursor` `maxLength(200)` + `/^[A-Za-z0-9_-]+$/`, `limit` whole number 1 to `MAX_WORK_PAGE`, all optional; the messages of `listWorkValidator`).
- Produces (`StudioPageService`): `export type ShownPrice = { amount: number; currency: string; text: string }`; `export type ShownFlashDesign = { id: string; name: string; size: string; price: ShownPrice | null; image: ShownImage; artist: { slug: string; name: string }; requestable: boolean }`; `export type FlashQuery = { artist: string | null; cursor: WorkCursor | null; limit: number }`; `export type ShownFlashPage = { designs: ShownFlashDesign[]; nextCursor: string | null; filters: { artists: { slug: string; name: string }[] } }`; `flash(tenant: Tenant, query: FlashQuery): Promise<ShownFlashPage>` (`listVisible` once; narrowed to the exact `artist` slug when given, no match an empty page with no design query; `filters.artists` from `artistsWithDesigns` over every visible artist, by name); `flashDesign(tenant: Tenant, id: string): Promise<ShownFlashDesign | null>`. `requestable` is the artist's `acceptingFlash`; the price text is `formatMoney`; the image is `ImageService.shownImage("flash_design", …)`.
- Produces (routes, tenant group, `publicCache()`): `GET /api/v1/tenants/:tenant/flash` (`api.v1.flash.index`), `GET /api/v1/tenants/:tenant/flash/:design` (`api.v1.flash.show`, `.where("design", router.matchers.uuid())`).

- [ ] **Step 1: Write the failing tests**

`public_flash.spec.ts` (`assertApiData` / `assertApiError`, `addArtist`, `addFlashDesign`):
- "lists every visible artist's shown designs newest first with exactly the documented fields": body keys `["data", "filters", "nextCursor"]`; each item exactly `["artist", "id", "image", "name", "price", "requestable", "size"]`; `image` exactly `["height", "url", "variants", "width"]`; `artist` exactly `["name", "slug"]`; a NPR 3,000 design's `price` deep-equals `{ amount: 300000, currency: "NPR", text: "NPR 3,000" }`, an unpriced one `null`; `filters` exactly `["artists"]`; never a key, artist id, `hidden` or timestamp.
- "a design is requestable while its artist takes flash requests, books open or closed; not when their flash is off": artists (books open, flash on), (books closed, flash on), (books closed, flash off) give `true`, `true`, `false`, all three listed.
- "hidden designs, and hidden or deleted artists' designs, are in no page, no filter and no design read" (Review Focus 3): `?artist=<hidden slug>` is `{ data: [], nextCursor: null, filters: { artists: <the visible ones> } }`; `GET /flash/<that id>` is 404 `not_found`.
- "pages by cursor: limit 2 over 5 designs gives 2, 2 and 1, the last with nextCursor null".
- "filters by artist; filters.artists names every visible artist with a shown design, by name, whatever the filter".
- "a malformed cursor, artist or limit is validation_failed with that field": `cursor=!!`, base64url of `"x~y"` (message `CURSOR_MESSAGE`), `artist=Sita`, `limit=0`, `limit=49`; 422, as `/work`.
- "the design read gives one design with the same fields; another studio's id, an unknown id and a hidden one are 404; a malformed id is the router's 404 without a query".
- "both reads are cacheable: public, an ETag and a 304; under an old studio slug they answer like under the current one".

`studio_page_service.spec.ts`: "flash names each design's artist and orders filters.artists by name".

`public_cases.ts`: `GET /api/v1/tenants/:tenant/flash` (`ownStatus` 200, `ownMarkers` `[own.flashDesign.id]`, snapshot the studio's flash rows) and `GET /api/v1/tenants/:tenant/flash/:design` (`params: (studio) => ({ design: studio.flashDesign.id })`, `ownMarkers` `[own.flashDesign.id, own.flashDesign.name]`).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=public_flash.spec.ts --files=studio_page_service.spec.ts`
Expected: FAIL (404 for both paths; `flash` is not a function).

- [ ] **Step 3: Implement** per Interfaces. `PublicFlashController.index` follows `PublicWorkController.index` (validate `ctx.request.qs()`, decode the cursor: one that passes the validator but decodes to null is `E_VALIDATION_ERROR` on `cursor` with `CURSOR_MESSAGE`; the envelope `{ ...serialize(data), nextCursor, filters }`); `show` throws `ApiException.notFound()` for null. The transformer writes every field out. Route comments in the existing style; run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=public_api.spec.ts --files=api_routes.spec.ts --files=studio_page_privacy.spec.ts --files=public_work.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): the public flash list and design reads" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Intake takes a flash design; the project carries it

**Files:**
- Modify: `apps/platform/app/modules/inquiries/validators/intake.ts` (`flashDesignId`), `apps/platform/app/modules/inquiries/errors.ts` (`flash_unavailable` and its `MESSAGES` line), `apps/platform/app/modules/inquiries/services/intake_service.ts`, `apps/platform/app/services/public_api.ts` (`ApiErrorCode` and `API_ERRORS.flash_unavailable`), `apps/platform/app/controllers/public_inquiries_controller.ts` (`toApiError`)
- Modify: `apps/platform/app/modules/inquiries/services/inquiry_service.ts` (`accept`), `apps/platform/app/modules/projects/services/project_service.ts` (`createFromInquiry`)
- Test: `apps/platform/tests/functional/api/inquiries.spec.ts`, `tests/functional/inquiries/intake_service.spec.ts`, `tests/functional/inquiries/inquiry_service.spec.ts`, `tests/functional/inquiries/inquiries_table.spec.ts`

**Interfaces:**
- Consumes: `FlashService.findShown` (Task 1); `intakeFields`, `postInquiry`, `intakeRows` (`#tests/helpers/intake`); `storedReferenceImages` (`#tests/helpers/uploads`).
- Produces: `intakeValidator.flashDesignId: vine.string().uuid().nullable().optional()` (message "Choose a design from the studio's page, or none."); `Submission.flashDesignId?: string | null`; `INQUIRY_RULE_REASONS` gains `"flash_unavailable"`; `API_ERRORS.flash_unavailable` = `{ status: 409, code: "flash_unavailable", message: "This flash design isn't available any more." }`; `createFromInquiry` input gains `flashDesignId: string | null`.
- Rule order in `IntakeService.submit`, before any image is decoded, against one `listVisible` read: with a `flashDesignId`, `findShown(tenant, id, visibleIds)` null is `flash_unavailable` (409); a `preferredArtistId` other than the design's artist is `artist_unavailable` (the existing 422 on `preferredArtistId`); the design's artist with `acceptingFlash` false is `artist_not_accepting`; the inquiry stores `preferred_artist_id` = the design's artist and `flash_design_id`. Without one, today's rules, unchanged.

- [ ] **Step 1: Write the failing tests**

`inquiries.spec.ts`:
- "a flash request stores the design and names its artist, even while their books are closed": an artist with `acceptingInquiries` false and `acceptingFlash` true; `postInquiry` with `flashDesignId` and no `preferredArtistId` is 201, and in A's context the inquiry has `flashDesignId` and `preferredArtistId` = the artist.
- "a custom request naming that artist is still artist_not_accepting" (spec: books closed, flash open).
- "a request for a design whose artist takes no flash requests is artist_not_accepting and stores nothing".
- "a hidden design, a hidden or deleted artist's design, an unknown id and another studio's design are flash_unavailable, store nothing and keep no file" (Review Focus 1, 3): each 409 `flash_unavailable` with the message "This flash design isn't available any more."; `intakeRows` unchanged; `storedReferenceImages` empty with a reference image attached.
- "a preferredArtistId other than the design's artist is a field error on preferredArtistId".
- "a flashDesignId that isn't a UUID is a field error on flashDesignId".

`intake_service.spec.ts`: "the flash rules come before any image is decoded" (an `ImageService` spy: no `store` call for each refusal).
`inquiry_service.spec.ts`: "accepting a flash request carries the design to the project": `accept(...)` gives a project whose `flashDesignId` is the inquiry's.
`inquiries_table.spec.ts`: "flash_design_id is frozen like the rest of what was submitted": a raw update throws `inquiries_guard_update: flash_design_id cannot change`.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=inquiries.spec.ts --files=intake_service.spec.ts --files=inquiry_service.spec.ts --files=inquiries_table.spec.ts`
Expected: FAIL on the new tests (the field is dropped, so the inquiry stores no design).

- [ ] **Step 3: Implement** per Interfaces: `IntakeService` gains `FlashService` as a fourth constructor dependency (a value import with the `biome-ignore` line; nothing builds `IntakeService` by hand); `checkArtist` becomes `target(tenant, submission): Promise<{ artistId: string | null; flashDesignId: string | null }>`; `toApiError` maps `flash_unavailable` to `ApiException.of("flash_unavailable")`; `accept` passes `live.flashDesignId`; the `IntakeService` doc comment lists the new refusal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=inquiry_refusals.spec.ts --files=inquiry_isolation.spec.ts --files=public_api.spec.ts --files=errors.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): an inquiry can ask for a flash design, and its project keeps it" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: The inbox and the project page show the design

**Files:**
- Create: `apps/platform/app/modules/flash/flash_card.ts`, `apps/platform/inertia/components/flash_design_card.tsx`
- Modify: `apps/platform/app/controllers/inquiries_controller.ts` (`index` rows, `show`), `apps/platform/app/controllers/projects_controller.ts` (`show`)
- Modify: `apps/platform/inertia/components/inquiries.ts` (`InquiryRow.flash`, `InquiryPageProps.flash`), `apps/platform/inertia/components/projects.ts` (`ProjectPageProps.flash`), `apps/platform/inertia/components/flash.ts` (`FlashCardProps`, `flashCardLine`), `apps/platform/inertia/pages/inquiries/index.tsx`, `inquiries/show.tsx`, `projects/show.tsx`
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts`, `tests/functional/projects/project_page.spec.ts`, `tests/unit/inertia/flash_copy.spec.ts`

**Interfaces:**
- Consumes: `FlashService.forIds` (Task 1); `Inquiry.flashDesignId`, `TattooProject.flashDesignId`.
- Produces (`#modules/flash/flash_card`): `export type FlashCardProps = { name: string; artistName: string | null; size: string; priceText: string | null; thumbnailUrl: string; imageUrl: string; hidden: boolean }`; `flashCard(images: ImageService, tenant: TenantRef, design: FlashDesign, artistName: string | null): Promise<FlashCardProps>` (`thumbnailUrl` the 320 px copy, `imageUrl` the 1280 px one, both `urlFor`).
- Produces (props): an inbox row's `flash: { name: string; thumbnailUrl: string } | null` (one `forIds` query for the page); the inquiry page's and the project page's top-level `flash: FlashCardProps | null` (not inside `inquiry` or `project`, so the pages' existing payload pins stand).
- Produces (dashboard): `FlashDesignCard({ flash }: { flash: FlashCardProps })`: a card titled "Flash design" with the thumbnail (a link to `imageUrl`, `alt` the name), the name, `flashCardLine(flash)` and, while hidden, "Hidden from the studio page."; in `components/flash.ts`, `flashCardLine({ artistName, size, priceText })` and the `FlashCardProps` type (the dashboard's copy of the server's).

- [ ] **Step 1: Write the failing tests**

`inbox.spec.ts`:
- "a flash request's row names the design with its thumbnail; other rows have none": the row's `flash` deep-equals `{ name: "Moth", thumbnailUrl }` with `thumbnailUrl` ending in `.320w.png`; a custom inquiry's row `flash` is null; the page's query count stays the same for 1 and for 3 flash rows (`recordQueries`, `#tests/helpers/query_count`).
- "the inquiry page shows the design: picture, name, artist, size and price": `flash` has exactly `["artistName", "hidden", "imageUrl", "name", "priceText", "size", "thumbnailUrl"]`, `priceText` "NPR 3,000", `hidden` false; after hiding the design, `hidden` true and still shown.

`project_page.spec.ts` (functional): "a project made from a flash request shows its design, to the owner and to its assigned artist; another project has none" (`flash.name` "Moth" for both roles; `flash` null without a design; `props.project` unchanged).

`flash_copy.spec.ts`: `flashCardLine({ artistName: "Sita Rai", size: "About 3 in", priceText: "NPR 3,000" })` is "By Sita Rai · About 3 in · NPR 3,000"; with `artistName` null and `priceText` null, "About 3 in".

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=project_page.spec.ts` and `PORT=3402 pnpm test unit --files=flash_copy.spec.ts`
Expected: FAIL (no `flash` prop).

- [ ] **Step 3: Implement** the helper, the props (after the tenant-scoped inquiry or project read; the artist's name from what the controllers already read: `artistNames(tenant)` in the inbox, `this.artists.list(tenant)` on the inquiry and project pages) and the UI: the inbox row shows a 40 px thumbnail and "Flash: {name}" above the idea; the inquiry page renders `FlashDesignCard` before the "Idea" card; the project page before `RequestCard`. The pages' contact recording (`use-contact-recording.ts`) is untouched; no `optimistic`. Shadcn and tokens only. Run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the commands of Step 2, plus `PORT=3402 pnpm test functional --files=next_step_agreement.spec.ts --files=page_affordances.spec.ts`, `PORT=3402 pnpm test unit --files=slow_connection_source.spec.ts --files=inline_confirms_source.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): the inbox and the project page show the flash design asked for" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: The storefront's flash pages and each artist's flash

**Files:**
- Create: `apps/storefront/src/studio/flash.ts` (pure), `apps/storefront/src/studio/components/flash.tsx` (stateless: `FlashGrid`, `ArtistFlash`), `apps/storefront/src/routes/flash/index.tsx`, `apps/storefront/src/routes/flash/$id.tsx`; regenerate `apps/storefront/src/routeTree.gen.ts`
- Modify: `apps/storefront/src/studio/request.ts` (`RequestSearch.flash`, the type only), `links.ts` (`flashHref`, `flashDesignHref`, `requestHref` writes `flash`), `srcset.ts`, `copy.ts`, `loaders.ts`, `seo.ts` (and its `rootMeta` comment, which names `/flash` as a path no page matches), `components/pages.tsx` (`FlashPage`, `FlashDesignPage` beside `WorkPage`, since `SiteBar` and `StudioAside` are local to it; `ArtistPage` renders `ArtistFlash`), `theme/registry.tsx`, `src/api/context.ts` (`hydrateApi`), `src/styles.css`, `scripts/check-page.mjs`
- Test: `apps/storefront/test/studio/flash.test.ts` (new), `fixtures.ts`, `links.test.ts`, `srcset.test.ts`, `loaders.test.ts`, `render.test.ts`, `seo.test.ts`, `prototype-removed.test.ts`, `theme-render.test.ts`, `search.test.ts`, `root-head.test.ts` (comment only), `test/api/context.test.ts`

**Interfaces:**
- Consumes: `tattooQueries.flash`, `tattooQueries.flashDesign`, `ListFlashQuery`, `FlashPage`, `FlashDesign` (Task 4); `readBrandImage` (`theme/config.ts`), `largeSource`, `cleanLine`, `fill` (`../intake/template.ts`), `findArtist`, `ARTIST_SLUG`, `rethrowAsNotFound`, `loadStudio`, `logReadFailed`; `SiteBar`, `StudioAside`, `SiteFooter`, `ChatButton`; `requestLink`, `chatLinks`.
- Produces (`flash.ts`):
  - `FLASH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`; `HOME_FLASH_COUNT = 6`, `ARTIST_FLASH_COUNT = 12`, `FLASH_PAGE_SIZE = 24`, `MAX_FLASH_PAGE = 48`.
  - `FlashDesignView = { id: string; name: string; size: string; priceText: string | null; image: BrandImage; largeSrc: string; alt: string; artist: { slug: string; name: string; href: string } | null; requestable: boolean; href: string; requestHref: string }` (`href` `flashDesignHref(id)`, `requestHref` `requestHref({ flash: id })`).
  - `FlashListView = { designs: readonly FlashDesignView[]; nextCursor: string | null; artists: readonly { slug: string; name: string }[] }`; `EMPTY_FLASH` (frozen, like `EMPTY_GALLERY`).
  - `flashDesignView(value: unknown, imageOrigin: string | null): FlashDesignView | null` (null without a `FLASH_ID` id, a name, a size or a usable picture (`readBrandImage`); name and size through `cleanLine`, at most 80 and 60 characters; `priceText` from `price.text` through `cleanLine`, else null; an artist only with an `ARTIST_SLUG` slug and a name; `requestable` only for `true`).
  - `flashListView(page: unknown, imageOrigin: string | null): FlashListView` (at most 48 designs, the bad ones dropped; `nextCursor` only when it matches `/^[A-Za-z0-9_-]{1,200}$/`; anything malformed `EMPTY_FLASH`).
  - `FlashSearch = { artist?: string; cursor?: string }`; `readFlashSearch(search: Record<string, unknown>): FlashSearch` (strings only, as the router hands them over: `artist` an `ARTIST_SLUG`, `cursor` `/^[A-Za-z0-9_-]{1,200}$/`; every other key dropped); `flashQuery(search: FlashSearch, limit: number): ListFlashQuery` (keys `artist, cursor, limit`).
  - `closedNoteFor(design: FlashDesignView, artists: readonly ArtistView[]): string | null`: null while requestable; else the artist's `closedMessage`, else `studioCopy.flash.closed`.
- Produces (`request.ts`, type only; Task 10 reads it): `RequestSearch = { artist?: string; flash?: string }`.
- Produces (`links.ts`): `flashHref(search: FlashSearch): string` (`/flash`, `/flash?artist=sita`, `/flash?artist=sita&cursor=c2`, through `queryOf`); `flashDesignHref(id: string): string`; `requestHref({ flash })` is `/request?flash=<id>` (with `flash`, `artist` is left out).
- Produces (`srcset.ts`, from its own constants, a square box drawn whole so no cover factor): `flashGridSizes(): string` = `"(min-width: 50.5rem) 15.34rem, (min-width: 40rem) calc((100vw - 4.5rem) * 0.334), calc((100vw - 3.5rem) * 0.5)"` (two columns, three from 40rem, a 48rem grid, 1rem gaps); `flashDesignSizes(): string` = `"(min-width: 38.5rem) 36rem, calc(100vw - 2.5rem)"`.
- Produces (`loaders.ts`): `ArtistPageData.flash: FlashListView`; `artistPageData(studio, artists, slug, origin, imageOrigin = null, portfolio = NO_PORTFOLIO, flash: unknown = null)`; `loadArtistPage` also reads `{ artist: slug, limit: ARTIST_FLASH_COUNT }` with the studio, the artists and the portfolio, and any failure of that read is `logReadFailed("Flash", context, error)` and `EMPTY_FLASH`. `FlashPageData = { studio; theme; seo; requestLink; chat; artists: readonly ArtistView[]; search: FlashSearch; list: FlashListView }`, `flashPageData(studio, artists, page, search, origin, imageOrigin = null)`, `loadFlashPage(context, search)` (studio, artists and the page in parallel; a flash read's 422 `validation_failed` or 404 `not_found` is the router's not-found, anything else the error page, as `loadWork`). `FlashDesignPageData = { studio; theme; seo; requestLink; chat; design: FlashDesignView; closedNote: string | null }`, `flashDesignPageData(studio, artists, design, origin, imageOrigin = null)` (null for a design `flashDesignView` refuses), `loadFlashDesignPage(context, id)` (a non-`FLASH_ID` id is `notFound()` before any call; studio, artists and the design in parallel; the design's 404 is the not-found; a null `flashDesignPageData` too). Header: `requestLink(studio, null)` on both pages; chat subject: the filtered artist's name on `/flash?artist=` (when that artist is in `list.artists`), `fill(studioCopy.chat.flash, { name })` on a design's page, else null. `hydrateApi` also keeps `tattooKeys.flash(tenant)` and `tattooKeys.flashDesigns(tenant)`.
- Produces (components): `components/flash.tsx`: `FlashGrid({ designs, showArtist, artists }: { designs: readonly FlashDesignView[]; showArtist: boolean; artists: readonly ArtistView[] })`, `ArtistFlash({ artist, list })`; `components/pages.tsx`: `FlashPage({ data })`, `FlashDesignPage({ data })`; `theme/registry.tsx`: `Theme.FlashPage`, `Theme.FlashDesignPage`, `ThemedFlashPage`, `ThemedFlashDesignPage`.
- Produces (`seo.ts`): `flashPageSeo(studio: StudioView, origin: string): PageSeo`; `flashDesignSeo(studio: StudioView, design: FlashDesignView, origin: string): PageSeo`.

- [ ] **Step 1: Write the failing tests**

`fixtures.ts`: `flashPage(count, over?)`: a `FlashPage` of `count` designs by Sita (`artist: { slug: "sita", name: "Sita Rai" }`, on the API's origin with copies, the first named "Moth", size "About 3 in", price `{ amount: 300000, currency: "NPR", text: "NPR 3,000" }`, the rest unpriced, all requestable), `nextCursor` null, `filters: { artists: [{ slug: "sita", name: "Sita Rai" }] }`; and `EMPTY_FLASH_PAGE` (`{ data: [], nextCursor: null, filters: { artists: [] } }`).

`flash.test.ts`:
- "a design becomes a view with its links, alt and price": `flashDesignView(flashPage(1).data[0], IMAGE_ORIGIN)` has `name` "Moth", `priceText` "NPR 3,000", `alt` "Moth, a flash design by Sita Rai", `artist.href` "/artists/sita", `href` `/flash/<id>`, `requestHref` `/request?flash=<id>`, a `srcSet` and `largeSrc`.
- "a broken design is dropped; a list of broken parts keeps the good ones" (no id, uppercase id, empty name, a 61-character size, a picture on another origin; an artist with slug "Sita" keeps the design with `artist` null and alt "Moth, a flash design"); "an older or broken answer is EMPTY_FLASH" (`undefined`, `null`, `"x"`, `{}`); "at most 48 designs are read"; "a nextCursor with a space is null".
- "the address's filter is read strictly": `readFlashSearch({ artist: "sita", cursor: "abc_-", fbclid: "x" })` keeps `artist` and `cursor`; `artist: "Sita"`, `cursor: "a b"`, `""` and non-strings are dropped (Review Focus 2).
- "closedNoteFor: null while requestable; the artist's words, else 'Not taking flash requests right now'".

`links.test.ts`: `flashHref({})` is "/flash", `flashHref({ artist: "sita", cursor: "c2" })` is "/flash?artist=sita&cursor=c2", `flashDesignHref(id)` is `/flash/<id>`; `requestHref({ flash: ID })` is `/request?flash=<ID>`, with `artist` too the same; each passes `isAllowedHref`.
`srcset.test.ts`: the two strings above.

`loaders.test.ts`. The fakes first: `listing()` (≈line 63) also answers `/flash?…` with `EMPTY_FLASH_PAGE` (so no test sees a flash failure it did not ask for), and the portfolio group's `withArtists` (≈line 700) answers `/flash?…` with `EMPTY_FLASH_PAGE` and fails only the `/work` read, so its exact log lines stand. Then the pins the artist page's new read changes: "the artist page's data holds no inquiry state…" (≈line 453) lists `"flash"` among its keys; the portfolio test's call list (≈line 584) gains `${root}/flash?artist=sita&limit=12`. New tests (the fakes also answer `/flash/<id>` with a design or a 404):
- "the artist page also asks for that artist's newest 12 designs": a URL ends `/flash?artist=sita&limit=12`; `data.flash.designs.length` follows the answer.
- "an artist page whose flash read fails (404, 500, network) still renders, without the Flash section, and logs 'Flash read failed' once" (Review Focus 4).
- "/flash reads the artists and the first 24 with the address's filter; a 422 validation_failed or a 404 from it is the not-found; a 500 is an error".
- "/flash/<id> reads the studio, the artists and the design; an unknown design is the not-found; a malformed id is the not-found with no API call" (Review Focus 2).

`render.test.ts`:
- "the artist page shows the artist's flash with 'All flash by'": `<section id="flash"` with `h2` "Flash" after `id="work"` and before the studio block, a card linking to `/flash/<id>` holding `Moth` and `NPR 3,000`, no artist name inside the cards; with a `nextCursor`, `<a class="text-link" href="/flash?artist=sita">All flash by <bdi>Sita Rai</bdi></a>`; without designs, no `id="flash"`.
- "a design whose artist takes no flash requests shows greyed with the artist's words" (`flash-card-closed`, the closed message inside the card).
- "/flash lists every design with its artist; the filter shows only with two artists": h1 "Flash"; one artist means no `nav`; two give `<nav aria-label="Whose flash">` with `/flash` (`aria-current="page"`) and `/flash?artist=arjun`; Show more links to `/flash?cursor=c2` ("Show more"), a cursor page has "Back to the newest" to the filter's first page; "No flash designs yet." with a link home; a filter with no match "No flash designs by this artist." and "Show all flash" to `/flash`; the site bar's Request is `/request` and the chat button is there.
- "the design page shows the picture large, the artist, size, price, status and Request this design": one `h1` "Moth", a link to `/artists/sita` reading "Sita Rai", Size, Price and Status ("Available") as `dt`/`dd`, `<a class="action action-primary" href="/request?flash=<id>">Request this design</a>`, the image's `sizes` is `flashDesignSizes()` and `src` is `largeSrc`; not requestable: no request link, and the Status is the artist's closed words or "Not taking flash requests right now"; an unpriced design has no Price row; the WhatsApp chat link's text is "Hi, I'm asking about the Moth flash".
- `assertSafePage` holds for both pages and for the artist page with flash.

`seo.test.ts`: `flashPageSeo` gives title "Flash at Black Needle", description "Flash designs by the artists of Black Needle: pick one and ask for it.", canonical `${ORIGIN}/flash` whatever the filter, no image, no JSON-LD; `flashDesignSeo` gives title "Moth, flash by Sita Rai at Black Needle" ("Moth, flash by Sita Rai" when the studio is named like the artist, the artist page's `sameName` rule), description "A flash design by Sita Rai, About 3 in, NPR 3,000. Ask Black Needle for it." (`trimDescription`), canonical `${ORIGIN}/flash/<id>`, no image, no JSON-LD.

`prototype-removed.test.ts`: the route list gains `routes/flash/$id.tsx` and `routes/flash/index.tsx` (sorted). `theme-render.test.ts`: the theme has `FlashPage` and `FlashDesignPage`. `context.test.ts`: the flash keys are kept by `hydrateApi`. `search.test.ts` and `root-head.test.ts` build their own routers, where `/flash` stays unmatched and they pass as they are: in `search.test.ts` replace the unmatched `"/flash?artist=true"` with `"/shop?artist=true"`, add a `/flash` route to its `visit` (`validateSearch: readFlashSearch`, `loaderDeps: ({ search }) => readFlashSearch(search)`) and a test "`/flash?artist=1e2&cursor=c2_-` reaches the loader as that and is not redirected"; in `root-head.test.ts` only its doc comment stops calling `/flash` the prototype's page.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL (missing `flash.ts`).

- [ ] **Step 3: Implement the view model, links, sizes, copy, loaders and SEO** per Interfaces and the Global Constraints' copy (`studioCopy.flash` and `studioCopy.chat.flash`; the `rootMeta` comment names `/admin/*` alone).

- [ ] **Step 4: Implement the components, routes and styles**

`FlashGrid`: `<ul class="flash-grid" role="list">` of cards (with the `biome-ignore` pair `ChatButton`'s list carries), each `<li class="flash-card">` (plus `flash-card-closed` while not requestable) holding `<a href={design.href}>` with the image (copies, `sizes={flashGridSizes()}`, `loading="lazy"`, `decoding="async"`, width and height), the name (`<bdi>`), "by {name}" (`Fill`) when `showArtist`, the price text, and while not requestable `closedNoteFor` in a `<p class="note user-text" dir="auto">`. `ArtistFlash`: `<section id="flash" class="section" aria-labelledby="flash-title">`, `h2` "Flash", `FlashGrid` without the artist, "All flash by {name}" (`flashHref({ artist })`) when `nextCursor`; null without designs; `ArtistPage` renders it after `PortfolioSection`, before `StudioAside`. `FlashPage` (in `pages.tsx`): `<SiteBar studio theme requestLink={data.requestLink} />`, `<main className="page">` with a section labelled by `h1` "Flash", the filter `nav` (links at least 3rem tall, `aria-current="page"` on the current one) when `list.artists.length >= 2`, "Back to the newest" on a cursor page, the grid with artists, a plain `<a class="action action-secondary flash-more" href={flashHref({ ...search, cursor })}>Show more</a>` while there is a `nextCursor`, the empty states, then `StudioAside`; after `</main>` `SiteFooter` and `<ChatButton chat={data.chat} studioName={studio.name} />`. `FlashDesignPage` (in `pages.tsx`): the same frame, with the picture (`largeSrc`, `srcSet`, `sizes={flashDesignSizes()}`, `fetchpriority="high"`), `h1` the name, "by" the artist's link, a `dl` of Size, Price (only when set) and Status ("Available", else `closedNote`), the request action while requestable, "All flash by {name}" (`flashHref({ artist })`). Routes: `routes/flash/index.tsx` (`createFileRoute("/flash/")`, `validateSearch: readFlashSearch`, `loaderDeps: ({ search }) => readFlashSearch(search)` as `/request` does, so a stray key never reaches the loader, `loadFlashPage`); `routes/flash/$id.tsx` (`loadFlashDesignPage(context, params.id)`); both `head` with `themedHeadTags` / `statusHead` and `headers: ({ match }) => pageCacheHeaders(match.status)`, rendering `ThemedFlashPage` / `ThemedFlashDesignPage`. CSS for `.flash-grid`, `.flash-card` (`object-fit: contain` on a square, `overflow-wrap: anywhere` on the text), `.flash-card-closed` (muted, still a link), `.flash-design` and `.flash-more` with the theme's tokens only.

`check-page.mjs`: the stand-in API answers `/api/v1/tenants/${SLUG}/flash?…` with an empty page and `/api/v1/tenants/${SLUG}/flash/<id>` with a 404; the artist page's expected reads gain `/api/v1/tenants/${SLUG}/flash?artist=sita&limit=12`; the not-found loop (`["/artists/nobody", "/artists/Sita", "/flash"]`) uses `"/admin/bookings"` instead of `"/flash"` (and its "unmatched path gets no Cache-Control" case with it); new checks: `/flash` is 200 with "No flash designs yet.", `pageCacheHeaders`' header, and the reads lookup, artists and `/flash?limit=24`; `/flash/NOT-A-UUID` is 404 with no API call but the lookup. Run `pnpm --filter @tattoo-drip/storefront generate-routes`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`, `pnpm --filter @tattoo-drip/storefront check:page`
Expected: PASS and clean; the default-theme snapshot unchanged; `routeTree.gen.ts` lists `/flash/` and `/flash/$id`; "Page check passed".

- [ ] **Step 6: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): flash pages, one design's page and each artist's flash" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: The Flash section on the home page, ordered and hidden from Page look

**Files:**
- Create: `apps/platform/database/migrations/1791800000001_add_flash_section_to_tenants.ts`
- Modify: `apps/platform/app/modules/storefront/look.ts` (`SECTION_KEYS`, `DEFAULT_SECTIONS`, the doc comment), `apps/platform/inertia/components/page_look.ts` (`SECTION_WORDS.flash`)
- Modify: `packages/types/openapi.yaml` (`StorefrontSection.type`'s enum and description, `StorefrontConfiguration.sections.maxItems`); regenerate
- Modify: `apps/storefront/src/studio/theme/config.ts` (`SECTION_KEYS`, `THEME_SECTIONS`, the doc comment), `src/studio/loaders.ts` (`StudioPageData.flash`, `studioPageData`, `loadStudioPage`), `src/studio/components/pages.tsx` (`StudioSection`'s `flash` case), `src/studio/components/flash.tsx` (`FlashSection`), `scripts/check-page.mjs`
- Regenerate: `apps/platform/database/schema.ts`
- Test (new): `apps/platform/tests/functional/tenancy/flash_section_migration.spec.ts`
- Test (pins of the four-key list, and `flash` used as an unknown key): platform `tests/unit/modules/storefront/look.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts`, `tests/functional/tenancy/page_look_columns.spec.ts`, `tests/functional/storefront/studio_page_service.spec.ts`, `tests/functional/api/public_studio.spec.ts`; storefront `test/studio/fixtures.ts` (`DEFAULT_STOREFRONT`), `theme-config.test.ts`, `render.test.ts`, `loaders.test.ts`

**Interfaces:**
- Consumes: `FlashGrid`, `flashListView`, `HOME_FLASH_COUNT`, `EMPTY_FLASH` (Task 8); `sectionList`, `SECTION_WORDS`, `useStoredRows`, `logReadFailed`.
- Produces: platform and storefront `SECTION_KEYS` = `["work", "artists", "flash", "info", "inquiry"]` (the drift test compares them), `DEFAULT_SECTIONS` and `THEME_SECTIONS["stencil-and-ink"].order` the same; `SECTION_WORDS.flash = { title: "Flash", description: "A few of your newest flash designs, with a link to all of them." }`, between `artists` and `info`; the contract's enum `[work, artists, flash, info, inquiry]`, `maxItems: 5`, and its description gains "`flash` (a few of the newest flash designs, shown only when there are some)"; `StudioPageData.flash: FlashListView`; `studioPageData(studio, artists, origin, imageOrigin = null, recentWork: unknown = null, flash: unknown = null, theme = parseThemeConfig(…))` (`flash` goes in before `theme`; only `loadStudioPage` passes `theme`); `loadStudioPage` also reads `{ limit: HOME_FLASH_COUNT }` **only when `theme.sections` includes `flash`** (with the artists and Recent work, in parallel), and any failure of that read is `logReadFailed("Flash", context, error)` and `EMPTY_FLASH`; `FlashSection({ list, artists })`.

- [ ] **Step 1: Write the failing tests**

Platform:
- `flash_section_migration.spec.ts` (new; the helpers `run`, `READ_DEFAULT`, `seed`, `lists`, `rolledBack` as in `good_to_know_section_migration.spec.ts`, importing `1791700000002_add_work_section_to_tenants`, `1791790000001_add_good_to_know_section_to_tenants` and `1791800000001_add_flash_section_to_tenants`; at most ten lists per test, since the slugs `mig-<n>` are read in text order):
  - "up and down keep every list within the column's check, boundary lists included": `run(FlashSection, "down")` first (the default then contains `'work,artists,info,inquiry'`), seed `["work,artists,info,inquiry", "artists,info,inquiry", "work,info,inquiry", "work,inquiry", "inquiry,work,info", "info,inquiry,artists", "work,work,artists,artists,info,zzz,zzz,inquiry", \`work,artists,${"x".repeat(79)},inquiry\`, "flash,work,inquiry", "flash,flash,info,work,artists,inquiry,zzz,zzz"]`; after up: `["work,artists,flash,info,inquiry", "artists,flash,info,inquiry", "work,flash,info,inquiry", "work,flash,inquiry", "inquiry,work,flash,info", "info,inquiry,artists,flash", "work,artists,flash,info,inquiry", "work,artists,flash,inquiry", "flash,work,inquiry", "flash,info,work,artists,inquiry"]`, the default contains `'work,artists,flash,info,inquiry'`, and no seeded list breaks the check (128's count query); after down: `["work,artists,info,inquiry", "artists,info,inquiry", "work,info,inquiry", "work,inquiry", "inquiry,work,info", "info,inquiry,artists", "work,artists,info,inquiry", "work,artists,inquiry", "work,inquiry", "info,work,artists,inquiry"]` and the default `'work,artists,info,inquiry'`.
  - "through TAT-126's, TAT-128's and this migration in order, a list ends with flash after the artists": down Flash, Good to know, Work (the default then `'artists,inquiry'`), seed TAT-128's `before` lists (`"artists,inquiry"`, `"inquiry"`, `"inquiry,artists"`, `"artists,artists,flash,inquiry"`, \`artists,${"x".repeat(84)},inquiry\`, the seven-key and the eight-key lists), up Work, Good to know, Flash: `["work,artists,flash,info,inquiry", "work,flash,info,inquiry", "work,info,inquiry,artists,flash", "work,artists,flash,info,inquiry", "work,artists,flash,info,inquiry", "work,artists,flash,info,inquiry", "work,artists,flash,info,inquiry"]` and the default `'work,artists,flash,info,inquiry'`; down Flash alone gives back what TAT-128's migration made (`"work,artists,info,inquiry"`, `"work,info,inquiry"`, `"work,info,inquiry,artists"`, then four `"work,artists,info,inquiry"`).
  - "the default is the first statement of up and of down" (the dry run, two queries each, as TAT-128's test).
- `look.spec.ts`: "the default is Recent work, the artists, Flash, Good to know, then the form" (`SECTION_KEYS` and `DEFAULT_SECTIONS` both `["work", "artists", "flash", "info", "inquiry"]`, replacing the four-key test at ≈line 207); "sectionList keeps Flash once, where it was put": `sectionList(["flash", "artists", "flash"])` is `["flash", "artists", "inquiry"]`, `sectionsOf("work,artists,inquiry")` stays without flash; and in the two tests that use `"flash"` as the unknown key (≈lines 236 and 249: `sectionList(["artists", "work", "artists", "flash"])`, `sectionsOf("inquiry,artists,inquiry,flash")`) the unknown key becomes `"zzz"`, so they keep their meaning.
- `page_look_copy.spec.ts`: the titles list is `["Recent work", "Artists", "Flash", "Good to know", "Got an idea?"]` and the descriptions list gains Flash's words third.
- `page_look_http.spec.ts`: "saves Flash in the order sent": `sections[]` flash, work, inquiry stores `"flash,work,inquiry"`; the default look's `sections` (≈line 74), the `sectionKeys` pins (≈lines 123 and 141) and the stored-default pins (≈lines 346, 420 and 458) become the five-key list (`"work,artists,flash,info,inquiry"`).
- `page_look_columns.spec.ts`: "a new studio's sections are work, artists, Flash, Good to know, then the form" (≈line 131), and the default pins at ≈lines 86 and 107, read `"work,artists,flash,info,inquiry"`.
- `studio_page_service.spec.ts`: `DEFAULT_LOOK.sections` is the five-key list. `public_studio.spec.ts`: the default `storefront.sections` is `[{ type: "work" }, { type: "artists" }, { type: "flash" }, { type: "info" }, { type: "inquiry" }]`.

Storefront:
- `theme-config.test.ts`: "the default order is work, artists, Flash, Good to know, then inquiry" (the pins at ≈lines 93 to 103, 166, 576, 603 and 641 to 645 become the five-key list); "an older API's [work, artists, info, inquiry] shows no Flash".
- `fixtures.ts`: `DEFAULT_STOREFRONT.sections` gains `{ type: "flash" }` after `artists`.
- `render.test.ts`: "the Flash section shows six designs with their artists and All flash": from an 8-design page, `<section id="flash"` with `h2` "Flash" after `id="artists"` and before `id="inquiry"`, six cards, "by Sita Rai", `<a class="text-link" href="/flash">All flash</a>`; "no designs, no Flash section and no All flash link"; "a studio that hides Flash shows none even with designs".
- `loaders.test.ts`: the studio page's pins: "reads the artists and the newest 9 photos once…" (≈line 116) and "the studio page reads the artists and the newest 9 photos" (≈line 181) gain the studio's `/flash?limit=6` in their call lists (default sections; each on its own test's API origin); the keys pin at ≈line 350 lists `"flash"`; the "a work read that fails…" group's `withArtists` (≈line 252) answers `/flash?…` with `EMPTY_FLASH_PAGE`, so its log lines stay exactly the work read's. New: "the studio page also reads the newest 6 designs, only when its sections include flash" (sections without flash make no `/flash` read; with flash anywhere, one `/flash?limit=6`); "a failed flash read (404, 500, network) still gives the studio page, without Flash, and logs 'Flash read failed' once" (Review Focus 4).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test functional --files=flash_section_migration.spec.ts > /tmp/site4-red.log 2>&1` (exit 124, "Cannot find module" for the migration), `PORT=3402 pnpm test unit --files=look.spec.ts --files=page_look_copy.spec.ts`, `PORT=3402 pnpm test functional --files=page_look_http.spec.ts --files=page_look_columns.spec.ts --files=public_studio.spec.ts --files=studio_page_service.spec.ts`, `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new and changed tests.

- [ ] **Step 3: Migrate**

`1791800000001_add_flash_section_to_tenants.ts`, the normalise-then-insert pattern of `1791790000001` (its doc comment says why lists are rebuilt and why the default changes first; this one says the same and why `info` must be a known key here). With `REBUILT(keys)` = TAT-128's `kept` / `listed` CTE over the given keys:

```ts
const WITH_FLASH = "'work', 'artists', 'flash', 'info', 'inquiry'";
const WITHOUT_FLASH = "'work', 'artists', 'info', 'inquiry'";

async up() {
	this.schema.raw(
		"alter table tenants alter column storefront_sections set default 'work,artists,flash,info,inquiry'",
	);
	this.schema.raw(`${REBUILT(WITH_FLASH)}
		update tenants t set storefront_sections = next.sections
		from (
			select id, case
				when 'flash' = any (string_to_array(sections, ',')) then sections
				when 'artists' = any (string_to_array(sections, ','))
					then regexp_replace(sections, '(^|,)artists(,|$)', '\\1artists,flash\\2')
				when 'info' = any (string_to_array(sections, ','))
					then regexp_replace(sections, '(^|,)info(,|$)', '\\1flash,info\\2')
				when 'inquiry' = any (string_to_array(sections, ','))
					then regexp_replace(sections, '(^|,)inquiry(,|$)', '\\1flash,inquiry\\2')
				else sections || ',flash'
			end as sections
			from listed
		) next
		where t.id = next.id and t.storefront_sections is distinct from next.sections`);
}

async down() {
	this.schema.raw(
		"alter table tenants alter column storefront_sections set default 'work,artists,info,inquiry'",
	);
	this.schema.raw(`${REBUILT(WITHOUT_FLASH)}
		update tenants t set storefront_sections = listed.sections
		from listed
		where t.id = listed.id and t.storefront_sections is distinct from listed.sections`);
}
```
Each list keeps its distinct known keys in stored order (a list that already holds `flash`, which only a development database can, keeps it where it is) and gets `flash` right after `artists`, else right before `info`, else right before `inquiry`: at most five keys and 31 characters. Every list shows Flash, which renders nothing until the artist adds a design, so the migration changes no page by itself. Note `select slug, storefront_sections from tenants` first; after `pnpm migrate` (then the `biome` step), every list is the old one with `flash` in that place; `pnpm migrate:rollback` gives back the old lists and `pnpm migrate` again; `ls database/migrations | tail -2` ends with `1791800000000_…`, `1791800000001_…`.

- [ ] **Step 4: Implement** per Interfaces; regenerate the types. `StudioSection`'s `flash` case renders `FlashSection` (null when empty): `<section id="flash" class="section" aria-labelledby="flash-title">`, `h2` "Flash", `FlashGrid` with artists over at most `HOME_FLASH_COUNT`, then `<a class="text-link" href="/flash">All flash</a>` with an `aria-hidden` arrow icon, as Recent work's "All work". `loadStudioPage` passes `theme` as `studioPageData`'s seventh argument. Update the doc comments that list the sections (`look.ts`, `theme/config.ts`, `StudioSection`). `check-page.mjs`: the home page's expected reads gain `/api/v1/tenants/${SLUG}/flash?limit=6` (its stand-in studio sends no storefront, so the default sections).

- [ ] **Step 5: Run the tests to verify they pass**

Run: the commands of Step 2 (the first without `timeout`), plus `PORT=3402 pnpm test functional --files=good_to_know_section_migration.spec.ts` (unchanged and still passing: it runs TAT-128's migration on its own, where `flash` is an unknown key), `PORT=3402 pnpm test unit --files=page_look_source.spec.ts`, `pnpm --filter @tattoo-drip/storefront build`, `pnpm --filter @tattoo-drip/storefront check:page` and `pnpm typecheck` (root)
Expected: PASS and clean; the default-theme snapshot unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/platform apps/storefront packages/types
git commit -m "feat(storefront): a Flash section on the home page, ordered and hidden from Page look" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: The request page for a flash design

**Files:**
- Modify: `apps/storefront/src/studio/request.ts` (`readRequestSearch` keeps `flash`), `src/studio/flash.ts` (`FlashLookup`, `FlashRequestView`), `src/studio/inquiry.ts` (`start`, `flashDesignId`, `flashInquiryState`, `inquiryChannels`), `src/studio/loaders.ts` (`RequestPageData.flash`, `requestPageData`, `loadRequestPage`, `channelsFor`), `src/studio/seo.ts` (`requestPageSeo`), `src/studio/components/inquiry.tsx` (`InquirySection`'s `intro` and h1, `InquiryFallback`), `src/studio/components/flash.tsx` (`FlashSummary`), `src/studio/components/pages.tsx` (`RequestPage`), `src/styles.css`, `scripts/check-page.mjs`
- Modify: `apps/storefront/src/intake/rules.ts` (`initialValues`), `src/intake/submission.ts` (`toInquiryInput`), `src/intake/problems.ts`, `src/intake/copy.ts`, `src/intake/components/intake-form.tsx`, `src/intake/components/intake-mount.tsx` (`intakeFormKey`)
- Test: `apps/storefront/test/studio/request.test.ts`, `request-route.test.ts`, `inquiry.test.ts`, `loaders.test.ts`, `render.test.ts`, `seo.test.ts`, `test/intake/rules.test.ts`, `submission.test.ts`, `problems.test.ts`, `copy.test.ts`, `section.test.ts`

**Interfaces:**
- Consumes: `flashDesignView`, `FLASH_ID`, `closedNoteFor`, `RequestSearch.flash`, `requestHref({ flash })` (Task 8); `tattooQueries.flashDesign` (Task 4); the request page as TAT-127 built it.
- Produces (`request.ts`): `readRequestSearch` keeps `flash` when it is a string matching `FLASH_ID`, else drops it; with a kept `flash`, `artist` is dropped (the design names the artist, so a request page has one spelling).
- Produces (`flash.ts`): `FlashLookup = { kind: "found"; design: unknown } | { kind: "gone" } | { kind: "failed" }`; `FlashRequestView = { kind: "requestable"; design: FlashDesignView } | { kind: "closed"; design: FlashDesignView; note: string } | { kind: "gone" } | { kind: "failed" }`.
- Produces (`inquiry.ts`): the `open` state gains two **optional** fields, `readonly start?: { readonly idea: string; readonly approximateSize: string }` and `readonly flashDesignId?: string`, absent for a custom request (so `inquiryState` and every existing literal and `deepEqual` in the tests stand); `flashInquiryState(studio: StudioView, design: FlashDesignView, artist: ArtistView): InquiryState` (open; `preferredArtist` and `artists` the design's artist alone, whatever their books say; `start` `{ idea: fill(studioCopy.flash.ideaStart, { name }), approximateSize: design.size }`; `flashDesignId` the design's id); `inquiryChannels(studio, artist, flashName: string | null = null)` (with a name: WhatsApp "Hi {studio}, I'd like to ask about the {name} flash.", email subject "Flash request: {name}", the same body).
- Produces (`loaders.ts`): `RequestPageData.flash: FlashRequestView | null`; `requestPageData(studio, artists, search, origin, imageOrigin = null, flash: FlashLookup | null = null)`: `found` with a view whose artist (`findArtist` by its slug) is in the list gives `requestable` (inquiry `flashInquiryState`) or, not requestable, `closed` with `note` = the artist's `closedMessage`, else `fill(studioCopy.flash.closedNamed, { name })` (inquiry `inquiryState(studio, artists, artist)`, so their books decide); a view `flashDesignView` refuses, or an artist not in the list, is `gone`; `gone` and `failed` give the general state. The chat subject is `fill(studioCopy.chat.flash, { name })` with a found design (requestable or closed), else today's. `channelsFor(studio, inquiry, flashName)` passes the design's name while the inquiry is a flash request. `loadRequestPage` reads the design (`tattooQueries.flashDesign`, `staleTime: "static"`) in parallel with the studio and the artists when `search.flash` is set: its 404 `not_found` is `gone`, any other failure `failed` (logged with `logReadFailed("Flash design", …)`); it never throws for the design. Without `search.flash` it reads exactly what it reads today.
- Produces (`seo.ts`): `requestPageSeo(studio, artist, origin, open = true, design: FlashDesignView | null = null)`: with a design (`requestPageData` passes it only for `requestable`), title "Ask for the Moth flash at Black Needle", description "Ask Black Needle for the Moth flash by Sita Rai: say where it goes and the dates that suit you.", canonical `${origin}/request?flash=<id>`, image null; without one, unchanged (a closed design's page has the artist's own head).
- Produces (components): `InquirySection` gains `intro?: ReactNode`, rendered right after the h1 and before the steps strip (or the closed content); its open h1 reads `studioCopy.flash.requestTitle` ("Ask for this design") when `state.flashDesignId` is set. `InquiryFallback` for a flash request says "Ask {studio} for {idea}: say where it goes and the dates that suit you." (`state.start.idea`). `FlashSummary({ request, studioName }: { request: FlashRequestView; studioName: string })`: `requestable` and `closed`, a `<div class="flash-summary">` (plus `flash-summary-closed`) with the picture at 8rem (copies, `sizes="8rem"`), the name, "by {name}", the size and the price, and for `closed` its note in `<p class="note user-text" dir="auto">`; `gone`, a `<p class="note">` of `studioCopy.flash.gone`; `failed`, of `studioCopy.flash.failed`. `RequestPage` passes `intro={data.flash ? <FlashSummary request={data.flash} studioName={studio.name} /> : null}`.
- Produces (intake): `initialValues(preferredArtistId: string | null, start: { idea: string; approximateSize: string } | null = null)`; `toInquiryInput(values, referenceImages, honeypot, flashDesignId: string | null = null)` (adds `flashDesignId` when set); `ProblemContext.sentFlash?: boolean` (absent is false); `NOTICE_CODES` gain `"flash-unavailable"` (title "This design isn't available any more", body "{studio} took it off their page while you were writing. You can still message them about it.") and `"flash-closed"` (title "This artist just stopped taking flash requests", body "Your request wasn't sent. You can still message {studio} about it."); `intakeFormKey(state)` is `flash:<id>` for a flash request (else today's artist id), so moving between a design's form and the same artist's custom form mounts a fresh form. In `IntakeForm` the artist picker is hidden while `state.flashDesignId` is set.

- [ ] **Step 1: Write the failing tests**

`request.test.ts`: "the address keeps a well-formed flash id": `readRequestSearch({ flash: ID, fbclid: "x" })` is `{ flash: ID }`; `{ artist: "sita", flash: ID }` is `{ flash: ID }`; `ID.toUpperCase()`, `ID.slice(0, 35)`, `"moth"`, `12` and `[ID, ID]` are dropped (Review Focus 2).
`request-route.test.ts`: "`/request?flash=<ID>&fbclid=x` reaches the loader as `{ flash: ID }`, and `?flash=<ID>&artist=sita` too"; its fake answers `/flash/<ID>` with a design.
`inquiry.test.ts`: "a flash request is open for the design's artist alone, with the idea and size filled in": `flashInquiryState(studio, design, closedBooksArtist)` is open, `artists` one entry, `start` `{ idea: "The Moth flash", approximateSize: "About 3 in" }`, `flashDesignId` the id; `inquiryState`'s open state has neither key; `inquiryChannels(studio, null, "Moth")`'s WhatsApp text is "Hi Black Needle, I'd like to ask about the Moth flash.".
`loaders.test.ts`, "loadRequestPage with ?flash=":
- "reads the design with the studio and the artists; a requestable design is a flash request for its artist, books closed or not".
- "a design whose artist's flash is off is the closed view, with that artist's own request state below".
- "an unknown design (404) is the general form with the 'isn't on the page' view; a 500 or a dropped connection is the general form with the 'couldn't load' view and one 'Flash design read failed' line; neither is a not-found or an error" (Review Focus 2).
- "without ?flash= the page reads the artists alone" (TAT-127's pin at ≈line 1004 stands).
`render.test.ts`:
- "a flash request page shows the design above the form and asks for it": `<h1 id="inquiry-title" class="section-title">Ask for this design</h1>`, then a `flash-summary` holding the picture, `Moth`, `by <bdi>Sita Rai</bdi>`, `About 3 in`, `NPR 3,000`, before `steps-strip`; the fallback says `Ask <bdi>Black Needle</bdi> for <bdi>The Moth flash</bdi>`; the chat button's WhatsApp text ends "about the Moth flash".
- "a closed design's page shows it greyed with the note, and the artist's own state"; "a gone design's page shows the note and the general form".
`seo.test.ts`: `requestPageSeo` with a design as in Interfaces; without one, TAT-127's results unchanged.
`rules.test.ts`: `initialValues("a1", { idea: "The Moth flash", approximateSize: "About 3 in" })` has those two and `preferredArtistId` "a1". `submission.test.ts`: `toInquiryInput(values, [], "", ID).flashDesignId` is ID; without it the key is absent.
`problems.test.ts` (Review Focus 1): `flash_unavailable` gives the notice `flash-unavailable` with `contact: true`; `artist_not_accepting` with `sentFlash: true` gives `flash-closed` with `contact: true` and no field error; with `sentFlash` absent or false, today's field error on `preferredArtistId`.
`copy.test.ts`: every notice code has copy (the existing sweep, now with the two). `section.test.ts`: an open state with `flashDesignId` renders the "Ask for this design" h1 and the `intro` between the h1 and the strip; `intakeFormKey` differs between a design's form and the same artist's custom form.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** per Interfaces. `IntakeForm`: `defaultValues: initialValues(preferredArtist?.id ?? null, state.start ?? null)`, `showArtists` false while `state.flashDesignId` is set, `toInquiryInput(…, state.flashDesignId ?? null)`, and `sentFlash: state.flashDesignId !== undefined` in the problem context. CSS for `.flash-summary` with the theme's tokens only. `check-page.mjs`: `/request?flash=<a well-formed id>` is 200 with the general form and the "isn't on … page any more" note (the stand-in 404s the design), and reads the lookup, the artists and `/flash/<id>`; `/request?artist=sita` still reads the lookup and the artists alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`, `pnpm --filter @tattoo-drip/storefront check:page`
Expected: PASS and clean; "Page check passed"; the default-theme snapshot unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): ask for a flash design from the request page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11: Docs, whole-branch checks and the browser pass

**Files:**
- Modify: `apps/platform/docs/backend.md` (a Flash bullet: the module, the table, the rules, `lockEditable`, a referenced design is hidden not deleted; Public API: the flash reads and `requestable`; Intake: `flashDesignId` and its refusals; Images: `flash_design`; the page look's section list now `work,artists,flash,info,inquiry` and the `1791800000001` migration), `apps/platform/database/README.md` (the not-soft-deleted list gains flash designs, with the `NO ACTION` keys that keep a named design), `apps/platform/docs/ui.md` (the artist form's Flash section and switch; the inbox row, the inquiry page's and the project page's Flash design card; Page look: the Flash row), `apps/storefront/docs/development.md` (routes `/flash` and `/flash/<id>`; the home and artist flash sections and their failure rule; the request page's `?flash=`; `check:page`'s reads; Themes: the `flash` section), `docs/data-model.md` (the Flash row (≈line 80) becomes FlashDesign: picture, name, size, optional price, hidden; requested like custom work, through the usual quote, not a fixed quote), `docs/architecture.md` (module table: Flash, TAT-129), and the product docs the spec lists, since this half ships alone: `docs/product.md` (≈line 59: flash designs a client can ask for join the studio page's MVP list, V1 keeps more themes and a custom domain; ≈line 43: a flash design asked for from the studio page goes through the usual quote, instant-booking flash is V1's), `docs/requirements.md` (the MVP's studio website line gains flash designs and requests; V1's "Studio site: flash, more themes, custom domain" drops flash; "Flash with instant booking" stays) and `docs/roadmap.md` (≈line 42 drops "and flash"; the loop line gains flash designs; ≈line 40's instant-booking flash stays).

- [ ] **Step 1: Update the docs** in the files above, one to three sentences each, in the existing voice. Plan 4b adds one of a kind and claiming to the same places.

- [ ] **Step 2: Run the root gates**

Run (worktree root, Node 24, the Global Constraints' environment): `pnpm check`, `pnpm typecheck`, `pnpm build`, then the full platform suite in the background under the lock: `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock env -u TURNSTILE_SECRET_KEY -u STOREFRONT_SERVER_KEYS -u TRUST_PROXY -u ALERT_EMAILS DB_DATABASE=tattoo_drip_site ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform PORT=3402 pnpm -C apps/platform exec node ace test` (empty `queue_jobs` in `tattoo_drip_site` first), `pnpm test` for the packages and storefront, and `pnpm --filter @tattoo-drip/storefront check:page`.
Expected: all clean; the platform log ends with `Tests N passed` and no failures; "Page check passed".

- [ ] **Step 3: Browser pass**

Make 8 PNGs of 1200 × 1200 (and one text file renamed `broken.png`) with `sharp` in a scratch folder outside the repository. Start the platform on 3401 against `tattoo_drip_site` with `TURNSTILE_SECRET_KEY` unset and the storefront on 3404 with `API_URL=http://localhost:3401`, as the earlier plans' browser passes did (Chromium at `/home/blank/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, the QA login). With Playwright, at 375 × 812 and 1280 × 800, light and dark:
- Dashboard: as an owner add 7 designs to one artist (one priced, one with a Devanagari name of about 40 characters) and 2 to another; `broken.png` gives the picture error; a price of 12.5 the price error; edit one in the sheet, hide one, remove one (the inline confirm: focus starts on "Keep the design"); a design a request names refuses removal with the words; as that artist, add one to their own profile; switch one artist's books off and leave flash on, another's both off.
- Page look: the five sections in order; move Flash above Artists, hide it, show it, save.
- Storefront: the home Flash section (6 cards, All flash) between Artists and Good to know; `/flash` with its artist filter and Show more, `/flash/<id>` (the picture whole and sharp, the price, Request this design), the books-closed artist's page (closed words, flash requestable), the both-closed artist's designs greyed with their words and no request button; `/request?flash=<id>` shows the design, the idea and size filled in and editable, no artist picker; send it, then find the design's picture and name in the inbox row, on the inquiry page and, after accepting, on the project page; hide the design in another tab and send a second request: the notice, not a field error; `/request?flash=<unknown id>` and `/flash/NOT-A-UUID` (general form; not-found); the chat link's message says "the … flash"; the sticky header's Request clears the flash pages' content; no horizontal scroll at 375 px with the long name; grids request the copies, never the stored image (network log).
Stop both servers by their exact PIDs.

- [ ] **Step 4: Commit**

```bash
git add docs apps/platform/docs apps/platform/database/README.md apps/storefront/docs
git commit -m "docs: flash designs, the flash pages and flash requests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Tear down**

Leave `tattoo_drip_site` in place for plan 4b (it stacks on this branch); delete the scratch images; stop every process this plan started; `git status` clean.
