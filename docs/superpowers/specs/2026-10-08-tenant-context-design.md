# Tenant context, /t/:tenant routes and the tenant switcher

Date: 2026-10-08
Refs: TAT-25

## Goal

Every dashboard page lives under `/t/:tenant/…`. Each request resolves the tenant from the URL and checks the signed-in user's live membership in it, every time, so removing a member or deleting a tenant takes effect on the next request. A non-member gets the same 404 as an unknown slug, so a URL never reveals that a tenant exists.

## Routes

- `/t/:tenant` (`tenant.dashboard`) is the tenant's home; the current dashboard page moves here. Later tenant pages join the same route group (`/t/:tenant/projects`, …).
- `/dashboard` (`dashboard`) is where login, signup and onboarding land. It redirects to the tenant the user last opened (kept in the session) if they're still a member of it, otherwise to their oldest live tenant, otherwise to `/onboarding`. It replaces TAT-19's `onboarded` middleware, which is removed.

## Tenant middleware

A named `tenant` middleware, used after `auth` on the `/t/:tenant` group:

- `TenancyService.membershipFor(user, slug)` finds the live tenant by slug and the user's live membership in it in one query, returning `{ tenant, membership }` or `null`.
- `null` means 404, the same response as an unknown slug (`E_ROUTE_NOT_FOUND`, rendered by the existing `errors/not_found` page).
- It runs on every request, with no caching.
- It sets `ctx.tenant` and `ctx.membership`, declared on `HttpContext`.
- It stores the tenant slug in the session as the last-opened tenant.
- It shares two Inertia props with every tenant page: `tenant` (`name`, `slug`, `type`, `role`) and `tenants` (the user's live tenants, each with `name`, `slug`, `role`, for the switcher).

Role checks per route are TAT-30; the role is available as `ctx.membership.role`. Old-slug redirects are TAT-24. Setting the tenant for row-level security is TAT-28.

## Rules

- Controllers pass `ctx.tenant` to services explicitly.
- A tenant id from the request body, query string or headers is never read; validators for tenant-owned data never include `tenant_id`.

## Switcher

- The app header shows the current tenant's name.
- With more than one tenant, it's a dropdown (shadcn `dropdown-menu`) listing each tenant with the user's role, linking to `/t/<slug>`, with the current one marked.
- Outside tenant pages (no `tenant` prop) it isn't shown.
- `NavLink` gains an optional `params` prop, and the nav's Dashboard entry links to `tenant.dashboard` for the current tenant.

## Tests

Functional, inside `wrapInGlobalTransaction()`:

- A member opens `/t/<their slug>` → 200, with `tenant` and `tenants` props.
- Each of these gets 404, the same as an unknown slug:
  - a member of another tenant
  - a user with no tenants
  - an unknown slug
  - a just-removed (soft-deleted) membership
  - a soft-deleted tenant
- A signed-out visitor → `/login`.
- `/dashboard`:
  - no tenant → `/onboarding`
  - one tenant → `/t/<slug>`
  - two tenants and a last-opened one → that one
  - last-opened one the user was removed from → their oldest live tenant
- `tenants` lists only the user's live tenants.
- `membershipFor` returns null for every non-member case.

## Docs and Linear

- `apps/platform/AGENTS.md`:
  - the tenant route group and middleware, `ctx.tenant`, the explicit-tenant and never-from-the-body rules
  - `/dashboard` as the entry point
  - removal of `onboarded`
- TAT-25: tick each item.
