# Storage Meter, Step 2 (Enforce) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold each studio's storage allowance on the server for every in-scope upload, behind `STORAGE_ENFORCEMENT`, with the ways to free space and the warnings the design asks for (Rollout step 2).

**Architecture:**
- **Reservations.** A reservation is a `reserved` row in `stored_files` (key `reserve:<uuid>`). It's taken in a short transaction of its own (`withSeparateContext`) under a per-studio advisory lock, checked against usage and the allowance. When the file lands, `recordStoredFile` turns it into the `stored` row; it's released on failure, and its expiry covers a crash.
- **Images** reserve centrally in `ImageService.store`/`storeLogo`, which already know the upload's size. A full studio's upload throws `StorageFullError`, an `InvalidImageError` subclass, so every staff controller's existing `asFieldErrors` shows it as a field error with no controller change.
- **Videos** reserve at signing, and **Design Lab** at submit.
- **Always-accepted purposes** (payment proofs, QR images, client post photos and videos) skip the check.

**Tech Stack:** AdonisJS 7, Inertia + React, the storefront (TanStack Start), OpenAPI types and SDK, Japa, `node:test` in the storefront.

**Spec:** `docs/superpowers/specs/2026-11-16-storage-meter-design.md` (Rollout step 2; Rulings 4, 6 and 7, including the owner deletes the product owner added on 2026-11-16).

## Global Constraints

- **Purposes:**
  - `ALWAYS_ACCEPTED = ["payment_proof", "payment_qr", "client_post_photo", "client_post_video"]`: counted but never refused
  - `fresh_ink_*`: never counted, never reserved
- **The check:**
  - With `storageEnforcement() === "enforce"` and a metered limit, refuse when `usedBytes + requested > limitBytes`.
  - In observe mode, log `logger.info({ tenantId, rule: "storage_limit", requested, usedBytes, limitBytes }, "Package rule would refuse")` and allow.
- **Reservation lifetimes:** an image 15 minutes, a video 75 minutes, a Design Lab image 1 hour. The Design Lab estimate is 8 MB per image.
- **The staff refusal** (`StorageFullError.message`): `This upload needs ${formatBytes(requested)}, but your studio has ${formatBytes(remaining)} of storage left. Free up space under Settings, Billing, Storage.` When a Solo studio's upload would fit in Studio's 25 GB, add ` Studio includes 25 GB: ask TattooDrip to move your studio to Studio.`
- **The client refusal:** API 409 `attachments_unavailable`, with the message `This studio can't take photos right now. Send your inquiry without them, and share the photos when the studio replies.`
- **The shared `storage` prop** is computed only on the pages that show it (the upload pages and Billing, by route name), or on every page once `STORAGE_ENFORCEMENT=enforce`, for the banner. That's a fix to step 1's per-request cost.
- **Roles:** deleting a Design Lab project is for members (owners for any project, artists for their own, as `scoped()` does). Deleting a reference photo or a deposit screenshot is for owners only. Each new route gets a `TENANT_ROUTE_ROLES` entry, an isolation case and an `account_routes` entry if it falls outside a studio. Rename nothing.
- **Rollout:** run `node ace codegen` after route or page changes. Contract changes go in `packages/types/openapi.yaml` first, then `pnpm --filter @tattoo-drip/types generate`.

## Review Focus

1. **Two uploads at once that together exceed the remaining space:** one succeeds, the other is refused, and usage never passes the limit. *(Task 1 test `concurrent reservations near the limit`.)*
2. **An upload that fails after reserving:** its reservation is gone at once, not after expiry. *(Task 1 test `a failed store releases its reservation`.)*
3. **A deposit screenshot or a review photo for a full studio** is still accepted. *(Task 1 test `always-accepted purposes are never refused`.)*
4. **A client's inquiry with photos for a full studio:** 409 `attachments_unavailable`, nothing is created, and the same inquiry without photos succeeds. *(Task 3 tests.)*
5. **Deleting a Design Lab project while a concept is generating** is refused in words. *(Task 4 test.)*

---

### Task 1: Reservations, and images held at the limit

**Files:**
- Modify: `apps/platform/app/services/db_context.ts`: add `withSeparateContext(values, fn)`, a root transaction outside any current context (`storage.exit(() => openRoot(values, fn))`)
- Create: `apps/platform/app/modules/storage/reservations.ts`
- Modify: `apps/platform/app/modules/storage/categories.ts` (`ALWAYS_ACCEPTED`), `apps/platform/app/modules/storage/record_stored_file.ts` (a `reservationKey` to replace), `apps/platform/app/modules/media/errors.ts` (`StorageFullError extends InvalidImageError`), `apps/platform/app/modules/media/services/image_service.ts` (`store`, `storeLogo`), `apps/platform/app/middleware/inertia_middleware.ts` (gate the shared prop)
- Test: `apps/platform/tests/functional/storage/storage_reservations.spec.ts`

**Interfaces:**
- `reserveStorage({ tenantId, purpose, bytes, minutes }): Promise<string | null>`: the reservation's key, or null for an always-accepted or uncounted purpose. Throws `StorageFullError`.
- `releaseStorage(tenantId, key): Promise<void>`: best effort, in a separate context.
- `StorageFullError(requested: number, remaining: number, studioLimit: number | null)`.
- `recordStoredFile({ …, reservationKey?: string })` deletes that reservation row in the same savepoint.
- `ImageService.store`/`storeLogo` reserve `file.size` before processing. On a failure they release it; on success the reservation is replaced and `afterRollback` releases it.

- [ ] **Step 1: Write the failing tests:**
  - a staff upload over the limit is refused with the staff message, and nothing is stored
  - in observe mode the same upload is stored and logged
  - `concurrent reservations near the limit`, with two `reserveStorage` calls in parallel
  - `a failed store releases its reservation`
  - an expired reservation stops counting
  - `always-accepted purposes are never refused`
  - the HTTP artist-photo upload shows the message on field `photo`
  - the shared prop is absent from a page outside the list in observe mode
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the new spec and `tests/functional/storage/*`, `tests/functional/media/image_service.spec.ts`, the artists, flash, cover and logo HTTP specs, and the intake spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): reserve storage for uploads and refuse them at the limit`.

### Task 2: Videos and Design Lab

**Files:**
- Modify: `apps/platform/app/modules/media/services/video_service.ts`:
  - `signUpload` reserves 75 minutes for `work_video`, with key `reserve:<stagingKey>`
  - `process` releases it after recording, or on refusal or failure
- Modify: `apps/platform/app/modules/design_lab/services/design_lab_service.ts`:
  - `submit`/`retry` reserve 8 MB per attempt, with key `reserve:design:<generationId>:<attempt>`, after the usage reservation
- Modify: `apps/platform/app/modules/design_lab/services/generation_runner.ts`: release after storing or failing
- Modify: `apps/platform/app/controllers/design_lab_controller.ts`: `asFieldErrors` maps `StorageFullError` on the same fields as `AllowanceError`
- Modify: the work-video sign path, so `StorageFullError` becomes the `video` field error, if `asFieldErrors` there doesn't already take `InvalidImageError`
- Test: `apps/platform/tests/functional/storage/storage_videos_design_lab.spec.ts`

- [ ] **Step 1: Write the failing tests:**
  - signing a work video for a full studio is refused on `video`
  - a client video sign is never refused
  - a Design Lab submit for a full studio is refused on `variations`, and nothing is queued
  - the reservation is released once the concept is stored, and when the generation fails
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the new spec and the work-video and Design Lab specs. The ffmpeg-only cases run on CI.
- [ ] **Step 5: Commit** `feat(platform): hold storage for videos and Design Lab`.

### Task 3: The client's inquiry without photos

**Files:**
- Modify: `packages/types/openapi.yaml` (createInquiry: 409 `attachments_unavailable` in its description and responses, and in the shared code list), then regenerate types. Modify: `apps/platform/app/services/public_api.ts` (the code, 409, and the message above).
- Modify: `apps/platform/app/modules/inquiries/services/intake_service.ts` (`StorageFullError` from `storeImages` becomes `AttachmentsUnavailableError`, before anything is created) and `apps/platform/app/controllers/public_inquiries_controller.ts` (`toApiError`).
- Modify: `apps/storefront/src/intake/problems.ts` (`attachments_unavailable` → a notice with an action), `apps/storefront/src/intake/components/intake-form.tsx` and `submit-flow.ts` (**Send without photos** resends the same fields without files, with a fresh challenge token), `apps/storefront/src/intake/copy.ts` if that's where the words live.
- Docs: `docs/sdk.md` (the inquiry codes).
- Test: a platform intake test, and `apps/storefront/test/intake/problems.test.ts` (plus the submit-flow test if it exists).

- [ ] **Steps:** failing tests (the platform 409 with no inquiry row and no file; the storefront mapping, and that the resend drops the files), red, implement, green (platform intake specs, storefront `pnpm test`, typecheck), commit `feat: let a client send an inquiry without photos when the studio's storage is full`.

### Task 4: Freeing space

**Files:**
- **A Design Lab project's delete:**
  - Route `DELETE /t/:tenant/design-lab/:id` (`tenant.design_lab.destroy`), MEMBERS, scoped like update
  - `DesignLabService.deleteProject` deletes each asset's file (`deleteOrThrow`), then the asset rows, then soft-deletes the project
  - Refused while a generation is queued or processing: `Wait for the concepts being made to finish, then delete the project.`
  - A Delete action with `InlineConfirm` on the project page
- **An inquiry or project reference photo's delete (owners):**
  - Route `DELETE /t/:tenant/references/:id` (`tenant.references.destroy`)
  - Deletes the file, then soft-deletes the row
  - `InlineConfirm` in `inertia/components/references.tsx`: "Delete this photo? It's the client's file and can't be brought back."
- **A deposit screenshot's removal (owners):**
  - Route `DELETE /t/:tenant/payments/:id/proof` (`tenant.payments.proof.destroy`)
  - Deletes the file, then clears the three proof columns (`payments_guard` allows clearing)
  - `InlineConfirm` where `proofUrls` show on the project page
- Each route: `TENANT_ROUTE_ROLES`, an isolation case, a role-access expectation. The Billing page's clients note says how to remove one.
- Test: `apps/platform/tests/functional/storage/storage_freeing_space.spec.ts`

- [ ] **Steps:**
  - Write the failing tests: each delete frees its bytes from usage, a non-owner gets a 404, another studio gets a 404, and the generating refusal
  - Red, implement, codegen, green: the new spec, the isolation and role-access specs, `account_routes`, typecheck
  - Commit `feat(platform): let studios free storage: Design Lab projects and client files`

### Task 5: The dashboard warning and the docs

**Files:**
- Create: `apps/platform/inertia/components/storage_bar.tsx`, rendered in `inertia/layouts/app.tsx` next to `VerifyEmailBar`.
  - It shows only when `storage.enforced` and `percent >= 80`, for every member.
  - Owners get a link to Billing.
  - Under 100%: `Your studio has used ${percent}% of its ${limitText} storage.`
  - At or over 100%: `Your studio's storage is full: new uploads are paused until there's room. Existing files, bookings and deposits keep working.`
- Docs: `apps/platform/docs/deploy.md` (what enforce does now), `docs/design-lab.md` (generation stops at the storage limit), `apps/platform/docs/backend.md`, `apps/platform/database/README.md` (the `1792040000000` migration entry, step 1's deferred minor).
- Test: `apps/platform/tests/unit/inertia/storage_bar.spec.ts`, on the bar's words as a pure function `storageBarText(storage, role)`.

- [ ] **Steps:** failing test, red, implement, green, commit `feat(platform): warn every member when the studio's storage is nearly full`.
