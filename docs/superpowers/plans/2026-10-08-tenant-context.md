# Tenant Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Claude implements this plan test-first; the user reviews the result.

**Goal:** Dashboard pages under `/t/:tenant`, guarded by a per-request membership check, with `/dashboard` as the landing redirect and a tenant switcher.

**Architecture:** `TenancyService.membershipFor(user, slug)` is the one place that decides access. A named `tenant` middleware calls it on every request, 404s non-members, sets `ctx.tenant` and `ctx.membership`, remembers the tenant, and shares `tenant` and `tenants` with Inertia. A `DashboardController` turns `/dashboard` into a redirect to the right tenant.

**Tech Stack:** AdonisJS 7, Lucid, Inertia + React, shadcn/ui, Japa with `@japa/api-client`.

**Spec:** `docs/superpowers/specs/2026-10-08-tenant-context-design.md`

## Global Constraints

- 404 for every non-member case, never 403, and identical to an unknown slug.
- No caching of membership checks.
- Controllers that `@inject()` keep value imports with the `biome-ignore` (see AGENTS.md).
- Run `node ace codegen` after route changes and commit `.adonisjs/`.
- Commits use scope `platform` and end with `Refs: TAT-25`.

## Review Focus

- **A member removed while their tab is open:** their next request gets 404. Pinned by the removed-membership test.
- **A slug with different case** (`/t/Black-Needle`): slugs are stored lowercase, so it 404s rather than matching. Pinned by a test.
- **`/dashboard` remembering a tenant the user has since lost:** it must fall back, not redirect into a 404. Pinned.
- **Shared props leaking another user's tenants:** `tenants` comes from `tenantsFor(user)` only. Pinned by the list test.

---

### Task 1: `membershipFor` and the tenant middleware (test-first)

- [ ] Tests:
  - `membershipFor` returns the tenant and membership for a member, and null for each non-member case
  - the HTTP tests for `/t/:tenant` (200 with props; the five 404 cases; a mixed-case slug 404s; signed-out goes to login)
- [ ] Implement:
  - `membershipFor`
  - the `tenant` middleware and its registration in `start/kernel.ts`
  - the `HttpContext` declaration
  - the `/t/:tenant` route group with `tenant.dashboard` rendering the dashboard page
  - the session memory
  - the shared props
- [ ] `node ace codegen`, run the tests, then commit.

### Task 2: `/dashboard` as the landing redirect (test-first)

- [ ] Tests for the four `/dashboard` cases. Update the TAT-19 tests that expected `/dashboard` to render.
- [ ] Implement:
  - `DashboardController.show`
  - point the `/dashboard` route at it
  - delete `onboarded_middleware.ts` and its kernel entry
- [ ] `node ace codegen`, run the tests, then commit.

### Task 3: Switcher and nav

- [ ] Add the shadcn `dropdown-menu`.
- [ ] `NavLink` takes `params`.
- [ ] `AppLayout` reads the `tenant` and `tenants` props: it shows the tenant name or the dropdown, and links the nav to `tenant.dashboard`.
- [ ] Typecheck, then check in headless Chromium against the dev server:
  - log in → land on `/t/<slug>`
  - the header shows the tenant
  - with a second membership the dropdown switches tenants
  - another tenant's URL shows the 404 page
- [ ] Commit.

### Task 4: Docs, Linear, review, PR

- [ ] AGENTS.md as the spec lists.
- [ ] `pnpm check && pnpm typecheck && pnpm build && pnpm test`.
- [ ] Tick the boxes on Linear TAT-25.
- [ ] `/code-review` and `/security-review`; fix what matters.
- [ ] Push and open the PR when the user says so.
