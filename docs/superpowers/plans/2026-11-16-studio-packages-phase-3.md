# Studio packages, phase 3: paused rules and the route capability map, with notices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tenant route is classified by what it needs from the package. In enforce mode a paused studio is refused new client work and Design Lab generation; observe mode, the default, only logs. Trial, paid, grace and pilot notices are computed daily and logged.

**Architecture:**
- **Capability map.** `ROUTE_CAPABILITIES` (`#modules/packages/route_capabilities`) sits next to `TENANT_ROUTE_ROLES` and gives every route one class. It is typed against the roles table, so a missing route doesn't compile, and a guard test pins the restricted list.
- **Middleware.** `packages`, after `role`, asks `PackageGate.checkCapability` for restricted classes only.
- **Notices.** A daily sweep (`SweepPackageNoticesJob`) queues one `PackageNoticeJob` (a `TenantJob`) per live studio. The job resolves the studio's entitlement, and the pure `dueNotice` decides which notice falls in the last 24 hours. In observe mode the job logs it.

**Tech Stack:** AdonisJS 7, Lucid/PostgreSQL 18 (RLS), @adonisjs/queue, Inertia + React, Japa.

**Spec:** `docs/superpowers/specs/2026-11-15-studio-packages-design.md`. Read rulings 7, 8 and 9, "Gating", "Notices" and "Enforcement switch". Phases 1 and 2 are in `apps/platform/app/modules/packages/` (`EntitlementService`, `PackageGate`, `PACKAGE_ENFORCEMENT`).

## Global Constraints

- **Paused refuses only new client work** (ruling 8):
  - converting an inquiry into a project;
  - creating a project directly or booking directly;
  - Design Lab generation;
  - adding active artists. This is already gated in phase 2: `PackageGate.checkArtistActivation`.
- **Still works when paused:**
  - everything on an existing project: quotes, deposits, accepting a quote, its sessions, its healing check;
  - payments, records, exports, account and billing settings;
  - the public page and intake.
- **Enforcement stays off.** `PACKAGE_ENFORCEMENT` unset or `observe` logs `"Package rule would refuse"` and allows. `enforce` refuses.
- **A refusal names the blocked action, says what still works, and links to the next step.** The refusal redirects an owner to the Billing page, which is the next step, with the message flashed. An artist member, who can't open Billing, goes back to the page they came from.
- **Pilots are never paused by accident.** A running grant is state `pilot` (phase 1), never `paused`.
- **Notices** (spec "Notices", ruling 9):
  - 3 days and 1 day before the trial ends;
  - 3 days before paid coverage ends, unless a later paid period already continues it (`Entitlement.until` is already the end of continuous coverage);
  - when grace starts, and 1 day before it ends;
  - a pilot's: 3 days before its transition date.
  - In observe mode they are only logged: `"Package notice would be sent"`. Sending (alert, email, banner) comes with enforcement (phase 4).
- **Commands** run from `apps/platform`. `node ace codegen` after route or controller changes.

## Review Focus

1. **A pilot studio, or a paid one, in enforce mode** can convert inquiries and book. Only `paused` refuses (Task 2 test).
2. **A paused studio in enforce mode records a client's deposit, moves a session and accepts a quote** on an existing project. These are open routes and must pass (Task 2 test).
3. **An artist member of a paused studio** is sent back to the page they came from, never to Billing, which would 404 for them (Task 2 test).
4. **A studio whose trial ends in 2.5 days** gets exactly one "3 days" notice across consecutive daily sweeps, never two and never none (Task 3 unit test over consecutive days).
5. **Paid coverage continued by a later period** gets no "paid ends" notice, because `until` already reaches the later end (Task 3 unit test).

---

### Task 1: The route capability map

**Files:**
- Create: `apps/platform/app/modules/packages/route_capabilities.ts`
- Modify: `apps/platform/app/modules/tenancy/access.ts`: export `type TenantRouteName = keyof typeof TENANT_ROUTE_ROLES`, if it isn't exported already.
- Test: `apps/platform/tests/unit/modules/packages/route_capabilities.spec.ts`

**Interfaces:**
- Produces:
  - `export type Capability = "open" | "new_work" | "design_lab" | "artist_activation"` (`artist_activation` is checked in the controller, phase 2; the middleware passes it).
  - `export const ROUTE_CAPABILITIES = { … } satisfies Record<TenantRouteName, Capability>`
  - `export function capabilityOf(routeName: string | undefined): Capability | undefined`

- [ ] **Step 1: Write the failing test**
  - `test("every tenant route has a capability, and only these routes are restricted")`:
    - `Object.keys(ROUTE_CAPABILITIES)` sorted equals `Object.keys(TENANT_ROUTE_ROLES)` sorted.
    - The non-`open` entries equal exactly:
      - `tenant.inbox.accept`, `tenant.projects.create`, `tenant.projects.store`: `new_work`;
      - `tenant.design_lab.generate`, `tenant.design_lab.retry`: `design_lab`;
      - `tenant.artists.store`, `tenant.artists.restore`: `artist_activation`.
  - `test("capabilityOf answers undefined for an unknown route")`.
- [ ] **Step 2: Run it.** `pnpm test unit --files=route_capabilities.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Every other route is `open`. Group the map like `TENANT_ROUTE_ROLES`, with one comment per restricted group naming the spec line.
- [ ] **Step 4: Run it, then `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): classify every tenant route by what the package allows`.

### Task 2: Refusing new client work while paused

**Files:**
- Modify: `apps/platform/app/modules/packages/errors.ts`: add the rules `paused_new_work` and `paused_design_lab`, with messages (exact):
  - `paused_new_work`: `Starting new client work is paused until your package is paid. Your existing projects, bookings, payments and page keep working.`
  - `paused_design_lab`: `Design Lab is paused until your package is paid. Your saved concepts stay available.`
- Modify: `apps/platform/app/modules/packages/services/package_gate.ts`: `checkCapability(tenant, capability, route)`.
- Create: `apps/platform/app/middleware/package_middleware.ts`
- Modify: `apps/platform/start/kernel.ts` (named middleware `packages`); `apps/platform/start/routes.ts` (the `/t/:tenant` group adds `middleware.packages()` after `middleware.role()`).
- Test: `apps/platform/tests/functional/packages/package_middleware.spec.ts`

**Interfaces:**
- Consumes: `capabilityOf` (Task 1); `EntitlementService.for`, `packageEnforcement()` and `PackageRuleError` (phases 1–2).
- Produces:
  - `PackageGate.checkCapability(tenant: Pick<Tenant, "id">, capability: Capability, route: string): Promise<void>`.
    - It resolves immediately for `open` and `artist_activation`.
    - For `new_work` and `design_lab`, while the state is `paused`, it logs `"Package rule would refuse"` with `{ tenantId, rule, route, state, package }` in observe mode, and throws `PackageRuleError` in enforce mode.
  - `PackageRuleError.code` gains `"paused_new_work" | "paused_design_lab"`.
  - The middleware catches `PackageRuleError`: it flashes `error` with the message, then redirects an owner to `tenant.settings.billing` and anyone else back.

- [ ] **Step 1: Write the failing tests** (global transaction; `captureLogs` from `#tests/helpers/logs`). Teardown: `env.set("PACKAGE_ENFORCEMENT", undefined as never)` and `delete process.env.PACKAGE_ENFORCEMENT`. Make a studio paused by moving its `created_at` to 2025 with no periods, as in `package_gate.spec.ts`.
  - `test("in enforce mode a paused studio can't accept an inquiry or open the booking page; the owner lands on Billing")`:
    - `POST /t/:slug/inbox/:id/accept` redirects to `/t/:slug/settings/billing` with the `paused_new_work` flash;
    - no project exists for the inquiry;
    - `GET /t/:slug/projects/new` redirects the same way.
  - `test("in enforce mode a paused studio's existing work goes on")`: on a paused studio's existing booked project, scheduling a session and adding a desk payment, through the project spec helpers' routes, both succeed (302 to the project, not to Billing).
  - `test("in enforce mode Design Lab generation is refused while paused")`: `POST …/design-lab/:id/generate` gives the `paused_design_lab` flash, and no generation row exists.
  - `test("an artist member of a paused studio goes back, not to Billing")`: the request is sent with a `referer` header; the redirect `location` equals that referer.
  - `test("in observe mode nothing is refused; the rule is logged with its route")`: with the variable unset, accepting the inquiry makes the project, and `captureLogs().everything()` holds an entry whose fields include `rule: "paused_new_work"` and `route: "tenant.inbox.accept"` with the message `"Package rule would refuse"`.
  - `test("a pilot or trial studio in enforce mode is never refused")`:
    - a fresh trial studio accepts an inquiry;
    - a studio created in 2025 with a running pilot grant (`PilotGrantService.grant`) accepts one too.
- [ ] **Step 2: Run it.** Expected: FAIL (refusals don't happen).
- [ ] **Step 3: Implement** the error rules, `checkCapability`, the middleware, the kernel entry and the group registration. Run `node ace codegen`.
- [ ] **Step 4: Run the spec, `role_middleware.spec.ts`, `tenant_routes.spec.ts`, `role_access.spec.ts`, the isolation suite and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): refuse new client work and Design Lab while paused, in enforce mode`.

### Task 3: Notices, computed daily and logged

**Files:**
- Create: `apps/platform/app/modules/packages/notices.ts` (pure)
- Create: `apps/platform/app/modules/packages/jobs/package_notice_job.ts` (`TenantJob`)
- Create: `apps/platform/app/modules/packages/jobs/sweep_package_notices_job.ts`
- Modify: `apps/platform/start/scheduler.ts`
- Test: `apps/platform/tests/unit/modules/packages/notices.spec.ts`, `apps/platform/tests/functional/packages/package_notices.spec.ts`

**Interfaces:**
- Consumes: `Entitlement` and `GRACE_DAYS` (phase 1), `EntitlementService.for`, `package_tenants()`, `packageEnforcement()`.
- Produces:
  - `export type PackageNotice = "trial_ends_in_3_days" | "trial_ends_in_1_day" | "paid_ends_in_3_days" | "grace_started" | "grace_ends_in_1_day" | "pilot_ends_in_3_days"`
  - `export function dueNotice(entitlement: Entitlement, at: DateTime, window?: Duration): PackageNotice | null`. The window defaults to 24 hours, the sweep's interval. A notice is due when its moment falls in `(at - window, at]`:
    - "N days before `until`" is the moment `until - N days`;
    - "grace starts" is `until - GRACE_DAYS`.
    - The moments for each state:

      | State | Moments |
      |---|---|
      | `trial` | 3 days and 1 day before `until` |
      | `paid` | 3 days before `until` |
      | `grace` | grace start, and 1 day before `until` |
      | `pilot` | 3 days before `until` |
      | `paused` | none |
  - `PackageNoticeJob` payload `{ tenantId: string }`: in observe mode it logs `"Package notice would be sent"` with `{ tenantId, notice, state, package, until }`.
  - `SweepPackageNoticesJob`: `scheduleId = "sweep-package-notices"`, `cron = "17 3 * * *"` (03:17 UTC daily). It queues one `PackageNoticeJob` per `package_tenants()` row.

- [ ] **Step 1: Write the failing unit tests** (`notices.spec.ts`, fixed dates):
  - `test("a trial gets its 3-day and 1-day notices once each across daily sweeps")`:
    - Trial `until` is 2026-12-01T00:00Z.
    - Sweeps at 03:17Z every day from 2026-11-25 to 2026-12-01 give exactly one `trial_ends_in_3_days`, on 2026-11-28.
    - They give exactly one `trial_ends_in_1_day`, on 2026-11-30.
    - Every other sweep gives null.
  - `test("paid coverage gets one notice 3 days before it ends")`.
  - `test("paid coverage continued by a later period gets no notice until the later end")`: the `until` from `resolveEntitlement` with two contiguous periods.
  - `test("grace gets a notice when it starts and 1 day before it ends")`.
  - `test("a pilot gets one notice 3 days before its transition date; a paused studio gets none")`.
- [ ] **Step 2: Run it.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `dueNotice`.**
- [ ] **Step 4: Write the failing functional test** (`package_notices.spec.ts`, global transaction, `captureLogs`):
  - `test("the notice job logs the due notice for its studio in observe mode, and nothing when none is due")`. Create the studio with `created_at` set so the trial ends 2.5 days after `at` (now), then run the job's `handle` through `processQueued` or by dispatching it on a fake queue (`#tests/helpers/worker`). It logs `trial_ends_in_3_days` once. A studio mid-trial logs nothing.
  - `test("the sweep queues one notice job per live studio")`. Use `queue.fake()`, run the sweep, and filter the pushed payloads to the test's tenant ids, as `expired_quote_candidates` specs do. A deleted studio gets none.
- [ ] **Step 5: Implement the jobs and the schedule.** Run both specs and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(platform): compute trial, paid, grace and pilot notices daily and log them`.

### Task 4: Paused wording once enforced, and docs

**Files:**
- Modify: `apps/platform/app/modules/packages/entitlement.ts` (`entitlementText(value, day, enforced = false)`). Paused reads `No paid package yet` unenforced, and `<Name> paused: pay to start new client work` when enforced.
- Modify: `apps/platform/app/modules/billing/billing_page.ts` and `apps/platform/app/controllers/admin_controller.ts`: pass `packageEnforcement() === "enforce"`.
- Modify: `apps/platform/docs/backend.md` (Studio packages: the capability map, the middleware, notices); `docs/payments-paybridgenp.md` (phase 3 line); `apps/platform/docs/deploy.md` (the notice sweep schedule; enforcement stays off).
- Test: `apps/platform/tests/unit/modules/packages/entitlement.spec.ts` (the status-line test)

- [ ] **Step 1: Write the failing test.** `entitlementText` of a paused Solo with `enforced: true` is exactly `Solo paused: pay to start new client work`. Unenforced it stays `No paid package yet`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement it, and write the docs.**
- [ ] **Step 4: Run the unit spec, `billing.spec.ts` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): word the paused state once packages are enforced, and document phase 3`.

### Task 5: Whole-phase check

- [ ] **Step 1:** `pnpm check`, `pnpm typecheck` and `pnpm build` from the repo root, then the full platform suite. Expected: green.
- [ ] **Step 2:** A Fable review of the whole branch on high effort (AGENTS.md). Fix Critical and Important findings test-first, and ledger the rest.
