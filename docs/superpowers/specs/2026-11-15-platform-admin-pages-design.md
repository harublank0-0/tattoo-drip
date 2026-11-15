# Platform admin pages: replacing the operator shell commands

Date: 2026-11-15. Status: draft for approval. Builder check done; nothing was left for the admin to decide.

## Intent

The platform admin (today one person) runs routine operator work from the server shell: Discover takedowns, review moderation, confirming accounts by hand and reading the pilot numbers. Every one of those means an SSH session, and most need a slug or a uuid copied from somewhere first. This adds pages under the existing `/admin` area so that work happens in the browser: browse to the thing, press the button next to it.

Success: the admin goes a normal week without SSHing in for any of the commands below.

## Goals

- Web equivalents for these commands, with the same rules and the same service calls:
  - `discover:status`, `discover:suspend`, `discover:restore` (studio listing and single photos)
  - `reviews:reports`, `reviews:takedown`, `reviews:restore`, `reviews:dismiss` (review, reply, Fresh ink post)
  - `account:verify`
  - `metrics:pilot`
- Browse instead of copy-paste: a studio list, a studio page holding everything an operator can act on for that studio, and the report queue with actions on each row.
- A way to reach `/admin` from the dashboard for the admin (it's typed by hand today).

## Non-goals

- `billing:sync-plans`: one-time setup, stays a shell command.
- Removing any command. They stay as the fallback (and the tests that cover them stay).
- An audit log, multiple admin roles or confirmation by a second person. There is one admin. The services already log each takedown with `logger.info`; that stays the record.
- Listing unconfirmed accounts. `account:verify` takes an email the admin already has from the person they checked; the page does the same.
- Editing studio data, impersonating an owner, or any other new operator power. Only what the commands already do.

## Anti-goals

- Any query from the web server that crosses tenants or bypasses row-level security. The `owner` connection is never used from a request. (`metrics:pilot` uses it today to list studios; the web page must not.)
- Showing operator notes, or anything else operators-only, to studios or clients. The pages are admin-only, as now.
- Studio- or client-typed text rendered as HTML. React's escaping is the web equivalent of the commands' `terminalText`; nothing uses `dangerouslySetInnerHTML`.

## Constraints (from the codebase)

- Admin access: `platformAdmin` middleware after `auth` and `dbContext`; non-admins get a 404 (`app/middleware/platform_admin_middleware.ts`). New routes join the existing `/admin` group in `start/routes.ts`. They are not tenant routes, so they need no `TENANT_ROUTE_ROLES` entry.
- Cross-tenant reads follow the existing admin pattern (`app/controllers/admin_controller.ts`): a SECURITY DEFINER function returns ids only, then each studio is read in its own context with `withDbContext({ tenantId })`.
- The operator services already run as the app role and resolve their target safely: `PublicationService.{operatorStatus, suspendStudio, restoreStudio, suspendPhoto, restorePhoto}` (by slug, via `tenant_for_slug()`) and `ReviewOperatorService.{openReports, takedown, restore, dismiss}` (by id, via the lookup functions). `AccountService.markVerified(email)` and `PilotMetricsService.forStudio` likewise. The pages call these; rules stay in the services.
- New SECURITY DEFINER function: a new migration, hardened as `database/README.md` asks (stable, `search_path = pg_catalog, pg_temp`, revoke from public, grant execute to the app role), like `billing_tenants()`. Then `pnpm migrate`, never editing `database/schema.ts`.
- After route/page/controller changes: `node ace codegen`, keep the generated `.adonisjs/` changes.
- Validation limits match the commands: Discover reason 1–500 characters (required); review takedown reason from `TAKEDOWN_REASONS`, note optional up to `MAX_TAKEDOWN_NOTE_LENGTH`.
- Dates on admin pages are UTC, like Billing and Payments.

## Approaches considered

- **A. One form per command.** Each command becomes a form (slug + reason → take down). Least work, but the admin still copies slugs and ids from elsewhere, which is half of what's tiresome about the shell.
- **B. Browse, then act (chosen).** Studios list → studio page with every actionable item and its button; a report queue with actions per row; a metrics page; an account confirm form. Costs one new database function for the studio list, which metrics needs anyway.
- **C. B with lookup-by-slug instead of a studio list.** Saves nothing: the metrics page needs the same listing function.

The admin picked **B**.

## Design

### Navigation

- `/admin` redirects to `/admin/studios`.
- The shared Inertia data gains `platformAdmin: true` for an admin (from `isPlatformAdmin`), and the account menu shows an "Admin" link only then. The flag only hides a link; the middleware stays the gate.
- All admin pages share a small sub-nav: Studios, Reports, Metrics, Accounts, Billing, Payments. Breadcrumb labels go in `inertia/components/shell/breadcrumbs.ts`.

### Database: `live_tenants()`

A SECURITY DEFINER function returning `table (tenant_id uuid)` of tenants where `deleted_at is null`, ids only, hardened and granted like `billing_tenants()`. Used by the Studios list and Metrics. Each studio is then read in its own context.

### Studios list (`GET /admin/studios`)

One row per live studio, oldest first: name, slug, type (studio/independent), Discover state (`status` from the publication overview, plus "taken down" when a takedown is set), and a count of open review reports. A text filter on name/slug runs in the browser (pilot scale: tens of studios). Each row links to the studio page.

### Studio page (`GET /admin/studios/:slug`)

Resolved by `tenant_for_slug()` (current or old slug; unknown → 404). Everything below is read in that studio's context. Sections:

1. **Discover listing**: what `operatorStatus` returns: status, owner's switch, returned by the public API, takedown with date and reason. Buttons: *Take off Discover* (reason required) or *Lift takedown*. After lifting, the flash says the resulting status and whether the owner's listing is off, as the command prints.
2. **Photos**: the studio's artists' work photos, grouped by artist, as thumbnails, with each photo's Discover state. Each has *Take off Discover* (reason required) or *Lift takedown*. Taken-down photos are listed first with their date and reason.
3. **Reviews and Fresh ink taken down**: every review, reply and post with a TattooDrip takedown: kind, date, reason, note, an excerpt. Each has *Lift takedown*.
4. **Open reports for this studio**: the same rows as the Reports page, filtered to the studio.

Action routes (all `POST`, redirect back to the studio page with a flash):

- `/admin/studios/:slug/discover/suspend` and `/discover/restore`
- `/admin/studios/:slug/photos/:photo/suspend` and `/photos/:photo/restore`

Success flashes repeat the command's warnings: public caches can keep a takedown for up to two minutes; the studio page and bookings are unchanged.

### Reports (`GET /admin/reports`)

`ReviewOperatorService.openReports()`, oldest first: studio (linked to its studio page), reported date, report reason, studio's note, rating, name shown, the review text. Per row:

- *Take down*: reason (select from `TAKEDOWN_REASONS`, defaulting to the report's reason), optional note. Closes the report.
- *Keep it up*: dismiss.

Reports only cover reviews, so the studio page is where everything else is taken down (a client asking for their own review to come down, a reply, a Fresh ink post). Section 3 of the studio page also lists the studio's live reviews and published posts, most recent first with a "show more". Every live review has *Take down*, and so does its reply when there is one; every published post has *Take down*. *(Designer's call: without this, a takedown with no report behind it, such as `client_request`, would still need SSH.)*

Action routes: `POST /admin/reviews/:id/takedown`, `POST /admin/reviews/:id/dismiss`, `POST /admin/reviews/:id/reply/takedown`, `POST /admin/posts/:id/takedown`, plus the matching `/restore` routes. A post takedown that fails because storage couldn't delete the public copies shows the command's message: nothing changed, try again once storage recovers.

### Metrics (`GET /admin/metrics?days=42`)

The same numbers as `metrics:pilot`: for each live studio, `PilotMetricsService.forStudio` in that studio's context, then all studios combined (`combineFacts`). Shown with the existing `pilotTiles` / the pilot metrics card component, one per studio plus a total. `days` is a whole number from 1 to 3650, default `GATE_DAYS` (42); the window's UTC start and end are shown.

### Accounts (`GET /admin/accounts`, `POST /admin/accounts/verify`)

One email field and the warning from the command: confirm only after checking who is asking some other way, because this skips the proof the link gives. Results flash: "No account uses that address", "That address is already confirmed", or "Confirmed. The account can now set up a studio."

### Code layout

- A new controller per area keeps `AdminController` (Billing/Payments) from growing: e.g. `admin_studios_controller.ts`, `admin_reviews_controller.ts`, `admin_metrics_controller.ts`, `admin_accounts_controller.ts`. Thin; services hold the rules.
- Pages under `inertia/pages/admin/`.
- Any new read the studio page needs that the services don't offer yet (the taken-down reviews/posts list, the photos-with-thumbnails list for an operator) goes into `ReviewOperatorService` / `PublicationService` as operator methods that take a slug or tenant id and run in that context, beside the existing ones.

### Tests

- Add the new admin routes to the route list in `tests/functional/identity/account_routes.spec.ts`, which fails for any route outside a studio that no list names.
- Every new route: a non-admin and an unconfirmed admin email get 404; signed-out gets the sign-in redirect (like `billing.spec.ts` covers the existing admin pages).
- Each action through the page route, checked at the effect the command tests already check (e.g. the public Discover API no longer returns the studio; the review shows as taken down; the report is closed).
- Validation: missing/too-long reason, unknown reason, bad uuid, unknown slug or id, a photo id from another studio (must 404 or refuse, not act).
- `live_tenants()`: returns live studios only, and the app role can call it (in the `rls` / function tests where the other lookup functions are tested).
- Metrics page: numbers match `metrics:pilot` for the same studios and window.

### Docs

- `ReviewOperatorService`'s doc comment ("the operator commands only… never the web or the worker") and ruling 11 of the TAT-70 pilot metrics spec ("not a web page"): both now say the admin pages use them too, keeping the rule that a request never uses the owner connection. *(Designer's call: this design deliberately reverses those two statements.)*
- `docs/discover/publication-controls.md`: the operator row and "Takedowns (operators)" say the admin pages do this too; drop "no moderation UI by design".
- `apps/platform/docs/deploy.md` account email section: confirm accounts from `/admin/accounts` (the command remains).
- The commands' doc comments can mention the page equivalent.

## Left to the builder

- Exact layout, wording and components within the existing shadcn/`Page`/`Section` conventions (`apps/platform/docs/ui.md`).
- Whether the takedown forms are inline or in a dialog.
- Thumbnail source for photos (whatever the portfolio page uses).
- How to batch per-studio reads on the Studios list and Metrics page (one `withDbContext` per studio is fine at pilot scale).
