# Admin pilot grants

Date: 2026-11-16. Status: approved by the product owner in conversation (short design).

## Intent

Pilot grants ([studio packages](2026-11-15-studio-packages-design.md), ruling 7 and "Pilots") are the last routine operator job that needs the server shell (`node ace packages:pilot`). Every pilot needs one before enforcement is switched on, so the admin gives, replaces and ends them from the browser, next to the studio they belong to.

## Goals

- A **Package** panel on each studio's admin page (`/admin/studios/<slug>`): the studio's package state in the Billing page's words (`entitlementText`), the running grant (package, until, note, granted by, granted on), past grants, a form to give a grant, and "End grant now".
- The admin Billing page's studio names link to that studio's admin page.

## Non-goals

- Removing `packages:pilot`: it stays as the fallback, with its tests.
- Editing a grant in place, choosing an allowance bundle (a grant takes its package's default bundle, as the command does), or grants starting in the future.
- Notifying the studio: grants stay operator-only, as the spec has them.

## Anti-goals

- A pilot paused by accident: ending a grant must leave the studio in exactly the state the entitlement rules give (paid if it pays, otherwise paused, or trial within 14 days of creation without a payment).
- Two running grants: the database's `pilot_grants_one_running` rule stays the guard.

## Constraints

- One service: the page and the command call `PilotGrantService`, so the rules stay one (note 1 to 500 characters, ends at 00:00 UTC on the given day and after now, a running grant ends when a new one starts).
- `pilot_grants` is tenant-owned under row-level security: every read and write runs in the studio's own context (`withDbContext`), as the rest of `/admin` does.

## Approaches

- **Chosen: a panel on the studio's admin page.** The grant sits with the rest of the studio's operator state, and the studio is already identified by the URL, so nothing is typed by hand.
- Rejected: a separate `/admin/pilots` page with a slug field (copy-paste of slugs, which the admin pages exist to avoid); a column of controls on the Billing page (crowded, and billing rows are about invoices).

## Decisions

- "Granted by" is the signed-in admin's account name (`fullName`, else the email), not typed.
- "End grant now" is new (the command can't do it), for a pilot that starts paying early: the running grant's `ends_at` becomes now. The product owner approved it.
- Refusals show as an error flash on the page, in the service's words. The page always sends a name within the service's 100-character limit, so the refusal that names the command's `--by` flag never reaches it.

## Left to the builder

Route names and paths, the panel's layout, the service method for ending a grant, test structure (HTTP tests for give, replace and end, refusals, non-admins' 404, and that the ended studio's state follows the entitlement rules).
