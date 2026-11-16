# Storage Meter, Step 1 (Measure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every counted file's size, backfill existing files, and show each studio's storage usage against its package allowance. Nothing is refused (Rollout step 1).

**Architecture:**
- **Size rows.** `stored_files` holds one size row per stored file. `ImageService` records an image's main file and `VideoService` its renditions, in the studio's context.
- **Usage** is the sum over rows whose key a **live record** still holds (one SQL list of key columns, `liveKeysSql`), plus unexpired reservations, which arrive in step 2. So deletes, soft deletes and orphans stop counting with no delete hooks.
- **`storage:reconcile`** fills and cleans the rows from storage.
- **The allowance** comes from the entitlement's bundle. v1 bundles read their package's launch default.

**Tech Stack:** AdonisJS 7 (Lucid, Inertia + React), PostgreSQL RLS, flydrive (R2/fs), Japa, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-storage-meter-design.md`

## Global Constraints

- **Allowances:**
  - New bundles `solo-v2` (images 40, storage 5120 MB) and `studio-v2` (images 40, storage 25600 MB). `PACKAGES.<pkg>.defaultBundleKey` becomes v2.
  - A v1 bundle's null storage reads as its package's v2 number. Any other null is unmetered.
  - 1 GB = 1024 MB, 1 MB = 1048576 bytes.
- **Counted:** only the main file of each image (never `variantsOfKey` copies), each video rendition key in `video_keys`, and its poster's main file, and only while a live record holds the key. These never count:
  - staging keys
  - `fresh_ink_*` public copies
  - the files of soft-deleted `artists`, `payment_methods`, `reference_images` and `design_projects` (their assets), or of a soft-deleted `client_posts` (its media)
- **Categories:**
  - `portfolio`: `artist_work_photo`, `work_video`, `artist_photo`, `flash_design`, `studio_cover`, `studio_logo`, `studio_icon`
  - `clients`: `reference_image`, `payment_proof`, `payment_qr`, `client_post_photo`, `client_post_video`
  - `design_lab`: `design_concept`
- **Switch:** `STORAGE_ENFORCEMENT` (`observe` default, `enforce`), read by `storageEnforcement()`. Nothing in this step refuses.
- **Context:** a size row is written on the caller's open transaction when there is one, else in `withDbContext({ tenantId })`. Never two overlapping contexts.
- **Rollout:** run `node ace codegen` after route, page-prop or shared-prop changes and commit `.adonisjs/`. Commits use `feat(platform): …`.

## Review Focus

1. **A soft-deleted artist or payment method:** its file stops counting at once, although its row and file remain. *(Task 2 test `soft-deleted records and orphans don't count`.)*
2. **An image's size copies and a published post's public copies never count.** *(Task 2 test `only main files, renditions and posters count`.)*
3. **A studio on a v1 plan or pilot grant:** its allowance is the package's launch default (Studio 25 GB), not unmetered. *(Task 2 test `v1 bundles read their package's launch default`.)*
4. **`storage:reconcile` run twice:** the second run changes nothing. A live key whose file is missing is reported, not counted. *(Task 3 tests.)*
5. **A new key column added to the schema later and forgotten in `liveKeysSql`:** a guard test fails. *(Task 2 test `every file key column is counted or explicitly excluded`.)*

---

### Task 1: The table, the bundles and the switch

**Files:**
- Create: `apps/platform/database/migrations/1792040000000_create_stored_files.ts`
- Create: `apps/platform/app/modules/storage/models/stored_file.ts`
- Create: `apps/platform/app/modules/storage/settings.ts`
- Modify: `apps/platform/start/env.ts`, `apps/platform/app/modules/packages/packages.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`EXPECTED_POLICIES`), `apps/platform/tests/functional/packages/catalogue.spec.ts`
- Test: `apps/platform/tests/functional/storage/stored_files_table.spec.ts`
- Regenerate: `apps/platform/database/schema.ts` (by `pnpm migrate`). Format it with Biome, the way it is committed.

**Interfaces:**
- **The table `stored_files`:**
  - `id` uuidv7
  - `tenant_id` (`enableTenantRls`)
  - `key varchar(512)` unique
  - `purpose varchar(64)`
  - `bytes bigint not null check (bytes >= 0)`
  - `status varchar(16)`: `reserved` or `stored`
  - `reserved_at`, `expires_at`, `stored_at` timestamptz
  - `created_at`, `updated_at`
  - check `stored_files_status_shape`: reserved means `expires_at` is not null; stored means `stored_at` is not null
  - index `(tenant_id, status)`
- **The bundles:** migration inserts `('solo-v2','solo',40,5120)` and `('studio-v2','studio',40,25600)` into `allowance_bundles (key, package, images_per_month, storage_megabytes)`.
- **`StoredFile` model:** `status: "reserved" | "stored"`.
- **`storageEnforcement(): "observe" | "enforce"`** from `STORAGE_ENFORCEMENT` (`Env.schema.enum.optional(["observe","enforce"])`).

- [ ] **Step 1: Write the failing tests:**
  - `stored_files_table.spec.ts`: the table refuses `bytes < 0` and a `reserved` row without `expires_at`. One studio's row is invisible from another's context (`inTenant`). The two v2 bundles exist with 5120 and 25600.
  - `catalogue.spec.ts`: expects the four bundles, and `PACKAGES.solo.defaultBundleKey === "solo-v2"`.
- [ ] **Step 2: Run them to see them fail.**
  Run (in `apps/platform`): `node ace test functional --files=tests/functional/storage/stored_files_table.spec.ts --files=tests/functional/packages/catalogue.spec.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement it.** Write the migration (with `down()`), the model, the settings and the env entry. Add the `EXPECTED_POLICIES` entry `stored_files: ["tenant_isolation:ALL"]` in the spec's format. Run `pnpm migrate` against the test database, then put `database/schema.ts` back to its Biome format (`biome format --write`).
- [ ] **Step 4: Run** those two specs plus `tests/functional/rls/catalog_guard.spec.ts`, the image meter spec and `tests/functional/packages/*.spec.ts`.
  Expected: PASS. The image meter's trial bundle is now v2, which still gives 40.
- [ ] **Step 5: Commit** `feat(platform): add the stored files ledger and the v2 package bundles`.

### Task 2: Recording sizes and measuring usage

**Files:**
- Create: `apps/platform/app/modules/storage/live_keys.ts`, `apps/platform/app/modules/storage/categories.ts`, `apps/platform/app/modules/storage/services/storage_meter_service.ts`
- Modify: `apps/platform/app/modules/media/services/image_service.ts` (`storeProcessed`, `storeOriginal`), `apps/platform/app/modules/media/services/video_service.ts` (`process`: each rendition written)
- Test: `apps/platform/tests/functional/storage/storage_meter.spec.ts`

**Interfaces:**
- **`categories.ts`:**
  - `STORAGE_CATEGORY: Record<ImagePurpose, "portfolio" | "clients" | "design_lab" | null>`: null for `fresh_ink_*`
  - `COUNTED_PURPOSES`
  - `formatBytes(bytes: number): string`, 1024-based: `"340 MB"`, `"1.2 GB"`, `"5 GB"`. Whole numbers drop `.0`; below 1 MB it shows KB.
- **`recordStoredFile({ tenantId, key, purpose, bytes })`** in `storage_meter_service.ts` (a module function, so `new ImageService()` keeps working). It upserts a `stored` row: `on conflict (key) do update set bytes, status = 'stored', stored_at`. It skips purposes whose category is null. It writes in `currentClient()` when open, else `withDbContext({ tenantId })`.
- **`liveKeysSql`:** a `select key` union over every live key column, used with the tenant id bound. The columns:
  - `artists.photo_key`, where `deleted_at` is null
  - `artist_work_photos.image_key` and `unnest(video_keys)`
  - `client_post_media.image_key` and `unnest(video_keys)`, joined to a live `client_posts`
  - `design_assets.image_key`, joined to a live `design_projects`
  - `flash_designs.image_key`
  - `payment_methods.qr_image_key`, live
  - `payments.proof_image_key`
  - `reference_images.image_key`, live
  - `tenants.cover_image_key`, `logo_image_key` and `logo_icon_key`, for the studio's row
  
  It also exports `EXCLUDED_KEY_COLUMNS`: `artist_work_photos.video_staging_key`, `client_post_media.video_staging_key`, `client_video_reservations.staging_key`, `gateway_accounts.webhook_key` and `gateway_checkouts.idempotency_key`.
- **`StorageMeterService`** (`@inject()` with `EntitlementService`):
  - `limitBytes(tenant): Promise<number | null>`
  - `usage(tenant, now?): Promise<{ usedBytes: number; byCategory: Record<"portfolio" | "clients" | "design_lab", number>; limitBytes: number | null }>`, in the studio's context. `usedBytes` is stored rows whose key is in `liveKeysSql` plus `reserved` rows with `expires_at > now`.

- [ ] **Step 1: Write the failing tests** in `storage_meter.spec.ts`:
  - `only main files, renditions and posters count`: store a photo through `ImageService.store` in a studio's context, with an `ArtistWorkPhoto` row holding its key. There is one row with the main file's byte size, and usage equals it. A `fresh_ink_photo` copy (`copyTo`) adds nothing.
  - `soft-deleted records and orphans don't count`: an artist's photo counts; after soft-deleting the artist it doesn't, though its row stays. A `stored_files` row with no record holding its key doesn't count.
  - `usage is broken down by category`.
  - `v1 bundles read their package's launch default`: a studio with a running `studio` pilot grant on `studio-v1` gets `limitBytes` 25600 × 1048576. A trial on `solo-v2` gets 5120 × 1048576. A test bundle with null storage and key `test-null` is null.
  - `a video counts its renditions and poster`: drive `VideoService.process` as the work-video tests do, skipped when ffmpeg is missing, the same guard they use. Its renditions and poster have rows.
  - `every file key column is counted or explicitly excluded`: scan `database/schema.ts` for `declare \w*(Key|Keys)` and assert each is in `liveKeysSql` or `EXCLUDED_KEY_COLUMNS`.
  - `formatBytes`: 0 → `"0 KB"`, 1536 → `"1.5 KB"`, 340 × 1048576 → `"340 MB"`, 1.25 × 1073741824 → `"1.3 GB"`, 5 × 1073741824 → `"5 GB"`.
- [ ] **Step 2: Run them to see them fail.** Run `node ace test functional --files=tests/functional/storage/storage_meter.spec.ts`. Expected: FAIL. Add bare exports first, or the runner hangs on a missing import.
- [ ] **Step 3: Implement it.** Call `recordStoredFile` right after a successful `put` in `storeProcessed` and `storeOriginal`, with `image.data.length` or `bytes.length`. In `VideoService.process`, call it after each rendition is written, with its file size from `stat`. The poster goes through `ImageService` and is recorded there.
- [ ] **Step 4: Run** the new spec, `tests/functional/media/image_service.spec.ts`, the work-photo and video specs (`rg --files tests -g '*work_video*' -g '*work_photo*'`), `tests/functional/reviews/post_publication.spec.ts` and the Design Lab specs.
  Expected: PASS, except tests already skipped for missing ffmpeg.
- [ ] **Step 5: Commit** `feat(platform): record stored file sizes and measure each studio's storage`.

### Task 3: `storage:reconcile`

**Files:**
- Create: `apps/platform/commands/storage_reconcile.ts`
- Test: `apps/platform/tests/functional/storage/storage_reconcile.spec.ts`

**Interfaces:**
- `node ace storage:reconcile [slug]`: one studio by slug, or every live studio (`package_tenants()`), each in its own context.
- For every live key (`liveKeysSql`) without a `stored` row, or whose row differs, it reads the size with `drive.use(<visibility of the key's purpose>).getMetaData(key)` (`contentLength`) and upserts the row.
- It deletes `stored` rows whose key isn't live or whose file is missing.
- It deletes `reserved` rows past `expires_at`.
- It prints one line per studio: `<slug>: <n> recorded, <m> removed, <k> missing files, usage <formatBytes> of <limit or "unmetered">`. A missing file is logged with its key, not counted.

- [ ] **Step 1: Write the failing tests:**
  - `it backfills existing files from storage`: an artist photo stored with its row deleted (as before this feature) gets a row with the stored size.
  - `it removes rows no live record holds, and expired reservations`.
  - `a live key whose file is gone is reported and not counted`.
  - `a second run changes nothing`.
  - `one studio by slug leaves the others alone`.
- [ ] **Step 2: Run them to see them fail** (the command module missing). Run with an existing command test as the model (`tests/functional/reviews/review_operator.spec.ts` uses `ace.create`).
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): add storage:reconcile to backfill and fix the storage ledger`.

### Task 4: Showing usage

**Files:**
- Modify: `apps/platform/app/middleware/inertia_middleware.ts` (shared prop), `apps/platform/app/controllers/billing_controller.ts`, `apps/platform/inertia/pages/settings/billing.tsx`, `apps/platform/app/controllers/admin_studios_controller.ts`, `apps/platform/inertia/pages/admin/studios/show.tsx`
- Create: `apps/platform/inertia/components/storage_line.tsx`
- Modify the upload pages to render it: `apps/platform/inertia/pages/portfolio/index.tsx`, `apps/platform/inertia/pages/artists/form.tsx`, `apps/platform/inertia/pages/settings/look.tsx`, `apps/platform/inertia/pages/settings/profile.tsx`, `apps/platform/inertia/pages/design_lab/show.tsx`
- Docs: `apps/platform/docs/backend.md` (packages bullet), `docs/design-lab.md` is not needed. Add a "Storage" note in `apps/platform/docs/deploy.md` (run `storage:reconcile` after deploying; `STORAGE_ENFORCEMENT`).
- Test: `apps/platform/tests/functional/storage/storage_display.spec.ts`

**Interfaces:**
- **Shared prop `storage`,** for a signed-in member in a studio, else null: `{ usedText: string; limitText: string | null; percent: number | null; enforced: boolean }`. `percent` is a whole number when metered.
- **Billing page prop `storageDetail`** (owners): the shared prop's fields, plus `categories: { key: "portfolio" | "clients" | "design_lab"; label: string; sizeText: string; href: string; note: string | null }[]`.
  - Labels: "Portfolio and studio page", "Clients and projects", "Design Lab".
  - The hrefs point at the portfolio, projects and Design Lab routes.
  - The `clients` note reads `"Inquiry photos and deposit screenshots stay with their records and can't be removed."`.
- **Admin Package section:** `pilot.storageText`, `Storage: ${usedText} of ${limitText ?? "unmetered"}`.
- **`StorageLine`** renders `Storage: 1.2 GB of 5 GB used`, or `… used (limits aren't applied yet)` when not enforced. It renders nothing when the prop is null or the limit is null.
- **The Billing section "Storage"** shows the same line, a bar (`role="progressbar"` with `aria-valuenow`), the categories with links, and the observe note.

- [ ] **Step 1: Write the failing tests** in `storage_display.spec.ts`:
  - A member's page has `storage.usedText` for its studio, and another studio's usage never leaks into it.
  - The owner's Billing page has `storageDetail.categories` with sizes and the clients note.
  - The admin studio page has `pilot.storageText`.
  - An artist gets the shared prop, but the Billing page stays owner-only, as it is today.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement it.** Run `node ace codegen`, write the docs, and run Biome.
- [ ] **Step 4: Run** the new spec, `tests/functional/billing/billing.spec.ts`, the admin specs, `tests/functional/identity/account_routes.spec.ts`, both `tsc` projects and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): show studio storage on Billing, upload pages and the admin page`.
