# Storage Meter, Step 4 (The Downgrade Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before an owner moves a studio from Studio to Solo, show its current storage against Solo's allowance and what happens if it's over (`docs/superpowers/specs/2026-11-16-storage-meter-design.md`, "Downgrades (with phase 4)"). The downgrade itself (the button, renewal timing) is phase 4 of the packages work; this step builds the preview it will show, and shows it on Billing now for studios on Studio.

**Architecture:** `StorageMeterService.downgradePreview(tenant, usage)` compares the usage already read for Billing with Solo's default bundle (`PACKAGES.solo.defaultBundleKey`); null unless the studio is on Studio and Solo's bundle is metered. Billing passes it as `storageDetail.downgrade`; the words are a pure function (`inertia/components/downgrade_storage_text.ts`) that a component (`downgrade_storage_preview.tsx`) renders, so phase 4's downgrade screen reuses both.

## Global Constraints

- **Words:**
  - Fits: `On Solo (${soloText}), your ${usedText} fits.`
  - Over: `On Solo (${soloText}), your ${usedText} is ${overText} over. Nothing is deleted: your files stay, and new uploads pause until there's room.`
- Shown to owners on Billing only (Billing is owners'); nothing for Solo studios or an unmetered Solo bundle.
- No new query: it uses the usage Billing already read.

### Task 1: The preview

**Files:** `apps/platform/app/modules/storage/services/storage_meter_service.ts` (`downgradePreview`), `apps/platform/app/controllers/billing_controller.ts`, `apps/platform/inertia/components/downgrade_storage_text.ts`, `apps/platform/inertia/components/downgrade_storage_preview.tsx`, `apps/platform/inertia/pages/settings/billing.tsx`. Tests: `tests/functional/storage/storage_downgrade.spec.ts` (Studio over and under Solo's limit, Solo gets null), `tests/unit/inertia/downgrade_storage_text.spec.ts` (both sentences).

- [ ] Red, implement, green, commit `feat(platform): preview a studio's storage on Solo before a downgrade`.
- [ ] Docs: the packages bullet in `apps/platform/docs/backend.md`.
