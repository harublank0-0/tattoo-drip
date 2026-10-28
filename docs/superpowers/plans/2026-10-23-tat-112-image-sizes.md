# TAT-112: Image sizes (320, 640 and 1280 px copies with srcset)

## 1. Header

- Ticket: TAT-112, WP-15a of the UX pass (`docs/superpowers/specs/2026-10-20-ux-build-plan.md`, row WP-15a; audit `2026-10-20-ux-audit.md` X-12). Linear says 2 points ("a guess"); this plan is about 3: platform pipeline 1.5, contract 0.25, storefront 1, dashboard thumbnails 0.25.
- Branch: `harublank00/tat-112-image-sizes-320-640-and-1280-px-variants-with-srcset`, base `9ac7621` (main, TAT-110 merged).
- Lane B: database `tattoo_drip_uy`; platform dev 3421, platform tests `PORT=3422`, storefront dev 3424, stand-in API 3425 (not needed here). Every platform test command in this worktree (it has no `.env`) carries `DB_DATABASE=tattoo_drip_uy PORT=3422 SESSION_DRIVER=memory`. A full platform suite run is wrapped in `flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock …`; targeted specs need no lock.
- All commands need `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH` in front.
- Goal in plain words: today every photo is one file of up to 2048 px. A phone on mobile data downloads that whole file for a 112 px roster photo, and the dashboard's reference grid downloads every full-size reference on every visit (they are `no-store`). After this ticket, an upload of an artist photo or a reference image also stores 320, 640 and 1280 px copies (only those narrower than the image). The public API lists the copies as `variants`, and the storefront gives them to the browser as `srcset` with `sizes`, so a phone loads the copy that fits its screen. The dashboard's grids and lists show the 320 px copy. Images stored before this ticket, or narrower than 320 px, have no copies and work exactly as today.

## 2. Scope fence

The builder may change only:

- Platform media: `apps/platform/app/modules/media/variants.ts` (new), `apps/platform/app/modules/media/services/image_processor.ts`, `apps/platform/app/modules/media/services/image_service.ts`
- Platform reads: `apps/platform/app/modules/storefront/services/studio_page_service.ts`, `apps/platform/app/transformers/public_artist_transformer.ts`, `apps/platform/app/modules/inquiries/reference_view.ts` (new)
- Controllers, only the lines that build reference or photo URLs: `apps/platform/app/controllers/{inquiries_controller.ts,projects_controller.ts,clients_controller.ts,artists_controller.ts}`
- Dashboard: `apps/platform/inertia/components/inquiries.ts` (`ReferenceProps`), `apps/platform/inertia/components/references.tsx`, `apps/platform/inertia/pages/artists/index.tsx` (two attributes on the photo), `apps/platform/inertia/components/artists.ts` (the `photoUrl` comment)
- Platform tests: `apps/platform/tests/unit/modules/media/{variants.spec.ts (new),image_processor.spec.ts}`, `apps/platform/tests/functional/media/image_service.spec.ts`, `apps/platform/tests/functional/artists/{artist_photo.spec.ts,artists_page.spec.ts}`, `apps/platform/tests/functional/api/public_artists.spec.ts`, `apps/platform/tests/functional/storefront/studio_page_service.spec.ts`, `apps/platform/tests/functional/inquiries/inbox.spec.ts`, `apps/platform/tests/functional/projects/project_page.spec.ts`, `apps/platform/tests/functional/clients/clients_pages.spec.ts`, `apps/platform/tests/helpers/images.ts`
- Contract: `packages/types/openapi.yaml`, `packages/types/src/index.ts`, `packages/types/src/openapi.gen.ts` (regenerate only, never by hand); `packages/sdk/test/client.test.ts` (fixture only)
- Storefront: `apps/storefront/src/studio/srcset.ts` (new), `apps/storefront/src/studio/view-model.ts`, `apps/storefront/src/studio/theme/config.ts`, `apps/storefront/src/studio/components/{artists.tsx,brand.tsx,pages.tsx}`, `apps/storefront/src/deposit/components/deposit-page.tsx`, `apps/storefront/src/deposit/loader.ts` (its comment only)
- Storefront tests: `apps/storefront/test/studio/{srcset.test.ts (new),fixtures.ts,view-model.test.ts,theme-config.test.ts,render.test.ts,theme-render.test.ts,safety.ts}`, `apps/storefront/test/deposit/render.test.ts`
- Docs: `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `apps/storefront/docs/development.md`, `docs/sdk.md`, `docs/architecture.md`

NOT in this plan:

- TAT-109's Projects list thumbnail (`InquiryService.firstImages`, `ProjectRow.thumbnail`). This plan only provides what it will call (Decision D10).
- TAT-115's Inbox thumbnails, TAT-116's cover and work photos, TAT-56's logo and cover upload. They add their own purposes and reuse this pipeline (D11).
- A backfill command for images stored before this ticket (U2).
- WebP or AVIF copies, `<picture>` (U3).
- Copies of payment QR codes and payment screenshots (U1).
- A cover on the deposit page (U4).
- `Cache-Control` on public files, a CDN, R2 (TAT-27).
- Pinning artist photos to the API's origin (a known limit of TAT-54; copies follow the photo's own origin, D8).
- Any migration, new route, new runtime or dev dependency, `node ace codegen` (no route, page or controller is added or renamed), `styles.css`, `check-page.mjs`, the demo seeder (its 640 × 480 references get a 320 px copy on their own).

## 3. Facts verified on this branch

Storage and processing today:

- `ImageService` (`apps/platform/app/modules/media/services/image_service.ts`):
  - `IMAGE_PURPOSES` (`:13-18`): `payment_qr` public, `payment_proof` private, `artist_photo` public, `reference_image` private. The purpose picks the disk (`diskFor`, `:32-33`). No logo or cover purpose exists.
  - `store(file, { tenant, purpose })` (`:42-53`) reads the temp file, removes it (it still has EXIF and GPS), then `storeBytes` (`:59-70`): `processImage`, then one `put` under `tenants/<tenant>/<purpose>/<randomUUID>.<jpg|png>` with `image/<format>`. It returns `StoredImage { key, width, height }` (`:21`).
  - `url(purpose, key, tenant)` (`:81-101`) refuses a key outside `tenants/<id>/<purpose>/` or with `..` (throws "…another tenant or purpose…"), then gives `getUrl` for public purposes or `getSignedUrl(key, { expiresIn: "5 minutes", cacheControl: "private, no-store" })` (`SIGNED_URL_TTL` `:23`, `PRIVATE_CACHE_CONTROL` `:30`).
  - `delete(purpose, key)` (`:108-117`) deletes one file, best effort: logs `{ err, purpose, key }` "could not delete a stored image", never throws.
- `processImage` (`image_processor.ts:73-77`): sniffs JPEG, PNG or WebP by its first bytes (`sniff`, `:43-60`; SVG, GIF, HEIF never reach a decoder), then in a decode slot (`decodeSlot = limitConcurrency(MAX_CONCURRENT_DECODES = 2)`, `:19-21`) refuses over `MAX_INPUT_PIXELS` 40 MP (`:11`, header read by `pixelCount`, `:126-135`), rotates by EXIF, fits in `MAX_DIMENSION` 2048 (`:13`) without enlarging, and re-encodes with no metadata: PNG stays PNG (QR codes stay sharp), everything else becomes JPEG at quality 85 with mozjpeg on white (`:101-107`). `sharp.cache(false)` (`:25`). Any sharp failure is `InvalidImageError` with its cause (`:114-119`). HEIC is not decoded (`docs/architecture.md:117`); the storefront's pickers convert in the browser (`apps/storefront/docs/development.md:115`).
- Upload field rule: `imageFile()` (`validators/image_file.ts:7-8`, 10 MB, jpg/jpeg/png/webp). Upload bodies must arrive within 90 s on the API and 120 s on the dashboard (TAT-38, `apps/platform/docs/backend.md:61`); processing happens after the body is in.
- Disks (`config/drive.ts:15-38`): `public` served at `/uploads`, `private` at `/files` (signed only), both absolute on `APP_URL`; tests write to `tmp/storage/` (`:15-16`). Production must move to R2 before any public deploy (TAT-27, `apps/platform/docs/deploy.md:86`), so no production image exists yet. The drive's file server (`node_modules/@adonisjs/drive/build/providers/drive_provider.js:14-50`) sends `Cache-Control` only from a signed URL's `cacheControl`; a public file gets an ETag and `Last-Modified` only.
- Key columns are `varchar(255)`: `artists.photo_key` (`database/migrations/1791580000000_create_artists_table.ts:33`), `reference_images.image_key` (`1791590000003_create_reference_images_table.ts:27`), `payment_methods.qr_image_key` (`1791560000001_create_payment_methods_table.ts:27`). Artists, reference images and payments also store the image's width and height; payment methods don't. A key with copies is about 111 characters.
- No disk quota exists anywhere (`rg -i quota` finds only quote statuses).
- Measured here with the installed sharp 0.35.5 (libvips 8.18.7), resizing a 2048 × 1536 JPEG with `resize({ width })` and `jpeg({ quality: 80, mozjpeg: true })`: 17, 34 and 93 ms for a flat image, 35, 96 and 205 ms for a noisy one (320, 640, 1280). Widths come out exact; heights are rounded by libvips (641 × 3 gives 320 × 1, 2048 × 1 gives 1 px tall copies, never 0). A copy has no EXIF and is progressive. A PNG copy keeps its alpha. A JPEG or PNG with HTML and a ZIP header appended is accepted, and neither the re-encoded image nor its copy contains those bytes.

Lifecycle callers (all use `store` / `afterRollback(delete)` / `afterCommit(delete)`, so a `delete` that also removes copies covers them all):

- `ArtistService.update` deletes a replaced photo after commit (`artist_service.ts:285-295`); `storePhoto` registers `afterRollback` (`:339-347`).
- `IntakeService.storeImages` stores up to 5 references one after another inside the request transaction, each with `afterRollback` (`intake_service.ts:169-190`; `MAX_REFERENCE_IMAGES` 5, `validators/intake.ts:9`).
- `DepositPageService.submitProof` stores the proof (`deposit_page_service.ts:185-189`); `PaymentMethodService` stores and replaces QR codes (`payment_method_service.ts:114-116, 167-169, 196`).
- The demo seeder stores 640 × 480 references with `storeBytes` (`database/seeders/demo_inquiries_seeder.ts:112-125`).

Where images reach a client:

- Public studio reads: `StudioPageService.photoOf` (`studio_page_service.ts:87-99`) gives `ShownPhoto { url, width, height }` (`:26`) from the artist's three photo columns, with no I/O; each read is one query (`CountingArtists` test, `tests/functional/storefront/studio_page_service.spec.ts:97-122`). `PublicArtistTransformer` writes the photo field by field (`public_artist_transformer.ts:18-24`). `public_artists.spec.ts:24-34` pins `ARTIST_FIELDS` and `PHOTO_FIELDS = ["height", "url", "width"]`, and `:92-115` pins the photo of a 300 × 200 PNG. `backend.md:53` says a new public field needs the contract, a ruling and the exact-fields tests; this plan is the ruling.
- Contract (`packages/types/openapi.yaml`): "Changes within v1 must be additive" (`:7`). `Image` (`:584-595`: `url`, `width`, `height`, optional `alt`, `additionalProperties: false`), `Photo` (`:597-611`: the same without `alt`, every property required), `Artist.photo` (`:739-741`), `StorefrontConfiguration.branding.logo`/`heroImage` (`:652-656`, "Not served yet"), `PortfolioProject.images` (`:774-776`, not served), `DepositPaymentMethod.qrImageUrl` (`:858-861`, a plain URL). `packages/types/src/index.ts:10-11` exports `Image` and `Photo`; the SDK re-exports every type and passes JSON through without checking it, so an older storefront ignores a new field. Typed fixtures with a photo: `packages/sdk/test/client.test.ts:704-716` (`ARTIST`), `apps/storefront/test/studio/fixtures.ts:41-49` (`SITA`), `test/studio/view-model.test.ts:186-205`, `test/studio/render.test.ts:215`.
- Deposit page: QR codes are `payment_qr` public URLs (`deposit_page_service.ts:252`), shown one at a time since TAT-110. The client's screenshot preview is a local object URL; the stored proof never goes back to the storefront.
- Dashboard: the reference grid (`inertia/components/references.tsx:8-31`, 3 columns, 4 from `sm`) uses the signed full-size URL as the thumbnail's `src` and as the link. Its props come from three copies of the same mapping: `inquiries_controller.ts:145-152`, `projects_controller.ts:303-316`, `clients_controller.ts:146-153` (`ReferenceProps { id, url, width, height }`, `inertia/components/inquiries.ts:37-43`). Payment screenshots are signed for owners only (`projects_controller.ts:322-336`). Artist photos: `artists_controller.ts:185-187` (`photoUrl`), drawn at 64 px in the list (`pages/artists/index.tsx:95-99`) and 96 px in the form (`pages/artists/form.tsx:172-176`). `ui.md:40`: "Images in lists and grids are lazy-loaded thumbnails, never the full-size file." Today's grid breaks that rule.
- Storefront artist photos: `photoView` (`src/studio/view-model.ts:201-211`) keeps a photo whose URL passes `safeImageUrl` (`links.ts:82-87`: http or https, no credentials, at most 2048 characters) and whose sides are whole numbers from 1 to 10000 (`:107-108`); it does not check the origin (TAT-54's known limit, `development.md:105`). `PhotoFigure` (`components/artists.tsx:10-30`) renders `src`, `width`, `height`, `alt`; roster photos are lazy (`:54`), the artist page's photo eager with `fetchPriority="high"` (`:126`). Pinned by `render.test.ts:144-151` and `:490-497`.
- Storefront brand images (TAT-54): `readBrandImage(value, imageOrigin)` (`src/studio/theme/config.ts:172-187`) keeps a URL with no space or control character, through `safeImageUrl`, on exactly the API's origin, with whole sides from 1 to 10000; `readCoverImage` (`:198-210`) adds `alt`. `BrandLogo` (`components/brand.tsx:16-34`, `fetchPriority="low"` so React adds no preload) and `BrandCover` (`:37-51`, eager, high). The platform never sends `Studio.storefront` yet (`theme/source.ts:12-14`), so on every real page there is no logo or cover; tests put one on a fixture (`test/studio/theme-fixtures.ts:15-29`). `theme-render.test.ts:100-111` pins the default pages byte for byte (`default-theme.snapshot.json`), `:159`, `:164` and `:211` pin the brand images' exact markup, and `:217-234` pins that the logo is never preloaded and the cover is.
- Deposit header logo (TAT-110): `DepositFrame` renders the checked logo with `referrerPolicy="no-referrer"` and `fetchPriority="low"` (`src/deposit/components/deposit-page.tsx:101-111`), from `parseThemeConfig(...).logo` (`src/deposit/loader.ts:38`). The loader's comment (`:13-15`) and `development.md:128` say the page never shows the cover; TAT-110's plan rejected the cover because it was the full stored photo and because it competes with the QR and costs about 115 px of height (`docs/superpowers/plans/2026-10-22-tat-110-deposit-page-v2.md:133`). The guard test requires `referrerPolicy="no-referrer"` on every `<img>` in `src/deposit/` (`test/deposit/guard.test.ts:168-170`); the logo's own test is `test/deposit/render.test.ts:161-185`.
- CSS widths the `sizes` values must mirror (`apps/storefront/src/styles.css`): `.page` `min(72rem, 100% - 2.5rem)` (`:153`); `.profile-logo` up to `min(12rem, 100%)` (`:170`); `.site-bar-logo` up to `6rem` (`:174`); `.artist` photo column `7rem` (`:221`), `9rem` from `48rem` (`:258-260`); `.artist-profile .artist-photo` at most `20rem` (`:238`); `.deposit-logo` up to `8rem` (`:378`).
- TAT-109's hook (`docs/superpowers/plans/2026-10-22-tat-109-projects-list.md:231-240`): once a 320 px copy exists, add `InquiryService.firstImages(tenant, projectIds)`, sign the copy's URL in `ProjectsController.index` after the member-scoped page read, add `thumbnail: { url, width, height } | null` to `ProjectRow`. TAT-54's follow-up list asks TAT-56 for "resized cover and logo variants with srcset/sizes" (`2026-10-22-tat-54-theme-system.md:2948-2951`).
- `docs/architecture.md:116` says resized variants would come "in the worker"; this plan makes them in the request (D3) and updates that line.
- Test conventions: `testImages` makes images on the fly (`tests/helpers/images.ts:21-48`), `uploadOf` writes a temp upload (`:54-59`), `RecordingImageService` records stored keys (`:65-73`). Almost every existing test image is 300 × 200 (`intake.ts:30-36`, `proofPart`, `artist_photo.spec.ts:19`), so those tests get no copies and keep their exact key regexes (`image_service.spec.ts:44-47, 61-64, 207-210`) and empty-folder checks (`storedReferenceImages`, `uploads.ts:17-23`). `makeReferenceImage` writes a fake `…/<uuid>.webp` key with no file (`pipeline.ts:139-151`).
- CI runs `pnpm check`, `pnpm typecheck`, the types-drift check, `pnpm build`, migrations and `pnpm test` (platform functional and unit suites against Postgres, storefront `node:test`, SDK and React tests) (`.github/workflows/ci.yml`). CI does not run the browser pass, Playwright or `check:page`.

## 4. Decisions

- **D1. Which images get copies.** `artist_photo` and `reference_image` get 320, 640 and 1280 px copies. `payment_qr` and `payment_proof` keep one size (U1).
  - Why: artist photos are the storefront's grid and the first photo on the artist page. References are private and `no-store`, so every dashboard visit downloads them again: they gain the most. A QR is a flat graphic that PNG compresses well, is shown one at a time (TAT-110) and must stay scannable, and a client may save it to scan from the gallery. Owners read small print (amount, transaction id) on a payment screenshot at full size.
  - Each purpose names its widths in `IMAGE_PURPOSES` (`variants: VARIANT_WIDTHS` or `NO_VARIANTS`), so TAT-56 and TAT-116 opt in with one line.
  - Signed-URL cost: a private copy gets its own 5-minute signature with `Cache-Control: private, no-store`, like the original. Signing is an HMAC with no I/O (also an S3/R2 presign); the dashboard signs one extra URL per reference.
  - Rejected: copies for every purpose (blurred QR modules, unreadable screenshots, work nobody uses).
- **D2. The copies are named in the image's key.** No migration. `tenants/<tenant>/<purpose>/<id>.jpg` is an image with no copies (every key stored so far). `tenants/<tenant>/<purpose>/<id>.320-640-1280.jpg` is an image whose copies are `<id>.320w.jpg`, `<id>.640w.jpg` and `<id>.1280w.jpg` beside it, on the same disk. The owning record keeps the image's key as it does today. `variantsOfKey(key)` reads the copies back from the key: no query and no disk read.
  - Why: the key is written only after the copies are, so it lists exactly what exists, also when making copies failed (D5). Every caller that holds a key can find the copies, and every cleanup path (`afterRollback`, `afterCommit`, TAT-42's future deletions) goes through `delete(purpose, key)`. The names are plain object names, so they work the same on the local disk and on R2 (TAT-27).
  - Rejected: a `variant_widths` column on `artists` and `reference_images` (two migrations, every insert and replace must carry it, and TAT-116 repeats it); widths computed from the stored width (cannot tell an old image or a failed copy from a good one, and `payment_methods` stores no width).
- **D3. Copies are made in the request, right after the image is processed.** `makeVariants` runs in a decode slot, one width at a time, before the image's own `put`.
  - Why: the input is processImage's output (at most 2048 px a side, already in memory), so the three copies take about 0.1 to 0.35 s (Fact "Measured"). The page has the copies as soon as the record is saved. A queued job would need a second write to the record, races with a replace or delete that commits first (copies for an image that is gone), and retries.
  - Cost: the intake request, which holds a database connection, its transaction and a write slot, takes up to about 1.8 s longer with 5 large references. The 90 s and 120 s deadlines cover the body only, so they are unaffected.
  - Rejected: the queue and worker (`docs/jobs-and-email.md`), for the reasons above. `docs/architecture.md:116` changes to say so.
- **D4. The copy set and the format.** The copies are every width in `[320, 640, 1280]` strictly below the stored image's width. An image is never enlarged; an image 320 px wide or narrower gets none. Each copy keeps the stored format: a JPEG image's copies are JPEG at quality 80 (mozjpeg, progressive), a PNG's are PNG (transparency and sharp edges survive). Copies are resized by width; their height keeps the aspect ratio. Like the stored image, they carry no metadata.
  - Rejected: WebP copies. Safari before iOS 14 (iPhone 6 and older stop at iOS 12, still common second-hand in Nepal) would pick a WebP candidate from `srcset` and show a broken image. `<picture>` with a JPEG fallback would double the stored copies (U3).
  - Rejected: JPEG copies of PNG images (drops the transparency a logo needs, TAT-56).
- **D5. A failed copy never fails the upload.** Copies are made and written first. If making or writing any copy fails, the copies already written are deleted (best effort), a warning is logged (`"image copies could not be stored; keeping the image without them"`, `{ err, purpose }`), and the image is stored under a key of the old form, as before TAT-112. If the image's own `put` fails, its copies are deleted before the error is thrown again. Nothing that a caller's `afterRollback` can't reach is left behind.
- **D6. Memory and CPU on a small server.** `makeVariants` accepts only processImage's output: `limitInputPixels` is 2048 × 2048, so a decoded copy source is at most about 17 MB. It takes one of the 2 decode slots, makes one width at a time, keeps sharp's cache off, and never sees the raw upload, so the 40 MP check stays the only gate on hostile input. libvips' thread count stays at its default.
- **D7. The contract: an additive list of `{ url, width }`, never a ready `srcset` string.** `Image` and `Photo` gain `variants: ImageVariant[]` (required, `[]` when there are none, at most 8, narrowest first, each narrower than `width`, on the image's own origin).
  - Why: a list of plain objects carries URLs the storefront checks one by one (origin, characters, width) and builds the string from. A string would be whatever the API sent. Parsing `srcset` to check it is error-prone (commas inside URLs, descriptors), and a string can carry a URL on any origin. The field is required because every property of these schemas is always there; older storefront builds read only `url`, `width` and `height` and ignore it.
  - Heights are not sent: libvips rounds them (Fact "Measured"), and `srcset` needs only widths; the page keeps the image's own `width` and `height` for its box.
  - Rejected: a `srcset` string; per-copy `height`.
- **D8. What the storefront accepts and renders.** `readSrcSet(variants, src, width)` (new, pure) keeps a variant when its `url` is a string with no whitespace, control character or comma, passes `safeImageUrl`, is on exactly `src`'s origin, and its `width` is a whole number from 1 to below the image's width. It reads at most 8 items, sorts by width, keeps the first item of each width and returns `"<u320> 320w, <u640> 640w, <src> <width>w"`, or `undefined` when no variant passes. For a logo or cover, `src` is already on the API's origin (TAT-54), so its copies are too. Artist photos keep TAT-54's known limit (any http(s) origin for the photo), and their copies must share the photo's origin.
  - `srcSet` is an optional property of `ArtistPhoto` and `BrandImage`, present only when it has a value, so a page without variants renders byte for byte as today (the snapshot test proves it).
  - `sizes` per image (`IMAGE_SIZES`, mirroring `styles.css`, pinned by a test): roster photo `(min-width: 48rem) 9rem, 7rem`; artist page photo `20rem`; cover `(min-width: 74.5rem) 72rem, calc(100vw - 2.5rem)`; hero logo `12rem`; artist page bar logo `6rem`; deposit logo `8rem`. `srcset` and `sizes` sit right after `src`; `loading`, `decoding` and `fetchPriority` stay as they are (roster lazy, artist page photo and cover eager and high, logos low). React 19 then preloads the artist page photo and the cover with `imagesrcset`/`imagesizes` instead of `href`.
  - `src` stays the stored image (the fallback, and the SEO `og:image`).
- **D9. The dashboard's grids and lists show the 320 px copy (U5).** `ReferenceProps` gains `thumbnailUrl` (the signed 320 px copy, or the image itself when it has none); the grid's `<img>` uses it, and the link still opens the full image. The artists list and form use the 320 px copy as `photoUrl` (64 and 96 px boxes). The three controllers share one helper, `referenceView(images, tenant, image)` (`#modules/inquiries/reference_view`), so they cannot drift. Who sees what is unchanged: each controller signs only after its existing tenant- and member-scoped reads.
- **D10. TAT-109's hook.** `ImageService.urlFor("reference_image", image.imageKey, tenant, THUMBNAIL_WIDTH)` (`THUMBNAIL_WIDTH = 320`, exported from `#modules/media/services/image_service`) gives the signed URL of the narrowest copy at least 320 px wide, else of the image itself. TAT-109 then sets `ProjectRow.thumbnail = { url: <that>, width: image.width, height: image.height }` (the reference row's stored size, for the box's aspect ratio). This ticket builds none of the list.
- **D11. One helper for every public image.** `ImageService.shownImage(purpose, key, tenant, { width, height })` returns `ShownImage { url, width, height, variants }`, the shape of `Image` and `Photo`. `StudioPageService` uses it now; TAT-116's cover and work photos and TAT-56's logo use it with new purposes (`variants: VARIANT_WIDTHS`).
- **D12. No backfill (U2).** No production image exists (TAT-27 is a precondition of any public deploy), so images with old keys exist only in development databases. They keep working without copies. A re-upload gives them copies.
- **D13. The deposit page still shows no cover (U4).** No cover is stored or served yet (`Studio.storefront` is not sent). TAT-110's other reason stands whatever the file size: on a payment page it competes with the QR and costs about 115 px of height. The deposit logo gets `srcset` like the studio's logo. The loader's comment drops "the full stored photo" and keeps the QR reason.
- **D14. Stale copies cannot happen.** Ids are random per upload, so a replaced image's copies keep the old id and are deleted with it after the commit; the new image's copies have a new id. A copy's key never names copies itself (`<id>.320w.jpg` does not parse as an image with copies).

## 5. Design

Nothing looks different. The only visible change is that photos arrive sooner on slow connections. No new words, no new CSS, no new tokens, no change to tap targets. The `var(--stencil-wash)` background already fills a photo's box while it loads.

- **Studio page roster** (375: the photo is a 7rem column beside the name; 1280: 9rem). The browser picks the 320 px copy at DPR 2 and the 640 px copy at DPR 3 (112 px × 3 = 336). Lazy, as today. Devanagari names: unchanged (`alt="Photo of अर्जुन थापा"`).
- **Artist page photo** (375: up to 20rem across the column; 1280: the 20rem column). At DPR 2 the 640 px copy, at DPR 3 the 1280 px copy, never the 2048 px file. Eager and high, as today.
- **Hero cover and logo, artist page bar logo, deposit header logo.** These are dormant until TAT-56/TAT-116 send them; the code and tests are in place.
- **Dashboard reference grid** (3 columns at 375, 4 from `sm`): about 110 px cells load the 320 px copy (slightly soft at DPR 3, acceptable for a thumbnail that opens the full image). "No references." and the `Reference N` alt text are unchanged.
- **Dashboard artists list and form**: the 64 and 96 px photos load the 320 px copy. The list's `<img>` gains `loading="lazy"` and `decoding="async"` (ui.md:40).
- **Empty, error and loading states**: an image with no copies renders as today. A copy that fails to load is a broken image, as an original would be; the browser does not fall back to `src` from `srcset`. That is why the key only names copies that were written (D2, D5).
- **Server and client.** The platform computes the copies and their URLs from the key. The storefront's loaders build `srcSet` on the server (it is in the loader data, which is public). The browser picks the candidate. The dashboard gets finished URLs as props.

## 6. Data and contract

No migration, no new table, no new route, no new query. No `TENANT_ROUTE_ROLES` or `tests/isolation/cases.ts` entry: copies are served by the existing `/uploads` and `/files` routes, and every URL is built behind the same key check as `url()`.

### `app/modules/media/variants.ts` (new, pure)

```ts
/**
 * Smaller copies of stored images (TAT-112): their widths, and how keys name
 * them. Pure. A copy sits beside its image on the same disk, so it has the
 * image's visibility and origin; the names are plain object names, the same
 * on the local disk and on R2 (TAT-27).
 *
 *   tenants/<tenant>/<purpose>/<id>.jpg               no copies (every key before TAT-112)
 *   tenants/<tenant>/<purpose>/<id>.320-640-1280.jpg  an image whose key names its copies
 *   tenants/<tenant>/<purpose>/<id>.320w.jpg          its 320 px copy
 *
 * The owning record keeps the image's key only. Ids are random, so a
 * replaced image never shares a copy with the new one.
 */

/** The copies a purpose with copies gets, narrowest first. */
export const VARIANT_WIDTHS = [320, 640, 1280] as const;
/** A purpose that keeps one size. */
export const NO_VARIANTS = [] as const;

/** At most this many copies are read from a key (the contract's maxItems). */
const MAX_VARIANTS = 8;

export type ImageExtension = "jpg" | "png";

/** The widths of `widths` below `width`: an image is never enlarged. */
export function variantWidths(width: number, widths: readonly number[]): number[] {
	return widths.filter((candidate) => candidate < width);
}

/** The key of an image whose copies have these widths; none is the old form. */
export function originalKey(
	base: string,
	extension: ImageExtension,
	widths: readonly number[],
): string {
	return widths.length === 0
		? `${base}.${extension}`
		: `${base}.${widths.join("-")}.${extension}`;
}

/** The key of the image's copy that is `width` px wide. */
export function variantKey(
	base: string,
	width: number,
	extension: ImageExtension,
): string {
	return `${base}.${width}w.${extension}`;
}

/** The base (no dot in it, so no ".."), the widths, the extension. */
const NAMED = /^([^.]+)\.([1-9]\d{0,3}(?:-[1-9]\d{0,3})*)\.(jpg|png)$/;

/**
 * The copies an image's key names, narrowest first, each with its own key;
 * [] for a key that names none: the old form, a copy's own key, or anything
 * malformed (widths not strictly increasing, more than 8, another extension).
 */
export function variantsOfKey(key: string): { width: number; key: string }[] {
	const match = NAMED.exec(key);
	if (!match) return [];
	const [, base, list, extension] = match;
	const widths = list.split("-").map(Number);
	if (
		widths.length > MAX_VARIANTS ||
		widths.some((width, index) => index > 0 && width <= widths[index - 1])
	) {
		return [];
	}
	return widths.map((width) => ({
		width,
		key: variantKey(base, width, extension as ImageExtension),
	}));
}
```

This was run against the cases in Task T1 in a scratch copy: the old form, `.webp`, `.320w.jpg`, `640-320`, `320-320`, `0`, `0320`, `12345`, `.gif`, `.jpg.exe`, `../`, 9 widths, upper-case `.JPG` and a trailing newline all give `[]`.

### `image_processor.ts` additions

```ts
/** Copies are made from processImage's output only: never more pixels than this. */
const MAX_VARIANT_INPUT_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
/** JPEG copies: a little below the stored image's 85, since they are shown small. */
export const VARIANT_JPEG_QUALITY = 80;

export type ProcessedVariant = { data: Buffer; width: number; height: number };

/**
 * Smaller copies of a processed image (TAT-112): one for each of `widths`
 * below its own width (variantWidths: never enlarged), narrowest first, in
 * its own format (a PNG stays PNG; a JPEG at VARIANT_JPEG_QUALITY), with no
 * metadata. Takes a decode slot like processImage and makes one width at a
 * time. Only processImage's output may come in: an input over 2048 × 2048
 * pixels is refused. Throws on any failure; ImageService then stores the
 * image without copies.
 */
export async function makeVariants(
	image: ProcessedImage,
	widths: readonly number[],
): Promise<ProcessedVariant[]> {
	const wanted = variantWidths(image.width, widths);
	if (wanted.length === 0) return [];
	return decodeSlot(async () => {
		const variants: ProcessedVariant[] = [];
		for (const width of wanted) {
			const resized = sharp(image.data, {
				limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
				failOn: "error",
			}).resize({ width });
			const { data, info } =
				image.format === "png"
					? await resized.png().toBuffer({ resolveWithObject: true })
					: await resized
							.jpeg({ quality: VARIANT_JPEG_QUALITY, mozjpeg: true })
							.toBuffer({ resolveWithObject: true });
			if (info.width !== width) {
				throw new Error(`a ${width} px copy came out ${info.width} px wide`);
			}
			variants.push({ data, width, height: info.height });
		}
		return variants;
	});
}
```

`processImage` itself does not change.

### `ImageService` (full shape; keep the existing doc comments and extend them)

- `IMAGE_PURPOSES` becomes `{ visibility, variants }`: `payment_qr: { visibility: "public", variants: NO_VARIANTS }`, `payment_proof: { visibility: "private", variants: NO_VARIANTS }`, `artist_photo: { visibility: "public", variants: VARIANT_WIDTHS }`, `reference_image: { visibility: "private", variants: VARIANT_WIDTHS }`, still `as const`. Its comment says a new purpose picks its copies here.
- New exports: `THUMBNAIL_WIDTH = 320` ("the copy dashboard lists and grids show: ui.md, never the full-size file"), `type ImageVariant = { url: string; width: number }`, `type ShownImage = { url: string; width: number; height: number; variants: ImageVariant[] }`.
- The key check moves from `url()` into a module function `assertKeyOf(purpose, key, tenant)` with the same condition and the message ``was given a key of another tenant or purpose (${purpose})`` (the existing test's `/another tenant or purpose/` still matches). URL building moves into a private `link(purpose, key)` (signed with `SIGNED_URL_TTL` and `PRIVATE_CACHE_CONTROL` for private purposes, `getUrl` otherwise).

```ts
	async storeBytes(
		bytes: Buffer,
		{ tenant, purpose }: { tenant: Pick<Tenant, "id">; purpose: ImagePurpose },
	): Promise<StoredImage> {
		const image = await processImage(bytes);
		const extension: ImageExtension = image.format === "png" ? "png" : "jpg";
		const base = `tenants/${tenant.id}/${purpose}/${randomUUID()}`;
		const widths = await this.storeVariants(purpose, base, extension, image);
		const key = originalKey(base, extension, widths);
		try {
			await diskFor(purpose).put(key, image.data, {
				contentType: `image/${image.format}`,
			});
		} catch (error) {
			// No record will point at the copies: take them (and any partial
			// write) away before failing.
			await this.removeAll(purpose, [
				key,
				...widths.map((width) => variantKey(base, width, extension)),
			]);
			throw error;
		}
		return { key, width: image.width, height: image.height };
	}

	/**
	 * Makes and writes the purpose's copies of `image`: the widths written,
	 * or [] when the purpose has none, the image is too narrow, or any copy
	 * failed (then none is left, and the image is stored as before TAT-112).
	 */
	private async storeVariants(
		purpose: ImagePurpose,
		base: string,
		extension: ImageExtension,
		image: ProcessedImage,
	): Promise<number[]> {
		const widths = IMAGE_PURPOSES[purpose].variants;
		if (widths.length === 0) return [];
		const written: string[] = [];
		try {
			const variants = await this.makeVariants(image, widths);
			for (const variant of variants) {
				const key = variantKey(base, variant.width, extension);
				written.push(key); // before the put: a half-written file goes too
				await diskFor(purpose).put(key, variant.data, {
					contentType: `image/${image.format}`,
				});
			}
			return variants.map((variant) => variant.width);
		} catch (error) {
			logger.warn(
				{ err: error, purpose },
				"image copies could not be stored; keeping the image without them",
			);
			await this.removeAll(purpose, written);
			return [];
		}
	}

	/** makeVariants (image_processor), as a method so a test can make it fail. */
	protected makeVariants(
		image: ProcessedImage,
		widths: readonly number[],
	): Promise<ProcessedVariant[]> {
		return makeVariants(image, widths);
	}
```

- `url(purpose, key, tenant)`: `assertKeyOf`, then `link(purpose, key)`. Behaviour unchanged.
- `variants(purpose, key, tenant): Promise<ImageVariant[]>`: `assertKeyOf`, then `variantsOfKey(key)` mapped to `{ url: await this.link(purpose, copy.key), width: copy.width }`. `[]` for a key without copies. Doc: same access rule as `url()` (load the owning record scoped to the tenant first); private copies are signed for 5 minutes with `private, no-store`; built from the key alone, no I/O.
- `urlFor(purpose, key, tenant, width): Promise<string>`: `assertKeyOf`, then the narrowest copy with `copy.width >= width`, else `key` itself, through `link`. Doc: what a thumbnail shows (`THUMBNAIL_WIDTH`); the image itself when no copy is that wide (it is then the widest there is) or when it has none.
- `shownImage(purpose, key, tenant, { width, height }): Promise<ShownImage>`: `{ url: await this.url(...), width, height, variants: await this.variants(...) }`. Doc: an image as the public API shows it (`Image`, `Photo`).
- `delete(purpose, key)`: `await this.removeAll(purpose, [key, ...variantsOfKey(key).map((copy) => copy.key)])`. `removeAll` is the old `delete` body in a loop: each key on its own, failures logged with the existing message and fields, never thrown.

### Public reads

- `studio_page_service.ts`: drop `ShownPhoto`; `ShownArtist.photo` is `ShownImage | null`. `photoOf` returns `this.images.shownImage(PHOTO, photoKey, tenant, { width: photoWidth, height: photoHeight })`. Still one query per read.
- `public_artist_transformer.ts`: the photo object gains `variants: artist.photo.variants.map(({ url, width }) => ({ url, width }))`, written out field by field like the rest.

### `openapi.yaml`

Add after `Photo`:

```yaml
    ImageVariant:
      type: object
      description: |
        A smaller copy of an image (TAT-112), for `srcset`: the same picture
        in the same format, `width` px wide; its height keeps the image's
        aspect ratio.
      required: [url, width]
      additionalProperties: false
      properties:
        url:
          type: string
          format: uri
          description: Absolute, on the same origin as the image's `url`.
        width: { type: integer, minimum: 1 }
```

In `Image` and `Photo`, add `variants` to `required` and to `properties`:

```yaml
        variants:
          type: array
          maxItems: 8
          description: |
            Smaller copies, narrowest first, each narrower than `width`
            (320, 640 and 1280 px, those below the image's own width). Empty
            for an image stored before them or too small to have any: then
            show `url` alone. Build `srcset` from these and `url` at `width`.
          items: { $ref: "#/components/schemas/ImageVariant" }
```

`Photo`'s description adds "and its smaller copies". Then `pnpm --filter @tattoo-drip/types generate`, and `packages/types/src/index.ts` exports `export type ImageVariant = Schemas["ImageVariant"];` after `Photo`.

### Dashboard

- `app/modules/inquiries/reference_view.ts` (new): `export async function referenceView(images: ImageService, tenant: TenantRef, image: Pick<ReferenceImage, "id" | "imageKey" | "width" | "height">)` returns `{ id, url: await images.url("reference_image", key, tenant), thumbnailUrl: await images.urlFor("reference_image", key, tenant, THUMBNAIL_WIDTH), width, height }`. Its comment: what the reference grid gets; load the image tenant- and member-scoped first, which is the access check; both URLs are signed for 5 minutes and `no-store`. Use `import type` for `ImageService` and `ReferenceImage` here (it is a function, not an `@inject()` class). Use the same tenant type the controllers already pass.
- The three controllers replace their inline mapping with `Promise.all(images.map((image) => referenceView(this.images, tenant, image)))`.
- `ReferenceProps` gains `thumbnailUrl: string` (comment: the signed 320 px copy, or the image itself when it has none). `ReferenceGrid` uses `src={reference.thumbnailUrl}` and adds `decoding="async"`; `href` stays `reference.url`; the component comment says so.
- `ArtistsController.toProps`: `photoUrl` becomes `this.images.urlFor("artist_photo", artist.photoKey, tenant, THUMBNAIL_WIDTH)` (the comment in `inertia/components/artists.ts:9` says it is the photo's 320 px copy). `pages/artists/index.tsx` adds `loading="lazy"` and `decoding="async"` to the photo.

### Storefront

- `src/studio/srcset.ts` (new, pure; imports only `safeImageUrl` from `./links.ts`):

```ts
/** At most this many variants are read (the contract's maxItems). */
const MAX_VARIANTS = 8;
/** What ends a srcset candidate early, or has no place in a URL. */
const UNSAFE = /[\s\p{Cc},]/u;

function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/**
 * The `srcset` of an image (TAT-112): the API's `variants` (smaller copies,
 * `{ url, width }`) and the image's own `src` at `width`, narrowest first, or
 * undefined when no variant passes: the page then shows `src` alone, as it
 * did before. Pure. A variant is kept when its URL has no space, control
 * character or comma, passes safeImageUrl, and is on exactly `src`'s origin,
 * and its width is a whole number from 1 to below `width`; one variant per
 * width, the first. The page builds the string; the API never sends one.
 */
export function readSrcSet(
	variants: unknown,
	src: string,
	width: number,
): string | undefined {
	if (!Array.isArray(variants) || UNSAFE.test(src)) return undefined;
	const origin = new URL(src).origin;
	const kept = new Map<number, string>();
	for (const item of variants.slice(0, MAX_VARIANTS)) {
		const url = own(item, "url");
		const candidateWidth = own(item, "width");
		if (typeof url !== "string" || UNSAFE.test(url)) continue;
		if (
			!Number.isInteger(candidateWidth) ||
			(candidateWidth as number) < 1 ||
			(candidateWidth as number) >= width ||
			kept.has(candidateWidth as number)
		) {
			continue;
		}
		const safe = safeImageUrl(url);
		if (safe === null || UNSAFE.test(safe) || new URL(safe).origin !== origin) {
			continue;
		}
		kept.set(candidateWidth as number, safe);
	}
	if (kept.size === 0) return undefined;
	const candidates = [...kept]
		.sort(([a], [b]) => a - b)
		.map(([candidateWidth, url]) => `${url} ${candidateWidth}w`);
	return [...candidates, `${src} ${width}w`].join(", ");
}

/**
 * Each image slot's `sizes`: the width it is drawn at, from styles.css
 * (test/studio/srcset.test.ts pins both sides). A wider guess only costs a
 * bigger copy; a narrower one a soft image.
 */
export const IMAGE_SIZES = {
	rosterPhoto: "(min-width: 48rem) 9rem, 7rem",
	profilePhoto: "20rem",
	cover: "(min-width: 74.5rem) 72rem, calc(100vw - 2.5rem)",
	profileLogo: "12rem",
	siteBarLogo: "6rem",
	depositLogo: "8rem",
} as const;
```

  This logic was run in a scratch copy: it orders `640, 320, 320(dup)` as `320 (first), 640, src`, drops another origin, http on an https image, another port, `javascript:`, credentials, a space, a comma, a width equal to the image's, a string width, 10.5 and an inherited `url`, and gives `undefined` for a `src` with a comma.

- `view-model.ts`: `ArtistPhoto` gains `readonly srcSet?: string` ("the photo and its smaller copies, when the API sent any (readSrcSet)"). `photoView` adds it with a conditional spread, `...(srcSet ? { srcSet } : {})`, where `srcSet = readSrcSet(photo.variants, src, photo.width)`. Update the comment at `:107`.
- `theme/config.ts`: `BrandImage` gains `readonly srcSet?: string`. `readBrandImage` adds it the same way from `own(value, "variants")` (its comment: copies must be on the image's origin, which is the API's). `readCoverImage` keeps it through its spread.
- `components/artists.tsx`: `PhotoFigure` takes `sizes: string`, renders `srcSet={photo.srcSet}` and `sizes={photo.srcSet ? sizes : undefined}` right after `src`. The roster passes `IMAGE_SIZES.rosterPhoto`, the profile `IMAGE_SIZES.profilePhoto`. Update the comment at `:4-9`.
- `components/brand.tsx`: `BrandLogo` takes `sizes: string`; both components render `srcSet`/`sizes` the same way (`BrandCover` uses `IMAGE_SIZES.cover`). `pages.tsx` passes `IMAGE_SIZES.profileLogo` (`:39`) and `IMAGE_SIZES.siteBarLogo` (`:133`).
- `deposit-page.tsx`: the header logo renders `srcSet={logo.srcSet}` and `sizes={logo.srcSet ? IMAGE_SIZES.depositLogo : undefined}` after `src`; `referrerPolicy` stays.
- `deposit/loader.ts:13-15`: "never the colours, the font or the cover (the page stays violet and writes no brand style, and a cover would compete with the QR on a payment page: TAT-110)".

## 7. Tasks

Every task: write the failing test first, run it and see it fail, implement, run again, commit. The builder ends each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every message below passed `pnpm exec commitlint` (subject and body, lines at most 100 characters).

Platform test commands below abbreviate `DB_DATABASE=tattoo_drip_uy PORT=3422 SESSION_DRIVER=memory timeout -s KILL 300 pnpm -C apps/platform exec node ace test` as `PT`. If several `--files` aren't taken at once, run them one after another.

### T0. Baseline (no commit)

- `PT unit --files=image_processor.spec.ts`, `PT functional --files=image_service.spec.ts`, `PT functional --files=artist_photo.spec.ts`, `PT functional --files=public_artists.spec.ts`: all green before any change. `pnpm --filter @tattoo-drip/storefront test` green.
- Note the time of `PT functional --files=inquiries.spec.ts` (intake with references) for the comparison in Section 9.

### T1. Keys that name their copies (`variants.ts`)

- Failing test first: new `apps/platform/tests/unit/modules/media/variants.spec.ts`, group `image copies' keys (TAT-112)`. It fails today: the module doesn't exist.
  1. `variantWidths`: 2048 gives `[320, 640, 1280]`; 1281 gives all three; 1280 gives `[320, 640]`; 641 gives `[320, 640]`; 640 gives `[320]`; 321 gives `[320]`; 320, 300 and 1 give `[]`; with `NO_VARIANTS`, 2048 gives `[]`.
  2. Round trip: `originalKey(base, "jpg", [320, 640, 1280])` is `${base}.320-640-1280.jpg`, and `variantsOfKey` of it gives widths `[320, 640, 1280]` with keys `${base}.320w.jpg`, `${base}.640w.jpg`, `${base}.1280w.jpg`; the same for `png`; `originalKey(base, "png", [])` is `${base}.png` (the old form).
  3. Every copy's key starts with the image's `tenants/<tenant>/<purpose>/` prefix.
  4. Keys that name no copies (a table): the old form `.jpg` and `.png`, the test helper's `.webp`, a copy's own key `.320w.jpg`, `.640-320.jpg`, `.320-320.jpg`, `.0.jpg`, `.0320.jpg`, `.12345.jpg`, `.320.gif`, `.320.jpg.exe`, `tenants/a/../b/x.320.jpg`, nine widths `.1-2-3-4-5-6-7-8-9.jpg`, `.320-640.JPG`, a trailing `\n`, `""`.
- Implement: `variants.ts` exactly as in Section 6.
- Run: `PT unit --files=variants.spec.ts`.
- Commit:

```
feat(platform): name image copies in the key so any reader can find them (TAT-112)

app/modules/media/variants.ts holds VARIANT_WIDTHS (320, 640, 1280), variantWidths (an
image is never enlarged) and the key layout: an image with copies is <id>.320-640-1280.jpg,
each copy <id>.320w.jpg beside it, and a key of the old form names none. Pure, so finding
the copies takes no query and no disk read.
```

### T2. Making the copies (`makeVariants`)

- Test helpers first (`tests/helpers/images.ts`): `phonePhoto(width = 300, height = 200)` (existing callers unchanged); `transparentPng(width, height)` (4 channels, alpha 0.5); `polyglot()`: `Buffer.concat([await testImages.jpeg(1000, 800), Buffer.from("<html><script>alert(1)</script></html>PK\x03\x04polyglot")])`; and exported `POLYGLOT_MARKERS = ["<script>", "PK\x03\x04"]`.
- Failing tests first, in `tests/unit/modules/media/image_processor.spec.ts`, new group `makeVariants (TAT-112)`. They fail today: `makeVariants` is not exported.
  1. "makes 320, 640 and 1280 px copies of a big photo, narrowest first, as JPEG": `processImage(jpeg(4000, 3000))` is 2048 × 1536; `makeVariants(image, VARIANT_WIDTHS)` gives widths `[320, 640, 1280]` and heights `[240, 480, 960]`; each `sharp(data).metadata()` is `jpeg` with exactly that width; each is smaller in bytes than the image.
  2. "never enlarges": a processed 640 × 480 gives `[320]`; 320 × 240 and 300 × 200 give `[]`; `NO_VARIANTS` gives `[]` for 2048.
  3. "a PNG's copies stay PNG, with their transparency": `processImage(transparentPng(1000, 400))` then copies are `png` with `hasAlpha`.
  4. "a strip 4000 × 2 px: copies 1 px tall, never 0": `png(4000, 2)` is processed to 2048 × 1; copies 320, 640, 1280 wide, each 1 px tall.
  5. "copies carry no metadata": from `phonePhoto(1200, 900)` (EXIF and GPS), every copy's `metadata().exif` is undefined.
  6. "a polyglot: neither the image nor its copies keep what came after it": `processImage(polyglot())`, then neither `image.data` nor any copy's `data` includes a `POLYGLOT_MARKERS` entry.
  7. "refuses anything larger than processImage's output": `makeVariants({ data: await testImages.jpeg(3000, 3000), format: "jpeg", width: 3000, height: 3000 }, VARIANT_WIDTHS)` rejects.
- Implement: Section 6's `makeVariants`, `ProcessedVariant`, `VARIANT_JPEG_QUALITY`, importing `variantWidths` from `#modules/media/variants`. Extend the file's header comment: copies come from the cleaned image only.
- Run: `PT unit --files=image_processor.spec.ts`.
- Commit:

```
feat(platform): make 320, 640 and 1280 px copies of a cleaned image (TAT-112)

makeVariants resizes processImage's output (at most 2048 px a side; anything larger is
refused) to each width below its own, in its own format (JPEG at quality 80, PNG stays
PNG), one width at a time inside a decode slot. Tests cover a strip 1 px tall, PNG
transparency, no metadata and a polyglot upload.
```

### T3. Storing and reading the copies (`ImageService`)

- Failing tests first, in `tests/functional/media/image_service.spec.ts`, new group `ImageService copies (TAT-112)`. Give each test its own tenant (`{ id: randomUUID() }`), because `tmp/storage` is only cleared per run and the file counts below read whole folders. Add a local helper `filesOf(visibility, tenant, purpose)` that `readdir`s `app.tmpPath("storage", visibility, "tenants", tenant.id, purpose)` (`[]` when missing), sorted. They fail today: keys have no widths, and `variants`/`urlFor`/`shownImage` don't exist.
  1. "an artist photo is stored with its 320, 640 and 1280 px copies beside it, on the public disk": `store(upload(jpeg(2000, 1500)), artist_photo)`; the key matches `^tenants/<id>/artist_photo/<V4>\.320-640-1280\.jpg$`; `filesOf("public", …)` has exactly 4 files; `filesOf("private", …)` is empty; each copy's width read with sharp is its name's width.
  2. "QR codes and payment screenshots keep one size": `payment_qr` with `png(2000, 1500)` gives `<V4>.png` and 1 file; `payment_proof` with `jpeg(2000, 1500)` gives `<V4>.jpg` and 1 file.
  3. "an image 320 px wide or narrower is stored as before, without copies": `artist_photo` with `jpeg(320, 240)` gives `<V4>.jpg` and 1 file.
  4. "variants() gives each copy's public URL, narrowest first, on the image's origin": URLs equal `${APP_URL}/uploads/<copy key>`, widths `[320, 640, 1280]`, each `new URL(u).origin` equals the origin of `url()`; GET of each is 200 `image/jpeg`. A key of the old form (`tenants/<id>/artist_photo/<uuid>.jpg`) gives `[]`.
  5. "a reference image's copies are private: signed, and never kept": `reference_image` with `jpeg(1000, 800)` (copies 320 and 640). Each `variants()` URL starts with `${APP_URL}/files/<copy key>?` and has `signature=`; GET is 200 with `cache-control: private, no-store`; `/files/<copy key>` unsigned is 401; the signed 320 URL with `.320w.` replaced by `.640w.` is 401; `/uploads/<copy key>` is 404; dropping `cacheControl` from a signed copy URL is 401.
  6. "variants() and urlFor() refuse a key of another tenant or purpose, as url() does": the three cases of the existing refusal test (`:118-144`), for both methods.
  7. "urlFor gives the narrowest copy at least that wide, else the image": for the 1000 px reference, `urlFor(…, 320)` is the `.320w.jpg` copy (signed), `urlFor(…, 321)` the `.640w.jpg`, `urlFor(…, 700)` the image itself; a key of the old form gives the image itself. Compare pathnames (signatures carry times).
  8. "shownImage gives the URL, the stored size and the copies": for the 2000 px artist photo, `{ url: await url(…), width: 2000, height: 1500, variants: await variants(…) }`.
  9. "when the copies can't be made, the upload is still stored, as before": `class NoCopies extends ImageService { protected override makeVariants() { return Promise.reject(new Error("no copies")); } }`; `store(upload(jpeg(2000, 1500)), artist_photo)` resolves with a `<V4>.jpg` key, the folder has exactly that one file, and `variants()` is `[]`.
  10. "a polyglot upload: the image and its copies are clean": `store(upload(polyglot()), artist_photo)`; read every file in the folder from disk; none includes a `POLYGLOT_MARKERS` entry.
  11. "a phone photo's copies have no EXIF or GPS": `store(upload(phonePhoto(1200, 900)), reference_image)`; every copy file's `metadata().exif` is undefined.
- Implement: Section 6's `ImageService` (everything but `delete`, which is T4). Keep `store()` as is (it calls `storeBytes`).
- Run: `PT functional --files=image_service.spec.ts` (and `--files=file_serving.spec.ts`).
- Commit:

```
feat(platform): store image copies with the upload, best effort (TAT-112)

Artist photos and reference images get copies (IMAGE_PURPOSES.variants); QR codes and
payment screenshots keep one size. When a copy fails, the image is stored as before,
without any. variants(), urlFor() and shownImage() build the copies' URLs from the key,
signed and no-store for private purposes, behind url()'s tenant and purpose check.
```

### T4. Deleting an image deletes its copies

- Failing tests first (they fail after T3: `delete` removes one file):
  1. `image_service.spec.ts`: "delete removes the image and every copy; a copy already gone is no error": store a 2000 px artist photo, delete its 640 copy by hand, then `images.delete(artist_photo, key)` resolves and `filesOf` is empty; a second `delete` resolves too.
  2. `artist_photo.spec.ts` (use `const widePhoto = async () => uploadOf(await testImages.jpeg(1000, 800))` and `variantsOfKey`):
     - "replacing a photo deletes the old photo's copies after the commit and keeps the new ones" (the stale-copy case; model it on `:100-128`): inside the context the old copies still exist; after it, the old image and copies are gone and the new image and copies exist; their keys share no id.
     - "removePhoto deletes the copies too" (model `:198-216`).
     - "a slug conflict after the photo was stored removes the new photo and its copies" (model `:218-242`).
- Implement: `delete` through `removeAll` (Section 6).
- Run: `PT functional --files=image_service.spec.ts`, `PT functional --files=artist_photo.spec.ts`.
- Commit:

```
feat(platform): deleting an image deletes its copies too (TAT-112)

ImageService.delete removes the image and every copy its key names, each best effort.
Replacing, removing or rolling back an artist photo leaves no copy behind.
```

### T5. The contract

- Failing test first: add `variants: []` to `SITA.photo` (`apps/storefront/test/studio/fixtures.ts:46`), to each photo literal in `test/studio/view-model.test.ts:186-205` and `test/studio/render.test.ts:215`, and `variants: [{ url: "https://api.example.com/uploads/tenants/t/artist_photo/p.320w.png", width: 320 }]` to the SDK's `ARTIST.photo` (`packages/sdk/test/client.test.ts:709`; its round-trip tests then pin that the SDK passes `variants` through). `pnpm --filter @tattoo-drip/sdk typecheck` and `pnpm --filter @tattoo-drip/storefront typecheck` fail: "Object literal may only specify known properties".
- Implement: the `openapi.yaml` edits in Section 6, `pnpm --filter @tattoo-drip/types generate`, the `index.ts` export.
- Run: `pnpm --filter @tattoo-drip/types typecheck && pnpm --filter @tattoo-drip/sdk typecheck && pnpm --filter @tattoo-drip/sdk test && pnpm --filter @tattoo-drip/react typecheck && pnpm --filter @tattoo-drip/react test && pnpm --filter @tattoo-drip/storefront typecheck && pnpm --filter @tattoo-drip/storefront test` (the default pages' byte-for-byte snapshot must still pass: an empty list renders nothing new).
- Commit:

```
feat(types): images carry their smaller copies as variants, for srcset (TAT-112)

Image and Photo gain variants, a list of ImageVariant { url, width }: narrowest first, at
most 8, on the image's own origin, [] when there are none. Required like every property;
older storefronts ignore it. The SDK and storefront fixtures gain variants.
```

### T6. The public artist photo lists its copies

- Failing tests first:
  1. `public_artists.spec.ts`: `PHOTO_FIELDS` becomes `["height", "url", "variants", "width"]`, and the 300 × 200 photo's deepEqual gains `variants: []` (fails today: no field).
  2. Same file, new test "a wide photo has its smaller copies, narrowest first, on the photo's origin and in the studio's own folder": `addArtist` with `uploadOf(jpeg(2000, 1500))`; the answer's `photo.variants` has widths `[320, 640, 1280]`, each URL's origin equals `photo.url`'s, each pathname matches `^/uploads/tenants/<tenant.id>/artist_photo/`, each `Object.keys(variant).sort()` is `["url", "width"]`, and GET of each is 200.
  3. `studio_page_service.spec.ts:177-192`: the expected photo gains `variants: []`. New test "photos with copies cost no extra query": with `recordQueries`, `visibleArtists` for a studio with two 1000 px photos makes as many queries as for a studio with two artists without photos.
- Implement: Section 6's public reads.
- Run: `PT functional --files=public_artists.spec.ts`, `PT functional --files=studio_page_service.spec.ts`, `PT functional --files=studio_page_privacy.spec.ts`, `PT functional --files=public_api.spec.ts`.
- Commit:

```
feat(platform): the public artist photo lists its smaller copies (TAT-112)

StudioPageService builds the photo with ImageService.shownImage and the transformer writes
its variants. Still one query per read: the copies come from the key.
```

### T7. Dashboard thumbnails

- Failing tests first (they fail today: no `thumbnailUrl`, and `photoUrl` is the full image):
  1. `inquiries/inbox.spec.ts`, new test "the inquiry page's grid shows the signed 320 px copy and opens the original": in the tenant context, `new ImageService().storeBytes(await testImages.jpeg(1000, 800), { tenant, purpose: "reference_image" })`, then `makeReferenceImage(tenant, { inquiryId, imageKey: stored.key, width: 1000, height: 800 })`. `props.references[0].thumbnailUrl`'s pathname ends with `.320w.jpg` and it has `signature=` and `cacheControl=`; `url`'s pathname ends with `.320-640.jpg`. In the existing test (`:159-205`, the helper's fake `.webp` key) `thumbnailUrl`'s pathname equals `url`'s.
  2. `projects/project_page.spec.ts:492-493` and `clients/clients_pages.spec.ts:191-192`: also `assert.match(...references[0].thumbnailUrl, /signature=/)`.
  3. `artists/artists_page.spec.ts`: a new test with an artist whose photo is `jpeg(1000, 800)`: `photoUrl`'s pathname ends with `.320w.jpg`.
- Implement: Section 6's dashboard part (`reference_view.ts`, the three controllers, `ReferenceProps`, `ReferenceGrid`, `toProps`, the artists list attributes).
- Run: `PT functional --files=inbox.spec.ts`, `--files=project_page.spec.ts`, `--files=clients_pages.spec.ts`, `--files=artists_page.spec.ts`, `--files=artist_form.spec.ts`, then `pnpm -C apps/platform typecheck`. Then the role and isolation specs that touch these pages: `PT functional --files=role_access.spec.ts`, `--files=cross_tenant.spec.ts` (no lock needed: neither is `setup_roles` or `role_guard`).
- Commit:

```
feat(platform): dashboard thumbnails load the 320 px copy, not the full photo (TAT-112)

The reference grids (inquiry, project and client pages) show thumbnailUrl, the signed
320 px copy, and still open the original. The artists list and form show the photo's
320 px copy. No change to who may see what: the same scoped reads come first.
```

### T8. A checked `srcset` (`srcset.ts`)

- Failing test first: new `apps/storefront/test/studio/srcset.test.ts` (fails today: no module). Use `S = "https://api.example.com/uploads/tenants/t/artist_photo/p.320-640.jpg"` at width 1200.
  1. `undefined` for `undefined`, `null`, `{}`, `"a 320w"` (a string) and `[]`.
  2. Builds `"<320> 320w, <640> 640w, S 1200w"` from a list sent 640 first; a second 320 entry is ignored (the first wins).
  3. Drops (a table; each alone gives `undefined`): another origin `https://evil.example/x.jpg`; `http://api.example.com/x.jpg` (another scheme); `https://api.example.com:8443/x.jpg` (another port); `javascript:alert(1)`; `data:image/png;base64,AAAA`; `https://u:p@api.example.com/x.jpg`; a space, a tab, a newline, `\u0000` and a comma in the URL; a URL of 2049 characters; widths `0`, `-320`, `10.5`, `"320"`, `1200` (equal) and `1600` (wider); an item that is a string, `null` or an array; an item whose `url` and `width` are inherited (`Object.create({ url, width: 320 })`).
  4. A hostile item next to a good one: only the good one is kept.
  5. Only the first 8 items are read: 8 junk items then a good one give `undefined`.
  6. A `src` with a comma gives `undefined`, whatever the variants.
  7. `IMAGE_SIZES` mirrors `styles.css`: read `../../src/styles.css` (as `test/deposit/styles.test.ts:12-15` does) and assert it includes `.page { width: min(72rem, 100% - 2.5rem);`, `.profile-logo { display: block; inline-size: auto; max-inline-size: min(12rem, 100%);`, `.site-bar-logo { display: block; inline-size: auto; max-inline-size: 6rem;`, `.artist { display: grid; grid-template-columns: 7rem minmax(0, 1fr);`, `@media (min-width: 48rem) {` followed by `.artist { grid-template-columns: 9rem minmax(0, 1fr); }`, `.artist-profile .artist-photo { max-width: 20rem; }` and `.deposit-logo { display: block; inline-size: auto; max-inline-size: 8rem;`; and that each `IMAGE_SIZES` value equals the strings in Section 6.
- Implement: `src/studio/srcset.ts` as in Section 6.
- Run: `pnpm -C apps/storefront exec node --import tsx --test test/studio/srcset.test.ts`.
- Commit:

```
feat(storefront): build a checked srcset from the API's image variants (TAT-112)

readSrcSet keeps a variant only on the image's own origin, with a whole width below the
image's, and a URL with no space, comma or control character; the page builds the string
itself. IMAGE_SIZES holds each image slot's sizes, pinned to its width in styles.css.
```

### T9. Photos, logos and the cover use it

- Failing tests first (attribute names matched case-insensitively, since React writes some in camelCase):
  1. `view-model.test.ts`: a `SITA_SIZED` (SITA with two variants on `api.example.com`) gives `photo.srcSet` equal to the expected string; with a variant on `evil.example` added, that one is dropped and the photo stays; SITA (no variants) has no `srcSet` key (`assert.equal("srcSet" in view.photo, false)`).
  2. `theme-config.test.ts`: a logo and a cover with variants on `IMAGE_ORIGIN` get `srcSet`; the same variants on `https://evil.example` are dropped and the images stay; the cover keeps its `alt` beside its `srcSet`; a logo without variants deepEquals `{ src, width, height }` as today.
  3. `render.test.ts`: with `SITA_SIZED`, the roster `<img>` has a `srcset` and `sizes="(min-width: 48rem) 9rem, 7rem"` and is still `loading="lazy"`; the artist page's has `sizes="20rem"` and is still eager and high; the SEO `og:image` is still `SITA_PHOTO_URL`; ARJUN (no photo) and SITA (no variants) render no `srcset` or `sizes`.
  4. `theme-render.test.ts`: a branded studio whose logo and cover have variants renders the logo with `sizes="12rem"`, the artist page's bar logo with `sizes="6rem"`, the cover with `sizes="(min-width: 74.5rem) 72rem, calc(100vw - 2.5rem)"`; the preload test (`:217-234`) still holds with variants (the cover's preload carries its srcset; the logo has none).
  5. `deposit/render.test.ts`: a logo with `srcSet` renders `srcset` and `sizes="8rem"` and keeps `referrerpolicy="no-referrer"`; the existing logo test (`:161-185`) is unchanged.
  6. `safety.ts` (`assertSafePage`), in its image loop: an `<img>` with `srcset` also has a non-empty `sizes`; every candidate (split on `", "`, attribute decoded) matches `/^https?:\/\/[^\s,]+ [1-9]\d*w$/`; an `<img>` without `srcset` has no `sizes`. The branded and hostile pages still pass.
- Implement: Section 6's storefront changes (`view-model.ts`, `theme/config.ts`, `artists.tsx`, `brand.tsx`, `pages.tsx`, `deposit-page.tsx`, the loader comment).
- Run: `pnpm --filter @tattoo-drip/storefront test && pnpm --filter @tattoo-drip/storefront typecheck`. The byte-for-byte default-page snapshot and the hostile-config snapshot must pass unchanged.
- Commit:

```
feat(storefront): photos, logo and cover load the copy that fits the screen (TAT-112)

Artist photos, the studio's logo and cover, and the deposit page's logo get srcset and
sizes when the API sent variants. Without them the markup is byte for byte what it was.
```

### T10. Docs

- Section 8. Then `pnpm check`.
- Commit:

```
docs: image copies, srcset and 320 px thumbnails (TAT-112)

backend.md, ui.md, development.md, sdk.md and architecture.md say which images get
copies, how their keys name them, what the API sends and what the pages load.
```

### T11. Browser pass and final gates (no commit unless a fix is needed)

Section 9's browser list, then Section 10.

## 8. Docs to update

- `apps/platform/docs/backend.md`:
  - Images bullet (`:66`): copies (TAT-112). `IMAGE_PURPOSES` gives each purpose its visibility and its copies: artist photos and reference images get 320, 640 and 1280 px (those narrower than the image), and QR codes and payment screenshots keep one size. Copies are made in the request, from the cleaned image, inside a decode slot, one width at a time, in the image's format (JPEG at 80, PNG stays PNG). The key names them (`<id>.320-640-1280.jpg`, each copy `<id>.320w.jpg`; `#modules/media/variants`), so the record keeps one key and no query finds them. A failed copy stores the image without copies, as before. `delete` removes the copies too. `variants()` / `urlFor()` / `shownImage()` follow `url()`'s rules (private copies signed, `no-store`). `THUMBNAIL_WIDTH` is what lists and grids show. Images stored before TAT-112 have no copies (no backfill). A new purpose picks its copies in `IMAGE_PURPOSES`, and a public image is built with `shownImage`.
  - Studio page reads (`:53`): "a photo is `ImageService.shownImage` of the public `artist_photo` key: its URL, size and `variants`", and "the tenant id (except inside a photo's or its copies' URL path)".
  - Reference images (end of `:66`): the dashboard signs `url` and `thumbnailUrl` through `referenceView` (`#modules/inquiries/reference_view`); TAT-109's list calls `urlFor(…, THUMBNAIL_WIDTH)`.
- `apps/platform/docs/ui.md:40`: append "Reference grids use `thumbnailUrl` and artist photos `photoUrl`, both the 320 px copy (`ImageService.urlFor` with `THUMBNAIL_WIDTH`); the link opens the full image."
- `apps/storefront/docs/development.md`:
  - `:84` (studio page photos): photos come with their smaller copies when the API has them: `srcset` (built by `readSrcSet` in `src/studio/srcset.ts` from the API's `variants`, each on the photo's own origin) and `sizes` (`IMAGE_SIZES`, pinned to `styles.css`); without variants only `src`, as before; `src` stays the stored image (and `og:image`).
  - `:95` (theme checks): a logo's or cover's `variants` pass the same rule: the API's origin, no space, comma or control character, a whole width below the image's, at most 8.
  - `:100` (brand images): their `sizes`.
  - `:105` (known limits): copies of an artist photo must share the photo's origin.
  - `:128` (deposit layout): the logo gets `srcset`/`sizes="8rem"`; the cover stays off the page because it competes with the QR (TAT-110).
  - Wherever it says "no smaller variant yet", remove it.
- `docs/sdk.md:31`: `photo` is `{ url, width, height, variants }` or null; `variants` are `{ url, width }`, narrowest first, for `srcset`, `[]` when none.
- `docs/architecture.md:116`: "Copies at 320, 640 and 1280 px are made in the request too, from the cleaned image (TAT-112): artist photos and references; QR codes and payment screenshots keep one size."

## 9. Acceptance with measurable checks, and the browser check list

Automated (in CI, under `pnpm test`):

- A 2000 × 1500 artist photo stores exactly 4 files on the public disk (the image and 3 copies) and none on the private disk. A 320 px-wide image, a QR code and a payment screenshot store 1 file each, with a key of the old form.
- The public artist photo has exactly `url`, `width`, `height` and `variants`; a 2000 px photo has 3 variants with widths `[320, 640, 1280]`, all on the photo's origin and in its studio's folder.
- `visibleArtists` makes as many queries with photos and copies as without (no query per photo).
- Private copies: signed, `cache-control: private, no-store`; unsigned or with the width swapped in the path, 401; on `/uploads`, 404.
- Every hostile key and every hostile variant in T1, T3, T8 and T9 is refused or dropped.
- Without variants, the studio and artist pages render byte for byte as before (snapshot).

Manual (browser pass, Lane B, not in CI). Platform dev on 3421 with `DB_DATABASE=tattoo_drip_uy`; storefront from `apps/storefront` with `API_URL=http://localhost:3421 STOREFRONT_URL='http://{tenant}.localhost:3424' pnpm exec vite dev --port 3424 --strictPort`. In the scratchpad, generate a photo-like 2400 × 3000 JPEG (sharp with gaussian noise, so it weighs like a photo) and a 300 × 375 one. In a throwaway studio, add an artist "Sita Rai" with the big photo, an artist "अर्जुन थापा" with a 1000 × 1250 photo, and one with the small photo. Run `pnpm seed:dev` against `tattoo_drip_uy` for references.

- At 375 × 812 (DPR 2, then DPR 3) and 1280 × 800 (DPR 1, then DPR 2), light and dark:
  - The studio page roster: Sita's `img.currentSrc` ends with `.320w.jpg` at 375/DPR 2, `.640w.jpg` at 375/DPR 3 and `.320w.jpg` at 1280/DPR 1. The small-photo artist's `<img>` has no `srcset`.
  - The artist page: `.640w.jpg` at 375/DPR 2 and 1280/DPR 2, `.1280w.jpg` at 375/DPR 3, never the stored image.
  - The roster photo's transfer size is under a quarter of the stored image's (DevTools network or `performance.getEntriesByType("resource")`).
  - No layout shift while photos load (each box has its size before the image arrives); the Devanagari name's alt text is unchanged; nothing looks different in either scheme.
- With DevTools at "Slow 4G", the roster's photos arrive visibly sooner than on main (record both times; a note, not a gate).
- Dashboard (3421) at 375 and 1280: a seeded inquiry's grid loads `…320w.jpg?signature=…`; tapping a thumbnail opens the full image in a new tab; its response has `cache-control: private, no-store`; the same URL without its query is 401. The artists list and form show the 320 px copy.
- Upload an artist photo through the form again: the old image and its copies are gone from `storage/public/tenants/<id>/artist_photo/` and the new ones are there.
- The intake form with 5 large photos still sends. Compare the request's time with T0's note: no more than about 2 s longer.

## 10. Final gates

- From the root: `pnpm check`, `pnpm typecheck`, `pnpm build` (the storefront build ends with the client-bundle check).
- `pnpm --filter @tattoo-drip/storefront test`; `pnpm --filter @tattoo-drip/sdk test`; `pnpm --filter @tattoo-drip/react test`.
- `pnpm -C apps/storefront check:page` after the build (the deposit header changed).
- `packages/types/src/openapi.gen.ts` matches: run `pnpm --filter @tattoo-drip/types generate` again and expect no diff.
- The full platform suite once, with `queue_jobs` emptied first in `tattoo_drip_uy`: `DB_DATABASE=tattoo_drip_uy PORT=3422 SESSION_DRIVER=memory flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock timeout -s KILL 1500 pnpm -C apps/platform exec node ace test`. Run it in the background and wait for the notification.
- `git status` clean.

## 11. Review focus (Fable and Codex)

- **Tenant isolation and keys.** `assertKeyOf` runs before every URL is built (`url`, `variants`, `urlFor`, so `shownImage` too). `variantsOfKey` only appends a suffix to a base without dots, so a copy's key can't leave the image's `tenants/<id>/<purpose>/` folder. Another tenant's or purpose's key throws for every method.
- **Private copies.** Always signed through `link`, with `PRIVATE_CACHE_CONTROL`, never `getUrl`. Written to the purpose's own disk (never the public one). Nothing private reaches the public API or the storefront.
- **Information exposure.** The public API adds only copy URLs (the same tenant id in the path as the photo's own URL) and widths. Role scoping in the dashboard is unchanged: `referenceView` runs after the same reads.
- **Failure paths.** Half-written or orphaned files when a copy's `put`, the image's `put` or a delete fails. Does every cleanup path (`afterRollback`, `afterCommit`, `delete`) reach the copies? Is a key ever written that names a copy that doesn't exist?
- **Memory and CPU.** `makeVariants` only takes processImage's output (`limitInputPixels`), holds one decode slot, one width at a time. The extra time on an anonymous intake with 5 references.
- **The storefront's checks.** Origin, characters (comma), width bounds, at most 8, own properties only. The string is built by the page, never taken from the API. `sizes` must match the CSS; a page without variants must be unchanged byte for byte.
- **Accessibility.** Alt text unchanged; boxes keep `width`/`height`; no new interaction.
- **Query counts.** No new query anywhere.

## 12. Risks and rollback

1. **Slower uploads.** About 0.1 to 0.35 s more per large image, and up to about 1.8 s for an intake with 5 large references while it holds a connection and a write slot. Levers if it matters: give `reference_image` only `[320, 640]`, or move copies to a job later (that needs a second write to the record).
2. **More storage.** About 40 to 50 % more per image with copies (the 1280 copy dominates). No quota exists yet; R2 storage is cheap.
3. **`sizes` drift.** A CSS change that resizes a photo slot without updating `IMAGE_SIZES` makes the browser pick a copy too big or too small. A test pins both sides.
4. **No backfill.** Images stored before this ticket load full size until re-uploaded. There are none in production.
5. **Public files have no `Cache-Control`** (the drive's file server sends ETag and Last-Modified only). Keys are immutable, so a long `max-age, immutable` can come with TAT-27 or a CDN. A deleted photo's old URL may stay in a cache until then, as originals do today.
6. **A browser that supports `srcset` but cannot decode a copy** shows a broken image. The copies are the same JPEG or PNG as the stored image, so this only happens if the copy file is missing, which D2 and D5 prevent.
7. **Rollback.** Revert the branch. Keys of the new form still open (the image's key is a real file, and the old `url()` accepts it), and the old `delete()` removes only the image, so copies become orphan files and do no harm. The contract field is additive: an old storefront ignores it, and a new storefront against an old API reads no variants and renders as before.

## 13. User-only decisions (defaults the builder uses)

- **U1. QR codes and payment screenshots keep one size.** Default: yes, no copies. A QR must stay scannable, and owners read small print on screenshots.
- **U2. No backfill of images stored before this ticket.** Default: none (no production image exists yet). Alternative: an ace command in a follow-up.
- **U3. Copies keep the stored format (JPEG or PNG), no WebP.** Default: the same format, so iPhones stuck on iOS 12 or 13 never get a broken image. Alternative: WebP inside `<picture>`, which doubles the stored copies.
- **U4. The deposit page still shows no cover.** Default: no. TAT-110's U2 stands, because on a payment page the cover competes with the QR. The logo gets `srcset`.
- **U5. Dashboard thumbnails switch to the 320 px copy in this ticket** (the reference grids and the artists list and form). Default: yes; ui.md already forbids full-size files in lists and grids.
