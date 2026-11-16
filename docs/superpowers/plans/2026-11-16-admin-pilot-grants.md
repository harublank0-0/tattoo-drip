# Admin Pilot Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give, replace and end a studio's pilot grant from its admin page, and link the admin Billing page's studios to those pages.

**Architecture:** A "Package" section on `/admin/studios/<slug>` (AdminStudiosController.show + `inertia/pages/admin/studios/show.tsx`) with two POST routes in the existing `/admin` group. Both call `PilotGrantService` (the same service as `packages:pilot`), which gains `end(slug)`. Every read and write runs in the studio's own context.

**Tech Stack:** AdonisJS 7 (Lucid, VineJS, Inertia + React), Japa functional tests, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-admin-pilot-grants-design.md` (parent: `docs/superpowers/specs/2026-11-15-studio-packages-design.md`, ruling 7 and "Pilots").

## Global Constraints

- One rule set: the page calls `PilotGrantService.grant` and the new `PilotGrantService.end`; `packages:pilot` and its tests stay unchanged.
- A grant ends at 00:00 UTC on the chosen day (`DateTime.fromISO(until, { zone: "utc" })`), must end after now, and takes its package's default allowance bundle; a running grant ends when a new one starts.
- Note: 1 to 500 characters after trimming. "Granted by": the signed-in admin's `fullName`, else `email`, cut to 100 characters.
- `pilot_grants` is tenant-owned under row-level security: reads and writes run in `withDbContext({ tenantId })`; the only cross-studio step is `tenant_for_slug`.
- Admin dates are UTC. Day texts use the Billing page's `formatDay(at.toUTC().toISODate())` (`#modules/projects/quotes`); times use `admin_studios_controller.ts`'s `at()` (`yyyy-MM-dd HH:mm 'UTC'`).
- After route changes run `node ace codegen` in `apps/platform` and commit the regenerated `.adonisjs/` files.
- Commits use the area scope: `feat(platform): …`.

## Review Focus

1. **A day in the past, today, or an impossible date (`2026-02-30`)** in the form: refused with the service's words, nothing written. *(Task 2 test `refuses a past or impossible date and an empty note`.)*
2. **"End grant now" with no running grant** (double click, a grant that just expired): an error flash, no 500, nothing written. *(Task 1 test `ending with no running grant is refused in words`; Task 2 checks the flash.)*
3. **An admin account without a full name, or with a long email:** "granted by" falls back to the email and is cut to 100 characters, never refused. *(Task 2 test `records the admin by name, else by email cut to 100 characters`.)*
4. **An old slug** in a grant or end POST acts on the studio's current slug, and the redirect lands on the current page. *(Task 2 test `an old slug grants to the same studio`.)*
5. **A studio owner (not an admin) posting to the routes** gets the 404 of an unknown page and nothing is written. *(Task 2 test `a studio owner gets a 404 and nothing is written`.)*

---

### Task 1: `PilotGrantService.end`

**Files:**
- Modify: `apps/platform/app/modules/packages/services/pilot_grant_service.ts`
- Test: `apps/platform/tests/functional/packages/pilot_grants.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PilotGrantService.end(slug: string, now?: DateTime): Promise<PilotGrant>`: sets the running grant's `ends_at` to `now` in the studio's context and returns it; throws `PilotGrantError` with `No studio uses "<slug>".` for an unknown slug and `This studio has no running grant.` when none runs (`starts_at <= now < ends_at`). Logs `logger.info({ tenantId, grantId }, "Pilot grant ended")`.

- [ ] **Step 1: Write the failing tests** in the existing group of `pilot_grants.spec.ts`:
  - `ending the running grant sets its end to now; the studio's later state follows the entitlement rules`: grant `studio` for 2 months at `now`, `end("<slug>", now.plus({ minutes: 5 }))`, assert the returned grant's `endsAt` equals that instant, and `inTenant(tenant, () => pilots.forTenant(tenant))` shows one grant with that `endsAt`. Then `EntitlementService.forLoaded(tenant, now.plus({ minutes: 6 }))` is not `"pilot"` (no payment, so `"trial"` within 14 days of creation, per `entitlement_service.spec.ts`'s rules).
  - `ending with no running grant is refused in words`: on a studio with no grant, and on one whose grant already ended, `end` rejects with `PilotGrantError` and message `This studio has no running grant.`; an unknown slug rejects with `No studio uses "nope".`
- [ ] **Step 2: Run them to see them fail**
  Run (from `apps/platform`): `node ace test functional --files=tests/functional/packages/pilot_grants.spec.ts`
  Expected: the two new tests FAIL (`pilots.end is not a function`).
- [ ] **Step 3: Implement `end(slug, now = DateTime.utc())`** with the same slug lookup as `grant` (extract the existing lookup into a private `tenantIdFor(slug): Promise<string>` that throws the `No studio uses` error, and use it in both). In `withDbContext({ tenantId })`: `update pilot_grants set ends_at = ? where tenant_id = ? and starts_at <= ? and ends_at > ? returning id`, throwing `This studio has no running grant.` when no row returns; return `PilotGrant.findOrFail(id, { client: trx })`.
- [ ] **Step 4: Run the spec again**
  Run: `node ace test functional --files=tests/functional/packages/pilot_grants.spec.ts`
  Expected: PASS, all tests in the file.
- [ ] **Step 5: Commit**
  `git add apps/platform/app/modules/packages/services/pilot_grant_service.ts apps/platform/tests/functional/packages/pilot_grants.spec.ts`
  `git commit -m "feat(platform): end a pilot grant early (PilotGrantService.end)"`

### Task 2: The admin Package section, its routes and the Billing links

**Files:**
- Modify: `apps/platform/start/routes.ts` (the `/admin` group, after `admin.studios.photos.restore`)
- Modify: `apps/platform/app/validators/admin.ts`
- Modify: `apps/platform/app/controllers/admin_studios_controller.ts`
- Modify: `apps/platform/inertia/pages/admin/studios/show.tsx`
- Modify: `apps/platform/app/controllers/admin_controller.ts` (Billing rows get `slug`)
- Modify: `apps/platform/inertia/pages/admin/billing.tsx` (the name links to the studio page)
- Regenerate: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/admin/admin_pilot_grants.spec.ts` (new)

**Interfaces:**
- Consumes: `PilotGrantService.grant(slug, { package, endsAt, note, grantedBy })`, `PilotGrantService.end(slug)`, `PilotGrantService.forTenant(tenant)`, `PilotGrantError` (Task 1); `EntitlementService.forLoaded(tenant)`, `entitlementText(entitlement, day, packageEnforcement() === "enforce")`, `PACKAGES`, `PACKAGE_KEYS`.
- Produces:
  - Routes: `POST /admin/studios/:slug/pilot` → `AdminStudiosController.grantPilot`, name `admin.studios.pilot.grant`; `POST /admin/studios/:slug/pilot/end` → `AdminStudiosController.endPilot`, name `admin.studios.pilot.end`.
  - `pilotGrantValidator` in `#validators/admin`: `package: vine.enum(PACKAGE_KEYS)`, `until: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)`, `note: vine.string().trim().minLength(1).maxLength(500)`.
  - New `show` prop `pilot: { stateText: string; running: GrantRow | null; past: GrantRow[]; packages: { value: PackageKey; label: string }[] }`, with `GrantRow = { packageName: string; untilText: string; note: string; grantedBy: string | null; grantedText: string }`. `untilText` is the end day via the Billing day format, `grantedText` is `at(startsAt)`. `past` lists ended grants, newest first.
  - The Billing page's studio rows gain `slug: string`.

- [ ] **Step 1: Write the failing tests** in `admin_pilot_grants.spec.ts` (group `Admin pilot grants`, `wrapInGlobalTransaction` per test; `studioWithOwner`, `adminUser`, `send` from `#tests/helpers/discover`; dates relative to `DateTime.utc()`):
  - `the studio page shows its package state, running grant and past grants`: after `PilotGrantService.grant` twice (the first is ended by the second), `GET /admin/studios/<slug>` as the admin has `pilot.stateText` matching `/^Studio, pilot until /`, `pilot.running.note` equal to the second note, and `pilot.past` with one row (the first note).
  - `the admin gives a grant: ends at 00:00 UTC on the day, recorded by the admin`: `send(..., "post", "/admin/studios/<slug>/pilot", { package: "solo", until: <date 30 days ahead as YYYY-MM-DD>, note: "Design partner" })` gives 302 and the flash `"<Name> is a Solo pilot until <day>."`. The stored grant has `endsAt` equal to `DateTime.fromISO(until, { zone: "utc" })` and `grantedBy` equal to `admin@platform.example` (the fixture has no `fullName`).
  - `records the admin by name, else by email cut to 100 characters`: with `fullName: "Ops Person"` the grant records `"Ops Person"`. With no name and a 120-character email it records the email's first 100 characters.
  - `a new grant replaces the running one`: grant twice through the route; `forTenant` shows the first ended at or before the second's start and one running.
  - `the admin ends the running grant`: `send(..., "/admin/studios/<slug>/pilot/end")` gives 302 and the flash `"The pilot grant has ended. The studio's package now follows its payments."`. No grant runs afterwards.
  - `refuses a past or impossible date and an empty note`: `until` yesterday gives the flash error `The grant must end after now.`. `until: "2026-02-30"` gives `Give an until date as YYYY-MM-DD.`. An empty note is a validation error on `note`. Nothing is written in any of them.
  - `ending with no running grant shows the error, not a 500`: 302 with the flash error `This studio has no running grant.`.
  - `an old slug grants to the same studio`: rename the studio's slug through the same fixture path `admin_studios.spec.ts`'s "an old slug redirects" test uses, POST to the old slug, and assert the grant belongs to the studio.
  - `a studio owner gets a 404 and nothing is written`: both routes as the studio's owner give 404, and `forTenant` is empty.
  - `the Billing page links each studio to its admin page`: `GET /admin/billing` has `studios[i].slug` equal to the studio's slug.
- [ ] **Step 2: Run them to see them fail**
  Run: `node ace test functional --files=tests/functional/admin/admin_pilot_grants.spec.ts`
  Expected: FAIL (404s from the missing routes; no `pilot` prop).
- [ ] **Step 3: Add the routes and the validator**, then run `node ace codegen`.
- [ ] **Step 4: Implement the controller.**
  - In `AdminStudiosController`, inject `PilotGrantService` and `EntitlementService`.
  - `show` builds the `pilot` prop inside `withDbContext({ tenantId: tenant.id })`.
  - `grantPilot(ctx)` validates with `pilotGrantValidator`. It turns `until` into `DateTime.fromISO(until, { zone: "utc" })`, flashing `Give an until date as YYYY-MM-DD.` when invalid. It calls `grant` with `grantedBy: (user.fullName?.trim() || user.email).slice(0, 100)`, then flashes success `"<studio name> is a <Package> pilot until <day>."`.
  - `endPilot(ctx)` calls `end` and flashes the success text above.
  - Both turn `PilotGrantError` into an error flash and redirect back, the way `operate()` does.
- [ ] **Step 5: Implement the page and the Billing link.**
  - In `show.tsx`, add `<Section title="Package">` before "Discover listing". It shows the state text, the running grant (package, until, note, "granted by … on …"), and an "End grant now" `Form` (`route="admin.studios.pilot.end"`) when one runs.
  - It has a grant `Form` (`route="admin.studios.pilot.grant"`, `errorBag="pilot"`) with a package `<select>` from `pilot.packages`, a `<input type="date" name="until">`, a note `Input` (`maxLength={500}`) and a "Grant" button. Add labels as the existing TakedownForm does, and field errors under each field.
  - It lists past grants.
  - In `admin_controller.ts`'s Billing loop, add `slug: tenant.slug`. In `billing.tsx`, wrap the studio name in `<Link href={urlFor("admin.studios.show", { slug: studio.slug })}>`.
- [ ] **Step 6: Run the new spec and the neighbours**
  Run: `node ace test functional --files=tests/functional/admin/admin_pilot_grants.spec.ts --files=tests/functional/admin/admin_studios.spec.ts --files=tests/functional/admin/admin_shell.spec.ts --files=tests/functional/billing/billing.spec.ts --files=tests/functional/packages/pilot_grants.spec.ts`
  Expected: PASS.
- [ ] **Step 7: Typecheck and lint**
  Run (repo root): `pnpm --filter @tattoo-drip/platform typecheck` and `pnpm check`.
  Expected: exit 0; no new Biome findings in the changed files.
- [ ] **Step 8: Commit**
  `git add apps/platform/start/routes.ts apps/platform/app/validators/admin.ts apps/platform/app/controllers/admin_studios_controller.ts apps/platform/app/controllers/admin_controller.ts apps/platform/inertia/pages/admin/studios/show.tsx apps/platform/inertia/pages/admin/billing.tsx apps/platform/.adonisjs apps/platform/tests/functional/admin/admin_pilot_grants.spec.ts`
  `git commit -m "feat(platform): give and end pilot grants from the studio's admin page"`

### Task 3: Docs

**Files:**
- Modify: `apps/platform/docs/deploy.md` or the packages section of `apps/platform/docs/backend.md`, wherever `packages:pilot` is documented (`rg -n "packages:pilot" apps/platform/docs docs deploy`)

- [ ] **Step 1: Document the page** next to each mention of `packages:pilot`: "or from the studio's admin page (`/admin/studios/<slug>`, Package), which can also end a grant early".
- [ ] **Step 2: Commit**
  `git commit -am "docs(platform): pilot grants from the admin page"`
