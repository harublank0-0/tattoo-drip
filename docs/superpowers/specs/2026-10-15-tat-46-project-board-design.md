# Project board and lifecycle (TAT-46, part 1)

Date: 2026-10-15
Refs: TAT-46, split with the user into two parts: **part 1 (this spec)** is the projects list, the manual status moves, notes, "last contacted", artist assignment and navigation; **part 2** is the inquiry inbox (accept/decline, references). TAT-46's blockers TAT-36 and TAT-37 are merged; it builds on TAT-64's `ProjectService` and project page (PR #18).

## Goal

Staff can find every project they're responsible for, see at a glance who needs a follow-up, and move a project through the steps nothing else moves: put it on hold, resume it, decline it, or record that the client withdrew. Owners assign the artist, so artists see their own projects. Each project keeps notes and the time the client was last contacted, which the one-tap chat links update by themselves.

No migration: `tattoo_projects` already has `artist_id`, `notes` (4,000 characters) and `last_contacted_at`. No API, SDK or OpenAPI changes.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Scope | Split TAT-46: board and lifecycle first, inbox second, each with its own spec, plan and PR | Two independent pieces; the board makes today's project page reachable and works with seeded projects |
| Manual moves | Hold (`quoted` to `on_hold`), resume (`on_hold` to `quoted`), decline (`reviewing` to `declined`), client withdrew (`reviewing`, `quoted`, `on_hold`, `deposit_pending` to `cancelled`, cancelling scheduled sessions) | Matches the project rules. Declining also cancels scheduled sessions, so the artist's time is free (found in review). Withdrawing a booked or in-progress project, or any project whose deposit money is held, waits for TAT-66, which records what happens to the deposit (found in review) |
| Projects screen | One list with status filter chips: Active (default), one per active status, Closed | Works on a phone with ten statuses; a kanban board would be cramped |
| Notes | The existing single `notes` field, edited in place | No migration; a timestamped log can come later |
| Last contacted | Set by tapping the chat links (WhatsApp, Viber, Copy message) in the background, plus a manual "Mark contacted" button | Keeps "contacted 2 days ago" honest without extra taps; the button covers calls and visits |
| Deleting projects | Not in part 1; declined and withdrawn projects drop out of Active | The soft-delete cascade (sessions, reference images) is built with the first feature that deletes projects, TAT-42 |
| Expiry safety net | Not in part 1; a small ticket is filed | Rare on a single-server pilot; a sweep needs a cross-tenant system job designed first |
| Artist assignment | Owners assign or change a project's artist on the project page | Without it, artists see nothing until a session is scheduled |
| Move rules | A declarative moves table in the projects module and one locked `ProjectService.move`; the page shows only the moves the table allows | Small and explicit; the automatic moves (quotes, sessions, expiry) stay where they are. A general status matrix and a database trigger were rejected |

## The moves table

`app/modules/projects/moves.ts` (pure, unit-tested):

| Move | Allowed from | To | Also |
|---|---|---|---|
| `hold` | `quoted` | `on_hold` | |
| `resume` | `on_hold` | `quoted` | |
| `decline` | `reviewing` | `declined` | cancels the project's `scheduled` sessions |
| `withdraw` | `reviewing`, `quoted`, `on_hold`, `deposit_pending` | `cancelled` | cancels the project's `scheduled` sessions; refused (`deposit_paid`) while the project holds verified deposit money |

- `MANUAL_MOVES` (the table), `type ManualMove`, and `allowedMoves(status): ManualMove[]`.
- `ACTIVE_STATUSES`: every status except `declined`, `cancelled` and `completed` (so `healing_check`, which still needs a follow-up, is active). `CLOSED_STATUSES`: those three.

## `ProjectService` additions

Every write locks the project row first (`SELECT ... FOR UPDATE`), the same order as the existing methods and `SessionService`. Callers pass a project loaded through `findFor`.

| Operation | Rule |
|---|---|
| `move(tenant, member, project, move)` | Locks the project (`lockFor`, below); its live status must be in the move's "allowed from", else `ProjectRuleError("move_not_allowed")`. `withdraw` is refused as `deposit_paid` while `depositHeld`. Moves with `cancelsSessions` (decline, withdraw) first cancel each `scheduled` session through `SessionService.cancel` (as `expireQuote` does). Sets the target status. Returns it |
| `depositHeld(tenant, project)` | Whether the current quote's verified deposit and correction payments, net of reversals, are above zero (`DepositService.verifiedPaid`, in the quote's currency). Partly paid counts; unverified proofs do not |
| `assignArtist(tenant, member, project, artistId)` | Owners only: anyone else gets E_ROW_NOT_FOUND (a 404, like another artist's project). `artistId` null unassigns; otherwise `ArtistService.findFor(tenant, artistId)` must find a live profile (else a 404). Existing sessions keep their own artist |
| `updateNotes(tenant, member, project, notes)` | Trimmed; empty clears to null; at most 4,000 characters (the validator enforces it) |
| `markContacted(tenant, member, project)` | Sets `last_contacted_at` to now |
| `list(tenant, member, filter, page)` | The tenant's live projects the member may see: owners all, an artist only those whose `artist_id` is their own live profile (the `findFor` rule; an artist without a profile sees none). `filter` is `"active"`, `"closed"` or one status. 25 per page. Active and single-status filters sort for follow-up: `last_contacted_at` nulls first, then oldest, then `created_at`; `closed` sorts by `updated_at` newest first. Returns the page of projects and the total |
| `countByStatus(tenant, member)` | Live projects per status, with the same scoping, as `{ [status]: n }` (`count(*)::int`) |

- **Authorization under the lock** (found in review): `findFor` authorizes before the lock, so every member-facing mutation (`move`, `updateNotes`, `markContacted`, and TAT-64's `issueQuote` and `acceptQuote`, which now take `member` too) locks through `lockFor`, which re-checks that a non-owner still has the project assigned to their own live artist profile and gives E_ROW_NOT_FOUND otherwise. An artist whose request waited on the lock while an owner reassigned the project can't write to it. `expireQuote` (a job) and `assignArtist` (owner only) are unaffected.
- **Errors** (`app/modules/projects/errors.ts`): `ProjectRuleError` with reasons `move_not_allowed` and `deposit_paid`, next to `QuoteRuleError`, thrown after the failed savepoint rolled back.
- **Module boundaries.** `list` reads only `tattoo_projects`. The controller then makes three batched reads through the owning services for the page of up to 25: `ClientService.findMany(tenant, ids)` (new; live clients by id), `ArtistService.list(tenant)` (names), and `SessionService.projectsWithScheduledTattoo(tenant, projectIds)` (new; the ids among them with a `scheduled` tattoo session).
- **"Booked, no session"**: a `booked` project that is not in that set. Shown as a warning on the list row and on the project page.

## Routes and access

All in the existing `/t/:tenant/projects` group (auth, dbContext, tenant, `role({ allow: ["owner", "artist"] })`). Every `:id` loads through `ProjectService.findFor` first, so another tenant's or another artist's project is a 404 even with a bad body.

| Route | Name | Does |
|---|---|---|
| `GET /t/:tenant/projects` | `tenant.projects.index` | The list. `?status=` is `active` (default), `closed` or a status; anything else falls back to `active`. `?page=` from 1 |
| `POST /t/:tenant/projects/:id/moves` | `tenant.projects.moves.store` | `{ move }`, an enum of the table's moves |
| `PUT /t/:tenant/projects/:id/notes` | `tenant.projects.notes.update` | `{ notes }` |
| `POST /t/:tenant/projects/:id/contacted` | `tenant.projects.contacted.store` | Marks it contacted now |
| `PUT /t/:tenant/projects/:id/artist` | `tenant.projects.artist.update` | `{ artistId }`, a uuid or empty to unassign; owners only (enforced by the service) |

- Each write redirects back to the project page with a flash. Successes: "Put on hold.", "Back to quoted.", "Project declined.", "Client withdrew: project cancelled.", "Notes saved.", "Marked as contacted.", "Artist assigned.", "Artist removed.". `move_not_allowed`: "This project can't make that change in its current status.". Bad input comes back as field errors.
- Each route gets a case in `tests/isolation/cases.ts`; `node ace codegen` after the route changes. The existing route guard already checks the projects group's middleware.

## Screens

**Navigation.** A "Projects" item for every role in the dashboard nav, after Dashboard (`inertia/layouts/app.tsx`, `tenantNav`).

**Projects list** (`inertia/pages/projects/index.tsx`), mobile-first:
- Filter chips with counts: Active, then `reviewing`, `quoted`, `on_hold`, `deposit_pending`, `booked`, `in_progress`, `healing_check`, then Closed. The selected chip is highlighted; chips with no projects stay visible with 0.
- Rows link to the project page and show the client name, "with {artist}" or "no artist", the status badge, the last contact ("contacted today", "contacted 3 days ago", "never contacted", worked out on the server in the studio's timezone), and a "no session" warning badge for a booked project without a scheduled tattoo session.
- "Newer" / "Older" links when there is more than one page; an empty state per filter.

**Project page** (`inertia/pages/projects/show.tsx`), additions:
- **Status actions:** a button per allowed move ("Put on hold", "Resume", "Decline", "Client withdrew"). Decline and Client withdrew ask for confirmation; Client withdrew says when it will cancel scheduled sessions.
- **Artist:** owners get a select of the studio's live artist profiles plus "No artist"; artists see the name.
- **Notes:** a text area with Save.
- **Last contacted** with a "Mark contacted" button.
- **Chat links** (Send on WhatsApp, Open Viber chat, Copy message) also post to the contacted route in the background (Inertia `router.post` with preserved scroll and state).
- The "booked with no scheduled session" warning at the top when it applies.

## Tests

- **Unit** (`moves.ts`): each move's allowed statuses and target match the project rules; `allowedMoves` for every status; `decline` and `withdraw` cancel sessions and `hold` and `resume` don't; `ACTIVE_STATUSES` and `CLOSED_STATUSES` cover all ten statuses without overlap.
- **`ProjectService`**: `move` for every move and status (allowed and refused), `withdraw` cancelling scheduled sessions and leaving completed ones; `assignArtist` (owner assigns and unassigns; an artist member gets a 404; an unknown or deleted artist gets a 404; sessions untouched); `updateNotes` (trim, clear); `markContacted`; `list` (each filter, both sort orders, paging, owner versus artist scoping, artist without a profile, another tenant); `countByStatus` scoping.
- **`ClientService.findMany`**, **`SessionService.projectsWithScheduledTattoo`**: their own small specs, including another tenant's ids.
- **HTTP**: the list's props per filter (rows, counts, warning, paging), an unknown status falling back to active, an artist seeing only their own; each write route's redirect and flash, field errors, an artist's 404 on `artist` and on another artist's project; the project page's new props (allowed moves, notes, last contact text, artist choices for owners only, the warning).
- **Isolation**: the five new routes.
- **Not automated**: the chat links' background contact post (browser checklist).

## Docs

- `docs/requirements.md` project rules: the manual moves, and that a client can withdraw only before booking for now (TAT-66 adds the rest with the deposit outcome).
- `apps/platform/docs/backend.md`: the projects paragraph gains `move`, `list`, `countByStatus`, `assignArtist`, notes and contacted, the moves table, and the two new reads in clients and scheduling.
- The `TattooProject` model comment.

## Carry-forwards

Posted as Linear comments when the PR is ready: TAT-42 (the project soft-delete cascade, moved from TAT-46: sessions and reference images, quotes and payments have no `deleted_at`), TAT-66 (withdrawal after booking and the deposit outcome), TAT-43 (walk-ins can use `assignArtist`), TAT-46 itself (part 2: inbox, accept/decline, references, seeded demo inquiries). File the expiry safety-net ticket (early or retry-exhausted `ExpireQuoteJob`).

## Not in this part

The inquiry inbox (part 2); deleting projects and the cascade (TAT-42); withdrawal after booking and deposit outcomes (TAT-66); moves into `completed` and `healing_check` (TAT-66, TAT-75); the expiry sweep (its own ticket); a notes history; drag-and-drop; API, SDK and OpenAPI changes; any migration.

## Assumptions the user can overrule at review

`healing_check` counts as active; 25 projects per page; the follow-up sort order; owners and the assigned artist can make every manual move (artists can't assign artists); the flash wording; a confirmation on decline and withdraw but not on hold/resume; the contacted time shown as relative text computed on the server; tapping Copy message counts as contacting.

## Verification

`PORT=3402 node ace test` passes, including the isolation cases and the new specs; `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. A browser pass on seeded projects: the filters and counts, each move, assigning an artist and opening the list as that artist, notes, Mark contacted and the chat links updating the time, the warning, 375 px width. Then the whole-branch review and the Codex code and security reviews before the PR.
