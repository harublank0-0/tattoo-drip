# Roles and authorization: owner and artist (TAT-30)

Date: 2026-10-20
Refs: TAT-30 (Roles and authorization policies, owner and artist). Builds on TAT-25 (the `/t/:tenant` group, `tenantContext`), TAT-28/29 (RLS and the isolation harness: `tests/isolation/cases.ts`, `cross_tenant.spec.ts`), TAT-31 (artist profiles, `linkToMe`), TAT-43 (`BookingService.bookableArtists`), TAT-50 (`CalendarService`), TAT-64/46 (`ProjectService.findFor`, `lockFor`), TAT-65/66 (owner-only deposit links and payment decisions), TAT-67 (the shell, `navItems`, the artist pages inside the Settings layout), TAT-85 (`mayChangeSession`) and TAT-52 (alerts per member). Blocks TAT-33 (member invites), whose routes are entries in the table this ticket adds. Honours the two carry-forward comments on the ticket (TAT-43/50: keep "owners book any live artist, artists only themselves" and the calendar's visibility; TAT-67: opening the artist pages to artists changes the route group and hides the Settings item for them).
Size: **about 3 points** (the ticket says 2). Ruling 1 says why.

## Goal

One definition of what an owner and an artist may do, that a test enumerates: a table of every `/t/:tenant` route and the roles that may use it, read by the role middleware on every tenant request and walked by a test that sends every route as an artist. Owners keep everything in their studio. Artists get what the requirements give them and nothing more: their own profile (new: today they can't edit it), plus the projects and sessions assigned to them (already built and tested, unchanged).

No migration, no setting, no API, OpenAPI, SDK or storefront change. One new route (`GET /t/:tenant/artists/mine`). Written without the user (unattended run): every open question is a ruling below.

## How roles are enforced today (2026-10-20, 65eab5f)

Read from the code, not from older specs:

- **Route groups.** Each nested group under `/t/:tenant` in `start/routes.ts` ends with `.use(middleware.role({ allow: [...] }))`: settings, artists, inbox, clients and payments `["owner"]`; projects, sessions, calendar and alerts `["owner", "artist"]`. `RoleMiddleware` (`app/middleware/role_middleware.ts`) 404s any other role. The root `GET /t/:tenant` (`tenant.dashboard`) has no role check.
- **Its test.** `tests/functional/tenancy/tenant_routes.spec.ts` holds its own literal list of nine areas and their allow lists, and checks every route under each area runs `role` with that list after `tenant`. A route under a tenth area (a new `/t/:tenant/<area>` group) is not in the list and nothing fails.
- **Owner-only actions inside shared groups.** Five project routes are open to artists at the route level and refused by their service: `deposit-link` (`DepositLinkService.issue`), `payments`, `refunds`, `deposit-outcome` (`PaymentService.requireOwner`) and `artist` (`ProjectService.assignArtist`). Each is tested in its own spec; nothing lists them together, so the next owner-only action added to the projects group depends on its author remembering the service check.
- **Record rules (which rows an artist reaches).** `ProjectService.findFor` / `findManyFor` / `lockFor` (assigned projects, re-checked under the row lock), `BookingService.bookableFrom` (only their own profile), `CalendarService.scopeFor` (their own sessions; details only of projects they may open), `mayChangeSession` in `#modules/scheduling/outcomes` with `SessionService.findChangeable` / `assertMayChange` (their own session on their own project; its comment says "TAT-30 folds this into the roles"), `AlertService` (each member's own alerts), `paymentsCard` (the assigned artist sees the balance and the list, never a screenshot). "Their own profile" is `artists.list(tenant).find(({ userId }) => userId === member.userId)` in five places; all agree.
- **UI.** `navItems` (`inertia/components/shell/nav_items.ts`) gives artists Projects and Calendar; controllers pass `isOwner` props. The server 404s the rest anyway.
- **The gap.** The requirements' role table says an artist may change "their own profile". Today the whole artists area is owners only, so an artist can't edit their bio, photo or "accepting inquiries" switch.
- **Bouncer.** Not installed: `@adonisjs/bouncer` is in no `package.json` and not in `pnpm-lock.yaml`; the `#policies/*` and `#abilities/*` aliases in `apps/platform/package.json` are starter-kit leftovers pointing at folders that don't exist (`app/policies`, `app/abilities`).

## Rulings

1. **About 3 points, not 2.** In: the route table and the middleware that reads it (ruling 3), the tests that walk it (ruling 5), and the artist's own profile (ruling 7), which is the one line of the role table the app doesn't do today. Out: changing any record rule (ruling 6), staff roles (V2), member management (TAT-33). Why the extra point: the table alone (2 points) would leave "artist: their own profile" unbuilt and the ticket's first line untrue. Rejected: deferring the own-profile edit to TAT-33 (TAT-33 is already 5 points, and the profile edit is a role rule, not an invitation rule).
2. **No Bouncer; the existing pattern, formalised in one place.** Bouncer would add a dependency, a provider and an initialize middleware; it authorizes a user, not a membership in the URL's tenant, so every ability would need the membership passed in; its denials are 403 by default (the app answers 404 everywhere so a URL never reveals a page exists); and adopting it means rewriting about ten tested service checks into policies for no change in behaviour. The rules here are of two kinds, and each already has one right home: *which role may use a route* (a table, ruling 3) and *which record an artist reaches* (the owning module's service, ruling 6). The `#policies/*` and `#abilities/*` aliases stay unused; removing them is not this ticket's business. Rejected: Bouncer policies per resource; a `can(member, "ability")` helper wrapping every `member.role === "owner"` (indirection that removes no risk until staff roles exist).
3. **One table: `TENANT_ROUTE_ROLES` in `#modules/tenancy/access`.** A pure module (one type-only import). Every `/t/:tenant` route name maps to the roles that may use it: `OWNERS` (`["owner"]`) or `MEMBERS` (`["owner", "artist"]`). Owners are in every entry ("everything in the tenant"). Each group of entries carries a comment naming the service rule that decides which records an artist reaches (ruling 6), so the file reads as the role table of the requirements, route by route. `rolesFor(name)` gives an entry or `undefined` (own keys only: `"constructor"` is undefined). Staff roles (V2) are new names in these lists, not a second table. Rejected: a table keyed by area with exceptions (two lists); keying by `METHOD pattern` (route names are what pages and `urlFor` use).
4. **The role middleware reads the table on every tenant route.** `middleware.role()` (no options) joins the `/t/:tenant` group after `tenant()`: `[auth(), dbContext(), tenant(), role()]`. The nested groups lose their `.use(middleware.role({ allow }))`. `RoleMiddleware` looks up `ctx.route.name`: a role not in the entry gets the router's 404 (unchanged); a route with no entry throws an `Error` naming it (a 500: loud in development, and the tests below make it impossible to ship). Why: the five owner-only routes inside the projects group now 404 at the route too, before any controller or validator, and a new tenant route cannot work until someone decides who may use it. The services keep their own checks (defence in depth; they are tested and stay). Rejected: keeping the group allow lists next to the table (two definitions that can drift); putting the verdicts only in the tests (no runtime check for routes inside shared groups); failing closed with a silent 404 for an unknown route (a forgotten entry would look like a working permission denial).
5. **The tests that enumerate it.**
   - `tenant_routes.spec.ts`: every app `/t/:tenant` route (all but `EXEMPT_ROUTES`) runs `auth`, `dbContext`, `tenant`, `role` in that order; the table's keys are exactly the names of those routes (no route without an entry, no entry without a route, no unnamed route). This replaces the literal nine-area list.
   - `tests/unit/modules/tenancy/access.spec.ts`: every entry allows owners and lists only known roles; `rolesFor` refuses unknown names and prototype names.
   - `role_middleware.spec.ts` (functional): the middleware lets an allowed role through, 404s another, and throws for a route the table doesn't name.
   - `role_access.spec.ts` (new, the walk): every case of `tests/isolation/cases.ts` (so every tenant route; the coverage test already guarantees one per route) is sent by a studio's artist whose account is linked to the studio's artist profile, with every project of the studio assigned to that profile and an alert of their own. A route the table gives to owners must answer 404 and leave the case's snapshot unchanged; any other route must answer the case's own status (the positive control the cross-tenant spec uses for owners). Linking and assigning everything means an owner-only route can only refuse the artist for their role, never for a missing assignment.
   - The same spec pins `ARTIST_ROUTES`, the sorted list of route names open to artists. Widening what an artist may do is then a conscious edit of two files (like `EXPECTED_POLICIES`). This list is a checksum of the table, not a second definition: nothing in the app reads it.
   - `nav_items.spec.ts`: every destination `navItems` gives a role is a route that role may use.
6. **Record rules stay where they are.** They are per-row and need the database; a route table can't hold them. The table's comments name them: projects `ProjectService.findFor` / `findManyFor` / `lockFor`; bookings `BookingService.bookableArtists`; sessions `mayChangeSession` (`#modules/scheduling/outcomes`) through `SessionService`; calendar `CalendarService.load`; alerts `AlertService`; payments on the project page `paymentsCard`; profiles the new `ArtistService.findEditable` and `updateOwn` (ruling 7). The five copies of "the member's own profile" are not unified: they mean the same thing, they are tested, and TAT-33 doesn't change what a link is (it only sets one). `mayChangeSession`'s comment changes from "TAT-30 folds this into the roles" to a pointer at the table. Rejected: one `ownProfile()` helper rewritten into the five services (churn for taste; the calendar and the booking page reuse a list they already loaded on purpose).
7. **Artists edit their own profile.** `tenant.artists.edit` and `tenant.artists.update` become `MEMBERS`; the list, new, create and delete stay `OWNERS`. `ArtistService` gains `profileOf(tenant, userId)` (the live profile linked to that account, or null), `findEditable(tenant, editor, id)` (owners: any live profile, as `findFor`; anyone else: only the live profile linked to them; otherwise E_ROW_NOT_FOUND, the same 404 as another studio's) and `updateOwn(tenant, userId, artist, input)`, which shares `update`'s body but, under the row lock, requires the profile to still be live and linked to that account (an owner who deleted it, or TAT-33's removal that unlinks it, wins: a 404) and never changes the link. The artist may change every field the form has: name, link (slug), bio, photo, shown on the public page, accepting inquiries and the closed message. The "This is my profile" checkbox is neither offered to them nor read from their request. Owners edit as before (`update`, `linkToMe`). Rejected: owner-only visibility or slug (a second form variant for a pilot of one studio; the owner can change it back); letting an artist unlink themselves (they would lose their own calendar and bookings until an owner relinks them).
8. **Where an artist finds it.** `GET /t/:tenant/artists/mine` (`tenant.artists.mine`, `MEMBERS`) redirects to the member's own profile's edit page; with none linked, an owner goes to the artists list and an artist goes to Projects with the toast "No artist profile is linked to you in {studio} yet. Ask an owner to link one." (straight to `tenant.projects.index`: a flash doesn't survive two redirects). The account menu gets "Your artist profile" for artists. The edit page keeps `[AppLayout, SettingsLayout]`; `SettingsLayout` shows a non-owner only the card, under the title "Your artist profile" and "What clients see about you on the studio page.", without the settings sidebar (its links would all 404). The form's Cancel goes to Projects for an artist, and its section title reads "Profile". TAT-107 (Today) and TAT-108 (project page restructure) redo navigation and may move this. Rejected: a shared prop with the member's own profile id (one more query on every page); a third tab for artists (TAT-107 decides the tabs).
9. **Before TAT-33 no artist has a linked profile.** Only an owner can link a profile, and only to themselves (`linkToMe`). So in production the new pages are reachable once TAT-33's invitations claim profiles; the tests link profiles directly. The browser pass for the artist side is TAT-33's (it creates a real artist through an invitation).
10. **One isolation case, nothing else new.** `GET /t/:tenant/artists/mine` gets a case (owner, 302, no snapshot). No migration, setting, job, email, API or storefront change.

## The pieces

### `#modules/tenancy/access` (pure)

`TENANT_ROUTE_ROLES` (the table), `type TenantRouteName`, `rolesFor(name: string | undefined): readonly MembershipRole[] | undefined`.

| Area (route names) | Roles | Who decides the records |
|---|---|---|
| `tenant.dashboard` | members | the redirect picks Inbox (owners) or Projects (artists) |
| `tenant.settings*` (14) | owners | |
| `tenant.artists`, `.create`, `.store`, `.destroy` | owners | |
| `tenant.artists.mine`, `.edit`, `.update` | members | `ArtistService.findEditable`, `updateOwn` |
| `tenant.inbox.*` (5) | owners | |
| `tenant.clients.*` (4) | owners | |
| `tenant.projects.create`, `.store`, `.index`, `.show`, `.quotes.store`, `.quotes.accept`, `.price.store`, `.moves.store`, `.notes.update`, `.contacted.store`, `.sessions.store` | members | `ProjectService.findFor` / `lockFor`, `BookingService.bookableArtists`, `SessionService.scheduleFor` |
| `tenant.projects.artist.update`, `.deposit_link.store`, `.payments.store`, `.refunds.store`, `.deposit_outcome.store` | owners | (the services refuse too) |
| `tenant.payments.*` (3) | owners | |
| `tenant.sessions.outcome`, `.move` | members | `mayChangeSession` |
| `tenant.calendar.index` | members | `CalendarService.load` |
| `tenant.alerts.*` (3) | members | `AlertService` (own alerts) |

### `RoleMiddleware`

No options. `rolesFor(ctx.route?.name)`; unknown: throw; role not listed: `E_ROUTE_NOT_FOUND`.

### `ArtistService`

| Operation | Rule |
|---|---|
| `profileOf(tenant, userId)` | The live profile linked to `userId`, or null |
| `findEditable(tenant, editor, id)` | Owners: `findFor`. Others: the live profile with that id linked to them, else E_ROW_NOT_FOUND |
| `updateOwn(tenant, userId, artist, input)` | `update`'s body (photo store and cleanup, row lock, slug and profile-per-user conflicts as field errors); under the lock the row must be linked to `userId` (else E_ROW_NOT_FOUND); the link never changes |
| `update(...)` | Unchanged behaviour; its body moves to a private `save` shared with `updateOwn` |

### Routes

| Method and path | Name | Change |
|---|---|---|
| every `/t/:tenant…` | | `middleware.role()` on the outer group; nested `role({ allow })` removed |
| `GET /t/:tenant/artists/mine` | `tenant.artists.mine` | new, `ArtistsController.mine` |
| `GET /t/:tenant/artists/:id/edit`, `PUT /t/:tenant/artists/:id` | | open to artists for their own profile |

## Screens

- **Account menu** (artists only): "Your artist profile" (lucide `UserRound`), above the theme switch, linking `tenant.artists.mine`.
- **Own profile** (`artists/form`, an artist): page title "Your artist profile", description "What clients see about you on the studio page.", one card (no settings sidebar), section "Profile", the same fields as an owner's edit without "This is my profile", [Save] ("Saving…") and Cancel (to Projects). After saving: back to the same page with the toast `"{name}" saved.` At 375 px, one column, 44 px controls (the form already uses them).
- **No profile linked** (an artist opening "Your artist profile"): Projects with the error toast above.

## Words

"Your artist profile", "What clients see about you on the studio page.", "Profile", "No artist profile is linked to you in {studio} yet. Ask an owner to link one.", and the existing `"{name}" saved.`

## Threat notes

- **A route nobody classified.** The middleware throws for a tenant route without an entry, and `tenant_routes.spec.ts` fails for it: a new route can't ship open by accident or closed by accident.
- **Widening by mistake.** Turning an `OWNERS` entry into `MEMBERS` also needs `ARTIST_ROUTES` edited, or `role_access.spec.ts` fails; a reviewer sees both.
- **Owner-only actions in shared areas** (deposit links, desk payments, refunds, deposit outcomes, assigning the artist): refused at the route now, and still by their services, before any body is validated. The walk proves each is a 404 for an artist who is assigned to the project, with nothing changed.
- **An artist editing someone else's profile:** `findEditable` loads only the profile linked to them (404 otherwise, before the body is read); `updateOwn` checks the link again under the row lock, so an unlink or delete that commits while the form is open wins. A 404 is the same answer as another studio's id.
- **An artist taking or dropping a link:** the link is never read from their request; `updateOwn` keeps the stored one.
- **Not a 403.** Every refusal is the router's 404 (`E_ROUTE_NOT_FOUND`) or E_ROW_NOT_FOUND, as before; nothing reveals that a page or record exists.
- **Tenant isolation:** unchanged; the new route has a cross-tenant case, and `role` runs after `tenant` on every route.

## Tests

- **Unit:** `access.spec.ts` (owners everywhere, known roles only, `rolesFor` on known, unknown, `undefined`, `"constructor"`, `"__proto__"`); `nav_items.spec.ts` gains "every destination a member sees is a route their role may use".
- **Functional:** `role_middleware.spec.ts` (allow, refuse, unknown route); `tenant_routes.spec.ts` (role after tenant on every app route; table keys equal the route names); `role_access.spec.ts` (the walk and `ARTIST_ROUTES`); `own_profile.spec.ts` (an artist opens and saves their own profile and keeps the link, can't open or save another's (linked to someone or not), `mine` for an artist with and without a profile and for an owner with and without one, an owner's edit unchanged); `artist_service.spec.ts` gains `profileOf`, `findEditable` and `updateOwn` (including the unlink-while-editing race at service level); `cases.ts` gains the `mine` case.
- **Not automated:** how the artist's page and the menu look (TAT-33's browser pass, which creates a real artist).

## Browser pass (in the PR)

Owner regression only (no artist can exist without TAT-33): at 375 px and 1280 px, light and dark, as an owner open Inbox, a project (deposit link, record a payment), Settings (each page), Artists (list, edit, add): all work as before; the account menu has no "Your artist profile". The artist side is TAT-33's browser pass.

## Docs

- `apps/platform/docs/backend.md`: the "Tenancy and route access" bullet (the table, `middleware.role()` on the group, the tests, "every tenant route needs an entry"); the Artists bullet ("TAT-30 opens it to artists by changing the allow list" becomes what this ticket did: `profileOf`, `findEditable`, `updateOwn`, `mine`); the Scheduling bullet's `mayChangeSession` sentence points at the table.
- `apps/platform/docs/testing.md`: the Tenant isolation section names `role_access.spec.ts` and `ARTIST_ROUTES`, and that a new route needs a `TENANT_ROUTE_ROLES` entry as well as its isolation case.
- `apps/platform/docs/ui.md`: App shell: "Your artist profile" in the account menu; `SettingsLayout` for a non-owner.
- `docs/requirements.md`: the role table's artist row reads "Their own profile (everything on it but the link to their login), plus …".
- `docs/architecture.md`: the Tenancy module row is unchanged; under "Tenant isolation" (rule 2) a sentence: "Which role may use each dashboard route is one table (`TENANT_ROUTE_ROLES`), read on every request."

## Carry-forwards

- **TAT-33:** its six owner routes are `OWNERS` entries; a removed member's profile is unlinked (`updateOwn` then 404s their open form); the artist browser pass.
- **TAT-107 / TAT-108:** "Your artist profile" lives in the account menu for now; the settings layout's artist variant is a stopgap.
- **V2 staff roles:** add the role to `MEMBERSHIP_ROLES` and to the entries it may use; the walk then needs a staff actor.
- **Cleanup (optional):** the unused `#policies/*` and `#abilities/*` aliases.

## Not in this ticket

Bouncer, staff roles, member management (TAT-33), changing any record rule, a `can()` helper, unifying the five own-profile lookups, owner-only profile fields, artists unlinking themselves, any API, SDK or storefront change.

## Assumptions the user can overrule at review

No Bouncer; route-level roles in one table read by the middleware; a missing entry is a 500, not a 404; artists may change every field of their own profile, slug and visibility included; "Your artist profile" in the account menu; the settings layout's artist variant; the 3-point size.

## Verification

`PORT=3402 node ace test` passes on Node 24.3.0; `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
