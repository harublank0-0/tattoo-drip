# Studio packages, phase 2: archiving artists and the active-artist limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can archive and restore artists (history kept, nothing new reaches an archived artist, gone from every public surface), active artists are counted against the package's limit, and adding or restoring an artist past the limit (or while paused) is refused in enforce mode and only logged in observe mode, the default.

**Architecture:** `artists.archived_at` with a database rule that an archived artist is never visible, so every public surface (studio page, public API, intake, Discover views and policies) excludes archived artists through the `visible` checks it already has. `ArtistService` gains archive/restore and an "assignable" read that the dashboard's assignment paths use instead of `findFor`/`list`. A new `PackageGate` in the packages module decides package rules from `EntitlementService`, logging in observe mode and refusing in enforce mode (`PACKAGE_ENFORCEMENT`); phase 3 adds its other rules to the same gate.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 (row-level security), VineJS, Inertia + React, Japa.

**Spec:** `docs/superpowers/specs/2026-11-15-studio-packages-design.md` (rulings 3, 4, 6, 11a; Design: Archiving artists, Gating, Enforcement switch; phase 2 of Phases).

## Global Constraints

- Branch `feat/studio-packages-phase-2` from `main` at `5e6c63d9` (phase 1 merged). Commit identity `harublank00@gmail.com`.
- An **active artist** is a live artist profile (not soft-deleted) that is not archived; hidden artists are active (spec ruling 4).
- **Archived ⇒ hidden:** archiving sets `archived_at = now()` and `visible = false`; the check `artists_archived_hidden` (`archived_at is null or not visible`) makes it impossible to show an archived artist. Restoring clears `archived_at` and leaves the artist hidden; the owner shows them again on purpose. No public read, view or policy changes.
- **Archived artists stay in `ArtistService.list`** (members finish their projects through it). Only NEW work refuses them: accepting an inquiry for them, assigning them to a project, booking them, a session that assigns them to a project they aren't on, offering their profile in an invitation. Sessions for a project already assigned to them stay allowed (spec: existing projects continue to completion).
- `PACKAGE_ENFORCEMENT`: `observe` (default, also when unset) logs `"Package rule would refuse"` with `{ tenantId, rule, ... }` at info and allows; `enforce` refuses with `PackageRuleError`. Rules in this phase: `artist_limit` (active artists would exceed `Entitlement.artistLimit`) and `paused` (adding an active artist while the state is `paused`). Both are checked when an artist is created and when one is restored.
- The gate locks the tenant row (`select 1 from tenants where id = ? for update`) before counting, so concurrent activations in enforce mode serialize.
- Out of this phase: refusing new client work while over the artist limit (ruling 11a) belongs to phase 3, with the other new-work gates; the downgrade's eligibility check (ruling 11) to phase 4, which will call `ArtistService.countActive`.
- Refusal copy: artist limit — `Solo includes one active artist. Archive an artist, or upgrade to Studio.`; paused — `Pay for a package to add an active artist.`.
- Commands run from `apps/platform`; every new tenant route gets a `TENANT_ROUTE_ROLES` entry (OWNERS), a case in `tests/isolation/cases.ts`, and `node ace codegen`.

## Review Focus

1. **The archived artist's own member** must still open and finish their projects and sessions (scope comes from `list`). Pinned in Task 4.
2. **Editing an archived artist with "visible" ticked** never shows them publicly. Pinned in Task 1.
3. **Restoring an artist who was hidden before archiving** keeps them hidden, and so does restoring any archived artist. Pinned in Task 1.
4. **A soft-deleted artist never counts; a hidden one does.** Pinned in Task 1.
5. **A paused studio, or one past its limit, in observe mode** (the default, and what every studio gets until enforcement is switched on) never blocks creating or restoring an artist. Pinned in Tasks 2 and 3.

---

### Task 1: The archived state

**Files:**
- Create: `apps/platform/database/migrations/1792010000000_add_archived_to_artists.ts`
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts`
- Modify: `apps/platform/database/README.md`
- Test: `apps/platform/tests/functional/artists/artist_archive.spec.ts`

**Interfaces:**
- Produces on `ArtistService`:
  - `archive(tenant: TenantRef, artistId: string): Promise<Artist>` — owners' action; sets `archivedAt` and `visible = false` on a live artist; idempotent on an archived one; 404 (`E_ROW_NOT_FOUND`) for an unknown, deleted or other tenant's id.
  - `restore(tenant: TenantRef, artistId: string): Promise<Artist>` — clears `archivedAt`; `visible` stays false.
  - `countActive(tenant: TenantRef): Promise<number>` — live and not archived (hidden included).
  - `listAssignable(tenant: TenantRef): Promise<Artist[]>` — `list` without archived artists, same order.
  - `findAssignable(tenant: TenantRef, artistId: string): Promise<Artist | null>` — `findFor` without archived artists.
- `save` (create/update/updateOwn) keeps `visible = false` while `archivedAt` is set, whatever the form sent.

- [ ] **Step 1: Write the failing tests** (global transaction; `studioWithOwner`, `addArtist` from `#tests/helpers/artists`)
  - `"archiving keeps the artist, hides them and stops counting them"`: two artists → `countActive === 2`; `archive(b)` → `b.archivedAt` set, `b.visible === false`, `list` still returns both, `listAssignable` only `a`, `findAssignable(b) === null`, `countActive === 1`.
  - `"an archived artist can't be shown, by the form or directly"`: `update(tenant, b, { ...input, visible: true })` on archived `b` → `visible === false`; inside `withTransaction`, `update artists set visible = true where id = ?` rejects with `/artists_archived_hidden/`.
  - `"restoring leaves the artist hidden and counts them again"`: `restore(b)` → `archivedAt === null`, `visible === false`, `countActive === 2`.
  - `"a deleted artist never counts; a hidden one does"`: hide `a` (update with `visible: false`) → counts; `delete(c)` → doesn't.
  - `"another studio's artist is unknown"`: `archive(otherTenant, a.id)` rejects (404).
- [ ] **Step 2: Run to verify they fail** — `node ace test functional --files=artist_archive.spec.ts`: FAIL (methods missing).
- [ ] **Step 3: Migration and service.** `archived_at timestamptz null`; the check `artists_archived_hidden`; index `(tenant_id) where deleted_at is null and archived_at is null` for the count. The service methods per the Interfaces block (writes in `withTransaction`, the row found with the tenant filter like `findFor`). README: the artists bullet (archived ⇒ hidden, the check).
- [ ] **Step 4: Migrate (and roll back once, then migrate), then run the test and `artist_service.spec.ts`** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(platform): archive and restore artists, keeping their history`

### Task 2: The package gate and the enforcement switch

**Files:**
- Create: `apps/platform/app/modules/packages/settings.ts`, `apps/platform/app/modules/packages/errors.ts`, `apps/platform/app/modules/packages/services/package_gate.ts`
- Modify: `apps/platform/start/env.ts` (`PACKAGE_ENFORCEMENT: Env.schema.enum.optional(["observe", "enforce"] as const)`), `apps/platform/.env.example` (commented line)
- Test: `apps/platform/tests/functional/packages/package_gate.spec.ts`

**Interfaces:**
- Consumes: `EntitlementService.for` (phase 1), `ArtistService.countActive` (Task 1).
- Produces:
  - `packageEnforcement(): "observe" | "enforce"` in `#modules/packages/settings` (unset → `observe`).
  - `PackageRuleError` in `#modules/packages/errors`: `code: "artist_limit" | "paused"`, `message` = the Global Constraints copy.
  - `PackageGate` (`@inject()`): `checkArtistActivation(tenant: TenantRef): Promise<void>` — runs in the caller's studio context and transaction; locks the tenant row, reads the entitlement and the active count; `paused` → rule `paused`; `artistLimit !== null && active >= artistLimit` → rule `artist_limit`; observe logs and returns, enforce throws.
  - `PackageGate.artistUsage(tenant: TenantRef): Promise<{ active: number; limit: number | null }>` — for the Billing page (Task 4).

- [ ] **Step 1: Write the failing tests** (global transaction; restore `PACKAGE_ENFORCEMENT` with `env.set` in `group.each.teardown`)
  - `"in observe mode nothing is refused: past the limit or paused, the rule is only logged"`: an independent (Solo) studio with one artist, no `PACKAGE_ENFORCEMENT` → `checkArtistActivation` resolves; same for a studio made paused (`created_at` moved back to 2025, no periods).
  - `"in enforce mode a Solo studio with an active artist can't add another"`: `env.set("PACKAGE_ENFORCEMENT", "enforce")`, Solo trial with one artist → rejects `PackageRuleError` with `code === "artist_limit"` and the exact message; after `archive` of that artist → resolves.
  - `"in enforce mode a paused studio can't add an active artist; a Studio trial can add any number"`: paused → `code === "paused"`; a Studio-trial studio with three artists → resolves.
  - `"the usage counts active artists against the package's limit"`: Solo with one active and one archived → `{ active: 1, limit: 1 }`; Studio → `limit: null`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** settings, error, gate, env entry (and a commented `# PACKAGE_ENFORCEMENT=observe` in `.env.example`).
- [ ] **Step 4: Run the tests and `pnpm typecheck`** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(platform): add the package gate with observe and enforce modes`

### Task 3: Archive and restore in the dashboard, and adding artists through the gate

**Files:**
- Modify: `apps/platform/start/routes.ts` (`POST /t/:tenant/artists/:artist/archive` → `tenant.artists.archive`, `.../restore` → `tenant.artists.restore`, uuid matcher), `apps/platform/app/modules/tenancy/access.ts` (both OWNERS), `apps/platform/tests/isolation/cases.ts`
- Modify: `apps/platform/app/controllers/artists_controller.ts` (`store` calls `PackageGate.checkArtistActivation` before `create`; `archive`, `restore` actions — `restore` checks the gate first; a `PackageRuleError` is a flashed error, not a 500; the index/edit props gain `archived: boolean`)
- Modify: `apps/platform/inertia/pages/artists/index.tsx` (archived artists after the others with an "Archived" badge), `apps/platform/inertia/pages/artists/form.tsx` (an "Archive" button with a `window.confirm`, or a "Restore" button and a note that restoring keeps the profile hidden)
- Test: `apps/platform/tests/functional/artists/artist_archive_http.spec.ts`

**Interfaces:**
- Consumes: Task 1's `archive`, `restore`; Task 2's `PackageGate.checkArtistActivation`, `PackageRuleError`.

- [ ] **Step 1: Write the failing tests** (`artist_archive_http.spec.ts`)
  - `"an owner archives and restores an artist; an artist can't"` (302s; the row's state; the artist role gets what it gets for `tenant.artists.destroy`).
  - `"an archived artist leaves the studio page, Discover and the intake form"`: after archive, `GET /api/v1/tenants/:slug/artists` doesn't list them, `POST …/inquiries` with their `preferredArtistId` is 422 on `preferredArtistId`, and `DiscoveryService.studioArtists` doesn't list them (the studio listed on Discover).
  - `"adding an artist past Solo's limit is refused in enforce mode and only logged in observe mode"`: independent studio with its one artist; observe → `POST /t/:slug/artists` creates it; enforce → no new row, flash error with the copy; restoring past the limit in enforce mode is refused the same way.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** routes, roles, isolation cases, controller actions and pages; `node ace codegen`.
- [ ] **Step 4: Run the spec, `tenant_routes.spec.ts`, `role_access.spec.ts`, the isolation suite and `pnpm typecheck`** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(platform): archive and restore artists from the dashboard`

### Task 4: No new work for archived artists

**Files:**
- Modify the assignment paths to the assignable reads:
  - `inquiry_service.ts` `checkArtist` → `findAssignable`; `inquiries_controller.ts` accept choices → `listAssignable`
  - `project_service.ts` `assignArtist` → `findAssignable`; `projects_controller.ts` assignment choices → `listAssignable`
  - `booking_service.ts` `bookableArtists` → `listAssignable` (owners) / own profile only if not archived (artists)
  - `session_service.ts` `add`: the session's artist must be `findAssignable`, unless it is the project's current artist (`findFor`); the project page's scheduling choices are the assignable artists plus the project's own artist
  - `invitation_service.ts` `claimable` excludes archived profiles (`profile_unavailable`)
- Test: one case in each existing spec named below

**Interfaces:**
- Consumes: Task 1's `listAssignable`, `findAssignable`, `findFor`.

- [ ] **Step 1: Write the failing tests** (one case each): accepting an inquiry for an archived artist is the `artist_unavailable` field error (`inquiry_service.spec.ts`); assigning one is refused (`project_changes.spec.ts`); booking one is refused and they aren't in the choices (`bookings_http.spec.ts`); a session for a project already assigned to the archived artist is scheduled, while one that would assign them to another project, or to an unassigned one, is refused (`project_scheduling_http.spec.ts`); the archived artist's own member still opens their project (`project_service.spec.ts`, `scopeTo`); an invitation can't offer an archived profile (`invitation_service.spec.ts`).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the assignment changes.
- [ ] **Step 4: Run the touched specs and `pnpm typecheck`** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(platform): keep new work off archived artists`

### Task 5: Active artists on the Billing page, and docs

**Files:**
- Modify: `apps/platform/app/controllers/billing_controller.ts`, `apps/platform/app/modules/billing/billing_page.ts` (`package.artists: { active: number; limit: number | null; text: string }`), `apps/platform/inertia/pages/settings/billing.tsx`
- Modify: `docs/payments-paybridgenp.md` (phase 2 in What is built), `docs/requirements.md` (artists: archive and restore), `apps/platform/docs/backend.md` (the packages module: `EntitlementService`, `PackageGate`, `PACKAGE_ENFORCEMENT`)
- Test: `apps/platform/tests/unit/modules/billing/billing_page.spec.ts`, `apps/platform/tests/functional/billing/billing.spec.ts`

**Interfaces:**
- Consumes: `PackageGate.artistUsage` (Task 2).

- [ ] **Step 1: Write the failing tests**: unit — `text` is exactly `1 of 1 active artist` for `{ active: 1, limit: 1 }`, `3 active artists` for `{ active: 3, limit: null }`, `1 active artist` for `{ active: 1, limit: null }`; functional — a Solo studio's page has `package.artists` `{ active: 1, limit: 1 }` after its owner profile exists.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the prop, the line under the package on the page, and the docs.
- [ ] **Step 4: Run the tests and `pnpm typecheck`** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(platform): show active artists against the package on the Billing page`

### Task 6: Whole-phase check

- [ ] **Step 1:** `pnpm check`, `pnpm typecheck`, `pnpm build` from the repo root, then the full CI sequence in the Linux container (every package's tests) — Expected: green apart from known environment-only failures, each named in the PR.
- [ ] **Step 2:** Fable review of the whole branch (high effort, AGENTS.md); fix Critical and Important findings test-first; ledger the rest.
