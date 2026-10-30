# Studio site 2/5 (TAT-126): photos without a cap, styles, healed, multi-upload and All work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An artist keeps up to 100 work photos, each with up to 3 styles and a healed mark, uploaded several at a time; the public site shows them newest first in a Recent work home section, on a new `/work` page filtered by artist, style and healed, and as each artist's full portfolio with an All / Healed filter, all with the large-photo viewer naming the artist and styles.

**Architecture:** `artist_work_photos` drops its 6 fixed positions for `created_at` order (a migration gives existing photos matching dates) and gains `styles varchar(40)[]` and `healed`. One new paged public read, `GET /tenants/{tenant}/work` (`listWork`, replacing the V1 `listPortfolio` sketch), serves Recent work, `/work` and the artist page, with an opaque keyset cursor and a `filters` facet so the storefront only offers filters that match something; `GET /styles` (`listStyles`) becomes real. The dashboard's tray becomes a thumbnail grid with one details sheet, and a multi-select that sends one photo per request in sequence. TAT-56's "artists placement" radio becomes an ordered show/hide list of sections, which `work` joins.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, Inertia + React + shadcn (dashboard), PostgreSQL 18, OpenAPI 3.1 + openapi-typescript, `@tattoo-drip/sdk` / `@tattoo-drip/react` (TanStack Query), TanStack Start (storefront), Japa and `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md`, sections "Home" (Recent work), "Artist page" (portfolio, All / Healed), "All work", "Photos", "Styles", "My calls" 1, 2, 6, 7, and the Look settings sentence under "Home". Ticket 2 of the spec's split. Plan 1 (`docs/superpowers/plans/2026-10-30-studio-site-1-artist-styles-and-links.md`) is built; its Interfaces are used as given: `#modules/artists/styles` (`TATTOO_STYLES`, `StyleSlug`, `STYLE_SLUGS`, `MAX_ARTIST_STYLES`, `TattooStyleRef`, `knownStyles`), `artists.styles`, the public Artist's `styles` / `socialLinks`, the artist form's `styleOptions` page prop and `styles[]` field, `ArtistView.styles` / `links`.

## Global Constraints

- Base: the tip of TAT-125's branch `harublank00/tat-125-studio-site-15-artist-styles-and-social-links` (plan 1, with `main` up to TAT-84 merged in: the artists controller now builds the list's props in `toRowProps` and the edit form's in `toProps`; `ArtistRowProps` / `ArtistProps` / `StyleOption` live in `inertia/components/artists.ts`). Branch `harublank00/tat-126-studio-site-25-full-portfolios-photo-styles-healed-photos` (Linear TAT-126) in the worktree `/home/blank/Coding/tattoo-drip-wt/site-2`. Database `tattoo_drip_site` is reused as plan 1 left it (never drop or recreate it).
- **Never touch the user's database `tattoo_drip` or the servers on ports 3333 and 3000.** Every platform command runs with `DB_DATABASE=tattoo_drip_site` and `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform` (the worktree has no `.env`; never read any `.env`). Unset `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS` for test runs. Tests use `PORT=3402`; a dev server for the browser pass uses 3401, the storefront 3404.
- Node 24: prefix commands with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`.
- A spec run that hits a missing import hangs Japa: run RED steps as `timeout 90 ... > /tmp/site2-red.log 2>&1` and expect exit 124 plus the "Cannot find module" line. Never two platform suites at once.
- Limits: **up to 100 photos per artist**; **up to 3 styles per photo** from plan 1's 18-style list; one **healed** mark (boolean). The 101st photo's error is "This artist already has 100 photos. Remove one to add another."; a fourth style is "Pick up to 3 styles.".
- Order: **newest first everywhere**, `created_at desc, id desc`; no manual reordering. Existing photos keep the studio's order: position 0 becomes the artist's newest date, each later position one second older.
- Public reads show visible artists' photos only (hidden and deleted never, in data, filters or by slug); a closed artist's photos still show.
- Sizes: the API's `limit` is 1 to 48, default 24. Recent work shows the newest **9**; `/work` and the artist page load **24** a page. `Artist.workPhotos` stays at most 6: the artist's six newest.
- Images: grids use the copies with `srcset` (`workGridSizes`), the viewer the widest copy up to 1280 px (`largeSource`); a grid never loads the stored image when a copy exists.
- Empty sections hide (spec call 7): no photos, no Recent work section and no All work link; no healed photo, no All / Healed filter.
- Caching: storefront pages keep `public, max-age=0, s-maxage=60, stale-while-revalidate=600`; the two new API reads use `middleware.publicCache()`.
- All text is plain text. The public API sends only what the contract lists (exact-fields tests).
- The storefront's default-theme snapshot (`apps/storefront/test/studio/default-theme.snapshot.json`) must not change: every new section renders nothing without photos.
- Deploy order: the platform before the storefront (the storefront's pages read `/work`).
- Never edit generated files: `packages/types/src/openapi.gen.ts` (`pnpm --filter @tattoo-drip/types generate`), `apps/platform/database/schema.ts` (`pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`), `apps/platform/.adonisjs/` (`node ace codegen`), `apps/storefront/src/routeTree.gen.ts` (`pnpm --filter @tattoo-drip/storefront generate-routes`, footer from `pnpm build`).
- Conventional Commits with area scopes (`platform`, `types`, `sdk`, `react`, `storefront`, `docs`), subjects under 100 characters, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Photos uploaded before this ticket** must come out in the order the studio set (position 0 first), not upload order. Checked against real rows in Task 1 (Step 6).
2. **Hidden, deleted or another studio's artists** must never surface through the new read: not in `data`, not in `filters`, not via `artist=<their slug>`. Pinned in Task 5 (`public_work.spec.ts`) and the isolation case.
3. **Paging across ties and changes:** two photos with the same `created_at` on a page boundary each appear once; a photo removed between two pages does not break the next page; a garbled cursor is a 422 `validation_failed` (the storefront shows its not-found page on `/work` and for an artist page's own cursor). Pinned in Task 3 and Task 5. A failed work read never takes the home page or an artist page down (Tasks 6 and 7).
4. **An older or partial API answer in the storefront:** a page without `filters` or `nextCursor`, an item without `artist` or with malformed `styles`, `?healed=1` parsed by the router as the number 1. Pinned in Task 6 (`gallery.test.ts`).
5. **A multi-upload that partly fails:** one non-image among five, or more files chosen than the tray has room for: the others upload once each, the summary names the refused file, nothing is sent past the limit. Words pinned in Task 2; behaviour in Task 8's browser pass.

---

### Task 1: Photos newest first, up to 100, with styles and a healed mark

**Files:**
- Create: `apps/platform/database/migrations/1791700000001_work_photos_newest_first_with_styles.ts`
- Modify: `apps/platform/app/modules/artists/styles.ts` (two exports)
- Modify: `apps/platform/app/modules/artists/services/work_photo_service.ts`
- Modify: `apps/platform/app/modules/artists/validators/work_photo.ts`
- Modify: `apps/platform/app/controllers/work_photos_controller.ts`, `apps/platform/app/controllers/artists_controller.ts` (`edit` props)
- Modify: `apps/platform/start/routes.ts` and `apps/platform/app/modules/tenancy/access.ts` (drop `tenant.artists.photos.move`)
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts` (`forArtists` with 6)
- Modify: `apps/platform/inertia/components/photos.ts`, `apps/platform/inertia/components/work_photo_tray.tsx` (drop the move buttons, the limit to 100; the rebuild is Task 2)
- Modify: `packages/types/openapi.yaml` (`Artist.workPhotos` and `WorkPhoto` descriptions only)
- Regenerate: `apps/platform/database/schema.ts`, `apps/platform/.adonisjs/`, `packages/types/src/openapi.gen.ts`
- Modify (tests and helpers): `apps/platform/tests/helpers/artists.ts` (`addWorkPhoto`), `tests/helpers/tenants.ts` (`seedWorkPhoto`), `tests/isolation/cases.ts`, `tests/functional/tenancy/role_access.spec.ts`, `tests/functional/rls/artist_work_photos.spec.ts`, `tests/functional/media/image_service.spec.ts`, `tests/functional/artists/artist_form.spec.ts`, `tests/unit/inertia/photos_copy.spec.ts`
- Test: `tests/functional/artists/work_photo_service.spec.ts`, `tests/functional/artists/work_photos_http.spec.ts`, `tests/functional/api/public_artists.spec.ts`

**Interfaces:**
- Consumes: `STYLE_SLUGS`, `StyleSlug` (plan 1).
- Produces (`#modules/artists/styles`): `export const MAX_PHOTO_STYLES = 3`; `export const STYLE_SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/`.
- Produces (model `ArtistWorkPhoto`, regenerated): `styles: string[]`, `healed: boolean`; no `position`.
- Produces (`WorkPhotoService`, `MAX_WORK_PHOTOS = 100`):
  - `list(tenant, artist): Promise<ArtistWorkPhoto[]>`: newest first.
  - `forArtists(tenant, artistIds: readonly string[], perArtist: number): Promise<Map<string, ArtistWorkPhoto[]>>`: each artist's `perArtist` newest, newest first, one query (`row_number() over (partition by artist_id order by created_at desc, id desc) <= perArtist`), none for `[]`.
  - `export type WorkPhotoDetails = { alt: string | null; styles: readonly StyleSlug[]; healed: boolean }`; `updateDetails(tenant, editor: ProfileEditor, photo: ArtistWorkPhoto, details: WorkPhotoDetails): Promise<ArtistWorkPhoto>` (replaces `describe`; same lock and re-check; alt trimmed, empty is null; styles stored as given).
  - `add`, `findEditable`, `remove` keep their signatures (`remove` no longer compacts); `move` and `describe` are gone.
- Produces (HTTP): `PUT /t/:tenant/artists/photos/:id` (`tenant.artists.photos.update`) takes `alt`, `styles[]` (slugs) and `healed` (`"1"` when ticked; missing is false, missing `styles` is `[]`) through `updateWorkPhotoValidator` (replaces `describeWorkPhotoValidator`), flashes "Photo saved."; `tenant.artists.photos.move` no longer exists.
- Produces (edit page prop): `workPhotos: { id: string; thumbnailUrl: string; alt: string | null; styles: string[]; healed: boolean }[]`, newest first (`styles` are the stored slugs, unknown ones included, like plan 1's form).
- Produces (test helper): `addWorkPhoto(tenant, artist, over?: Partial<{ alt: string | null; key: string; width: number; height: number; styles: string[]; healed: boolean; createdAt: DateTime }>)`.

- [ ] **Step 1: Set up the worktree**

The coordinator created the worktree and branch on plan 1's tip.

```bash
cd /home/blank/Coding/tattoo-drip-wt/site-2 && PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile
```

Then `pnpm migrate` in `apps/platform` with the Global Constraints' environment.
Expected: nothing to migrate (plan 1 migrated `tattoo_drip_site`); `git status` clean.

- [ ] **Step 2: Write the failing tests**

`work_photo_service.spec.ts` (replace the six-photo and move tests; keep every lock, race, file and isolation test, adapted to dates):
- "an owner adds photos, the newest listed first; the 101st is refused before it is decoded": seed `MAX_WORK_PHOTOS - 1` rows with `addWorkPhoto` (`createdAt` one second apart, in the past), `add` one real upload: `list()[0].id` is the new photo and `list()` has 100 items; the next `add` rejects with `WorkPhotoLimitError` and `images.keys.length` is unchanged.
- "two uploads racing for the 100th place: the second is refused under the lock and its file is deleted": the existing race test with 99 seeded rows.
- "updateDetails stores the description, the styles as given and the healed mark; empty text becomes null": `{ alt: "  Koi  ", styles: ["realism", "blackwork"], healed: true }` reads back `"Koi"`, `["realism", "blackwork"]`, `true`; then `{ alt: "", styles: [], healed: false }` reads back `null`, `[]`, `false`.
- "the database refuses a fourth style": a raw update setting 4 slugs throws, the message naming `artist_work_photos_styles_max`.
- "remove deletes the file and its copies first, then the row; the other photos keep their dates".
- "updateDetails and remove by an artist unlinked meanwhile are refused too" (the old describe/move/remove test without move).
- "forArtists reads each listed artist's newest perArtist photos, newest first, in one query, and none for no artists": artist A with 8 photos and B with 2, `forArtists(tenant, [A, B], 6)`: A's 6 newest in order, B's 2; `forArtists(tenant, [], 6)` is an empty map with no query (the existing query-count approach).

`work_photos_http.spec.ts` (drop the move test; "the rest move up" leaves the removal test):
- "an owner saves a photo's description, two styles and the healed mark": fields `alt` "Koi", `styles[]` "realism", `styles[]` "blackwork", `healed` "1": redirect to the edit page, flash success "Photo saved.", the row holds all three.
- "a save without style boxes or the healed box clears them".
- "a fourth style is a field error and changes nothing": error on `styles` is "Pick up to 3 styles.".
- "an unknown style is a field error and changes nothing" (assert the same error key plan 1's artist-form test settled on).
- "the 101st photo gets a field error and stores nothing": 100 seeded rows, the upload's error on `photo` is "This artist already has 100 photos. Remove one to add another.", no new file.
- "the move route is gone": `POST /t/<slug>/artists/photos/<id>/move` is a 404.
- "the edit page lists the photos newest first with their styles and healed mark": `workPhotos` ids in newest-first order, each with exactly `["alt", "healed", "id", "styles", "thumbnailUrl"]`.

`public_artists.spec.ts`:
- "work photos are the six newest, newest first, with exactly url, width, height, alt and variants": 8 photos give 6 whose URLs hold the keys of the 6 newest, in order; still no id, key, position, styles, healed or timestamp.
- The ETag test becomes "adding a photo or saving its details changes the list's ETag".

`photos_copy.spec.ts`: the limit is 100 and the server's; `photoCount(37)` is "37 of 100 photos" and the strings built from the limit say 100; `moves` and `moveLabel` are gone from the module's shape.

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=work_photo_service.spec.ts --files=work_photos_http.spec.ts --files=public_artists.spec.ts` and `PORT=3402 pnpm test unit --files=photos_copy.spec.ts`
Expected: FAIL on the new tests (101st accepted at 6, unknown `updateDetails`, no `styles` column).

- [ ] **Step 4: Write the migration**

`up`, in this order: (1) give existing photos matching dates, as the owner:
```sql
update artist_work_photos p
set created_at = m.newest - p.position * interval '1 second'
from (select tenant_id, artist_id, max(created_at) as newest
      from artist_work_photos group by tenant_id, artist_id) m
where p.tenant_id = m.tenant_id and p.artist_id = m.artist_id
```
(2) drop `artist_work_photos_position_unique`, `artist_work_photos_position_range` and the `position` column; (3) add `styles varchar(40)[] not null default '{}'` with check `artist_work_photos_styles_max` (`cardinality(styles) <= 3`) and `healed boolean not null default false`; (4) indexes `artist_work_photos_newest` on `(tenant_id, created_at, id)` and `artist_work_photos_artist_newest` on `(tenant_id, artist_id, created_at, id)`. `down` raises "artist_work_photos: an artist has more than 6 photos; remove some before rolling back" when any artist has more than 6, else restores `position` as `row_number() - 1` over `created_at desc, id desc` per artist with both constraints, and drops what `up` added. The file's doc comment says why the dates were rewritten.

- [ ] **Step 5: Implement the service, validator, controller, routes and props**

Service per Interfaces; `MAX_WORK_PHOTOS` comment: the count under the artist's row lock is now the only guard (the database no longer holds the limit). Validator: `styles: vine.array(vine.enum(STYLE_SLUGS)).distinct().maxLength(MAX_PHOTO_STYLES).optional()`, `healed: vine.boolean().optional()`, `alt` unchanged; messages `"styles.array.maxLength": "Pick up to 3 styles."` (VineJS's key for an array's length, as plan 1 found) and plan 1's handling of an unknown style: plan 1 built a private `ArtistErrorReporter` in `#modules/artists/validators/artist` that moves `styles.<n>` errors to `styles` with "Pick styles from the list."; export it under the name `StylesErrorReporter` and use it for `updateWorkPhotoValidator` too, so both forms behave the same. Remove the move route, its `TENANT_ROUTE_ROLES` entry, its isolation case (`workPhotoRows` orders by `created_at`, then `id`) and its line in `role_access.spec.ts`'s `ARTIST_ROUTES`; the PUT case's body becomes `{ alt: "Koi on the forearm", styles: ["blackwork"], healed: "1" }`. `StudioPageService` passes `6` to `forArtists`. Contract: `Artist.workPhotos` says "The artist's six newest photos, newest first; [] when none. An artist who is closed for inquiries still shows theirs. All of them are in `listWork`." and `WorkPhoto` "the list's order is newest first"; regenerate. Tray: delete the move buttons; `photos.ts` sets `MAX_WORK_PHOTOS = 100` and drops `moves` / `moveLabel`. Update the helpers and the tests that named `position`. Run `node ace codegen`.

- [ ] **Step 6: Migrate, checking the order of existing photos (Review Focus 1)**

Before migrating, as the owner (`podman exec -i tattoo-drip_postgres_1 psql -U postgres -d tattoo_drip_site -c "..."`):
```sql
insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, position, alt, created_at)
select a.tenant_id, a.id, 'tenants/' || a.tenant_id || '/artist_work_photo/order-check-' || v.p || '.jpg',
       100, 100, v.p, 'order-check ' || v.p, now() - v.age * interval '1 minute'
from (select tenant_id, id from artists
      where deleted_at is null
        and not exists (select 1 from artist_work_photos w where w.artist_id = artists.id)
      limit 1) a,
     (values (0, 3), (1, 1), (2, 2)) v(p, age)
```
Run `pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`. Then `select alt from artist_work_photos where alt like 'order-check %' order by created_at desc, id desc`.
Expected: `order-check 0`, `order-check 1`, `order-check 2` (the upload order was 0, 2, 1). Delete the three rows. If the insert added 0 rows (no artist in the database), say so in the task report. Then `pnpm migrate:rollback` and `pnpm migrate` again: both succeed and `git diff database/schema.ts` is empty afterwards.

- [ ] **Step 7: Run the tests to verify they pass**

Run: the commands of Step 3, plus `--files=artist_form.spec.ts --files=artist_work_photos.spec.ts --files=image_service.spec.ts --files=role_access.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add apps/platform packages/types
git commit -m "feat(platform): work photos newest first, up to 100, with styles and a healed mark"
```

### Task 2: The dashboard tray: several photos at once, a grid and a details sheet

**Files:**
- Modify: `apps/platform/inertia/components/photos.ts` (words and small rules)
- Modify: `apps/platform/inertia/components/work_photo_tray.tsx` (the grid and its one sheet; keeps the `window.confirm` exemption in `inline_confirms_source.spec.ts`)
- Create: `apps/platform/inertia/components/work_photo_upload.tsx`
- Modify: `apps/platform/inertia/pages/artists/form.tsx` (passes `styleOptions` to the tray)
- Test: `apps/platform/tests/unit/inertia/photos_copy.spec.ts`

**Interfaces:**
- Consumes: the edit page's `workPhotos` (Task 1) and `styleOptions` (plan 1); routes `tenant.artists.photos.store` (unchanged: one `photo` per request), `.update`, `.destroy`.
- Produces: `WorkPhotoTray({ tenantSlug, artistId, photos, styleOptions })`; `WorkPhotoUpload({ tenantSlug, artistId, room })`; in `photos.ts`: `WorkPhotoProps` (Task 1's shape), `MAX_PHOTO_STYLES = 3`, and the functions tested below.

- [ ] **Step 1: Write the failing unit tests** in `photos_copy.spec.ts` (extend `PhotosModule`)

```ts
assert.equal(photos.uploadingPhotos(1, 1), "Uploading…");
assert.equal(photos.uploadingPhotos(1, 1, 40), "Uploading… 40%");
assert.equal(photos.uploadingPhotos(2, 5), "Uploading 2 of 5…");
assert.equal(photos.uploadingPhotos(2, 5, 40), "Uploading 2 of 5… 40%");
assert.equal(photos.roomNote(3, 5), "There's room for 3 more photos. Choose 3 or fewer.");
assert.equal(photos.roomNote(1, 2), "There's room for 1 more photo. Choose 1.");
assert.isNull(photos.roomNote(5, 5));
assert.equal(photos.addedLine(1, 0), "1 photo added.");
assert.equal(photos.addedLine(5, 0), "5 photos added.");
assert.equal(photos.addedLine(4, 1), "4 photos added. This one couldn't be added:");
assert.equal(photos.addedLine(3, 2), "3 photos added. These 2 couldn't be added:");
assert.equal(photos.addedLine(0, 1), "This photo couldn't be added:");
assert.equal(photos.addedLine(0, 3), "These 3 photos couldn't be added:");
assert.equal(photos.failureLine("IMG_2.heic", "Use a JPEG, PNG or WebP image."), "IMG_2.heic: Use a JPEG, PNG or WebP image.");
assert.equal(photos.editLabel(3, null), "Edit photo 3");
assert.equal(photos.editLabel(3, "Koi"), "Edit photo 3: Koi");
assert.equal(photos.tileNote(2, true), "2 styles · Healed");
assert.equal(photos.tileNote(1, false), "1 style");
assert.equal(photos.tileNote(0, true), "Healed");
assert.isNull(photos.tileNote(0, false));
assert.equal(photos.TRAY_FULL, "That's 100 photos, the most an artist can show. Remove one to add another.");
assert.equal(photos.trayIntro(true), "Up to 100 photos of this artist's work. Your page shows them newest first: on the artist's page, in Recent work and in All work.");
assert.equal(photos.trayIntro(false), "Up to 100 photos of your work. The studio page shows them newest first: on your page, in Recent work and in All work.");
assert.equal(photos.TRAY_CREATE_NOTE, "Once the artist is saved, you can add up to 100 photos of their work here.");
```
Plus `MAX_PHOTO_STYLES` is 3 and equals the server's (`#modules/artists/styles`).

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 pnpm test unit --files=photos_copy.spec.ts`
Expected: FAIL (`uploadingPhotos` is not a function).

- [ ] **Step 3: Implement the words** in `photos.ts`, plus `UPLOAD_LABEL = "Add photos"`, `UPLOAD_HELP = "Choose one or more. JPEG, PNG or WebP, up to 10 MB each. Photos from a phone work as they are."`, `STYLES_HELP = "Up to 3."`, `HEALED_LABEL = "Healed"`, `HEALED_HELP = "The photo shows the tattoo once it healed."`.

- [ ] **Step 4: Implement the upload and the tray**

`WorkPhotoUpload`: a `Field` with a `multiple` file input (`accept={PHOTO_ACCEPT}`, label `UPLOAD_LABEL`) and an "Upload photos" button. On submit: if more files are chosen than `room`, show `roomNote` as the field error and send nothing. Otherwise send the files **one request each, in the order chosen, the next only after the previous finishes**: `router.post(urlFor("tenant.artists.photos.store", …), { photo: file }, { forceFormData: true, preserveScroll: true, preserveState: true, onError, onFinish })` (one photo per request keeps every request under the 20 MB limit with no resizing; Inertia cancels a visit when another starts, so they cannot overlap). The button shows `uploadingPhotos(n, total, percentage)` and is disabled while sending. A refused file is recorded with `failureLine(file.name, errors.photo)` and the queue goes on; a cancelled visit stops it. Afterwards a `role="status"` region shows `addedLine` and the failure lines (`wrap-anywhere`), and the input is cleared. With `room` 0 the tray shows `TRAY_FULL` instead.

`WorkPhotoTray`: the upload first, then `photoCount`, then the photos newest first as a grid (3 columns, 4 from `sm`, 6 from `lg`) of buttons, each the 320 px thumbnail (`loading="lazy"`, `width`/`height` 96, `alt` from `photoAlt`), `aria-label` `editLabel(n, alt)`, and `tileNote` under it when not null. A tile opens the tray's **one** `Sheet` (`components/ui/sheet.tsx`, mounted once, the photo in state; it closes when that photo is gone) holding the larger thumbnail and one `<Form route="tenant.artists.photos.update">` keyed by the photo id and its stored values: "Description (optional)" (the TAT-116 input and help), a "Styles" `FieldSet` (one `Checkbox` per `styleOptions` entry, `name="styles[]"`, two columns from `sm`, description `STYLES_HELP`), a `HEALED_LABEL` checkbox (`name="healed"`, `value="1"`, description `HEALED_HELP`), "Save photo" (closes the sheet on success; a refusal keeps it open with the error under its field), and "Remove photo" (`window.confirm(REMOVE_PHOTO_QUESTION)`, then `router.delete`, closing on success). Shadcn components and tokens only, controls 44 px below `lg` by the components. Run `node ace codegen`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test unit --files=photos_copy.spec.ts --files=inline_confirms_source.spec.ts --files=tap_targets.spec.ts`, then `pnpm typecheck`
Expected: PASS and clean. (The grid, the sheet and the queue are checked in Task 8's browser pass.)

- [ ] **Step 6: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): upload several work photos at once and tag their styles and healed mark"
```

### Task 3: The paged read of photos

**Files:**
- Create: `apps/platform/app/modules/artists/work_cursor.ts`
- Modify: `apps/platform/app/modules/artists/services/work_photo_service.ts` (`page`, `facets`)
- Test: `apps/platform/tests/unit/modules/artists/work_cursor.spec.ts` (new), `apps/platform/tests/functional/artists/work_photo_service.spec.ts` (new group "the paged read")

**Interfaces:**
- Produces (`#modules/artists/work_cursor`): `export type WorkCursor = { at: string; id: string }` where `at` is the photo's `created_at` in UTC with microseconds (`2026-10-30T04:05:06.123456Z`, exactly six digits); `encodeWorkCursor(cursor: WorkCursor): string` (base64url of `` `${at}~${id}` ``, no padding); `decodeWorkCursor(text: string): WorkCursor | null` (null for anything that is not exactly that shape with a lowercase UUID).
- Produces (`WorkPhotoService`):
  - `export type WorkFilter = { artistIds: readonly string[]; style: string | null; healed: boolean }`
  - `page(tenant, filter: WorkFilter, after: WorkCursor | null, limit: number): Promise<{ photos: ArtistWorkPhoto[]; next: WorkCursor | null }>`: newest first; `next` is the last returned photo's cursor when more remain, else null; no query for `artistIds` `[]`.
  - `facets(tenant, artistIds: readonly string[]): Promise<{ styles: string[]; healed: boolean }>`: the distinct style slugs those artists' photos carry (raw, unordered: the caller orders and filters them) and whether any is healed; one query on `dbClient()` (never the `db` service), none for `[]`.

- [ ] **Step 1: Write the failing tests**

`work_cursor.spec.ts`:
- "a cursor goes there and back": `decodeWorkCursor(encodeWorkCursor(c))` deep-equals `c` for `{ at: "2026-10-30T04:05:06.123456Z", id: "0199f000-0000-7000-8000-000000000001" }`, and the text matches `/^[A-Za-z0-9_-]+$/`.
- "anything else is null": `""`, `"abc"`, base64url of `"x~y"`, of a 3-digit-fraction time with a good id, of a good time with `"not-a-uuid"`, of an uppercase UUID, and a 201-character string.

`work_photo_service.spec.ts`, "the paged read":
- "page lists the given artists' photos newest first; nothing and no query for no artists".
- "paging by cursor visits every photo once, also across photos created in the same instant": 5 photos, 3 sharing one `createdAt`, `limit` 2: three pages of 2, 2, 1 whose ids, joined, are all 5 in `created_at desc, id desc` order, the last `next` null.
- "a photo removed between pages: the next page still starts after the cursor".
- "style and healed filter, and combine": photos tagged `["realism"]`, `["realism", "blackwork"]` healed, `[]` healed: `style: "realism"` gives 2, `healed: true` 2, both 1.
- "facets: the styles the given artists' photos carry and whether one is healed; another artist's are not counted; none for no artists".
- "another tenant's photos never appear, from this tenant's context" (`inTenant` of the other studio).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test unit --files=work_cursor.spec.ts > /tmp/site2-red.log 2>&1`, then `PORT=3402 pnpm test functional --files=work_photo_service.spec.ts`
Expected: exit 124 with "Cannot find module '#modules/artists/work_cursor'"; FAIL on the new group.

- [ ] **Step 3: Implement**

`page` builds one model query: `where tenant_id`, `whereIn artist_id`, `styles @> array[?]::varchar[]` when a style is set, `healed = true` when asked, `(created_at, id) < (?::timestamptz, ?::uuid)` after a cursor, `order by created_at desc, id desc`, `limit + 1`, and selects `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at` (read from `$extras`): the instant leaves and returns as Postgres text, so no millisecond rounding can skip a photo. `facets` is `array_agg(distinct style) filter (where style is not null)` over `left join lateral unnest(styles)` plus `coalesce(bool_or(healed), false)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the two commands of Step 2 without `timeout`
Expected: PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): read work photos a page at a time with filters and a cursor"
```

### Task 4: The contract, the SDK and the React hooks

**Files:**
- Modify: `packages/types/openapi.yaml`; regenerate `packages/types/src/openapi.gen.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/sdk/src/client.ts`; `packages/react/src/queries.ts`, `hooks.ts`, `index.ts`
- Modify: `docs/sdk.md` ("Public API by stage" and the studio page paragraph)
- Test: `packages/sdk/test/client.test.ts`, `packages/react/test/lists.test.ts`

**Interfaces:**
- Produces (contract): `listWork` replaces `listPortfolio`; `PortfolioProject` is removed; `listStyles` is tagged `MVP`. New schemas `GalleryPhoto` and `WorkFilters` (below).
- Produces (types): `GalleryPhoto`, `WorkFilters`, `ListWorkQuery` (`NonNullable<operations["listWork"]["parameters"]["query"]>`), `WorkPage` (its 200 body); `PortfolioProject`, `ListPortfolioQuery`, `PortfolioPage` are gone.
- Produces (SDK): `client.work.list(query?: ListWorkQuery, call?: RequestOptions): Promise<WorkPage>` (the whole body, like `listPortfolio` did); `client.portfolio` is gone; the query encoder takes booleans (`true` is sent as `true`).
- Produces (React): `tattooKeys.work(tenant, query?)` = `[...tattooKeys.tenant(tenant), "work", query ?? {}]`; `tattooQueries.work(client, query?)` (no `staleTime`, like `artists`); `useWork(query?)`; `portfolio` and `usePortfolio` are gone.

- [ ] **Step 1: Write the failing tests**

`client.test.ts` (replaces the portfolio test):
- "work.list sends the filters like a form and returns the whole page": `work.list({ artist: "sita", style: "fine-line", healed: true, cursor: "next page", limit: 12 })` calls `${T}/work?artist=sita&style=fine-line&healed=true&cursor=next+page&limit=12` with `credentials` `"omit"`, and resolves to the body `{ data: [], nextCursor: null, filters: { styles: [], healed: false } }` as it is.
- "work.list() asks for the first page with no question mark": `${T}/work`.

`lists.test.ts` ("tattooQueries.services, work and availability"): `tattooQueries.work(client).queryKey` is `[...tenant, "work", {}]`, with `{ artist: "sita", healed: true }` it ends in that object; fetching it through a `QueryClient` calls `/work` once and gives the whole page.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/sdk test` and `pnpm --filter @tattoo-drip/react test`
Expected: FAIL (`work` is undefined).

- [ ] **Step 3: Change the contract and regenerate**

```yaml
/tenants/{tenant}/work:
  parameters: [{ $ref: "#/components/parameters/Tenant" }]
  get:
    operationId: listWork
    tags: [MVP]
    summary: Photos of the studio's work, newest first, a page at a time
    # description: every photo of every visible artist (a closed artist's too), newest first;
    # filters combine; an artist or style that matches nothing is an empty page; cacheable;
    # under an old studio slug it answers like under the current one.
    parameters:
      - { name: artist, in: query, description: An artist's slug (getArtist), schema: { type: string, pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$" } }
      - { name: style, in: query, description: A style's slug (listStyles), schema: { type: string, maxLength: 40, pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" } }
      - { name: healed, in: query, description: "`true`: only photos marked healed. Leave it out for all.", schema: { type: boolean } }
      - { name: cursor, in: query, description: The previous page's `nextCursor`, as sent, with the same filters, schema: { type: string, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" } }
      - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 48, default: 24 } }
    responses:
      "200": # headers CacheControl and ETag; body, additionalProperties false:
        # required [data, nextCursor, filters]
        # data: array of GalleryPhoto, maxItems 48
        # nextCursor: [string, "null"], "Pass it as `cursor` for the next page; null on the last."
        # filters: WorkFilters
      "304": NotModified
      "422": ValidationError   # a malformed parameter or cursor: `validation_failed` with `fields`
      "404": NotFound
      "429": RateLimited
      default: Error
```
`GalleryPhoto` (additionalProperties false, every property required): `url`, `width`, `height`, `alt`, `variants` exactly as `WorkPhoto`; `styles`: array of `TattooStyle`, `maxItems: 3`, "The photo's styles from the platform's list, in the list's order; [] when none."; `healed`: boolean; `artist`: object `{ slug, name }` (required, additionalProperties false), "Whose work it is: the artist's page is `getArtist(slug)`.". `WorkFilters` (required `[styles, healed]`): `styles` (array of `TattooStyle`), "The styles at least one photo carries, among the visible artists' photos (only `artist`'s when it is given), in the list's order: offer only these."; `healed`: "Whether one of those photos is marked healed.". Remove `/tenants/{tenant}/portfolio` and `PortfolioProject`; `listStyles` gets `tags: [MVP]` and the description "The platform's fixed list of tattoo styles, in its order. Cacheable."; set `TattooStyle`'s name example to `Fine line`. Run `pnpm --filter @tattoo-drip/types generate`.

- [ ] **Step 4: Implement the types, SDK and hooks** per Interfaces, and update `docs/sdk.md`: the MVP row adds `work.list` and `styles.list`, the V1 row drops `portfolio` and `styles`; one paragraph after the artists one: `client.work.list({ artist?, style?, healed?, cursor?, limit? })` gives `{ data, nextCursor, filters }`, newest first, 24 a page (at most 48), cached for 60 seconds, a malformed cursor is `validation_failed`; React `useWork(query)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, then `pnpm typecheck` (root)
Expected: PASS and clean (the platform and storefront use none of the removed names).

- [ ] **Step 6: Commit**

```bash
git add packages docs/sdk.md
git commit -m "feat(types): listWork replaces the portfolio sketch, listStyles is real"
```

### Task 5: The public `/work` and `/styles` endpoints

**Files:**
- Create: `apps/platform/app/modules/storefront/validators/work.ts`
- Create: `apps/platform/app/controllers/public_work_controller.ts`, `apps/platform/app/controllers/public_styles_controller.ts`
- Create: `apps/platform/app/transformers/public_gallery_photo_transformer.ts`, `apps/platform/app/transformers/public_style_transformer.ts`
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts` (`work`)
- Modify: `apps/platform/start/routes.ts`; regenerate `apps/platform/.adonisjs/`
- Modify: `apps/platform/tests/isolation/public_cases.ts`
- Test: `apps/platform/tests/functional/api/public_work.spec.ts` (new), `apps/platform/tests/functional/api/public_styles.spec.ts` (new), `apps/platform/tests/functional/storefront/studio_page_service.spec.ts`

**Interfaces:**
- Consumes: `page`, `facets`, `WorkCursor`, `encodeWorkCursor`, `decodeWorkCursor` (Task 3); `knownStyles`, `TattooStyleRef`, `TATTOO_STYLES`, `STYLE_SLUG_SHAPE` (plan 1, Task 1); the contract (Task 4).
- Produces (`#modules/storefront/validators/work`): `listWorkValidator` (`artist` the contract's slug pattern, `style` `maxLength(40)` + `STYLE_SLUG_SHAPE`, `healed` `vine.boolean()`, `cursor` `maxLength(200)` + `/^[A-Za-z0-9_-]+$/`, `limit` whole number 1 to 48, all optional), `WORK_PAGE_SIZE = 24`, `MAX_WORK_PAGE = 48`, `CURSOR_MESSAGE = "Pass a nextCursor exactly as the previous page sent it."`.
- Produces (`StudioPageService`): `export type WorkQuery = { artist: string | null; style: string | null; healed: boolean; cursor: WorkCursor | null; limit: number }`; `export type ShownGalleryPhoto = ShownWorkPhoto & { styles: TattooStyleRef[]; healed: boolean; artist: { slug: string; name: string } }`; `export type ShownWorkPage = { photos: ShownGalleryPhoto[]; nextCursor: string | null; filters: { styles: TattooStyleRef[]; healed: boolean } }`; `work(tenant: Tenant, query: WorkQuery): Promise<ShownWorkPage>`: `listVisible` once (names, slugs, ids), narrowed to the exact `artist` slug when given (no match: an empty page and empty filters with no photo query), then `page` and `facets`; styles through `knownStyles`.
- Produces (routes): `GET /api/v1/tenants/:tenant/work` (`api.v1.work.index`, tenant group, `publicCache()`), `GET /api/v1/styles` (`api.v1.styles.index`, outer group, `publicCache()`).

- [ ] **Step 1: Write the failing tests**

`public_work.spec.ts` (with `assertApiData` / `assertApiError`, `addArtist`, `addWorkPhoto`):
- "lists every visible artist's photos newest first with exactly the documented fields": body keys exactly `["data", "filters", "nextCursor"]`; each item exactly `["alt", "artist", "healed", "height", "styles", "url", "variants", "width"]`; `artist` exactly `["name", "slug"]`; `filters` exactly `["healed", "styles"]`; never an id, key, artist id or timestamp.
- "a closed artist's photos are listed; a hidden or deleted artist's are in no page, no filter and no artist= answer" (Review Focus 2): a hidden artist's photo tagged `cover-up` and healed: absent from `data`, `filters.styles` lacks `cover-up`, and `?artist=<hidden slug>` is `{ data: [], nextCursor: null, filters: { styles: [], healed: false } }`.
- "pages by cursor: limit 2 over 5 photos gives 2, 2 and 1, the last with nextCursor null".
- "filters by artist, style and healed, and they combine; an unknown style is an empty page with the usual filters".
- "a style that left the list is dropped from the photo and from the filters": stored `["realism", "retired-style"]` gives `styles` `[{ slug: "realism", name: "Realism" }]`.
- "a malformed cursor, artist, style or limit is validation_failed with that field" (Review Focus 3): `cursor=!!`, `cursor=<base64url of "x~y">`, `artist=Sita`, `style=Fine%20line`, `limit=0`, `limit=49`, each a 422 with `fields` holding the parameter; the decoded-but-wrong cursor's message is `CURSOR_MESSAGE`.
- "is cacheable: public, an ETag and a 304; HEAD the same", and "under an old studio slug, answers like under the current one".

`public_styles.spec.ts`: "lists the 18 styles in the list's order as slug and name, cacheable, under no studio": 18 items, the first `{ slug: "blackwork", name: "Blackwork" }`, each exactly `["name", "slug"]`, `Cache-Control` public.

`studio_page_service.spec.ts`: "work names each photo's artist and orders the filters' styles as the list does".

`public_cases.ts`: a GET case for `/api/v1/tenants/:tenant/work`, `ownStatus` 200, `ownMarkers` `[own.artistProfile.slug]` (`twoStudios` seeds two of that artist's photos), snapshot of the studio's work photo rows.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=public_work.spec.ts --files=public_styles.spec.ts --files=studio_page_service.spec.ts`
Expected: FAIL (404 for both paths).

- [ ] **Step 3: Implement**

`PublicWorkController.index`: `publicTenantContext`, `validateUsing(listWorkValidator)` (the query string), `decodeWorkCursor` (a cursor that passes the validator but decodes to null throws `errors.E_VALIDATION_ERROR` with field `cursor` and `CURSOR_MESSAGE`), `pages.work(...)` with `limit ?? WORK_PAGE_SIZE`, then the envelope `{ data, nextCursor, filters }`: `ctx.serialize` wraps only `data`, so spread its result and add the two keys; the transformer writes every field out (`{ slug, name }`, `{ url, width }`). `PublicStylesController.index` serializes `TATTOO_STYLES` through `PublicStyleTransformer`. Route comments in the existing style; run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=public_api.spec.ts --files=api_routes.spec.ts --files=public_artists.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): the public work read with filters and paging, and the style list"
```

### Task 6: The storefront's All work page and each artist's portfolio

**Files:**
- Create: `apps/storefront/src/studio/gallery.ts` (pure: view model and search reading)
- Create: `apps/storefront/src/studio/components/gallery.tsx` (stateless: grid, viewer, filters)
- Create: `apps/storefront/src/studio/paging.tsx` (the one stateful island: Show more)
- Create: `apps/storefront/src/routes/work.tsx`; regenerate `apps/storefront/src/routeTree.gen.ts`
- Modify: `apps/storefront/src/studio/links.ts`, `loaders.ts`, `seo.ts`, `copy.ts`, `components/pages.tsx`, `components/artists.tsx` (remove `WorkGrid`), `theme/registry.tsx`, `src/routes/artists/$slug.tsx`, `src/api/context.ts`, `src/styles.css`, `scripts/check-page.mjs`
- Test: `apps/storefront/test/studio/gallery.test.ts` (new), `fixtures.ts`, `loaders.test.ts`, `render.test.ts`, `seo.test.ts`, `lightbox.test.ts`

**Interfaces:**
- Consumes: `useWork`'s query options `tattooQueries.work`, `ListWorkQuery`, `WorkPage` (Task 4); `readBrandImage`, `largeSource`, `workGridSizes`, `cleanLine`, `fill`.
- Produces (`gallery.ts`):
  - `GalleryPhotoView extends WorkPhotoView` (from `view-model.ts`) with `openId: string` (`work-open-{n}`), `artist: { name: string; href: string } | null`, `styles: readonly string[]` (names), `healed: boolean`; `dialogId` is `work-photo-{n}`, `label` "Photo {n}".
  - `GalleryView = { photos: readonly GalleryPhotoView[]; nextCursor: string | null; styles: readonly { slug: string; name: string }[]; healed: boolean }`; `EMPTY_GALLERY`.
  - `RECENT_WORK_COUNT = 9`, `WORK_PAGE_SIZE = 24`, `MAX_GALLERY_PAGE = 48`.
  - `galleryView(page: unknown, imageOrigin: string | null, offset = 0): GalleryView`
  - `PortfolioSearch = { healed?: true; cursor?: string }`, `WorkSearch = PortfolioSearch & { artist?: string; style?: string }` (absent keys, never null, so the router writes nothing back).
  - `readPortfolioSearch(search: Record<string, unknown>): PortfolioSearch`, `readWorkSearch(search: Record<string, unknown>): WorkSearch`
  - `workQuery(search: WorkSearch, limit: number): ListWorkQuery` (keys in the order `artist, style, healed, cursor, limit`, absent ones left out).
- Produces (`links.ts`): `workHref(search: WorkSearch): string`, `portfolioHref(slug: string, search: PortfolioSearch): string`.
- Produces (`loaders.ts`): `ArtistPageData.portfolio: { gallery: GalleryView; search: PortfolioSearch }`; `artistPageData(studio, artists, slug, origin, imageOrigin = null, portfolio = { page: null, search: {} })`; `loadArtistPage(context, slug, search: PortfolioSearch)` (studio, artists and `{ artist: slug, …search, limit: 24 }` in parallel); `WorkPageData = { studio; theme; seo; artists: readonly { slug: string; name: string }[]; search: WorkSearch; gallery: GalleryView }` (`artists`: the visible ones with at least one work photo, by name); `workPageData(studio, artists, page, search, origin, imageOrigin = null)`; `loadWorkPage(context, search: WorkSearch)`; `moreWork(context: ApiContext, query: ListWorkQuery, cursor: string, offset: number, imageOrigin: string | null): Promise<GalleryView>` (the browser's Show more, `queryClient.fetchQuery`). On `/work`, a work read's API 404 `not_found` or 422 `validation_failed` (a hand-edited cursor) becomes the router's not-found. On an artist's page, only a 422 `validation_failed` from the address's own `cursor` / `healed` becomes the not-found; any other failure of the portfolio read (404 from an older platform, 5xx, network) shows the artist page without the Work section, never an error page (spec anti-goal: never harder to reach the studio).
- Produces (components): `GalleryGrid({ photos, showArtist })`; `PagedGallery({ first, showArtist, moreHref: (cursor: string) => string, more?: (cursor: string, offset: number) => Promise<GalleryView> })` in `paging.tsx`; `WorkPage({ data, more? })` and `ThemedWorkPage`; `ArtistPage` gains an optional `more` prop; `seo.ts` `workPageSeo(studio: StudioView, origin: string): PageSeo`.

- [ ] **Step 1: Write the failing tests**

`fixtures.ts`: `galleryPage(count, over?)`: a `WorkPage` of `count` photos by Sita (`artist: { slug: "sita", name: "Sita Rai" }`, on the API's origin with copies, the first tagged `[{ slug: "fine-line", name: "Fine line" }]` and healed), `nextCursor` null, `filters: { styles: [fine-line], healed: true }`.

`gallery.test.ts`:
- "a page becomes photos with the artist, style names and the healed mark": photo 1 has `artist` `{ name: "Sita Rai", href: "/artists/sita" }`, `styles` `["Fine line"]`, `healed` true, `alt` "Tattoo by Sita Rai, photo 1", `label` "Photo 1", `dialogId` "work-photo-1", `openId` "work-open-1", a `srcSet`; the view's `styles` and `healed` come from `filters`.
- "an offset continues the numbering": `galleryView(page, origin, 24).photos[0].dialogId` is "work-photo-25".
- "an older or broken answer is an empty gallery" (Review Focus 4): `undefined`, `null`, `"x"`, `{}` each give `EMPTY_GALLERY`; a page without `filters` gives `styles: []` and `healed: false`; a `nextCursor` with a space is null.
- "a photo from another origin is dropped; one without a usable artist keeps its photo, without a link, and its alt is 'Tattoo, photo n'"; "at most 3 style names, malformed ones dropped"; "at most 48 photos are read".
- "the address's filters are read strictly": `readWorkSearch({ artist: "sita", style: "fine-line", healed: 1, cursor: "abc_-" })` keeps all four (`healed: true`); `healed` `"1"` and `true` are on, `"on"`, `0` and `"true "` off; `artist: "Sita"`, `style: "Fine line"`, `cursor: "a b"`, `""` and non-strings are dropped.
- "workHref and portfolioHref keep the filters": `workHref({ artist: "sita", healed: true })` is "/work?artist=sita&healed=1", with `cursor: "c2"` it ends "&cursor=c2", `workHref({})` is "/work"; `portfolioHref("sita", { healed: true, cursor: "c2" })` is "/artists/sita?healed=1&cursor=c2#work", `portfolioHref("sita", {})` is "/artists/sita#work"; each passes `isAllowedHref`.

`loaders.test.ts` (the `listing()` fake also answers `/work` with an empty page):
- "the artist page asks for that artist's newest 24, healed ones when asked": URLs end `/work?artist=sita&limit=24` and `/work?artist=sita&healed=true&limit=24`.
- "/work reads the artists and the first page with the address's filters", and "a 422 validation_failed from the work read is a not-found".
- "an artist page whose portfolio read fails (404, 500, network) still renders, without the Work section"; "an artist page whose own cursor is garbled (422 validation_failed) is the not-found".

`render.test.ts` (the old artist-page work tests now pass a gallery page):
- "the artist page shows the whole portfolio with All and Healed": `<section id="work">` holds a `nav` labelled "Which photos" with `/artists/sita#work` (`aria-current="page"`) and `/artists/sita?healed=1#work`; with `filters.healed` false there is no `nav`.
- "Show more links to the next page with the same filter": `nextCursor` "c2" with `healed` gives `href="/artists/sita?healed=1&amp;cursor=c2#work"`; on a cursor page a "Back to the newest" link goes to `/artists/sita?healed=1#work`.
- "the viewer on /work names the artist with a link, the styles and Healed"; "on the artist's own page the viewer has no link to that page".
- "/work's filters show only what applies": one artist with photos means no artist select, no facet styles no style select, `healed` false and not asked no checkbox, none of them no `form`; the form is `method="get"` `action="/work"`, its selects preselect the address's values.
- "/work with no photos says 'No photos yet.' and links home"; "/work with filters and no match says 'No photos match these filters.' and links to /work".
- `assertSafePage` holds for both pages.

`seo.test.ts`: `workPageSeo` gives title "All work at Black Needle" ("All work by Sita Rai" for an independent studio), description "Tattoos by the artists of Black Needle, newest first." ("Tattoos by Sita Rai, newest first."), canonical `${ORIGIN}/work` whatever the filters, no image, no JSON-LD.

`lightbox.test.ts`: "Show more's focus move is the only DOM access outside lightbox.ts": `paging.tsx` holds exactly one `document.getElementById` and one `.focus()`, and no file under `src/studio/` other than `lightbox.ts` and `paging.tsx` contains `document.`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL (missing `gallery.ts`).

- [ ] **Step 3: Implement the view model, links, loaders and SEO**

Per Interfaces. `galleryView` reads each item through `readBrandImage` (origin, sides, copies), the alt through `cleanLine` (at most 200 characters, else the fallback), style names through `cleanLine`, `artist` only with an `ARTIST_SLUG` slug, `nextCursor` only when it matches `/^[A-Za-z0-9_-]{1,200}$/`. `hydrateApi` also keeps `tattooKeys.work(tenant)` (it prefixes every work key) for the page's lifetime. Copy, in `studioCopy.work`: `allWork` "All work", `pageTitle` "All work", `showMore` "Show more", `loadingMore` "Loading…", `moreFailed` "Couldn't load more photos. Try again.", `newest` "Back to the newest", `empty` "No photos yet.", `noMatch` "No photos match these filters.", `showAll` "Show all work", `noHealed` "No healed photos yet.", `healed` "Healed", `filterNav` "Which photos", `all` "All", `galleryAlt` "Tattoo by {name}, photo {n}", `galleryAltNoName` "Tattoo, photo {n}", `photoN` "Photo {n}", and `filters`: `label` "Filter the photos", `artist` "Artist", `anyArtist` "All artists", `style` "Style", `anyStyle` "All styles", `healedOnly` "Healed only", `apply` "Show photos".

- [ ] **Step 4: Implement the components and routes**

`GalleryGrid` is TAT-116's `WorkGrid` markup (`work-grid`, `work-open` with `id={openId}`, `work-photo`, the `<dialog>` with its Close form, the large copy and the caption) plus, under the caption, a `work-dialog-meta` block: the artist's name as a link (`<bdi>`; only with `showArtist`), the style names joined by " · ", and "Healed". `PagedGallery` renders `GalleryGrid` for every photo so far and, while there is a `nextCursor`, an `<a class="action action-secondary work-more" href={moreHref(cursor)}>Show more</a>` that works without JavaScript; with `more`, a click calls `preventDefault`, shows `loadingMore` with `aria-busy`, appends the answer, then moves focus to the first new photo's `openId` (the one DOM call here, in an effect); a failure leaves the link and shows `moreFailed` in a `role="status"` paragraph. `ArtistPage`: `<section id="work">` with "Work", the `HealedFilter` nav (when `gallery.healed` or the address asked for healed), "Back to the newest" on a cursor page, `PagedGallery` without artist links, `noHealed` when the healed view is empty; no section when the artist has no photos and no filter is set. `WorkPage`: the artist page's site bar and studio block (extract `SiteBar` and `StudioAside` from `ArtistPage` with byte-identical markup), `h1` "All work", the filter form (`role="search"`, `aria-label` "Filter the photos"; selects `name="artist"` and `name="style"` whose first option has `value=""`, the checkbox `name="healed"` `value="1"`, then the "Show photos" submit; the artist options are `data.artists`, the style options `gallery.styles`), the gallery with artist links, the empty states. `src/routes/work.tsx`: `validateSearch: readWorkSearch`, `loaderDeps` the search, `loadWorkPage`, `themedHeadTags`, `pageCacheHeaders`, a component passing `more` built from the route context (`moreWork` with `workQuery(search, WORK_PAGE_SIZE)` and the connection's `apiUrl`); `artists/$slug.tsx` gains `validateSearch: readPortfolioSearch` and the same `more`. CSS for `.work-filters`, `.work-filter-nav` (links at least 3rem tall, `[aria-current="page"]` filled with `--stencil`), `.work-dialog-meta` (`overflow-wrap: anywhere`) and `.work-more` with the theme's tokens only. `check-page.mjs`: the stand-in API answers `/work` with an empty page, and a page's expected reads are the keyed lookup, the artists read and one work read. Run `pnpm --filter @tattoo-drip/storefront generate-routes`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`
Expected: PASS and clean; the default-theme snapshot unchanged; `routeTree.gen.ts` lists `/work`.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): an All work page and each artist's whole portfolio, a page at a time"
```

### Task 7: Recent work on the home page, ordered and hidden from Page look

**Files:**
- Create: `apps/platform/database/migrations/1791700000002_add_work_section_to_tenants.ts`
- Modify: `apps/platform/app/modules/storefront/look.ts`, `apps/platform/app/modules/tenancy/validators/tenant.ts` (`updateLookValidator`), `apps/platform/app/modules/tenancy/services/tenancy_service.ts` (`PageLookInput`, `updateLook`), `apps/platform/app/controllers/page_look_controller.ts`
- Modify: `apps/platform/inertia/components/page_look.ts`, `apps/platform/inertia/components/stored_choice.ts`, `apps/platform/inertia/pages/settings/look.tsx`
- Modify: `packages/types/openapi.yaml` (`StorefrontSection`, `StorefrontConfiguration.sections`); regenerate
- Modify: `apps/storefront/src/studio/theme/config.ts`, `src/studio/loaders.ts`, `src/studio/copy.ts` (`work.recentTitle`), `src/studio/components/pages.tsx` (`StudioSection`), `src/studio/components/gallery.tsx` (`RecentWork`)
- Regenerate: `apps/platform/database/schema.ts`, `apps/platform/.adonisjs/`
- Test: platform `tests/unit/modules/storefront/look.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts`, `tests/functional/tenancy/page_look_columns.spec.ts`, `tests/functional/api/public_studio.spec.ts`; storefront `test/studio/fixtures.ts` (`DEFAULT_STOREFRONT`), `theme-config.test.ts`, `render.test.ts`, `loaders.test.ts`

**Interfaces:**
- Consumes: `GalleryGrid`, `galleryView`, `RECENT_WORK_COUNT`, `EMPTY_GALLERY` (Task 6).
- Produces (platform `look.ts`): `SECTION_KEYS = ["work", "artists", "inquiry"]` (the storefront's list, same order: the drift test compares them); `DEFAULT_SECTIONS = ["work", "artists", "inquiry"]`; `sectionList(keys: readonly string[]): SectionKey[]` (known keys, each once, in order, `inquiry` added at the end if missing) with `sectionsOf(stored) = sectionList(stored.split(","))`; `ARTIST_PLACEMENTS`, `ArtistPlacement`, `ARTIST_PLACEMENT_KEYS` and `placementOf` are gone.
- Produces (Page look): the form posts `sections[]` (the shown keys in order); `PageLookInput.sections: SectionKey[]` replaces `artists`; the page gets `look.sections: SectionKey[]` and `sectionKeys: SectionKey[]` instead of `look.artists` and `placements`.
- Produces (dashboard `page_look.ts`): `SectionKey`, `SECTION_WORDS`, `REQUIRED_SECTION = "inquiry"`, `SectionRow = { key: SectionKey; shown: boolean }`, `sectionRows(shown, all)`, `moveRow(rows, index, direction: "up" | "down")`, `toggleRow(rows, index, shown)`, `sentSections(rows): SectionKey[]`, `moveSectionLabel(title, direction)`, `SECTIONS_INTRO`; `stored_choice.ts` `useStoredRows(stored: readonly SectionKey[], all: readonly SectionKey[]): [SectionRow[], (rows: SectionRow[]) => void]` (follows a changed stored list in place, compared as its comma string, like `useStoredChoice`).
- Produces (storefront): `SECTION_KEYS` and `THEME_SECTIONS["stencil-and-ink"].order` = `work, artists, inquiry` (required stays `inquiry`); `StudioPageData.recentWork: GalleryView`; `studioPageData(studio, artists, origin, imageOrigin = null, recentWork: unknown = null)`; `loadStudioPage` also reads `{ limit: RECENT_WORK_COUNT }`, and **any** failure of that read (404 from an older platform, 422, 5xx, network) leaves `recentWork` empty so the studio page renders without Recent work, never an error or not-found (spec anti-goal: never harder to reach the studio; it also makes the deploy order safe); `RecentWork({ gallery })`.

- [ ] **Step 1: Write the failing tests**

Platform:
- `look.spec.ts`: "the default is Recent work, artists, then the form"; "sectionList keeps known keys once, in order, and adds the form at the end": `sectionList(["artists", "work", "artists", "flash"])` is `["artists", "work", "inquiry"]`; "a stored list without work stays without it": `sectionsOf("artists,inquiry")` is `["artists", "inquiry"]`; the placement tests go; the drift test is unchanged and compares the new lists.
- `page_look_copy.spec.ts`: `SECTION_WORDS` has exactly the server's `SECTION_KEYS`, with `work` titled "Recent work", `artists` "Artists", `inquiry` "The form"; `sectionRows(["artists", "inquiry"], ["work", "artists", "inquiry"])` is artists shown, inquiry shown, work hidden; `moveRow` of that list's index 2 `"up"` puts work before inquiry, index 0 `"up"` changes nothing; `toggleRow` cannot hide `inquiry`; `sentSections` of work shown, artists hidden, inquiry shown is `["work", "inquiry"]`; `moveSectionLabel("Recent work", "up")` is "Move Recent work earlier", `"down"` "Move Recent work later".
- `page_look_http.spec.ts`: "saves the sections in the order sent": `sections[]` artists, work, inquiry stores `"artists,work,inquiry"`; "a list without the form gets it at the end": `sections[]` work stores `"work,inquiry"`; "showing only the form hides Recent work and artists": stores `"inquiry"`; "an unknown or repeated section is a field error and nothing changes" (`flash`; `work` twice); "the page offers every section and the stored order": props `sectionKeys` `["work", "artists", "inquiry"]` and `look.sections` as stored.
- `page_look_columns.spec.ts`: "a new studio's sections are work, artists, then the form".
- `public_studio.spec.ts`: the default `storefront.sections` is `[{ type: "work" }, { type: "artists" }, { type: "inquiry" }]`.

Storefront:
- `theme-config.test.ts`: "work is a section: the default order is work, artists, then inquiry"; "an older API's [artists, inquiry] shows no Recent work".
- `render.test.ts`: "Recent work comes after the intro and before the artists, with the newest photos and All work": from a 12-photo page, `<section` whose `h2` is "Recent work" before `id="artists"`, nine `work-open` buttons, a link to `/work` reading "All work"; "no photos, no Recent work and no All work link"; "a studio that hides Recent work shows none even with photos"; "artists before Recent work when the configuration says so"; "Recent work's viewer names the artist with a link".
- `loaders.test.ts`: "the studio page reads the artists and the newest 9 photos": URLs are the artists read and `/work?limit=9`; "a failed work read (404, 500, network) still gives the studio page, with an empty Recent work".

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test unit --files=look.spec.ts --files=page_look_copy.spec.ts`, `PORT=3402 pnpm test functional --files=page_look_http.spec.ts --files=page_look_columns.spec.ts --files=public_studio.spec.ts`, `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Migrate**

Migration `up`: the column default becomes `'work,artists,inquiry'`, and every studio without `work` gets it first (`update tenants set storefront_sections = 'work,' || storefront_sections where not ('work' = any (string_to_array(storefront_sections, ',')))`): an owner's earlier choices stay as they were and Recent work joins at its default place. `down` removes `work` from every list and restores the old default. Before migrating, note `select slug, storefront_sections from tenants`; after `pnpm migrate` (then the `biome` step), `select count(*) from tenants where not ('work' = any (string_to_array(storefront_sections, ',')))` is 0 and each list is the old one with `work,` in front.

- [ ] **Step 4: Implement**

Contract: `StorefrontSection.type` enum `[work, artists, inquiry]`, described "`work` (Recent work: the newest photos), `artists` (the artists list) or `inquiry` (the idea form, always listed)"; `sections` `maxItems: 3`; regenerate. Platform per Interfaces; validator `sections: vine.array(vine.enum(SECTION_KEYS)).distinct().maxLength(SECTION_KEYS.length)` with messages "Choose sections from the list." (`sections.*.enum`) and "Show each section once." (`sections.distinct`); `updateLook` stores `sectionList(input.sections).join(",")`. Look page: the "Artists list" radio group becomes a "Sections" `FieldSet` (legend, `SECTIONS_INTRO` "What your page shows under its cover and intro, in this order.") with an `<ol>` of rows from `useStoredRows(look.sections, sectionKeys)`: each row has its title and description, a "Show on your page" `Checkbox` (the form row instead reads "Always shown"), and earlier / later icon `Button`s (`aria-label` from `moveSectionLabel`, disabled at the ends); a hidden `sections[]` input per shown row, in order; after a move, focus goes back to the pressed button of the moved row, or its other move button when the pressed one is now disabled. `SECTION_WORDS` descriptions: work "The newest photos from all your artists, with a link to all of them.", artists "Each artist with their photo, styles and status. Their own pages work either way.", inquiry "Where clients send their idea. Always on your page.". Errors under the list: `errors.sections`, else the first error whose key starts with `sections.`. Storefront per Interfaces; `StudioSection`'s `work` case renders `RecentWork` (null when the gallery is empty): `<section id="recent-work" class="section" aria-labelledby="recent-work-title">`, `h2` `studioCopy.work.recentTitle` ("Recent work"), `GalleryGrid` with artist links over at most `RECENT_WORK_COUNT` photos, then `<a class="text-link" href="/work">All work</a>` with an `aria-hidden` arrow icon. `DEFAULT_STOREFRONT` in the fixtures becomes the platform's new default. Run `node ace codegen`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: the commands of Step 2, plus `PORT=3402 pnpm test unit --files=page_look_source.spec.ts`, `pnpm --filter @tattoo-drip/react test`, `pnpm typecheck` (root)
Expected: PASS and clean; the default-theme snapshot unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/platform apps/storefront packages/types
git commit -m "feat(storefront): Recent work on the home page, ordered and hidden from Page look"
```

### Task 8: Docs, whole-branch checks and the browser pass

**Files:**
- Modify: `apps/platform/docs/backend.md` (Public API: the work read, its cursor and filters, the style list; Artists: work photos without positions, 100, styles, healed, `updateDetails`, `page`, `facets`, the cap held under the lock only; Images: work photos' grids), `apps/platform/database/README.md` (the deferrable-unique bullet: `artist_work_photos` dropped its positions in this ticket; the pattern stays for the next list reordered in place), `apps/platform/docs/ui.md` (work photos: the grid, the sheet, the sequential multi-upload; Page look: the Sections list replaces the artists radio), `apps/storefront/docs/development.md` (studio page: the routes now include `/work`; Recent work; the artist portfolio and its All / Healed links; the gallery viewer's meta; `paging.tsx` as the second DOM call; `check:page`'s three reads; Themes: the `work` section), `docs/data-model.md` (`ArtistWorkPhoto` row; `PortfolioItem` replaced by it, spec call 6).

- [ ] **Step 1: Update the docs** in the files above, one to three sentences each, in the existing voice. `docs/product.md`, `roadmap.md` and `requirements.md` wait for the last ticket of the split (the studio site moves into the pilot when all of it ships).

- [ ] **Step 2: Run the root gates**

Run (worktree root, Node 24, the Global Constraints' environment): `pnpm check`, `pnpm typecheck`, `pnpm build`, then the full platform suite with `PORT=3402 pnpm -C apps/platform exec node ace test` in the background (empty `queue_jobs` in `tattoo_drip_site` first), `pnpm test` for the packages and storefront, and `pnpm --filter @tattoo-drip/storefront check:page`.
Expected: all clean; the platform log ends with `Tests N passed` and no failures; `check:page` prints "Page check passed".

- [ ] **Step 3: Browser pass**

Make 30 JPEGs of 1600 × 1200 (and one text file renamed `broken.jpg`) with `sharp` (the platform's dependency) in a scratch folder outside the repository. Start the platform on 3401 against `tattoo_drip_site` and the storefront on 3404 with `API_URL=http://localhost:3401`, as plan 1's browser pass did. With Playwright (plan 1's `playwright-core` and Chromium paths), at 375 × 812 and 1280 × 800, light and dark:
- Dashboard: upload 5 files in one go including `broken.jpg`: four added once each, the summary names `broken.jpg` (Review Focus 5); choose more files than the room left: the room note, nothing sent; reach 26 photos for one artist (Devanagari name) and 3 for another; in the sheet tag 3 photos with styles and 2 as healed; a fourth style shows the error; focus returns to the tile after a save.
- Page look: move Recent work below Artists by keyboard (focus stays on the move button), hide it, show it again, save.
- Storefront: Recent work's 9 photos and All work; `/work`'s filters (artist, style, Healed only) and their empty state; Show more appends photos 25 and 26 and focus lands on photo 25; with JavaScript off, Show more opens the cursor page with "Back to the newest"; the viewer shows the artist link, the styles and Healed; the artist page's All / Healed; no horizontal scroll at 375 px; the grids request copies, never the stored 2048 px image (network log).
Stop both servers by their exact PIDs.

- [ ] **Step 4: Commit**

```bash
git add docs apps/platform/docs apps/platform/database/README.md apps/storefront/docs
git commit -m "docs: work photos newest first, the work read and Recent work"
```

- [ ] **Step 5: Tear down**

Leave `tattoo_drip_site` in place for tickets 3 to 5 (they stack on this branch); delete the scratch images; stop every process this plan started; `git status` clean.
