# Finish a project and the healing check (TAT-111, covers TAT-87)

Date: 2026-10-20
Refs: TAT-111 (Finish a project and the healing check; UX build plan WP-14, audit finding X-2) and TAT-87 (Finish a project: move it to completed once the balance is paid), which this design covers in full; TAT-87 stays open until the user closes it as a duplicate. Builds on TAT-46 (`ProjectService.move`, `CLOSED_STATUSES`, the projects list), TAT-64 (`BOOKED_STATUSES`, quotes locked from booked on), TAT-66 (`balanceOf`, `PaymentService`, `CLOSED_FOR_OUTCOME`, `settleableDeposit`, `outcome_first`, `listFlags`, the hourly-actuals carry-forward), TAT-85 (the work rule that moves `booked` to `in_progress`, `scheduleRefusal`, `project_finished`, ruling 7's hand-over of "finish a project"), TAT-52 (the `aftercare` message, `cardKinds`, the one-tap chat links) and TAT-98 (`StatusBadge`, `STATUS_GROUPS`). Roles are TAT-30 (designed in parallel); the page restructure is TAT-108; small closed-project items are TAT-115.
Size: **about 4 points** (TAT-111 says 3, TAT-87 says 2). The extra point is touch-up sessions during the healing check (ruling 10) and the list's "balance due" flag (ruling 7); without them it is 3.

## Goal

When the last session of a tattoo is done, the owner taps "Mark the tattoo finished" on the project page. The project moves to Healing check, the page says when the check is due (four weeks after the last tattoo session), and the "Message the client" card is ready with the aftercare message. When the healed photo has come (or a touch-up is done), the owner taps "Healing check done" and the project is Completed, under Closed on the board. A balance still due is named and confirmed, never a wall: the money can still be recorded afterwards, and the board flags a finished project that still owes.

No migration, no new setting, no API, SDK or storefront change. Two new dashboard routes. Written without the user (unattended run): every open question is a ruling below.

## Depends on

Designed on 65eab5f (TAT-98's tip, which holds TAT-97 and every merged ticket before it). Nothing from a ticket still in flight is needed. The plan's Task 0 stops on another base.

## Rulings

1. **One ticket, two owner steps, and TAT-87 inside it.** "Mark the tattoo finished" moves `in_progress` to `healing_check`; "Healing check done" moves `healing_check` to `completed`. TAT-87's checklist maps onto it: the owner action from `in_progress` with no session left (ruling 4); the balance decision (ruling 5: confirm, not block); the rule in `ProjectService` under the project's row lock, refusing stale clicks (rulings 5 and 14); the completed state on the board and the page (`StatusBadge` already shows it; Closed lists it); the artist view hides the action (ruling 13); transition tests and an isolation case per route (Tests). Rejected: two tickets (the same lock, rules, card and tests twice).
2. **The order is `in_progress` → `healing_check` → `completed`.** `docs/requirements.md` draws `completed → healing_check`, but the code already decided otherwise: TAT-46's `CLOSED_STATUSES` puts `completed` under Closed and keeps `healing_check` Active ("it still needs a follow-up"), and TAT-98 puts `healing_check` in the "in the chair" group and `completed` in "closed". So the check is the last open step and Completed is the end. The requirements' diagram and status table are corrected. Rejected: completed first, then a healing check (a closed project would come back to Active); finishing straight to completed (no place for the check the pilot asked for).
3. **Every finish goes through the healing check; closing it has no date gate.** A studio that does no checks taps "Healing check done" right after "Mark the tattoo finished". Nothing closes a check automatically: an open check stays in the Active view, which is the reminder. Rejected: a "skip the healing check" switch (a branch to save one tap); closing checks automatically after N days (nothing in the app moves a project by itself except a quote's expiry).
4. **What finishing needs: `in_progress`, and no session scheduled.** `in_progress` already means a completed tattoo session and no scheduled tattoo session (TAT-85's work rule), so the step adds only "no session of any kind is scheduled" (`session_scheduled`): a consultation or touch-up left scheduled must get its outcome first. Closing the check needs the same. Not from `booked`: a booked project has a tattoo session still to come, or none done. Rejected: letting a scheduled session ride along (it would hang on a finished project); finishing from `booked`.
5. **A balance still due is confirmed, not blocked, and the confirmation is exact.** When money is owed (the current quote's total minus verified payments, above zero: `owed(balanceOf(...).due)`), the confirmation names the amount and the page posts it as `confirmedDue` (paisa, digits). Under the lock the server reads the balance again and refuses unless the posted amount equals what is owed now (`ProjectRuleError("balance_changed")`); with nothing owed (paid, overpaid, or no price) no amount is needed. The same rule applies to closing the check. Why not block: an hourly total is an estimate (TAT-66's known limit, no "actual hours" yet), a discount or an unpaid debt has no payment kind, and the desk records money after the fact anyway; blocking would trap real projects in In progress forever. Why exact: a payment recorded or reversed in another tab since the page loaded must not let the owner confirm a debt they never saw. Rejected: block until paid (TAT-87's first option); a plain "I know" checkbox (misses a changed amount).
6. **Money after finishing keeps TAT-66's rules.** Session and balance payments, refunds and reversals stay allowed on `healing_check` and `completed` (TAT-66 refuses only `declined`); a deposit is still only for `deposit_pending`; the Payments card keeps showing "Balance due". `completed` is not in `CLOSED_FOR_OUTCOME`, so finishing never asks for a deposit outcome and `outcome_first` never blocks a refund on a finished project: the deposit paid for the tattoo. Rejected: adding `completed` to `CLOSED_FOR_OUTCOME` (it would ask "kept or refunded?" about every finished tattoo's deposit).
7. **The board flags a finished project that still owes, for fixed prices only.** `PaymentService.listFlags` gains `balanceOwed`: a `healing_check` or `completed` project whose current quote is fixed-price and whose balance due is above zero. The row shows an outline "balance due" badge, owners only (artists get no flags, as today). Hourly quotes are not flagged: their balance is an estimate, and until hourly actuals exist a correctly paid hourly project would be flagged forever. Rejected: no flag (a debt confirmed at finish vanishes into Closed); flagging hourly projects too.
8. **The healing check's date is computed, not stored: 28 days after the last tattoo session.** `healingCheckDueOn(sessions, timezone)` takes the latest completed tattoo session, its end's local day in the studio's timezone, plus `HEALING_CHECK_DAYS` (28). The card shows "Due 17 Nov 2026." or, once past, "Was due 17 Nov 2026." No column, so no migration. Why: healing runs from the session, not from when someone taps the button; a stored date would only serve cross-project queries, and Today (TAT-107) can read sessions when it wants "checks due". Rejected: a `healing_check_due_on` column (a stored derived value); `finished_at` (no reader yet); a studio setting for the days (no pilot ask; a carry-forward).
9. **Owners close the check, any time.** The result goes in the project's notes (they stay editable). Rejected: closing only after the due date (a client who sends the photo early would have to wait); a "healed well / needed a touch-up" field (no reader).
10. **A healing check takes touch-up sessions only; a completed project takes none.** `schedulableKinds(status)` gives every kind for `reviewing` to `in_progress`, `["touch_up"]` for `healing_check`, nothing otherwise; `scheduleRefusal(status, kind)` refuses a tattoo or consultation during the check with the new reason `touch_ups_only` ("The healing check takes touch-up sessions only."), and `completed` keeps `project_finished`. Who may schedule is unchanged (owners any artist, the assigned artist themselves). The Sessions card's kind list comes from the server, so a healing check offers only Touch-up, with the hint "The healing check takes touch-up sessions only." A touch-up's outcome never moves the project (TAT-85: only tattoo sessions do). This settles TAT-85 ruling 22's "the finish-project follow-up decides touch-ups after completion". Rejected: no sessions in the check (a needed touch-up would need a new project); tattoo sessions that reopen the project (ruling 11).
11. **No undo.** A finished tattoo can't go back to In progress, nor a completed project to its check. The inline confirmation guards against a mis-tap. Rejected: a "Not finished yet" route (a third move and its isolation case, for a rare mistake); a reopen is a carry-forward if the pilot asks.
12. **Aftercare reuses TAT-52's message; no new kind.** `aftercare` already exists (offered once a tattoo or touch-up session is completed, and the card's first choice on an `in_progress` or `healing_check` project), with its one-tap WhatsApp and Viber links and its last-contact record. Finishing points the owner at it in the flash. Its default text gains one short sentence so the check happens without another message: "In about four weeks, send us a photo of the healed tattoo here." (a studio that edited its aftercare keeps its own text). Rejected: a seventh `healing_check` message kind now (requirements put healing-check messages in V1, and it would widen three enum checks: `message_templates.kind`, `tattoo_projects.last_contact_kind`, `inquiries.last_contact_kind`); Nepali text (nobody to proofread it).
13. **Owners only; the assigned artist sees the check but no button.** Both routes call `ProjectService.requireOwner` after `findFor` and before the body is validated, so an artist (assigned or not) gets the same 404 whatever they post, and the service checks again. The page sends the artist no finish card on an `in_progress` project, and on a `healing_check` the card without its action (the due date and what to ask the client). TAT-30 maps this to one capability, `projects.finish` (finish and close the check), granted to owners by default: `requireOwner` becomes that capability check and `finish.action` follows it. Rejected: letting the assigned artist finish (money is the owner's decision in TAT-66; TAT-30 can widen it).
14. **Two routes, each with an isolation case.** `POST /t/:tenant/projects/:id/finish` (`tenant.projects.finish.store`) and `POST /t/:tenant/projects/:id/complete` (`tenant.projects.complete.store`), in the projects group (owners and artists pass the role middleware; the service narrows to owners), `ProjectChangesController.finish` / `complete`, body `confirmedDue` (optional, 1 to 20 digits, "Reload the page and try again." otherwise). A refusal is a flash and a redirect to the project, like the manual moves; a second tap, a stale tab or a project that moved on gets `move_not_allowed`'s existing words. `twoStudios` gains `finishProject` and `healingProject` (no quote, so a body of `confirmedDue: "0"` succeeds). Rejected: a fifth entry in `MANUAL_MOVES` (those are open to the assigned artist and carry no balance or session rule). *As built:* both routes are under `OWNERS` in `TENANT_ROUTE_ROLES`, not the projects group, so the role middleware 404s an artist before the controller runs; `requireOwner` in the controller and the service stays as a second check. Safer than designed, and `apps/platform/docs/backend.md` describes it so.
15. **Closed projects: work stops, notes and money don't.** On `completed` the page offers no finish card, no moves, no new session (ruling 10) and no quote form (already so). For every closed project (`declined`, `cancelled`, `completed`: a new `closed` prop) the page hides the artist picker (`assignment` null) and "Mark contacted" (TAT-115's item, done here; TAT-115 can drop it). Notes stay editable, owners still record money (ruling 6), and the "Message the client" card keeps its plain links and, on a completed project, aftercare (TAT-52's rule, unchanged). The server keeps accepting `assignArtist` and `markContacted` on closed projects: both are harmless, owner-or-assigned writes, and the card's chat links still record contact. The fully read-only header is TAT-108's. Rejected: refusing those writes server-side now (the chat links would start flashing errors on completed projects).
16. **The UI fits today's page; TAT-108 moves it.** A "Finish" card directly under the status card (so the aftercare message card is right below it), with the step's button and an inline confirmation panel (focus starts on "Not yet", Escape closes and returns focus, the confirm button says "Saving…" while the request runs), never `window.confirm`. TAT-108's Next step card will take its content ("in progress → Mark the tattoo finished; done → healing check"); TAT-99's card reordering keeps it right under the status card for these two statuses.
17. **Built on 65eab5f; conflicts are textual.** The plan quotes every edited file from that commit.

## The lifecycle after this ticket

| Status | Reached by | The project page offers (owners) | The assigned artist |
|---|---|---|---|
| `in_progress` | a completed tattoo session with none scheduled (TAT-85) | Finish card: "Mark the tattoo finished" (or "Record or cancel the scheduled session under Sessions first."); sessions of every kind; Client withdrew | Sessions; no finish card |
| `healing_check` | "Mark the tattoo finished" | Healing check card: due date, "Healing check done"; touch-up sessions only; money | The card without its button; touch-ups on their own project |
| `completed` | "Healing check done" | Nothing to do: notes, money, the message card's links and aftercare | The same, read only |

## The pieces

### `#modules/projects/finish` (pure)

`FINISH_STEPS` (`finish`: `in_progress` → `healing_check`; `complete`: `healing_check` → `completed`), `FinishStep`, `FINISHED_STATUSES` (`healing_check`, `completed`), `HEALING_CHECK_DAYS` (28), `FinishRefusal`, `FinishFacts`, `FinishResult`; `finishStepFor(status)`, `finishRefusal(step, facts)` (status, then a scheduled session, then the confirmed amount), `owed(due)`, `healingCheckDueOn(sessions, timezone)`, `owedNote(due, estimated)`, `finishedFlash(step, result)`.

### Services

| Operation | Rule |
|---|---|
| `DepositService.balance(tenant, project)` | `{ balance: balanceOf(current quote, every payment), estimated: quote is hourly }`. ProjectService reads money here because PaymentService depends on ProjectService (TAT-85 ruling 7) |
| `ProjectService.requireOwner(member)` | E_ROW_NOT_FOUND for anyone but an owner |
| `ProjectService.finish(tenant, member, project, confirmedDue)` | Owners only; under `lockFor`: the live sessions and balance, `finishRefusal("finish", …)`, then `in_progress` → `healing_check`. Returns `{ status, due, estimated, dueOn }` |
| `ProjectService.completeHealingCheck(…)` | The same for `complete`: `healing_check` → `completed` |
| `PaymentService.listFlags` | Adds `balanceOwed` (ruling 7) |
| `SessionService.scheduleFor` | `scheduleRefusal(live.status, input.kind)` (ruling 10) |

`ProjectRuleError` gains `session_scheduled` and `balance_changed`; `SessionRuleError` gains `touch_ups_only`. Nothing else changes: sessions, payments, deposit links, quotes and outcomes are untouched by a finish step.

### Routes and props

`POST /t/:tenant/projects/:id/finish` and `POST /t/:tenant/projects/:id/complete` (ruling 14). The project page's props gain `finish` (`{ step, dueText, overdue, action: { confirmedDue, balanceDueText, estimated, sessionScheduled } | null } | null`), `closed`, and `scheduling.kinds`; `assignment` is null on a closed project. The list's rows gain `balanceOwed`.

## Screens

### Finish card (`in_progress`, owners)

```
Finish the tattoo                                        (card title)
Once the work is done, mark the tattoo finished. Its healing check
will be due 6 Nov 2026, four weeks after the last tattoo session.
Balance due: NPR 15,000.                                 (only when owed)
[ Mark the tattoo finished ]                             (h-11)
.--------------------------------------------------------------.
| Mark the tattoo finished? The project moves to Healing check, |
| due 6 Nov 2026, and takes only touch-up sessions from now on. |
| NPR 15,000 of the balance is still due: it stays on the       |
| Payments card.                                                |
| [ Mark finished ]  [ Not yet ]                                |
'--------------------------------------------------------------'
```

With a session scheduled the button is replaced by "Record or cancel the scheduled session under Sessions first." The panel opens under the button; focus starts on "Not yet"; Escape closes it and returns focus to the button.

### Healing check card (`healing_check`; owners with the button, the artist without)

```
Healing check
Due 7 Nov 2026. Ask the client for a photo of the healed tattoo. If it
needs a touch-up, schedule a touch-up session under Sessions.
[ Healing check done ]
  -> "Close the project? It moves to Completed and takes no more sessions."
     [ Close the project ]  [ Not yet ]
```

"Was due 7 Nov 2026." once the day has passed (the studio's today, compared as dates). Both cards wrap at 375 px: every button and the panel's buttons are `h-11`, the panel's buttons wrap (`flex-wrap`), and amounts like "NPR 1,50,000" sit in running text.

### Elsewhere

The Sessions card's "Kind" select lists the server's kinds (only Touch-up during a check). The status card's "Mark contacted" and the artist picker disappear on closed projects. The projects list shows "balance due" next to the other outline flags.

## Words

Card: "Finish the tattoo", "Healing check", "Once the work is done, mark the tattoo finished. Its healing check will be due {day}, four weeks after the last tattoo session." (without a day: "Once the work is done, mark the tattoo finished. Its healing check comes next."), "Due {day}. " / "Was due {day}. " followed by "Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.", "Balance due: {amount}." / "Balance due: {amount} (estimated).", "Record or cancel the scheduled session under Sessions first.", "Mark the tattoo finished", "Healing check done". Panel: "Mark the tattoo finished? The project moves to Healing check, due {day}, and takes only touch-up sessions from now on." (without a day: "…moves to Healing check and takes…"), "Close the project? It moves to Completed and takes no more sessions.", each followed by " {amount} of the balance is still due: it stays on the Payments card." (" of the estimated balance" for hourly) when owed; buttons "Mark finished", "Close the project", "Not yet", "Saving…".

Flashes: "Tattoo finished: the healing check is due {day}. Send the aftercare message from Message the client." ("…: the healing check is next. …" without a day), "Healing check done: the project is completed.", each followed by " {amount} of the balance is still due: record it under Payments when it's paid." (" of the estimated balance") when owed. Refusals: "This project can't make that change in its current status." (TAT-46's), "Record or cancel the scheduled session first.", "The balance changed since this page loaded. Check it and try again."; scheduling during a check: "The healing check takes touch-up sessions only." (flash and hint). Field error: "Reload the page and try again." (`confirmedDue`). List badge: "balance due". Aftercare default: "… Message us here if anything worries you. In about four weeks, send us a photo of the healed tattoo here."

## Who may do what

| Action | Owner | Assigned artist | Other artist / non-member |
|---|---|---|---|
| Mark the tattoo finished, Healing check done | yes | 404 | 404 |
| See the Healing check card | yes, with the button | yes, without | 404 (the page) |
| Schedule a touch-up during the check | any artist | themselves, own project | 404 |
| Record money on a finished project | yes (TAT-66) | no (TAT-66) | 404 |

## Threat notes

- **Tenant isolation.** Both routes are in the `/t/:tenant` group (auth, dbContext, tenant middleware), load the project with `findFor` (scoped by tenant and RLS) and lock it with `lockFor` (`tenant_id` and id). Another studio's id or slug is the same 404 as an unknown one; the isolation cases prove it with a positive control that really changes studio A's project. No tenant id is read from the body.
- **Authorization.** Owners only, 404 not 403: `requireOwner` runs before the body is read, so a probing artist learns nothing from validation errors, and `finishStep` checks again. A non-member never reaches the controller (tenant middleware 404). The artist's page props carry no action and no `confirmedDue`.
- **Stale and double clicks.** Every finish step locks the project row first, the order every project write uses (`SessionService` and `PaymentService` lock it first too), so a session scheduled or a payment recorded in another tab either commits before the step reads (and is seen) or waits for it. A second tap finds the status moved on (`move_not_allowed`). The confirmed amount must match the balance read under the lock.
- **What a hostile member could try.** An owner posting an arbitrary `confirmedDue` only finishes with the amount actually owed (which an owner may do anyway). A huge or malformed amount is a field error before any query (at most 20 digits, so no costly `BigInt` parse). An artist scheduling a tattoo session to drag a checked project back is refused (`touch_ups_only`), and scheduling never reopens a project. CSRF: both routes are POSTs behind Shield, like every dashboard form.
- **Data.** Nothing new is stored or exposed: the balance and the sessions are already on the page for both roles (TAT-66 shows the assigned artist the balance). No token, no public route, no email; the deposit page can't take a screenshot for a finished project (its state is `paid` or `updating`, never `due`).

## Tests

- **Unit:** `finish` (the steps, `finishStepFor` per status, `finishRefusal`'s order and amount rule, `owed`, `healingCheckDueOn` across the studio's midnight and ignoring other kinds and outcomes, `finishedFlash` with and without money owed and for hourly); `schedule_rules` (`schedulableKinds` per status, `scheduleRefusal` for touch-ups and tattoos, the healing-check hint); the dashboard's finish words (`inertia/components/finish.ts`); the aftercare default's new sentence.
- **Functional, services:** finishing then completing; every other status refused with nothing changed; a scheduled session of any kind refused, then allowed once it has its outcome; money owed refused until confirmed exactly, then the close asks again; nothing owed (paid, overpaid, no price) needs no amount; an hourly estimate says so; the assigned artist refused with a 404; two tabs: the second tap on either step, a payment recorded since the page loaded, a tattoo session scheduled since; money after finishing (balance payment, refund, no outcome asked); `listFlags`' `balanceOwed`; a healing check takes a touch-up and stays put, a tattoo or consultation is `touch_ups_only`, a completed project `project_finished`.
- **Functional, HTTP:** both steps with their flashes and redirects; the confirmation required and named in the flash; stale-page refusals; a tampered amount a field error; the assigned artist's 404 on both routes whatever the body; the page's `finish`, `closed`, `assignment` and `scheduling` per status and role, `overdue` past the date; touch-ups only in the Sessions card and a refused tattoo session over HTTP; the board's "balance due" for owners only.
- **Isolation:** the two routes in `cases.ts`, with `finishProject` and `healingProject` in `twoStudios`.
- **Updated, not new:** `schedule_rules.spec.ts` and `session_scheduling.spec.ts` (a healing check now refuses a tattoo session with `touch_ups_only`), `project_page.spec.ts` (`scheduling` carries `kinds`), `payment_reads.spec.ts` (each flags object has `balanceOwed: false`).
- **Not automated:** how the cards look (the browser pass).

## Acceptance at 375 px (browser pass, in the PR)

On the isolated database with the dev server on 3401, at 375 × 812 and 1280 × 800, light and dark, as an owner:

1. An `in_progress` project with a fixed quote and money owed: the Finish card is the second card, "Balance due: NPR …" shows, the button is at least 44 px tall; tapping it opens the panel with focus on "Not yet"; Escape closes it and focus returns to the button; nothing overflows (`document.documentElement.scrollWidth` is 375).
2. Confirm: the flash names the due day and the money still owed; the card is now "Healing check" with "Due …"; "Message the client" starts on Aftercare and its text ends with the healed-photo sentence; the Sessions card's Kind lists only Touch-up.
3. Schedule a touch-up: the card shows "Record or cancel the scheduled session under Sessions first."; mark it done; "Healing check done" → panel → "Close the project": Completed badge, no artist picker, no "Mark contacted", no "Schedule a session".
4. Projects → Closed lists the project with "balance due"; record the rest at the desk on the project; the flag is gone.
5. As the assigned artist (if a second account is set up): no Finish card on `in_progress`; the Healing check card without a button.

## Docs

- `apps/platform/docs/backend.md`: a "Finishing a project (TAT-111)" bullet; the Scheduling and "Scheduling on a project" bullets (`scheduleRefusal(status, kind)`, `touch_ups_only`); the payments bullet's `listFlags`.
- `apps/platform/docs/ui.md`: the Finish card and the closed-project hides.
- `apps/platform/docs/testing.md`: `finishProject` and `healingProject` in `twoStudios`.
- `docs/requirements.md`: the lifecycle diagram and table (ruling 2), the scheduling sentence (touch-ups during the check), a rule bullet for finishing. No box is ticked: the board's box waits for the browser passes.

## Carry-forwards

- **TAT-87:** covered here; the user closes it as a duplicate.
- **TAT-108:** move the Finish card into the Next step card; the read-only header for closed projects.
- **TAT-115:** "no artist picker and no Mark contacted on closed projects" is done here.
- **TAT-107 (Today):** "healing checks due" can be listed from `healingCheckDueOn` over each `healing_check` project's sessions if the pilot wants it.
- **TAT-30:** `requireOwner` on the finish routes becomes the `projects.finish` capability.
- **TAT-66's hourly actuals:** once actual hours exist, flag hourly projects too (ruling 7) and drop "estimated".
- **Later, if the pilot asks:** a reopen ("Not finished yet"), a studio setting for the healing-check days, a `healing_check` message kind (V1).

## Not in this ticket

A migration or stored date, a reopen, automatic closing, a new message kind, Nepali texts, server-side refusal of artist changes or contact records on closed projects, the Next step card, Today's list, any API, SDK or storefront change.

## Assumptions the user can overrule at review

The order `in_progress` → `healing_check` → `completed`; confirming instead of blocking a balance due; hourly projects not flagged; 28 days from the last tattoo session, computed; no skip and no automatic close; touch-ups only during the check; no undo; owners only; the aftercare default's new sentence and no healing-check message; hiding the artist picker and "Mark contacted" on every closed project.

## Verification

`DB_DATABASE=<isolated> PORT=3402 node ace test` passes on Node 24.3.0 (37 more tests than the baseline); `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; no migration and no change to `database/schema.ts`; the browser pass above.
