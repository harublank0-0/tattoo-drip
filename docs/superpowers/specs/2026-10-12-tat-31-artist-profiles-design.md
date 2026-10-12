# Artist profiles (dashboard CRUD)

Date: 2026-10-12
Refs: TAT-31. Its blockers TAT-21 and TAT-25 are done. TAT-37 (project models) and TAT-36 (sessions) need the `artists` table this ticket creates, although Linear does not list TAT-31 as their blocker, so the build order is TAT-31, TAT-37, TAT-36. TAT-33 (invites that claim a profile), TAT-35, TAT-39, TAT-34 and TAT-44 build on it too.

## Goal

An owner can create, edit, hide and delete the public profiles of the studio's artists: name, a slug that becomes the per-artist intake link, a bio, a photo, and whether the artist is currently accepting inquiries. An independent artist gets their own profile automatically when they create their tenant. The `artists` table is tenant-owned and protected by row-level security from the start, so the later tickets can reference it with composite foreign keys.

This ticket stores profiles and gives owners a dashboard to manage them. It does not publish them: the public read endpoints are TAT-44 and the studio page is TAT-48.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Who may create and edit profiles | Owners only for now. Artist-role members get the same 404 as an unknown URL | Matches every settings page today. An artist-role member cannot exist until invites ship (TAT-33), so self-editing could not be used or tested in a real flow. TAT-30 adds "an artist edits their own profile" on top of the user link this ticket stores |
| Editing a slug | Allowed, with a warning in the form that the old shared link stops working | Simplest, and matches the ticket. Slug history and redirects can come later, as tenant slugs get aliases in TAT-24 |

## Data

New table `artists`, created by a new migration after `1791570000000_enable_row_level_security`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, `uuidv7()` | primary key |
| `tenant_id` | uuid, not null, references `tenants.id` on delete cascade | indexed |
| `user_id` | uuid, null, references `users.id` on delete set null | the optional login. A deleted account must not delete a public profile |
| `name` | varchar(120), not null | same limit as a tenant name, so the independent auto-profile never truncates |
| `slug` | varchar(63), not null | lowercase letters, digits and hyphens, not starting or ending with a hyphen, 2 to 63 characters |
| `bio` | varchar(1000), null | plain text |
| `photo_key`, `photo_width`, `photo_height` | varchar(255), integer, integer, null | all three set or all three null (check constraint). The public API's `Image` needs width and height, and `ImageService.store` already returns them |
| `visible` | boolean, not null, default true | hidden means not shown anywhere public |
| `accepting_inquiries` | boolean, not null, default true | when false the artist is still shown, but the intake form hides them and shows `closed_message` |
| `closed_message` | varchar(300), null | plain text |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | soft delete through `withSoftDeletes` |

- **Indexes.** Partial unique `(tenant_id, slug) WHERE deleted_at IS NULL`, so a deleted profile frees its slug (the alternative, reserving it forever like a tenant slug, is not worth it for a path segment). Partial unique `(tenant_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL`: one live profile per login per studio. An index on `user_id`.
- **Row-level security.** The migration runs `enableTenantRls("artists")` (policy `tenant_isolation`, plus `UNIQUE (tenant_id, id)` so TAT-37 and TAT-36 can use `tenantReference(..., "artist_id", "artists")`). `artists: ["tenant_isolation:ALL"]` is added to `EXPECTED_POLICIES` in `tests/functional/rls/catalog_guard.spec.ts`.
- **The user link.** `users` is a global table, so the link cannot be a composite key. That the linked user is an owner or member of this tenant is an application rule in the service. In this ticket the only person an owner can link is themselves (a "This is my profile" checkbox). Linking other people arrives with TAT-33, when an invited member claims a profile.
- **Names.** `accepting_inquiries` and `closed_message` follow the product wording. The draft OpenAPI calls them `acceptingRequests` and `closedMessage`; it is reworked in TAT-44, so nothing changes in the contract here.

## Module `app/modules/artists/`

Mirrors `app/modules/payments/`: `models/artist.ts` (`compose(ArtistSchema, withSoftDeletes)`), `services/artist_service.ts`, `errors.ts`, `validators/artist.ts` (shape only), and a `rules.ts` only if pure rules appear.

`ArtistService` is the only thing other modules call:

- `list(tenant)`: live profiles ordered by name, case-insensitive.
- `findFor(tenant, id)`: an unknown, deleted or foreign id all throw the same 404.
- `create(tenant, input, { owner })` and `update(tenant, artist, input)`.
- `delete(tenant, artist)`: a soft delete. The photo file stays, as QR codes do.
- `createOwnerProfile(tenant, owner)`: used by onboarding.

**Photo.** A new `IMAGE_PURPOSES.artist_photo` with public visibility, validated with the existing `imageFile()` (10 MB; jpg, jpeg, png, webp). The lifecycle copies `PaymentMethodService`: `images.store` runs inside the `withTransaction` callback, `afterRollback` is registered on the next statement with no `await` between, and a replaced or removed key is deleted with `afterCommit`. There is no crop and there are no resized variants: the pipeline already scales to 2048 px, and thumbnails can be requested when the studio page needs them (TAT-48).

**Conflicts.** A unique violation on the slug index becomes the field error "This link is already used by another artist". A unique violation on the user index becomes "You already have a profile". Both are recovered after the savepoint rolls back, the way `SlugTakenError` is.

**Rules for code in this module.** It never imports the `db` service (the Biome rule); it uses models, `withTransaction` and `dbClient()`. A service query that reads or writes artists has a test that runs it from the other tenant's context, because the isolation harness cannot see a missing filter while RLS hides the rows.

## Tenancy hooks

- **Independent tenants.** In `TenancyService.createTenant`, when `input.type === "independent"`, call `ArtistService.createOwnerProfile` inside the existing `withDbContext({ tenantId })` callback, right after the owner membership. The profile's `name` is the tenant name, its `slug` is the tenant slug (always valid under the artist rule), it is visible and accepting, and it is linked to the owner. The tenant, the membership and the profile succeed or roll back together. A studio gets no automatic profile. Existing dev tenants are not backfilled: there is no real data yet, and an owner can create "my profile" by hand.
- **Deleting a tenant.** `Tenant.softDelete` also soft-deletes the tenant's live artists in the same transaction, like memberships and payment methods.
- **Removing a member** (TAT-33) must unlink their profile, never delete it. TAT-33 owns that; the nullable `user_id` already allows it.

## Routes, permissions and navigation

A top-level dashboard area, not under settings, so TAT-30 can open it to artists by changing the allow list instead of moving routes. Every route is inside the `/t/:tenant` group (`auth`, `dbContext`, `tenant`) and a nested group with `middleware.role({ allow: ["owner"] })`:

| Route | Name |
|---|---|
| `GET /artists` | `tenant.artists` |
| `GET /artists/new` | `tenant.artists.create` |
| `POST /artists` | `tenant.artists.store` |
| `GET /artists/:id/edit` | `tenant.artists.edit` |
| `PUT /artists/:id` | `tenant.artists.update` |
| `DELETE /artists/:id` | `tenant.artists.destroy` |

- `:id` is constrained to a uuid, so a malformed id is a 404.
- `ArtistsController` stays flat in `app/controllers`. It loads the record scoped to the tenant before validating the body (a foreign id is a 404), flashes success messages, and turns service errors into field errors.
- A new "Artists" entry in `tenantNav()` in `inertia/layouts/app.tsx`, shown only when `tenant.role === "owner"`.

## Pages

Copied from the payments pages.

- `artists/index.tsx`: a list with the photo thumbnail, name, slug and badges (Hidden, Not accepting, "You"), edit and delete with confirmation, and an empty state.
- `artists/form.tsx`, shared by create and edit: name; slug, suggested from the name until edited, with the "old links stop working" warning on edit; bio textarea; photo upload showing the stored image with a remove checkbox; checkboxes for visible and accepting inquiries; the closed message, shown with the accepting control; and "This is my profile".
- Checkboxes, not a Switch: there is no Switch component and adding one is a new dependency.

## Tests

- **Service (functional).** Create, update and delete rules; slug uniqueness including reuse after delete; one profile per user; the linked user must be a live member of that tenant; photo store, replace and remove; file cleanup on rollback and only after commit for replaced files; a fault-injected "transaction cannot open" case; `list` and `findFor` run from the other tenant's context.
- **Pages (functional).** Ordered props; create, edit and delete over HTTP; validation errors; an artist-role member gets 404; foreign and deleted ids give 404; a malformed uuid gives 404.
- **Onboarding.** An independent tenant gets its profile atomically; a studio does not; a failing profile insert rolls the tenant back; `Tenant.softDelete` cascades.
- **Guards.** The `EXPECTED_POLICIES` entry. `twoStudios` and `Studio` get an artist. `"artist"` joins the isolation case `resource` union, with six cases in `tests/isolation/cases.ts` whose snapshot includes deleted rows so an unauthorized soft delete shows. A route-group test checks that every `/t/:tenant/artists` route runs `auth`, `dbContext`, `tenant`, then `role(owner)`, like the settings one.
- Pure unit tests for the slug rule and the suggestion helper, if they are extracted.

## Docs and generated files

`apps/platform/docs/backend.md` gets the artists module, the service API, the owner-only rule and where TAT-30 hooks in. `apps/platform/database/README.md` changes only if a new rule appears. `docs/data-model.md` changes only if a column contradicts its conceptual text. `database/schema.ts` is regenerated by `pnpm migrate`; run `node ace codegen` for the routes.

## Not in this ticket

Public read endpoints and the SDK (TAT-44). Artist self-edit and policies (TAT-30). Invites and claiming a profile (TAT-33). Manual ordering. The studio page and its "which artists show" configuration (TAT-48, StorefrontConfiguration). Portfolio (TAT-39) and the services mapping (TAT-34). Reserved slug words, to be decided with the studio-page route. Photo crop and thumbnails. Slug history and redirects. A guard against deleting an artist who has projects or sessions: TAT-37 and TAT-36 add it when those references exist, and until then deleting is a soft delete.

## Assumptions the user can overrule at review

Names and limits above (name 120, bio 1000, closed message 300); checkboxes instead of a Switch; owner-only linking, to oneself; a deleted profile frees its slug; the independent auto-profile uses the tenant name and slug; no backfill.

## Verification

`pnpm migrate` on the dev database and on a fresh throwaway cluster. `PORT=3402 node ace test` passes, including the catalog guard and the isolation harness with the new table and routes. `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. A manual pass in the browser: create a studio profile with and without a photo, edit its slug (the warning shows), hide it, switch accepting off, delete it; sign up an independent artist and see the automatic profile; confirm an artist-role member gets a 404. Then the final review and the Codex code and security reviews before the PR.
