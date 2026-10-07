# Tenants, memberships and onboarding

Date: 2026-10-07
Refs: TAT-19

## Goal

After signing up, a person creates their business, a `studio` or an `independent` artist, and becomes its owner. TAT-24 (slugs), TAT-25 (tenant routes), TAT-26 (profile and payments) and TAT-33 (invites) build on this.

## Scope

In:

- `tenants` and `tenant_memberships` tables and models in a new `app/modules/tenancy/` module.
- `TenancyService`: create a tenant with its owner, list a user's tenants, and a guard that a tenant keeps at least one owner.
- Onboarding at `/onboarding`: name, type, slug and timezone. Signup and login send users without a tenant there.
- HTTP and service tests.

Left to the tickets that own them:

- "Needs a verified email" → TAT-18 (email verification doesn't exist yet).
- The independent owner's Artist profile → TAT-31 (artist profiles don't exist yet).
- Reserved slugs and old-slug redirects → TAT-24. TAT-19 checks format and uniqueness only.
- Profile fields and payment settings → TAT-26.
- `/t/:slug` routes and the tenant switcher → TAT-25. Until then, onboarding lands on `/dashboard`.
- Removing and demoting members → TAT-33, which must call the owner guard.

## Data

`tenants`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | `uuidv7()` |
| `type` | text | check `studio` or `independent` |
| `name` | varchar(120) | not null |
| `slug` | varchar(63) | not null, unique |
| `timezone` | varchar(64) | not null, default `Asia/Kathmandu` |
| `created_at`, `updated_at` | timestamptz | |

`tenant_memberships`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | `uuidv7()` |
| `tenant_id` | uuid | not null, references `tenants` on delete cascade, indexed |
| `user_id` | uuid | not null, references `users` on delete cascade, indexed |
| `role` | text | check `owner` or `artist` |
| `created_at`, `updated_at` | timestamptz | |

Unique `(tenant_id, user_id)`.

Models `Tenant` and `TenantMembership` live in `app/modules/tenancy/models/` and extend the generated schema classes. `User` gets no tenancy relation: Identity doesn't import Tenancy's tables, so other code asks `TenancyService`.

## TenancyService

`app/modules/tenancy/services/tenancy_service.ts`:

- `createTenant(owner: User, input: { type, name, slug, timezone }): Promise<Tenant>` creates the tenant and the owner membership in one transaction. A unique violation on the slug (a race between two signups) becomes a `SlugTakenError`.
- `tenantsFor(user: User): Promise<{ tenant: Tenant; role }[]>` lists the user's tenants, oldest membership first.
- `assertKeepsAnOwner(trx, tenantId, change: { remove: membershipId } | { demote: membershipId })` throws `LastOwnerError` if the change would leave the tenant with no owner. It locks the tenant's owner rows (`FOR UPDATE`), so two owners removing each other at once can't both succeed. The caller runs it inside the same transaction as the change.

## Validation

`app/modules/tenancy/validators/tenant.ts`, VineJS:

- `name`: trimmed, 2–120 characters.
- `type`: `studio` or `independent`.
- `slug`: trimmed, lowercased, matching `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` (3–63 characters, no hyphen at either end), unique in `tenants.slug`.
- `timezone`: one of `Intl.supportedValuesOf("timeZone")`.

## Onboarding flow

- `GET /onboarding` renders `onboarding/create_tenant` with the timezone list. `POST /onboarding` validates, calls `createTenant` and redirects to `/dashboard`. Both are for signed-in users only, through a thin `OnboardingController` in `app/controllers/`.
- `SlugTakenError` is returned as a validation error on `slug`.
- Signup redirects to `/onboarding`. Login redirects to `/onboarding` when `tenantsFor(user)` is empty, otherwise to `/dashboard`.
- The page uses `Form` and the shadcn `Field` components like the signup page:
  - name
  - type, as two radio cards ("Studio — a shop with artists", "Independent — just you")
  - slug, pre-filled from the name until edited and shown as `{slug}.tattoodrip.com`
  - timezone, a select defaulting to `Asia/Kathmandu`

  Add the shadcn `radio-group` and `select` components with the CLI.

## Tests

Functional tests (`tests/functional/`), each inside `wrapInGlobalTransaction()`:

- Onboarding:
  - creates the tenant and an owner membership for the signed-in user
  - lowercases the slug
  - rejects a bad slug format, a taken slug, an unknown timezone and an unknown type, each with an error on that field
  - sends a signed-out user to `/login`
- Redirects:
  - signup lands on `/onboarding`
  - login lands on `/onboarding` without a tenant and on `/dashboard` with one
- `assertKeepsAnOwner`:
  - rejects removing or demoting the only owner
  - allows it when another owner remains
  - allows removing an artist
- `tenantsFor` returns only the user's own tenants, with their roles.

## Docs and Linear

- `apps/platform/AGENTS.md`: the tenancy module and `TenancyService` as the way other modules read tenants and memberships.
- TAT-19: tick what is done and note the deferrals and their tickets.
