# Pilot metrics: link share, inquiry to verified deposit, no-shows (TAT-70)

Date: 2026-10-20
Refs: TAT-70 (Pilot metrics: link share, inquiry → verified deposit time, no-shows). Blocks TAT-71 (the gate 1 decision) and TAT-76 (owner reports, V1). Builds on TAT-51 (every inquiry comes through the intake link), TAT-43 (desk bookings: projects with no inquiry), TAT-37 and TAT-66 (the payments ledger: `kind`, `status`, `verified_at`, corrections that name the payment they reverse), TAT-85 (`SessionService.countByStatus`, made for this ticket and TAT-76), TAT-46 (the inbox, where owners land), TAT-18 (`account:verify`, the operator command pattern) and the row-level security conventions (TAT-28). TAT-107 (the Today screen) comes after it and takes the card over.
Size: **about 2 points**, as the ticket says. Every number is derived from columns that already exist, so there is no migration and no event table; the work is four small reads in their modules, one service, a card and an operator command.

## Goal

Gate 1 asks, for six weeks: does the design-partner studio receive most new custom work through the intake link, does it record its deposits in Tattoo Drip, and do clients keep their sessions? Three numbers answer it, recorded from day one because they come from what the platform already stores: the share of new work that arrives through the link, the median time from an inquiry to its verified deposit, and the session no-show rate. Each studio's owners see their own three numbers on a small card; the team sees every studio's through an operator command, never through a web page.

No migration, no new setting, no new route, no API, OpenAPI, SDK or storefront change. Written without the user (unattended run): every open question is a ruling below.

## Depends on the built code

Designed on 38e09cd (TAT-88's design commit on top of TAT-98's tip 65eab5f). It uses no TAT-88 code: it can be built before or after TAT-88. The plan's Task 0 checks the named code it edits, not a commit.

## Rulings

1. **About 2 points: three numbers, two places to read them, nothing recorded anew.** In: the three metrics, defined below; a "Last 30 days" card for owners; `node ace metrics:pilot` for the team; docs. Out: per-artist and per-month breakdowns, deposits collected in rupees, inquiries by source, quote-to-deposit conversion (all TAT-76, V1), charts, exports, a history of past values. Why: each item in is one of the ticket's four boxes. Rejected: new event tables "to record from day one" (ruling 2).
2. **Derive every number from data that already exists; no column, no event table.** Link share: `inquiries.created_at` and `tattoo_projects.inquiry_id` / `created_at`. Inquiry to deposit: `inquiries.created_at`, `tattoo_projects.inquiry_id` and the payments ledger (`kind`, `status`, `verified_at`, `corrects_payment_id`). No-shows: `project_sessions.status` and `starts_at` through `SessionService.countByStatus`. Every one of them has been written since the feature that owns it shipped, so the history is already there and nothing needs backfilling. Limits, stated rather than fixed: a request that arrives by DM or phone and never becomes a project is invisible (the gate's check-ins with the studio cover it); `verified_at` is when the studio decided, not when the client paid; TAT-42's privacy deletion must keep those timestamps and links when it anonymizes (carry-forward). Rejected: a `pilot_events` table or new timestamps (a second record of facts the tables hold, which could disagree with them).
3. **Link share: the inquiries that arrived through the link, out of those plus the projects booked at the desk.** Numerator: live inquiries (not soft-deleted) whose `created_at` falls in the window, whatever became of them (new, accepted, declined; anonymized ones count). Every inquiry comes through the intake link: nothing else creates one (`IntakeService.submit` is the only writer). Denominator: that count plus the live projects with no inquiry (`inquiry_id is null`: TAT-43's direct bookings, walk-ins and phone or DM bookings) whose `created_at` falls in the window. A project made from an inquiry is not counted again. Why this denominator: gate 1 asks whether the studio "receives most new custom inquiries through the intake link"; a request that came another way only shows up in our data as a desk booking. Rejected: accepted inquiries only (it would call a declined request "not through the link", and the gate is about where requests arrive, not which ones the studio takes).
4. **Inquiry to verified deposit: the median, over projects whose first verified deposit was verified in the window.** For each live project made from a live inquiry, take its first deposit payment that is `verified` and that no correction reverses (no payment names it in `corrects_payment_id`); if that first verification's `verified_at` falls in the window, its duration is `verified_at − inquiries.created_at`, in hours (never below 0). A deposit counts whether a screenshot from the deposit page was verified or the deposit was recorded at the desk (both are "records every deposit in Tattoo Drip"). Desk bookings have no inquiry and are left out; a project with no deposit (zero deposit, or not paid yet) is not in the sample. The number is the median of those durations, with the sample size shown beside it. Why the first verified deposit, and why the window on the deposit: the moment the client committed with money is the funnel's end, and counting by the deposit's time means each project counts once, in the period it completed. Rejected: the time to a fully covered deposit (needs the quote's amount and currency at each point in time, for the rare split deposit); counting by the inquiry's time (a recent inquiry's deposit isn't in yet, which drags the median down until it is).
5. **No-show rate: no-shows out of the sessions that happened or should have.** Over the sessions whose `starts_at` falls in the window (TAT-85's `countByStatus`, all kinds: consultation, tattoo and touch-up): `no_show / (completed + no_show)`. Cancelled sessions are left out (called off in advance, not missed). Sessions that started in the window but are still `scheduled` have no outcome yet: they are left out of the rate and their number is shown ("2 past sessions without an outcome aren't counted"), so the owner can record them. Why: TAT-85's ruling 14 already defines this rate; the hint keeps an unrecorded session from silently improving it.
6. **Windows are rolling and timezone-free.** The card covers the last 30 days and the command the last 42 by default (`--days`), each the half-open interval [now − N × 24 hours, now). Counting by instants means the studio's time zone changes no number, and a window that ends now makes every `scheduled` session in it a past one. The command prints the window's ends in UTC. Rejected: calendar months or local days (TAT-76's reports, which need the studio's time zone).
7. **No data is a dash, never a zero percent.** A number whose denominator is 0 shows "—" and says why ("No inquiries or desk bookings yet.", "No deposits verified from an inquiry yet.", "No finished sessions yet."). Every live studio is listed by the command, the silent ones included, so the team sees who isn't using it. Percentages are whole numbers; durations read "under an hour", "N hours" (under 48) or "N.N days" (whole days without ".0").
8. **One service, four reads in their own modules.** `PilotMetricsService.forStudio(tenant, window)` (new `reports` module, `app/modules/reports/`) returns the raw facts (`PilotFacts`: the two counts, the list of durations, the session counts) and asks each module for its part: `InquiryService.countReceived` and `receivedAt`, `ProjectService.countBookedAtDesk` and `inquiryIdsFor`, `DepositService.firstVerifiedDeposits`, `SessionService.countByStatus`. The arithmetic and the words are pure functions in `#modules/reports/pilot_metrics` (`linkShare`, `median`, `noShowRate`, `durationText`, `pilotCard`, `pilotLines`, `combineFacts`), unit-tested. Why: the architecture's rule (other modules call a module's services, not its tables), and TAT-76 extends the same service. Rejected: one SQL join across four tables in a reports module (it would read other modules' tables); a module per metric.
9. **Every read runs under row-level security, in the studio's context.** The service uses models in the ambient transaction: on the inbox, the request's tenant context; in the command, a `withDbContext({ tenantId })` per studio as the app role. The aggregate queries also say `whereNull("deleted_at")` themselves, as `IntakeService.checkOpenLimit` does. No new index: each query filters by `tenant_id` first (indexed everywhere) and a pilot studio has hundreds of rows a year.
10. **Owners see a "Last 30 days" card at the bottom of the inbox.** The inbox is where owners land (`DashboardController.tenantHome`) and is owners only, which is right for studio-wide numbers: an artist would see other artists' no-shows. Three tiles in one card (label, value, detail), stacked at 375 px and side by side from `sm`, then the hint line when sessions lack an outcome. Computed on every inbox load (six small queries). It sits under the list on both tabs. TAT-107's Today screen takes it over and decides its final place. Rejected: a new page or a settings tab (a route, an isolation case and a place owners never visit); the projects board (artists see it too); an Inertia deferred prop (client code for a few milliseconds).
11. **The team's cross-studio view is an operator command, not a web page.** `node ace metrics:pilot [--days=42]` (`node build/ace.js metrics:pilot` in production) lists the live studios with the owner database role (the one query that crosses tenants: id, slug and name, oldest first), then computes each studio's numbers with the same `PilotMetricsService` as the card, as the app role in that studio's context, and prints a block per studio and one for all studios together (counts summed, the median over all durations pooled). It prints studio names, slugs and aggregates only: no client data, no ids. It runs where the owner role's password already is (the migration step's environment), like `account:verify`. Rejected: an internal admin page (see Threat notes); a SECURITY DEFINER function returning every studio's aggregates (it would give the web process's role a cross-tenant read); running every query as the owner (row-level security would no longer prove that a studio's numbers are its own).
12. **`--days` is a whole number from 1 to 3650.** Anything else prints "Give --days a whole number from 1 to 3650." and exits 1. With no studios it prints "No studios yet.".

## The pieces

### `#modules/reports/pilot_metrics` (pure)

`CARD_DAYS` (30), `GATE_DAYS` (42), `type MetricsWindow = { from: DateTime; to: DateTime }`, `lastDays(days, now?)`, `type PilotFacts = { linkInquiries; deskProjects; depositHours: number[]; sessions: { completed; noShow; noOutcome } }`, `noFacts()`, `linkShare(facts)`, `median(values)`, `noShowRate(sessions)`, `percentText(ratio)`, `durationText(hours)`, `combineFacts(list)`, `type PilotCard = { title; tiles: { label; value; detail }[]; note: string | null }`, `pilotCard(facts, days)`, `pilotLines(heading, facts)`.

### Reads in their modules

| Operation | Rule |
|---|---|
| `InquiryService.countReceived(tenant, { from, to })` | Live inquiries with `created_at` in [from, to) |
| `InquiryService.receivedAt(tenant, ids)` | `created_at` of these live inquiries, by id |
| `ProjectService.countBookedAtDesk(tenant, { from, to })` | Live projects with no inquiry and `created_at` in [from, to) |
| `ProjectService.inquiryIdsFor(tenant, projectIds)` | The inquiry of each of these live projects, by project id; desk bookings left out |
| `DepositService.firstVerifiedDeposits(tenant, { from, to })` | Per project, the first `verified` deposit no correction reverses, when that first verification is in [from, to) |
| `SessionService.countByStatus(tenant, { from, to })` | Unchanged (TAT-85) |
| `PilotMetricsService.forStudio(tenant, window)` | The `PilotFacts` of ruling 8 |

### The card and the command

`inertia/components/pilot_metrics_card.tsx` (`PilotMetricsCard`, `type PilotCardProps`) on `inquiries/index` (`pilotMetrics` prop). `commands/pilot_metrics.ts` (`metrics:pilot`, a `protected studios()` the test overrides).

## Screens

### The inbox's card (owners)

```
Last 30 days                                            (card title, h2)
Through the link        Inquiry to deposit      No-shows
75%                     2.5 days                8%
12 inquiries through    Median of 8 deposits    2 of 25 finished
the link, 4 bookings                            sessions
at the desk
3 past sessions without an outcome aren't counted.     (muted, only when > 0)
```

A shadcn `Card` with a `dl` grid (`grid gap-4 sm:grid-cols-3`); label `text-sm text-muted-foreground`, value `text-2xl font-semibold`, detail `text-sm text-muted-foreground`; text tokens only, no colour, no chart. Below the inbox list and its pagination, on both tabs. Nothing to tap. One column at 375 px.

### The command's output

```
Pilot numbers for the last 42 days: 2026-09-08 09:30 to 2026-10-20 09:30 UTC.
Black Needle (black-needle)
  Through the link: 75% (12 inquiries through the link, 4 bookings at the desk)
  Inquiry to deposit: 2.5 days (Median of 8 deposits)
  No-shows: 8% (2 of 25 finished sessions)
  3 past sessions without an outcome aren't counted.
Red Ink (red-ink)
  Through the link: — (No inquiries or desk bookings yet.)
  …
All studios (2)
  …
```

## Words

Card: "Last 30 days", "Through the link", "Inquiry to deposit", "No-shows", "{n} inquiries through the link, {m} bookings at the desk" (singular "1 inquiry", "1 booking"), "No inquiries or desk bookings yet.", "Median of {n} deposits" / "From 1 deposit", "No deposits verified from an inquiry yet.", "{a} of {b} finished sessions" ("1 finished session"), "No finished sessions yet.", "{n} past sessions without an outcome aren't counted." / "1 past session without an outcome isn't counted.", "—". Durations: "under an hour", "1 hour", "{n} hours", "{n} days", "{n.n} days". Command: "Pilot numbers for the last {n} days: {from} to {to} UTC.", "All studios ({n})", "No studios yet.", "Give --days a whole number from 1 to 3650.".

## Threat notes

- **Why no cross-tenant web surface.** A team page would need a platform-admin role that the tenancy model doesn't have, plus a way for the web process to read every studio: either the owner role's credentials in the web environment (which `database/README.md` forbids: the web and worker run as `NOBYPASSRLS` and never hold `DB_MIGRATION_PASSWORD`) or a SECURITY DEFINER aggregate the app role can execute. Either way one authorization bug, a stolen admin session or a CSRF on that page would expose every studio's activity. The command adds nothing to what shell and database access already allow: it runs only where the owner password lives, reads one cross-tenant list (ids, slugs, names), and computes each studio's numbers as the app role inside that studio's row-level security context, so the team sees exactly what that studio's owners see.
- **Tenant isolation.** Every metric query is a model query in the ambient transaction with the tenant set; another studio's rows are invisible to it (a functional test runs the service in one studio's context against another's data). The command's per-studio contexts don't overlap (`withDbContext` per studio, awaited in turn).
- **Authorization.** The card is only on the inbox, which is owners only (the route group's role check, unchanged; artists get a 404). The props carry counts and words, no ids, no names, no client data.
- **A hostile guest.** Spamming the intake form inflates the link count (bounded by TAT-55's limits: 20 an hour per address, 60 an hour per studio, 10 a day per phone); the card and the command show the counts next to the share, so a burst is visible. Nothing a guest sends reaches the command's output except as a number.
- **A hostile member.** An artist can't reach the inbox or run the command. An owner sees only their own studio's numbers.
- **What leaves the platform.** Nothing: no email, no API. The command prints to the operator's terminal.

## Tests

- **Unit:** `pilot_metrics` (`lastDays`; `linkShare`, `noShowRate` and `median`, odd, even and empty; `percentText`; `durationText`'s ranges; `combineFacts`; `pilotCard` with data, with none, with singulars and with the note; `pilotLines`).
- **Functional, reads:** `InquiryService.countReceived` (the window's live inquiries, any status; not a deleted one, not one outside the window, half-open) and `receivedAt`; `ProjectService.countBookedAtDesk` (desk projects only, live, in the window) and `inquiryIdsFor`; `DepositService.firstVerifiedDeposits` (first verified per project, a reversed one skipped, submitted and rejected ones ignored, a project whose first verification is before the window left out).
- **Functional, service:** `PilotMetricsService.forStudio` (the three facts from one studio's data, desk projects out of the deposit sample, another studio's context sees none).
- **Functional, HTTP:** the inbox gives owners the card's props for the last 30 days, with data and with none; artists still get a 404.
- **Functional, command:** `metrics:pilot` prints each studio's block and the total for the given days (through a subclass whose `studios()` returns the test's studios); refuses a bad `--days`; says "No studios yet.".
- **Not automated:** the owner-role listing of live studios (tests can't commit tenants for another connection to see); checked by running the command against the builder's isolated database in the browser pass; how the card looks.

## Browser pass (in the PR)

Dev server on `PORT=3401` against the builder's isolated database, seeded (`node ace db:seed --connection=owner` as the README says, or a few records made by hand). At 375 px and 1280 px, light and dark:

1. As an owner, the inbox shows "Last 30 days" under the list with three tiles; with no data, three dashes and their reasons.
2. Send an inquiry through the studio page and book a walk-in at the desk: the link share reads 50% (1 and 1). Accept the inquiry, quote with a deposit, record the deposit at the desk: "Inquiry to deposit" shows a duration "From 1 deposit".
3. Mark a past session a no-show and another done: "50%", "1 of 2 finished sessions"; leave a third past session scheduled: the hint appears.
4. As an artist: the inbox is still a 404.
5. `<db-env> node ace metrics:pilot` and `--days=7`: every studio in that database is listed (the silent ones with dashes), then "All studios"; `--days=0` refuses.

## Docs

- `docs/requirements.md`: tick "Pilot metrics: share of inquiries arriving through the link, time from inquiry to verified deposit, session no-shows" with a rule line (the three definitions in one sentence each, the card, the command).
- `docs/architecture.md`: the module table gains "Reports | Pilot metrics (MVP); owner reports (V1) | MVP".
- `docs/roadmap.md`: Gate 1 names `metrics:pilot` as the source of its numbers.
- `apps/platform/docs/backend.md`: a "Pilot metrics (TAT-70)" bullet (the service, the reads, the definitions, the command).
- `apps/platform/docs/ui.md`: the inbox card (TAT-107 moves it).
- `apps/platform/database/README.md`: the RLS section names `metrics:pilot` as the one non-migration use of the owner connection (a list of live tenants; every number under row-level security).
- `apps/platform/docs/deploy.md`: how to run `metrics:pilot` in production (the migration step's environment).

## Carry-forwards

- **TAT-71:** the gate's write-up uses `metrics:pilot --days=42` per studio, plus the check-ins for requests that never reached the platform (ruling 2).
- **TAT-76:** per artist (`countByStatus` already gives `byArtist`), per month in the studio's time zone, deposits in rupees, inquiries by source and quote-to-deposit conversion build on `PilotMetricsService`.
- **TAT-107:** the Today screen takes the card over.
- **TAT-42:** the privacy deletion must keep `inquiries.created_at`, `tattoo_projects.inquiry_id` and `created_at`, payments and session statuses (it scrubs text, not these).

## Not in this ticket

Charts, trends or past values, per-artist or per-month numbers, money totals, inquiries by source, conversion rates, exports, an admin page, new tables, columns or indexes.

## Assumptions the user can overrule at review

Counting every live inquiry (declined ones too) as arriving through the link; desk bookings as the only other channel; the first verified, unreversed deposit (desk ones included) as "verified deposit", counted in the window of its verification; all session kinds in the no-show rate and cancelled ones out; 30 days on the card and 42 in the command; the card at the bottom of the inbox until TAT-107; the command's use of the owner role for the studio list only.

## Verification

`PORT=3402 node ace test` passes on Node 24.3.0 against the builder's isolated database; `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; no migration; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
