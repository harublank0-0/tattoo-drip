# Design Lab Image Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take each studio's monthly Design Lab limit from its package's allowance bundle once enforcement is on, observe it before, warn near the limit, word the refusal per ruling 12, and show the admin each studio's monthly use.

**Architecture:** `DesignUsageService` gains `EntitlementService` and resolves the limit in force per studio (`limitsFor`). `allowance()` and `reserve()` use it, and `reserve()` logs the bundle's would-be refusal in observe mode. The page's warning is a pure helper in `inertia/components/design_lab.ts`. The admin line is one more prop in the Package section.

**Tech Stack:** AdonisJS 7 (Lucid, Inertia + React), Japa, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-image-meter-design.md` (parent: `docs/superpowers/specs/2026-11-15-studio-packages-design.md`, Allowances and ruling 12).

## Global Constraints

- **The limit in force.**
  - `DESIGN_LAB_MONTHLY_LIMIT` = 0 means 0, in every mode: the documented global off switch (docs/design-lab.md).
  - Otherwise, with `packageEnforcement() === "enforce"` and the entitlement's bundle `imagesPerMonth` not null, the limit is that number.
  - Otherwise it is `DESIGN_LAB_MONTHLY_LIMIT`.
- **`packageLimit`** is the entitlement bundle's `imagesPerMonth` (null when not metered), whatever the mode.
- **Observe log:** in observe mode, when `packageLimit !== null` and the request's attempts exceed `max(0, packageLimit − settled − reserved)`, log `logger.info({ tenantId, rule: "image_allowance", package, packageLimit, used: settled + reserved, requested }, "Package rule would refuse")` and go ahead.
- **Studio offer:** only in enforce mode, for a `solo` entitlement, when the `studio-v1` default bundle's (`PACKAGES.studio.defaultBundleKey`) `imagesPerMonth` exceeds the limit in force.
- **Unchanged:** reserve, settle, release, `BURST_LIMIT`, `RELEASED_CAP` (it uses the limit in force), the calendar month (UTC) and the advisory lock.
- **Commits:** `feat(platform): …` / `docs(platform): …`; run `node ace codegen` after page-prop changes and commit `.adonisjs/`.

## Review Focus

1. **`DESIGN_LAB_MONTHLY_LIMIT=0` in enforce mode:** generation stays off, though the bundle says 40. *(Task 1 test `0 in the setting turns generation off in every mode`.)*
2. **A bundle without an image number in enforce mode:** the setting applies; no crash. *(Task 1 test `a bundle with no image number falls back to the setting`.)*
3. **Observe mode, a bundle lower than the setting:** never refused, only logged. *(Task 1 test `observe mode allows and logs what the bundle would refuse`.)*
4. **The Studio offer in observe mode:** never shown, because upgrading wouldn't help there. *(Task 1 test `the refusal names the reset date, what still works, and offers Studio only when it gives more`.)*
5. **An artist (not an owner) at the limit:** gets the same refusal. The service has no role branch, so the existing artist-driven HTTP test in `design_lab.spec.ts` covers it; Task 1 re-runs that spec.

---

### Task 1: The limit from the bundle, the observe log and the refusal

**Files:**
- Modify: `apps/platform/app/modules/design_lab/services/design_usage_service.ts`
- Test: `apps/platform/tests/functional/design_lab/image_meter.spec.ts` (new)

**Interfaces:**
- Produces:
  - `DesignUsageService` is `@inject()` with `constructor(private entitlements: EntitlementService)`. Callers already resolve it from the container.
  - `Allowance` gains `packageLimit: number | null`.
  - `AllowanceError` becomes `new AllowanceError(remaining: number, limit: number, resetsAt: DateTime, studioLimit: number | null)`. Its message at 0 left: `Your studio has used all ${limit} generations for this month. New generations are paused until ${formatDay(resetsAt ISO date)}; your designs and history stay available.`, plus ` The Studio package includes ${studioLimit} a month.` when `studioLimit !== null`. When some are left, the existing partial message is kept unchanged.
  - Private `limitsFor(tenant, now): Promise<{ limit: number; packageLimit: number | null; package: PackageKey; studioLimit: number | null; creditsPerImage: number | null }>`. It reads `this.entitlements.for(tenant, now)` and the bundles by id/key, in the caller's (studio's) context.

- [ ] **Step 1: Write the failing tests.** Group `Design Lab image meter`, `wrapInGlobalTransaction`. The fixture is `studioWithOwner` + `artistIn` + `seedDesignLab` (1 settled unit this month). Add usage with `DesignUsageRecord.create({ …, generationId: designGeneration.id, attempt: 2, units: N, status: "settled" })` in `inTenant`. Make a bundle with `AllowanceBundle.create({ key: "test-solo-3", package: "solo", imagesPerMonth: 3 })` and point a running `PilotGrant.create(...)` (package `solo`) at it in `inTenant`. Use `env.set(...)` for `PACKAGE_ENFORCEMENT` and `DESIGN_LAB_MONTHLY_LIMIT`, and in each test's cleanup `delete process.env` for both, as `design_lab.spec.ts` does. Resolve the service from `app.container`.
  - `enforce mode takes the limit from the studio's bundle`: grant on `test-solo-3`, enforce, setting 40. `allowance().limit` is 3 and `packageLimit` 3. Reserving 3 attempts at once throws `AllowanceError` (1 settled + 3 > 3); reserving 2 succeeds.
  - `observe mode keeps the setting in force`: same grant, observe, setting 2. `allowance().limit` is 2 and `packageLimit` 3.
  - `observe mode allows and logs what the bundle would refuse`: same grant, observe, setting 50, plus 2 more settled units (3 in total). Reserving 1 succeeds, and `captureLogs().everything()` has one `"Package rule would refuse"` entry with `rule: "image_allowance"`, `packageLimit: 3`, `used: 3`, `requested: 1`.
  - `a bundle with no image number falls back to the setting`: bundle `test-solo-null` (`imagesPerMonth: null`) and its grant, enforce, setting 7: `allowance().limit` is 7 and `packageLimit` null.
  - `0 in the setting turns generation off in every mode`: enforce, setting 0, studio on its trial (bundle 40): `allowance().limit` is 0.
  - `the refusal names the reset date, what still works, and offers Studio only when it gives more`: grant on `test-solo-3`, enforce, plus 2 more settled units. `reserve` rejects with the message `Your studio has used all 3 generations for this month. New generations are paused until ${formatDay(first of next month UTC)}; your designs and history stay available. The Studio package includes 40 a month.`. The same in observe mode with setting 3: no Studio sentence. A `studio` trial at its limit in enforce mode: no Studio sentence.
- [ ] **Step 2: Run them to see them fail.**
  Run (in `apps/platform`): `node ace test functional --files=tests/functional/design_lab/image_meter.spec.ts`
  Expected: FAIL (limit stays the setting; no `packageLimit`; old message).
- [ ] **Step 3: Implement** `limitsFor` and use it in `allowance` and `reserve`, which computes `resetsAt` as `monthStart(now).plus({ months: 1 })`. Add the observe log and the new `AllowanceError` arguments. Update the class doc comment to say where the limit comes from.
- [ ] **Step 4: Run the new spec and the Design Lab specs.**
  Run: `node ace test functional --files=tests/functional/design_lab/image_meter.spec.ts --files=tests/functional/design_lab/design_lab.spec.ts --files=tests/functional/design_lab/design_history_http.spec.ts --files=tests/functional/design_lab/design_lab_scoping.spec.ts --files=tests/functional/design_lab/design_history.spec.ts`
  Expected: PASS. The existing "used all 2 generations" and "1 of 2 generations left" assertions still hold.
- [ ] **Step 5: Commit.** `feat(platform): take Design Lab's monthly limit from the studio's package`

### Task 2: The warning near the limit

**Files:**
- Modify: `apps/platform/inertia/components/design_lab.ts`, `apps/platform/inertia/pages/design_lab/show.tsx`
- Test: `apps/platform/tests/unit/modules/design_lab/words.spec.ts`

**Interfaces:**
- Produces: `allowanceWarning(allowance: Allowance): string | null`. It returns `` `Only ${remaining} generation(s) left this month. ${resetsText(resetsAt)}.` `` when `1 <= remaining <= 5` and `limit > 0`, using "generation" for 1 and "generations" otherwise; null otherwise. The constant `LOW_ALLOWANCE = 5` is exported beside it. The inertia `Allowance` type gains `packageLimit: number | null`.

- [ ] **Step 1: Write the failing tests** in `words.spec.ts`. With a limit of 40 and a reset of 2026-12-01 UTC:
  - remaining 6 gives null
  - remaining 5 gives `Only 5 generations left this month. Resets on 1 Dec.`
  - remaining 1 gives `Only 1 generation left this month. Resets on 1 Dec.`
  - remaining 0 gives null, since the form's own "no generations left" text covers it
  - limit 0 gives null
- [ ] **Step 2: Run them to see them fail.** Run: `node ace test unit --files=tests/unit/modules/design_lab/words.spec.ts`. Expected: FAIL (`allowanceWarning` is not a function). Add the bare export first, or the runner hangs on the missing import.
- [ ] **Step 3: Implement** the helper. In `show.tsx`, render it under the "Generate a concept" section's description as `<p role="status" className="text-sm font-medium text-amber-700 dark:text-amber-400">` when not null. Run `node ace codegen`.
- [ ] **Step 4: Run** `node ace test unit --files=tests/unit/modules/design_lab/words.spec.ts` and both `tsc` projects. Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `feat(platform): warn on the Design Lab page when few generations are left`

### Task 3: The admin line and docs

**Files:**
- Modify: `apps/platform/app/controllers/admin_studios_controller.ts`, `apps/platform/inertia/pages/admin/studios/show.tsx`, `docs/design-lab.md` (Usage and cost, settings table), `apps/platform/docs/backend.md` (the packages bullet)
- Test: `apps/platform/tests/functional/admin/admin_pilot_grants.spec.ts`

**Interfaces:**
- Consumes: `DesignUsageService.allowance(tenant)` (Task 1).
- Produces: the `pilot` prop gains `imagesText: string`. It reads `Design Lab images this month: ${used + reserved} of ${limit}`, plus ` (package: ${packageLimit} a month once limits are on)` in observe mode when `packageLimit !== null && packageLimit !== limit`.

- [ ] **Step 1: Write the failing test** `the Package section shows the studio's Design Lab images this month`. Use a studio with `seedDesignLab` (1 settled unit). With setting 10 in observe mode, `pilot.imagesText` is `Design Lab images this month: 1 of 10 (package: 40 a month once limits are on)`. With setting 40 it is `Design Lab images this month: 1 of 40`.
- [ ] **Step 2: Run it to see it fail.** Run: `node ace test functional --files=tests/functional/admin/admin_pilot_grants.spec.ts`. Expected: FAIL (`imagesText` undefined).
- [ ] **Step 3: Implement** it. Inject `DesignUsageService` into `AdminStudiosController` and read it inside `pilotProps`' studio context. In the page, show the line under the state badge. Update the docs:
  - `docs/design-lab.md`: the limit in force (bundle once enforced, the setting before; 0 stays the off switch), the warning at 5, and the refusal's words.
  - `backend.md`: the packages bullet names the image meter.
- [ ] **Step 4: Run** the admin specs, `tests/functional/identity/account_routes.spec.ts`, both `tsc` projects and Biome on the changed files. Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `feat(platform): show each studio's Design Lab images on its admin page`
