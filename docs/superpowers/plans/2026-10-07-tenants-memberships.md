# Tenants and Memberships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Claude implements this plan test-first; the user reviews each task's result.

**Goal:** Tenants with owner memberships, created through an onboarding page that new users land on.

**Architecture:** A `tenancy` module (`app/modules/tenancy/`) owns the `tenants` and `tenant_memberships` tables, their models, a validator and `TenancyService`. A thin `OnboardingController` serves `/onboarding`. Other code reads tenancy only through the service.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18, VineJS, Inertia + React with shadcn/ui, Japa with `@japa/api-client`.

**Spec:** `docs/superpowers/specs/2026-10-07-tenants-memberships-design.md`

## Global Constraints

- Migrations follow `apps/platform/database/README.md`: UUIDv7 keys, `timestamptz`, and an index on every foreign key.
- Never hand-edit `database/schema.ts`. After `migration:run`, run `pnpm exec biome check --write database/schema.ts`.
- Controllers stay in `app/controllers/`; models, services and validators go in `app/modules/tenancy/`.
- Functional tests run inside `testUtils.db().wrapInGlobalTransaction()`.
- Commits use scope `platform` and end with `Refs: TAT-19`.

## Review Focus

- **Two signups racing for the same slug:** the second gets a `slug` field error, not a 500. Pinned by a service test that inserts the slug between validation and creation.
- **Mixed-case or padded slugs** (`" Black-Needle "`) are stored as `black-needle`. Pinned by an onboarding test.
- **A user who belongs to two tenants** sees both, and never another user's tenant. Pinned by a `tenantsFor` test.
- **Removing one of two owners at the same moment:** the lock in `assertKeepsAnOwner` lets only one proceed. No test, because a real concurrency test isn't worth its flakiness; the `FOR UPDATE` is reviewed instead.
- **A signed-out request to `/onboarding`** goes to login. Pinned.

---

### Task 1: Tables and models

**Files:** two migrations, `app/modules/tenancy/models/tenant.ts`, `app/modules/tenancy/models/tenant_membership.ts`, regenerated `database/schema.ts`.

- [ ] Write both migrations as in the spec, including check constraints, the unique `(tenant_id, user_id)` and the indexes.
- [ ] Run `node ace migration:run`, then Biome on `schema.ts`.
- [ ] Write the `Tenant` model (`hasMany` memberships) and the `TenantMembership` model (`belongsTo` tenant). Export the `TenantType` and `MembershipRole` union types.
- [ ] Run `pnpm typecheck`, then commit `feat(platform): add tenants and memberships tables`.

### Task 2: TenancyService (test-first)

**Files:** `app/modules/tenancy/services/tenancy_service.ts` and `app/modules/tenancy/errors.ts` (`SlugTakenError`, `LastOwnerError`); test `tests/functional/tenancy/tenancy_service.spec.ts`.

- [ ] Write the tests and watch them fail. They cover:
  - `createTenant` makes the tenant and the owner membership
  - a slug inserted after validation turns into `SlugTakenError`
  - `tenantsFor` returns only the user's tenants with roles, oldest first
  - `assertKeepsAnOwner`: rejects removing the only owner, rejects demoting the only owner, allows it with a second owner, and allows removing an artist
- [ ] Implement the service. `createTenant` uses `db.transaction`. A unique violation (`23505`) on `tenants_slug_unique` becomes `SlugTakenError`. `assertKeepsAnOwner` selects the owner memberships `FOR UPDATE` through `trx`.
- [ ] Run the tests until they pass, run the whole suite, then commit `feat(platform): add TenancyService`.

### Task 3: Onboarding route, validator and redirects (test-first)

**Files:**
- `app/modules/tenancy/validators/tenant.ts`
- `app/controllers/onboarding_controller.ts`
- `start/routes.ts`
- `new_account_controller.ts` and `session_controller.ts` (redirects)
- test `tests/functional/tenancy/onboarding.spec.ts`

- [ ] Write the HTTP tests from the spec and watch them fail: creation, slug lowercasing, the 4 invalid inputs, the signed-out redirect, the signup redirect, and the two login redirects.
- [ ] Implement the validator. Implement the controller: `create` renders the page with `timezones`; `store` validates, calls `createTenant`, turns `SlugTakenError` into a `slug` validation error, and redirects to `/dashboard`. Add the routes and the redirects.
- [ ] Check what Inertia validation errors look like in a test response (`assertSession` errors or a redirect back) and assert on that.
- [ ] Run the tests until they pass, run the whole suite, then commit `feat(platform): add tenant onboarding`.

### Task 4: Onboarding page

**Files:** `inertia/pages/onboarding/create_tenant.tsx`, plus the shadcn `radio-group` and `select` components.

- [ ] Add the components with `pnpm dlx shadcn@latest add radio-group select`, then `pnpm format:fix`.
- [ ] Build the page: the fields as in the spec, the slug following the name until edited, and field errors through `FieldError`.
- [ ] Run `pnpm typecheck`, then check by hand in the browser: sign up, land on onboarding, create a tenant, land on the dashboard. Check a taken slug shows its error.
- [ ] Commit `feat(platform): add the onboarding page`.

### Task 5: Docs, Linear, review

- [ ] `apps/platform/AGENTS.md`: the tenancy module, `TenancyService` as the only way to read tenancy, and `assertKeepsAnOwner` for TAT-33.
- [ ] Run `pnpm check && pnpm typecheck && pnpm build && pnpm test`.
- [ ] Linear TAT-19: tick what's done and note the deferrals (TAT-18, 24, 25, 26, 31, 33).
- [ ] Run `/code-review` on the branch, fix what matters, then push and open the PR when the user says so.
