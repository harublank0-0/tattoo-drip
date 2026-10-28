# Project page restructure: header, Next step card, money summary, sheets (TAT-108)

> For the Sonnet 5.5 builder. Follow the tasks in order, test first. The standing rules of
> `run7-brief.md` (isolated database, ports, no `.env` reads, Node 24, commit rules, teardown,
> report) apply; they are not repeated here. Where the code below and the code on the branch
> disagree in a small way (a renamed import, a line that moved), adapt and say so in the report;
> where a rule or a decision below would change, stop and report instead.

## 1. Header

- **Ticket:** TAT-108, "Project page restructure: header, Next step card, money summary, sheets"
  (WP-11 of the UX pass; audit findings P-1, X-8, W-1). Platform dashboard only. TAT-99 (the light
  reorder) was cancelled in its favour; read it in Linear for reference only.
- **Branch:** `harublank00/tat-108-project-page-restructure-header-next-step-card-money-summary`,
  cut from main `9ac7621`. This plan is its first commit.
- **Lane A:** database `tattoo_drip_ux` (`DB_DATABASE=tattoo_drip_ux` on every platform command),
  platform dev server 3401, tests `PORT=3402`, storefront 3404 and stand-in API 3405 (neither is
  needed). Use `SESSION_DRIVER=memory` for test runs in this worktree (it has no `.env`). A FULL
  platform suite run goes through
  `flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock`.
  Targeted runs need no lock (none of them is `setup_roles.spec.ts` or `role_guard.spec.ts`).
- **Goal in plain words:** a project page opens on who it is for, what the piece is, who tattoos
  it, its status and how far along it is (Review, Quote, Deposit, Sessions, Done), then ONE "Next
  step" card that holds the thing to do now (check the screenshot, send a price, chase the deposit,
  book the session, finish the tattoo...), chosen on the server by the same rules that fill Today
  and the Projects list, so the three can never disagree. Money is one line ("Paid NPR 5,000 of
  NPR 20,000 · Balance NPR 15,000") with the list of payments behind "Show payments". The rarely
  used forms (revise the quote, record a payment, record a refund, set the price, schedule a
  session) open in a bottom sheet. Every `window.confirm` on the project and inquiry pages becomes
  an inline confirmation. A closed project offers no change to the project itself. From 1024 px the
  page is two columns (7/12 and a sticky 5/12).
- **Points:** the ticket says 4; this plan is about 5 (the server-side Next step table with its
  agreement tests, the sheet and the inline confirm are on top of the layout).

## 2. Scope fence

You may change:

- `apps/platform/app/modules/projects/next_step.ts` (new, pure)
- `apps/platform/app/modules/payments/payments_card.ts` (one new field, `summary`)
- `apps/platform/app/modules/projects/services/waiting_service.ts` (its doc comment only: a second
  caller of `forProjects`)
- `apps/platform/app/controllers/projects_controller.ts` (`show` only)
- `apps/platform/inertia/pages/projects/show.tsx`, `apps/platform/inertia/pages/inquiries/show.tsx`
- `apps/platform/inertia/components/`: `page.tsx` (one optional prop), `projects.ts`,
  `payments.ts` (types only), `payments_card.tsx`, `sessions_card.tsx`, `finish_card.tsx`,
  `message_card.tsx` (one optional prop), and the new files `project_page.ts`, `confirm.ts`,
  `sheets.ts`, `form_sheet.tsx`, `inline_confirm.tsx`, `next_step_card.tsx`, `quote_card.tsx`,
  `deposit_panel.tsx`, `change_card.tsx`, `progress_line.tsx`
- `apps/platform/inertia/components/ui/sheet.tsx` (new, shadcn)
- Tests: `apps/platform/tests/unit/modules/projects/next_step.spec.ts` (new),
  `tests/unit/modules/payments/payments_card.spec.ts`, `tests/unit/inertia/project_page.spec.ts`
  (new), `tests/unit/inertia/confirm_and_sheets.spec.ts` (new),
  `tests/unit/inertia/inline_confirms_source.spec.ts` (new), `tests/unit/inertia/tap_targets.spec.ts`,
  `tests/unit/inertia/payments_card_form.spec.ts`, `tests/unit/inertia/finish_copy.spec.ts`,
  `tests/functional/projects/project_page.spec.ts`,
  `tests/functional/projects/next_step_agreement.spec.ts` (new)
- Docs: `apps/platform/docs/ui.md`, `apps/platform/docs/backend.md`

NOT in this plan:

- No route, validator, migration, OpenAPI, SDK or storefront change. No `TENANT_ROUTE_ROLES` or
  `tests/isolation/cases.ts` change (no new route).
- No change to `WAITING_HASH`, `waitingOf`, `waitingText`, `WaitingService.work`, Today, the
  Projects list, `listLine`, `PaymentService` or any service rule.
- The `window.confirm` calls on Settings (members, payment methods) and Artists stay (X-8 lists
  two of them; the ticket scopes the project and inquiry pages). Follow-up.
- No server guard for the artist change or "Mark contacted" on a closed project (decision D9;
  follow-up).
- The session move form stays inline under its session (TAT-85); only "Schedule a session" moves
  into a sheet.
- No piece title column (TAT-115): the header shows the start of the brief, as the Projects list
  does.
- The flash "Record what happened to the deposit under Payments." after a withdrawal
  (`project_changes_controller.ts:67`) keeps its words (a test pins them); the form it points at
  is now in the Next step card at the top. Copy follow-up.

## 3. Facts verified on this branch (9ac7621)

The page and its cards today:

- `inertia/pages/projects/show.tsx` (930 lines) is one `max-w-2xl` column of cards in a fixed
  order (`:133-325`): booked-without-session banner, status card (badge, brief, contact line and
  Mark contacted, move buttons, an outcome hint link to `#payments`, the owner's artist picker),
  `FinishCard`, `MessageCard`, `SessionsCard`, Request, Quote (`id="quote"`, `:225-251`: summary or
  `PriceForm`, the quote's `ChatMessage`, `AcceptQuote`), `DepositCard` (`id="deposit"`,
  `:412-497`), `PaymentsCard`, Notes, the quote form (`id="quote-form"`, `:279-298`, at the very
  bottom), Earlier versions.
- `window.confirm` on these pages (`rg -n "confirm\(" inertia`): `pages/projects/show.tsx:386`
  (New deposit link, only when a link exists), `:544` (`PriceForm` `onBefore`), `:821`
  (`MoveButtons`: decline, withdraw; questions in `CONFIRM`, `:789-805`),
  `components/payments_card.tsx:601` (`RefundForm` `onBefore`), `pages/inquiries/show.tsx:238`
  (Decline). `pages/calendar/index.tsx:288,300,302` call a local `confirm` function, not the
  browser's. Out of scope: `pages/settings/members.tsx:251,261,322,334`, `pages/artists/index.tsx:82`,
  `pages/settings/payments.tsx:197`.
- Existing inline confirm panels, the pattern this plan reuses: `ConfirmPanel`
  (`payments_card.tsx:298-370`: Verify, Reject, Reverse, with a note; Escape cancels),
  `OutcomePanel` (`sessions_card.tsx:229-292`: focus starts on "Keep it scheduled"), the Finish
  confirmation (`finish_card.tsx:100-142`: focus on "Not yet", Escape closes and returns focus,
  `onDone` moves focus to the page `h1` through `Page`'s `titleRef`). `focusFirstInvalid`
  (`sessions_card.tsx:299-303`) focuses the first `aria-invalid` field after a `setTimeout(0)`.
- shadcn components present (`inertia/components/ui`): badge, button, card, checkbox,
  dropdown-menu, empty, field, input, label, radio-group, select, separator, sonner, table,
  textarea. **No `sheet`.** `radix-ui@1.6.7` is a dependency (`package.json:93`) and ships
  `dialog` (`node_modules/radix-ui/dist/dialog.*`); every ui component imports from `radix-ui`
  (e.g. `dropdown-menu.tsx:3`); `lucide-react` (`:90`) and `tw-animate-css` (dev) are installed.
  `components.json` is new-york, lucide. So the sheet needs no new package.
- Inertia 3 (`@inertiajs/react` 3.8.0): a form submission keeps the page mounted by default
  (`node_modules/@inertiajs/react/dist/index.js:1575`, `preserveState: preserveState ?? _method !==
  "get"`; `router.post` likewise, `@inertiajs/core/dist/index.js:3224`). The `Form` component's
  `errors` are its own instance's (`react/dist/index.js:1087`, `errors: form.errors`, set from that
  submission's `onError`): two forms never show each other's errors, but a Form that unmounts
  loses them. `FinishCard` reads the page's bag directly (`finish_card.tsx:40`,
  `usePage().props.errors.confirmedDue`).
- A refused rule (not a field) is a flash `error` and a redirect, which Inertia treats as a
  success: quotes (`quotes_controller.ts:118-123`), payments (`payments_controller.ts:217-232`,
  except `refund_too_large`, a field error on `amount`), scheduling
  (`project_sessions_controller.ts:187-198`), moves (`project_changes_controller.ts:70-73`). The
  flash travels in the page object's `flash` field (`app/middleware/inertia_middleware.ts:135-158`),
  so `onSuccess(page)` can read `page.flash.error`; `FlashToasts` shows it as a toast
  (`components/flash_toasts.tsx`).
- Anchors that land on this page (keep every one working): `WAITING_HASH`
  (`app/modules/projects/waiting.ts:228-242`: `payments`, `quote-form`, `quote`, `deposit`,
  `sessions`, and null for `on_hold` and `deposit_due`), used by Today's rows
  (`inertia/pages/today/index.tsx:27-28`) and the Projects list cards (`listLine`,
  `app/modules/projects/project_list.ts:175-202`, which also gives `payments` to its two money
  lines); the deposit-screenshot alert (`PAYMENTS_CARD = "payments"`,
  `app/modules/notifications/alerts.ts:133`, any role); the day agenda's `#sessions`
  (`components/day_agenda.tsx:141`); in-page links to `#payments` (`show.tsx:158`, `:429`). Ids
  today: `quote` (`show.tsx:226`), `quote-form` (`:281`), `deposit` (`:414`), `payments`
  (`payments_card.tsx:63`), `sessions` (`sessions_card.tsx:71`), `finish` (`finish_card.tsx:75`,
  nothing links to it). Each carries
  `scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0`.
- `WaitingService.forProjects(tenant, member, projects, now)` (`waiting_service.ts:73-134`) gives
  each project `{ facts, waiting, text, hash, since }` with at most four queries
  (`QuoteService.currentFor`, `DepositService.depositStates`, `DepositLinkService.statesFor` for
  owners, `SessionService.projectsWithScheduledTattoo`), each skipped for an empty id list
  (`quote_service.ts:54`, `deposit_service.ts:239`, `deposit_link_service.ts:190`,
  `session_service.ts:207`). Its comment says `work` is its only caller. `waitingOf` skips the
  screenshot rule for artists (`waiting.ts:109-111`) and runs it first for owners whatever the
  status, so a withdrawn project's undecided screenshot stays the owner's work. `expiryCancels`
  (`app/modules/projects/expiry.ts:25`) is the sweep's money rule; `waitingOf` returns null only for
  an expired quote the sweep will cancel (`waiting.ts:125-128`).
- `ProjectsController.show` (`app/controllers/projects_controller.ts:257-553`) already loads the
  project (member-scoped `findFor`), client, artists, sessions, quote history, money
  (`payments.forProject`), deposit link (owners), templates, inquiry and references, and renders
  `projects/show`. `this.waiting` is already injected (`:126`). The props type is
  `ProjectPageProps` (`inertia/components/projects.ts:69-170`), and the render is type-checked
  against the page's props (`.adonisjs/server/pages.d.ts:37`).
- Roles (TAT-30): `tenant.projects.show`, quotes, accept, price, moves, notes, contacted and
  sessions are `MEMBERS`; artist, finish, complete, deposit link, payments, refunds, deposit outcome
  and the `/payments` decisions are `OWNERS` (`app/modules/tenancy/access.ts:85-112`). An artist
  opens only projects assigned to their own profile (`ProjectService.findFor`), and the page gives
  them the balance and the list of payments but never a screenshot or a form (`paymentsCard`,
  `app/modules/payments/payments_card.ts:122-280`), no deposit panel (`deposit` is owners-only,
  `projects_controller.ts:539-542`), no client link and no artist picker.
- What refuses writes on a closed project (declined, cancelled, completed): `issueQuote`
  (`project_service.ts:416`, `QUOTABLE_STATUSES`), `acceptQuote` (`:449`, quoted only), `move`
  (`:563`, the moves table has no closed source status), finish/complete (`finishRefusal`),
  `scheduleFor` (`scheduleRefusal`: `project_closed`, `project_finished`), the deposit link (deposit
  pending only). Accepted on purpose: `setPrice` on any `BOOKED_STATUSES` project without a quote,
  completed included (`:480-485`); desk session and balance payments on any status but declined,
  refunds, reversals, verify and reject of a waiting screenshot on any status, and the deposit
  outcome on a closed project (TAT-66, TAT-111, `docs/backend.md` Payments). Not guarded and not
  offered on a closed page since TAT-111: `assignArtist` (`:637-654`) and `markContacted` without a
  channel (`:677-691`); `markContacted` with a channel is what the chat links of a completed
  project's aftercare message post, so it must stay open. `updateNotes` (`:657-670`) has no status
  check.
- `paymentsCard` words the balance as a state (`due`, `paid`, `overpaid`, `no_price`, `closed`,
  `over_refunded`) with `totalText`, `paidText` and `amountText` (`payments_card.ts:195-217`);
  `BalanceBlock` (`payments_card.tsx:133-177`) turns them into "Balance due NPR 15,000" and so on.
  Money is paisa, `formatMoney` (`app/modules/projects/quotes.ts:60`) and `formatSignedMoney`
  (`app/modules/payments/ledger.ts:170`); the client's `formatRupees` (`components/projects.ts:234`)
  takes rupees.
- The Projects list words a finished project's fixed price still owed as "NPR 15,000 still due"
  (`PaymentService.listFlags`, `payment_service.ts:324-330`: `FINISHED_STATUSES`, a fixed quote,
  `owed(balanceOf(...).due)`), and a closed project holding a deposit as "Record whether the
  deposit was kept or refunded" (`project_list.ts:187-193`).
- The list's piece is `excerpt(project.brief, ALERT_EXCERPT_LENGTH)` (`projects_controller.ts:224`);
  its next session is the first scheduled session that has not started
  (`SessionService.nextScheduledFor`), formatted by `sessionStartText`
  (`app/modules/scheduling/times.ts:49`). TAT-110's `nextScheduled` (`session_service.ts:161`) is
  the paid deposit page's, "not ended"; the project page already has every session, so it reads no
  session again.
- `Page` (`components/page.tsx`) renders the `h1` (Eczar, `wrap-anywhere`), a `<p>` description
  and actions; `CardTitle` is `leading-none` (`ui/card.tsx:34`), too tight for a title that holds a
  Devanagari name (ui.md asks 1.35 or more).
- Tests that pin today's page: `tests/functional/projects/project_page.spec.ts` (982 lines;
  `assert.deepEqual(props.project, …)` at `:62`, `bookedWithoutSession` at `:336` and `:357`),
  `project_finish_http.spec.ts`, `tests/unit/modules/payments/payments_card.spec.ts`,
  `tests/unit/inertia/{payments_card_form,finish_copy,session_actions,message_block_source,tap_targets}.spec.ts`.
  `tests/helpers/query_count.ts` has `recordQueries`; `tests/helpers/waiting_fixtures.ts` has
  `studio()` and `seedGroups()` (one project per Today group, a Devanagari client `SITA_THAPA`).
- Playwright is not in CI: CI runs `pnpm check`, `pnpm typecheck`, `pnpm build`, then `pnpm test`
  (`.github/workflows/ci.yml:50-94`), which is the platform's unit and functional suites
  (`tests/browser` is empty) and the storefront's tests.

## 4. Decisions

D1. **`nextStep` comes from `WaitingService.forProjects` on the one project, then a pure table.**
The controller calls `this.waiting.forProjects(tenant, membership, [project], now)` and hands its
`waiting`, `text` and `hash` to a new pure `nextStepOf` (`#modules/projects/next_step`). When
something waits, the card is that reason's step, its anchor is `WAITING_HASH` of the reason and its
words include the Today row's words; when nothing waits, the status decides. Reason: the same
facts code and the same rules as Today and the list, so they cannot disagree; an agreement test
pins it. Rejected: rebuilding `WaitingFacts` from what `show` already loaded (zero extra queries,
but a second copy of the facts code that can drift). Cost: at most four small indexed queries.

D2. **The table lives on the server, actions by name.** `nextStepOf` returns
`{ kind, title, text, primary, secondary, anchor, needsYou }`, where `primary` and `secondary` are
action names from a fixed list, kept only when the page can offer them (`can`, the same flags the
cards use). The client maps names to components. Reason: one tested table, words on the server
like Today and the list. Rejected: the client choosing by status (a second rule set).

D3. **Progress line: Review, Quote, Deposit, Sessions, Done.** reviewing is Review; quoted and
on_hold are Quote; deposit_pending is Deposit; booked and in_progress are Sessions; healing_check is
Done (current); completed has every step done. Declined and cancelled show no line (the status
badge says it; we don't store how far a withdrawn project got, so a line would guess). Reason: the
audit's five steps (P-1), one place per status. Pure `progressOf` on the client, pinned against
`PROJECT_STATUSES`.

D4. **Anchors travel with the action.** The Next step card carries `id={nextStep.anchor}`; every
other element that owns one of the five ids (`payments` the Money card, `quote` the Quote card,
`quote-form` the revise trigger, `deposit` the deposit panel, `sessions` the Sessions card) drops
its id when the Next step card carries it (`cardId(own, anchor)`). So Today's "Deposit screenshot
to check" lands on the card that holds Verify and Reject, "Price sent" on Client accepted, "No
session" on Schedule a session, and the alert's and the list's `#payments` on the Money card or,
when the Next step holds the screenshot, the outcome form or the balance to collect, on it. Each id
appears once. Rejected: changing `WAITING_HASH` to one `next-step` id (churn in Today's and the
list's tests, and stale links to the old ids would land nowhere).

D5. **What a Next step card offers is not offered again on the page.** When the card offers
`revise_quote`, `record_payment` or `schedule`, the Quote card, the Money card and the Sessions
card hide their own trigger; when it holds `verify_proof` or `record_outcome`, the Money card does
not draw the screenshots or the outcome form. Reason: no two identical buttons side by side at
1280 px. `offers(nextStep, action)` decides.

D6. **Sheets: shadcn `sheet` (Radix Dialog from `radix-ui`), bottom on every width.** It slides up
from the bottom, at most 90% of the screen high and scrolling inside, clearing the safe area; from
`lg` it is centered and at most `max-w-xl` wide. Reason: one code path, no media query in script.
Rejected: `drawer` (needs `vaul`), a right-side panel on desktop (side switching needs either two
class sets that fight in tw-animate-css or JS). Five forms move into sheets: Revise the quote,
Record payment, Record a refund, Set price, Schedule a session. Not moved: the first quote (it is
the next step, inline in the card), the deposit outcome (the next step when needed, inline), the
deposit link panel, Verify/Reject/Reverse panels, session outcomes and the session move form,
notes, the artist picker.

D7. **Sheet behaviour is Radix's, plus two rules.** Focus: Radix moves focus into the sheet on
open, traps it, closes on Escape, the close button and the overlay, and our `onCloseAutoFocus`
puts focus back on the trigger, or on the page `h1` when the trigger is gone (`focusBack`). Saving:
the sheet closes only on a successful save without an error flash (`sheetAfterSave`). A refused
field stays in the open sheet with the typed values (the page stays mounted: section 3, Inertia 3);
a refused rule (an error flash) keeps the sheet open and shows the message inside it in a
`role="alert"` paragraph, because the toast's live region is hidden from screen readers while a
modal is open. No sheet is ever reopened: it never closes on a refusal.

D8. **Inline confirms for one-tap actions only; money forms confirm by naming the amount.** One
`InlineConfirm` component (trigger, a `fieldset` with the question as `legend`, the confirm button
and the safe button; focus starts on the safe button; Escape or the safe button closes and returns
focus to the trigger; after the request answers, focus returns to the trigger or the page `h1`)
replaces `window.confirm` for: decline and withdraw (project), New deposit link, Decline (inquiry).
Their questions stay word for word. Refund and Set price are forms inside sheets: the sheet is the
deliberate step, and the submit button names the amount ("Record refund of NPR 2,000", "Set the
price to NPR 15,000") with the consequence in the sheet's description ("A refund can't be edited
or deleted; a mistake is reversed.", "It can't be changed afterwards."). Reason: lesson 1 (no
confirm state nested in a modal, no Escape fight with Radix). Rejected: a modal dialog per confirm
(the ticket asks for none), a second inline step inside the sheet (user decision U4 if wanted).

D9. **Closed means the project itself can't change from the page; bookkeeping stays.** A declined,
cancelled or completed project shows no status move, no artist picker, no "Mark contacted", no
quote form, no scheduling (all already true or follow from the props). It still shows, where the
server allows: Verify/Reject of an undecided screenshot (the Next step), the deposit outcome (the
Next step), Record payment and Record a refund (Money card; completed with a balance due makes
Record payment the Next step), Reverse, Set price on a completed project booked without one, the
chat links (aftercare on a completed project records the contact), and Notes (internal; U1). No new
server guard: the only route that accepts a write the closed page doesn't offer is
`tenant.projects.artist.update` (and "Mark contacted" with no channel), both owners-or-member
writes TAT-111 left open on purpose; a guard is a behaviour change for its own ticket (U2).

D10. **Status moves go to a "Change this project" card at the end of the left column**, as plain
buttons (Put on hold, Resume, Client withdrew, Decline) next to the owner's artist picker. Decline
and Client withdrew use `InlineConfirm`. When the Next step card offers Resume, the Change card
doesn't. Reason: lesson 1; a `DropdownMenu` would need custom focus handling to hand focus from the
closing menu to a confirm panel. Rejected: the audit's "⋯" menu (U3).

D11. **Money summary: one server-worded line, `payments.summary`.** "Paid NPR 5,000 of NPR 20,000 ·
Balance NPR 15,000" (with " (estimated)" for an hourly quote), "Paid in full: NPR 20,000", "Paid
NPR 22,000 of NPR 20,000 · Overpaid by NPR 2,000", "No price yet" or "Paid NPR 3,000 · No price
yet", "Holds NPR 3,000" or "Nothing paid" (declined, cancelled), "Refunded NPR 500 more than it
received". It is the Money card's main line and, below `lg` only, a line in the page header. The
ledger is behind a "Show payments (N)" button (`aria-expanded`, `aria-controls`), closed on load;
waiting screenshots are never behind it. Artists keep exactly what TAT-30 gives them (the line and
the list, no screenshot, no form).

D12. **Layout: phone order = DOM order.** Left column (and the phone, top to bottom): Next step,
Sessions, Message the client, Request, Notes, Change this project. Right column: Payments (Money),
Quote. The header (name, piece, status and artist, progress line, money line below `lg`) is above
both. From `lg` the two columns are `lg:col-span-7` and `lg:col-span-5`, the right one
`lg:sticky lg:top-6 lg:self-start` with `lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto` so an
opened ledger stays reachable. Reason: tab order and reading order match on every width (no CSS
`order`). Rejected: the Message card in the right column (it would be last on a phone).

D13. **The contact line moves into the Message card.** `MessageCard` already has `footer` (the
inquiry page passes its contact text); it gains an optional `onMarkContacted` that draws a "Mark
contacted" `Button` beside it. The project page passes `footer={contactedText}` and, unless closed,
`onMarkContacted`.

D14. **Query count:** the page's number of queries does not grow with sessions, payments,
references or quote versions; TAT-108 adds at most the four of `forProjects`. Pinned few-vs-many,
like `projects_list.spec.ts:829-860`; an exact total would break on any shared-prop change.

## 5. Design

Voice: a calm studio manager, short and specific (design doc). Client names wrap
(`wrap-anywhere`), never truncated or clamped. Tokens only, no custom classes, no palette colours
(ui.md, Theme). 44 px targets below `lg` come from the shared components; a raw link that is a
control adds `max-lg:min-h-11`.

### 5.1 Header (both widths)

- `h1`: the client's name (`Page` as today, `titleRef` for focus fallback).
- Description: the piece, `project.piece` (start of the brief, 80 graphemes, as the list).
- `Page` gains an optional `details?: ReactNode` rendered under the description inside the
  header's left column (a `div`, so a list can sit there). Details hold:
  1. A row: `StatusBadge` and "With Asha" / "No artist yet" (muted).
  2. The progress line (`ProgressLine`, not for declined or cancelled): an `ol` with
     `aria-label="Progress"`, five `li` in a `grid grid-cols-5`; each a dot (`size-3 rounded-full`,
     done `bg-primary`, current `border-2 border-primary bg-card`, to come `border
     border-input bg-card`), a dashed connector to the next dot (`border-t border-dashed
     border-input`, `aria-hidden`), and its label (`text-sm`, the current one `font-medium
     text-foreground`, others `text-muted-foreground`); `aria-current="step"` on the current `li`
     and an `sr-only` ", done" / ", now" after the done and current labels. At 375 px each step is
     about 68 px wide; "Sessions" fits at 14 px.
  3. Below `lg` only (`lg:hidden`): `payments.summary` (`text-sm font-medium`).
- Actions: "View client" (owners), as today.

### 5.2 Next step card (left column, first)

- `Card` with `id={nextStep.anchor ?? undefined}` and the scroll-margin classes; `max-sm:gap-3
  max-sm:py-4` like the Message card.
- Header: an eyebrow "Next step" (`text-sm text-muted-foreground`), with a marigold dot
  (`size-2 rounded-full bg-marigold`, `aria-hidden`) and `sr-only` "Needs you:" before the title
  when `nextStep.needsYou`; the title in `CardTitle` with `text-lg leading-snug wrap-anywhere`.
- Content: `nextStep.text` (when not null), then the primary action, then secondary blocks, then
  secondary buttons in one `flex flex-wrap gap-2` row (`layoutOf`).
- Action components (client map, `next_step_card.tsx`):
  - `verify_proof`: the `PendingProof` blocks of `payments.pending` (exported from
    `payments_card.tsx`); in this card the image is `max-h-48` so Verify and Reject are on a
    phone's first screen. `onDone` focuses the page `h1`.
  - `issue_quote`: the first-quote `QuoteForm` inline (`key="first"`), unchanged fields.
  - `send_quote`: the quote's `ChatMessage` (`message` prop, `onSent` records `kind: "quote"`).
  - `client_accepted`: `AcceptQuote` (same form, `quoteId`), with a `variant` prop: default as
    primary, outline as secondary.
  - `revise_quote`: the Revise sheet trigger (outline), wrapper `id={cardId("quote-form", anchor)}`.
  - `resume`: a Button "Resume" posting `{ move: "resume" }` to `tenant.projects.moves.store`
    (no confirm, as today).
  - `deposit_link`: `DepositPanel` (today's `DepositCard` body without the Card, wrapper
    `id={cardId("deposit", anchor)}`): dev-host warning, link with Copy link, reference code, the
    deposit `ChatMessage`, Make deposit link, or New link through `InlineConfirm` ("Make a new link?
    The link you sent before stops working.", confirm "Make a new link", keep "Keep this link").
    The "check it under Payments" sentence goes (the screenshot is the Next step when it waits).
  - `record_payment`: the Record payment sheet trigger.
  - `schedule`: the Schedule a session sheet trigger.
  - `open_sessions`: a link styled as a button, "Record it under Sessions", `href="#sessions"`.
  - `finish`: `FinishPanel` (today's `FinishCard` without the Card and title; same words from
    `finish.ts`, same confirm panel, `onDone` to the `h1`).
  - `record_outcome`: `OutcomeForm` (exported from `payments_card.tsx`), `onDone` to the `h1`.

The table (`nextStepOf`, first match wins; "name" is the client's first name, else "the client";
Today's words are `waitingText`, quoted as they read today; `[x]` = offered only when `can.x`):

| # | When | kind | Title | Text | Primary | Secondary | anchor |
|---|---|---|---|---|---|---|---|
| 1 | waiting `proof_to_check` (owners, any status) | check_proof | Check the deposit screenshot | cancelled: "The client withdrew while this screenshot waited. Verify or reject it so the money is recorded right." else "Verify it only if the money reached your account." | verify_proof | | payments |
| 2 | `price_to_send` (reviewing) | send_price | Send {name} a price | "Accepted 2 days ago, no price yet." | issue_quote | | quote-form |
| 3 | `quote_ending`, quoted | price_ending | Remind {name} before the price ends | "The price ends tomorrow. If {name} hasn't said yes by then, the project is cancelled." | send_quote, else client_accepted | client_accepted, revise_quote | quote |
| 4 | `quote_ending`, on_hold | price_ending | Resume, or give more time | "On hold. The price ends tomorrow, and then the project is cancelled." | resume | revise_quote | quote |
| 5 | `quote_ending`, deposit_pending | deposit_ending | owners: Remind {name} about the deposit; artists: Waiting for the deposit | "Deposit not paid. The price ends tomorrow. If it isn't paid by then, the project is cancelled." | deposit_link | record_payment, revise_quote | quote |
| 6 | `deposit_link_missing` | make_link | Send the deposit link | "No deposit link yet." / "The deposit link stopped working." | deposit_link | record_payment | deposit |
| 7 | `deposit_unpaid` | chase_deposit | Remind {name} about the deposit | "Deposit not paid, link made 4 days ago." | deposit_link | record_payment | deposit |
| 8 | `no_session` | book_session | Book the tattoo session | "Booked, no session in the calendar." / "Deposit paid, no session booked." | schedule | | sessions |
| 9 | `price_sent` | await_answer | Waiting for {name} to answer | "Price sent 2 days ago." | client_accepted | send_quote, revise_quote | quote |
| 10 | `on_hold` (client side) | on_hold | On hold | "Resume the project when {name} is ready." | resume | revise_quote | null |
| 11 | `deposit_link_sent` | link_sent | Waiting for the deposit | "Deposit link sent 1 day ago." | deposit_link | record_payment | deposit |
| 12 | `deposit_due` (artists) | await_deposit | Waiting for the deposit | "An owner records it when it is paid." | none | | null |
| 13 | nothing waits, the sweep will cancel the expired quote | price_ended | The price has ended | "Send a new price, or the project is cancelled within minutes." | revise_quote | | null |
| 14 | a scheduled session has started and this member may record it | record_session | How did the session go? | "Sat 24 Oct, 11:00 with Asha has started. Record it under Sessions: done, no-show or cancelled." | open_sessions | | null |
| 15 | booked, in_progress or deposit_pending with a scheduled session not started | next_session | Next session: Sat 24 Oct, 11:00 | "With Asha." (null without an artist) | none | | null |
| 16 | in_progress, owners | finish | Finish the tattoo | null (the panel speaks) | finish | schedule | null |
| 17 | in_progress, artists | more_sessions | Schedule the next session | "When the tattoo is done, an owner marks it finished." | schedule | | null |
| 18 | healing_check | healing_check | Healing check | null (the panel; an artist's has no button) | finish | record_payment (owners, a fixed price owed), schedule | null |
| 19 | completed, owners, a fixed price owed | collect_balance | NPR 15,000 still due | "The tattoo is finished. Record the payment when {name} pays." | record_payment | | payments |
| 20 | completed otherwise | closed | Completed | "Nothing left to do. The project stays here for your records." | none | | null |
| 21 | declined or cancelled, owners, outcome needed | record_outcome | Record whether the deposit was kept or refunded | null (the form speaks) | record_outcome | | payments |
| 22 | declined or cancelled otherwise | closed | Declined / Cancelled | "This project is closed." | none | | null |
| 23 | anything else (should not happen) | nothing | Nothing to do right now | null | none | | null |

`needsYou` is true exactly when `waiting.side === "studio"` (rows 1 to 8), as on the list.
The examples' dates and ages are the rules' own words (`waitingText`, `sessionStartText`).

### 5.3 The other cards

- **Sessions** (left): today's `SessionsCard`, `id={cardId("sessions", anchor)}`; its "Schedule a
  session" opens the Schedule sheet and is hidden when the Next step offers `schedule`. Outcome
  panels and the move form stay inline.
- **Message the client** (left): today's `MessageCard` with `footer={contactedText}` and, unless
  `closed`, `onMarkContacted`.
- **Request** (left): title "Request" for a project from an inquiry, "About the piece" for a
  direct booking; the full brief (`whitespace-pre-line wrap-anywhere`), then today's details list
  (now `grid-cols-[auto_minmax(0,1fr)]` with `wrap-anywhere` values, as the inquiry page) and the
  references.
- **Notes** (left): unchanged form; stays on closed projects (D9).
- **Change this project** (left, last; only when it has something): the owner's artist picker
  (today's `ArtistField`) and the move buttons (`MOVE_LABELS`): Put on hold and Resume post at
  once; Client withdrew and Decline through `InlineConfirm` with today's `CONFIRM` questions
  (confirm "Client withdrew" / "Decline the project", keep "Keep the project"). Resume is left out
  when the Next step offers it.
- **Payments** (right, `id={cardId("payments", anchor)}`): `h2` "Payments" (ref for its own
  focus as today), `summary` (`text-base font-semibold`), a muted hint when one applies (overpaid:
  "Record a refund if you give it back."; no price and `canSetPrice`: "Set it in the Quote card.";
  hourly: `totalNote`), the deposit line (today's), the recorded outcome (today's), the waiting
  screenshots and the outcome form unless the Next step holds them, "Show payments (N)" /
  "Hide payments" (a `Button variant="ghost"`, `aria-expanded`, `aria-controls` the list's id; "No
  payments yet." and no button when empty), the list (today's `PaymentList` with Reverse), then
  "Record payment" and "Record a refund" sheet triggers (owners; Record payment hidden when the
  Next step offers it).
- **Quote** (right, `id={cardId("quote", anchor)}`): today's `QuoteSummary` or "No quote yet.";
  Set price sheet trigger when `canSetPrice`; the Revise sheet trigger when `canQuote` and a quote
  exists and the Next step doesn't offer it (wrapper `id={cardId("quote-form", anchor)}`);
  "Earlier versions (N)" behind a ghost Button disclosure.

### 5.4 Sheets (all five)

`FormSheet` draws: `SheetTrigger asChild` with our `Button`; `SheetContent side="bottom"` with
`SheetHeader` (`SheetTitle`, `SheetDescription`), the error-flash message (`role="alert"`, the
destructive wash used by `BalanceBlock`'s lapsed line), the form, and a footer row: the submit
`Button` ("Saving…" while processing) and a `SheetClose asChild` ghost Button "Cancel". The close
"×" is our `Button variant="ghost" size="icon"` (44 px below `lg`) with `sr-only` "Close".

| Sheet | Trigger | Title / description | Form (unchanged fields, route, validation) | Submit |
|---|---|---|---|---|
| Revise | "Revise the quote" | Revise the quote / "The client gets a new price to accept. Saving sends the project back to Quoted." | `QuoteForm` with `quote`, `key={quote.id}`, `tenant.projects.quotes.store`, `baseQuoteId` | "Revise quote" |
| Record payment | "Record payment" | Record payment / "Money the client paid at the desk or by transfer. It is recorded as verified." | `RecordPaymentForm`, `key={recordFormKey(actions)}`, `tenant.projects.payments.store` | "Record payment" |
| Refund | "Record a refund" | Record a refund / "A refund can't be edited or deleted; a mistake is reversed." | `RefundForm` fields (amount, method, note), `tenant.projects.refunds.store` | `refundLabel(amount)`: "Record refund of NPR 2,000" or "Record refund" |
| Set price | "Set price" | Set the price / "No price was set at booking. It can't be changed afterwards." | `PriceForm` field `fixedPrice`, `tenant.projects.price.store` | `priceLabel(price)`: "Set the price to NPR 15,000" or "Set price" |
| Schedule | "Schedule a session" | Schedule a session / `scheduling.hint` or "Pick the kind, the artist and the time." | `ScheduleForm` (kind, artist, date, start, hours), `tenant.projects.sessions.store` | "Schedule session" |

Inside a sheet the forms drop their own Escape handlers, mount-time focus effects and Cancel
buttons (Radix does those), keep `onError={() => focusFirstInvalid(...)}`, and wire `onStart` and
`onSuccess` to `useFormSheet` (D7). The refund's and the price's `onBefore` `window.confirm` go.

### 5.5 Layout

- 375 x 812: one column; the header, then the Next step card. Measure: with a one-line name and a
  one-line piece, the Next step title is above 400 px from the page top, a waiting screenshot's
  Verify and Reject are visible without scrolling, and so are a reviewing project's first quote
  field and a quoted project's Client accepted.
- 1280 x 800: `grid gap-6 lg:grid-cols-12 lg:items-start` replaces the `max-w-2xl` column inside
  the `max-w-6xl` page; left `flex min-w-0 flex-col gap-6 lg:col-span-7`; right `flex min-w-0
  flex-col gap-6 lg:col-span-5 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-3rem)]
  lg:overflow-y-auto` (pad it `lg:p-1 lg:-m-1` if a focus ring is clipped). The right column holds
  Payments and Quote, which stay in view while the left column scrolls: no empty right third.
- Light and dark: tokens only; the sheet's overlay is `bg-background/80` (no `bg-black`).
- Loading, empty, error: no skeletons (X-10 is separate); "Saving…" on every submit; empty
  sessions, payments and quote keep today's sentences; errors as above (D7, D8).
- Devanagari: the header name, the Next step title (it holds the first name), the piece and the
  Request text wrap; nothing truncates.

### 5.6 Server and client

Server: `nextStep` (kind, words, actions, anchor, needsYou), `project.piece`, `payments.summary`,
every `can` flag. Client: the progress line (`progressOf(status)`), which id each element carries
(`cardId`), which triggers hide (`offers`), the action-to-component map, sheet and confirm state.

## 6. Data and contract

- No migration, no route, no OpenAPI or SDK change, no isolation case: the page's route and its
  `MEMBERS` entry are unchanged and its isolation case (`cases.ts`) already covers it.
- New props on `projects/show`: `nextStep: NextStepProps` (restated in `components/projects.ts`
  from the server type), `project.piece: string`, `payments.summary: string`
  (`PaymentsCardProps`, both sides). Removed: `bookedWithoutSession` (the Next step's
  `book_session` replaces the banner; update `project_page.spec.ts:336,357`).
- Queries: `forProjects` on `[project]`, member-scoped (the project came from `findFor`), at most
  four (D14); everything else is read already. Tenant scoping is the services' as today; the
  artist's `forProjects` never reads links and skips the screenshot rule, like Today's.
- `nextStepOf` input, built in `show` from values it already has (hoist the inline expressions of
  `message`, `deposit`, `scheduling`, `finish`, `payments` and the session rows into constants
  first, then use the same constants in the render and in `can`):

```ts
const can: Record<NextStepAction, boolean> = {
	verify_proof: paymentsProps.pending.length > 0, // owners only: artists get []
	issue_quote: canQuote && current === null,
	send_quote: messageProps !== null,
	client_accepted: canAccept,
	revise_quote: canQuote && current !== null,
	resume: moves.includes("resume"),
	deposit_link: depositProps !== null, // owners, deposit_pending
	record_payment: (paymentsProps.actions?.recordKinds.length ?? 0) > 0,
	schedule: schedulingProps !== null,
	open_sessions: startedSession !== null,
	finish: finishProps !== null,
	record_outcome: paymentsProps.outcome.needed !== null,
};
```

- `startedSession`: the first session row with `status === "scheduled"` whose `outcomes` include
  `no_show` (that outcome needs the session to have started and the member to be allowed: the same
  rule that shows the No-show button). `nextSession`: the first scheduled session with
  `startsAt > now` (the list's rule). Each as `{ startText: sessionStartText(startsAt, timezone,
  now), artistName }` (artist from the `artists` list, null when deleted).
- `balanceOwedText`: owners only, `FINISHED_STATUSES.includes(status) && money.quote?.kind ===
  "fixed" && owed(money.balance.due) > 0n` then `formatMoney(owed(...))`: the same three conditions
  as `listFlags` (`payment_service.ts:324-330`); an agreement test pins it against the list.
- `sweepWillCancel`: `sweepWillCancel(state.facts, now)` from `next_step.ts` (below).

## 7. Tasks

Commands run from `apps/platform` with the lane's env (Node 24 on `PATH`, `DB_DATABASE=tattoo_drip_ux`,
`PORT=3402`, `SESSION_DRIVER=memory`), each wrapped in `timeout -s KILL 300`. Every commit ends with
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; every message below passed
`pnpm exec commitlint`.

### Task 1. The Next step table (server, pure)

- **Goal:** `nextStepOf` and `sweepWillCancel` with the table of section 5.2.
- **Files:** `app/modules/projects/next_step.ts` (new), `tests/unit/modules/projects/next_step.spec.ts`
  (new).
- **Test first:** `next_step.spec.ts` imports `nextStepOf`, `sweepWillCancel`, `NEXT_STEP_ACTIONS`
  (fails today: the module doesn't exist). Build facts with a helper `facts(over)` whose `can` is
  all true unless overridden. One test per table row (1 to 23) asserting `kind`, `title`, `text`,
  `primary`, `secondary`, `anchor`, `needsYou`, with `waiting`, `waitingText` and `waitingHash`
  taken from `waitingOf`/`waitingText`/`WAITING_HASH` on `WaitingFacts` built like
  `tests/unit/modules/projects/waiting.spec.ts` does (so the words are the real rule's), plus:
  - availability: row 3 with `can.send_quote` false makes `client_accepted` the primary and drops
    it from `secondary`; row 9 with `can.client_accepted` false has primary null and `secondary`
    `["send_quote", "revise_quote"]`; row 5 for an artist (`deposit_link` and `record_payment`
    false) is titled "Waiting for the deposit" with primary null and `["revise_quote"]`;
  - a Devanagari first name: `clientName: "सीता थापा"` gives "Send सीता a price"; a null or blank
    name gives "Send the client a price";
  - row 14 beats rows 15 to 18 (a started touch-up during a healing check is `record_session`);
    a waiting reason beats row 14 (booked without a tattoo session but a started consultation is
    `book_session`);
  - `sweepWillCancel`: true for an expired quote on a quoted project with no deposit, false when
    `expirySpared`, false when the deposit is covered, false before the expiry, false for a status
    outside quoted/on_hold/deposit_pending;
  - every `primary` and `secondary` value is in `NEXT_STEP_ACTIONS`.
- **Implementation** (full, this is the tricky pure logic):

```ts
import type { DateTime } from "luxon";
import { firstName } from "#modules/notifications/messages";
import { expiryCancels } from "#modules/projects/expiry";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
import type { Waiting, WaitingFacts } from "#modules/projects/waiting";

/**
 * The project page's Next step card (TAT-108): one step per project. When something waits, it is
 * that reason's step, chosen by waitingOf through WaitingService.forProjects, the rules Today and
 * the Projects list use, so the three never disagree; the card carries the reason's WAITING_HASH.
 * When nothing waits, the status decides. Pure: ProjectsController.show gathers the facts.
 */

/** What the card can hold; the page draws each with the component that already does it. */
export const NEXT_STEP_ACTIONS = [
	"verify_proof",
	"issue_quote",
	"send_quote",
	"client_accepted",
	"revise_quote",
	"resume",
	"deposit_link",
	"record_payment",
	"schedule",
	"open_sessions",
	"finish",
	"record_outcome",
] as const;
export type NextStepAction = (typeof NEXT_STEP_ACTIONS)[number];

export type NextStepKind =
	| "check_proof"
	| "send_price"
	| "price_ending"
	| "deposit_ending"
	| "make_link"
	| "chase_deposit"
	| "book_session"
	| "await_answer"
	| "on_hold"
	| "link_sent"
	| "await_deposit"
	| "price_ended"
	| "record_session"
	| "next_session"
	| "finish"
	| "more_sessions"
	| "healing_check"
	| "collect_balance"
	| "record_outcome"
	| "closed"
	| "nothing";

export type NextStep = {
	kind: NextStepKind;
	title: string;
	text: string | null;
	/** The one main action, or null when there is nothing to do here. */
	primary: NextStepAction | null;
	secondary: NextStepAction[];
	/** The id the card carries, so Today's and the list's links land on it; null for none. */
	anchor: string | null;
	/** It waits on the studio (waiting.side "studio"): the marigold dot. */
	needsYou: boolean;
};

/** A session as the card names it: "Sat 24 Oct, 11:00" and its artist. */
export type SessionLine = { startText: string; artistName: string | null };

export type NextStepFacts = {
	status: ProjectStatus;
	/** WaitingService.forProjects' answer for this project. */
	waiting: Waiting | null;
	/** Its words (waitingText), null when nothing waits. */
	waitingText: string | null;
	/** Its card (WAITING_HASH), null when nothing waits or the reason has none. */
	waitingHash: string | null;
	clientName: string | null;
	/** The expired quote's sweep will cancel the project (sweepWillCancel). */
	sweepWillCancel: boolean;
	/** The earliest scheduled session that has not started. */
	nextSession: SessionLine | null;
	/** A scheduled session that has started and this member may record. */
	startedSession: SessionLine | null;
	/** Owners: a finished project's fixed price still owed ("NPR 15,000"), else null. */
	balanceOwedText: string | null;
	/** What the page can offer this member now: the same flags its cards use. */
	can: Record<NextStepAction, boolean>;
};

const WITH_SESSION: readonly ProjectStatus[] = [
	"booked",
	"in_progress",
	"deposit_pending",
];

/**
 * Whether the expiry sweep will cancel the project for its expired quote: the one case in which
 * waitingOf returns null on purpose (its rule, from the same facts).
 */
export function sweepWillCancel(facts: WaitingFacts, now: DateTime): boolean {
	const { quote } = facts;
	if (!quote || !isExpired(quote, now) || facts.expirySpared) return false;
	return expiryCancels({
		status: facts.status,
		depositAmount: quote.depositAmount,
		depositSettled: facts.depositSettled,
	});
}

const withArtist = ({ startText, artistName }: SessionLine) =>
	artistName ? `${startText} with ${artistName}` : startText;

export function nextStepOf(facts: NextStepFacts): NextStep {
	const { status, waiting, can } = facts;
	const name = firstName(facts.clientName ?? "") || "the client";
	const said = `${facts.waitingText ?? ""}.`;
	const step = (
		kind: NextStepKind,
		title: string,
		text: string | null,
		primary: NextStepAction[],
		secondary: NextStepAction[] = [],
		anchor: string | null = null,
	): NextStep => {
		const first = primary.find((action) => can[action]) ?? null;
		return {
			kind,
			title,
			text,
			primary: first,
			secondary: secondary.filter((action) => action !== first && can[action]),
			anchor,
			needsYou: waiting?.side === "studio",
		};
	};

	if (waiting) {
		const anchor = facts.waitingHash;
		switch (waiting.reason) {
			case "proof_to_check":
				return step(
					"check_proof",
					"Check the deposit screenshot",
					status === "cancelled"
						? "The client withdrew while this screenshot waited. Verify or reject it so the money is recorded right."
						: "Verify it only if the money reached your account.",
					["verify_proof"],
					[],
					anchor,
				);
			case "price_to_send":
				return step("send_price", `Send ${name} a price`, said, ["issue_quote"], [], anchor);
			case "quote_ending":
				if (status === "on_hold") {
					return step(
						"price_ending",
						"Resume, or give more time",
						`On hold. ${facts.waitingText ?? "The price ends soon"}, and then the project is cancelled.`,
						["resume"],
						["revise_quote"],
						anchor,
					);
				}
				if (status === "deposit_pending") {
					return step(
						"deposit_ending",
						can.deposit_link ? `Remind ${name} about the deposit` : "Waiting for the deposit",
						`${said} If it isn't paid by then, the project is cancelled.`,
						["deposit_link"],
						["record_payment", "revise_quote"],
						anchor,
					);
				}
				return step(
					"price_ending",
					`Remind ${name} before the price ends`,
					`${said} If ${name} hasn't said yes by then, the project is cancelled.`,
					["send_quote", "client_accepted"],
					["client_accepted", "revise_quote"],
					anchor,
				);
			case "deposit_link_missing":
				return step("make_link", "Send the deposit link", said, ["deposit_link"], ["record_payment"], anchor);
			case "deposit_unpaid":
				return step("chase_deposit", `Remind ${name} about the deposit`, said, ["deposit_link"], ["record_payment"], anchor);
			case "no_session":
				return step("book_session", "Book the tattoo session", said, ["schedule"], [], anchor);
			case "price_sent":
				return step("await_answer", `Waiting for ${name} to answer`, said, ["client_accepted"], ["send_quote", "revise_quote"], anchor);
			case "on_hold":
				return step("on_hold", "On hold", `Resume the project when ${name} is ready.`, ["resume"], ["revise_quote"], anchor);
			case "deposit_link_sent":
				return step("link_sent", "Waiting for the deposit", said, ["deposit_link"], ["record_payment"], anchor);
			case "deposit_due":
				return step("await_deposit", "Waiting for the deposit", "An owner records it when it is paid.", [], [], anchor);
		}
	}

	if (facts.sweepWillCancel) {
		return step("price_ended", "The price has ended", "Send a new price, or the project is cancelled within minutes.", ["revise_quote"]);
	}
	if (facts.startedSession) {
		return step(
			"record_session",
			"How did the session go?",
			`${withArtist(facts.startedSession)} has started. Record it under Sessions: done, no-show or cancelled.`,
			["open_sessions"],
		);
	}
	if (facts.nextSession && WITH_SESSION.includes(status)) {
		const { startText, artistName } = facts.nextSession;
		return step("next_session", `Next session: ${startText}`, artistName ? `With ${artistName}.` : null, []);
	}
	switch (status) {
		case "in_progress":
			return can.finish
				? step("finish", "Finish the tattoo", null, ["finish"], ["schedule"])
				: step("more_sessions", "Schedule the next session", "When the tattoo is done, an owner marks it finished.", ["schedule"]);
		case "healing_check":
			return step(
				"healing_check",
				"Healing check",
				null,
				["finish"],
				facts.balanceOwedText ? ["record_payment", "schedule"] : ["schedule"],
			);
		case "completed":
			return facts.balanceOwedText
				? step(
						"collect_balance",
						`${facts.balanceOwedText} still due`,
						`The tattoo is finished. Record the payment when ${name} pays.`,
						["record_payment"],
						[],
						"payments",
					)
				: step("closed", "Completed", "Nothing left to do. The project stays here for your records.", []);
		case "declined":
		case "cancelled":
			return can.record_outcome
				? step("record_outcome", "Record whether the deposit was kept or refunded", null, ["record_outcome"], [], "payments")
				: step("closed", status === "declined" ? "Declined" : "Cancelled", "This project is closed.", []);
		default:
			return step("nothing", "Nothing to do right now", null, []);
	}
}
```

  (Biome will reflow the long lines; keep the words.)
- **Run:** `pnpm test unit --files=next_step`
- **Commit:**

```
feat(platform): choose the project page's next step from the waiting rules (TAT-108)

nextStepOf takes WaitingService's answer for one project, so the page's Next step card says what
Today and the Projects list say, then the status when nothing waits. Pure and table-tested.
```

### Task 2. The money summary line (server, pure)

- **Goal:** `paymentsCard` returns `summary` (D11).
- **Files:** `app/modules/payments/payments_card.ts`, `tests/unit/modules/payments/payments_card.spec.ts`,
  `inertia/components/payments.ts` (add `summary: string` to `PaymentsCardProps`, with a comment).
- **Test first:** extend "the balance: due, paid in full, overpaid, no price, and a closed
  project's holding" (`payments_card.spec.ts:213`) and add one hourly case: assert `summary` is
  "Paid NPR 5,000 of NPR 20,000 · Balance NPR 15,000", "… · Balance NPR 15,000 (estimated)" for an
  hourly quote, "Paid in full: NPR 20,000", "Paid NPR 22,000 of NPR 20,000 · Overpaid by
  NPR 2,000", "No price yet", "Paid NPR 3,000 · No price yet", "Holds NPR 3,000", "Nothing paid",
  "Refunded NPR 500 more than it received" (fails today: no field). Use the amounts the existing
  cases build; adjust the expected strings to them.
- **Implementation:** after `amountText` (`payments_card.ts:208-217`) compute `total` (formatMoney
  of `balance.total`, or "" when null), `paid` (`formatSignedMoney(balance.paid)`) and the record
  of section D11 keyed by `state`; `" (estimated)"` only on `due` when `quote?.kind === "hourly"`;
  `no_price` and `closed` pick the "nothing paid" form when `balance.paid === 0n`. Add `summary`
  to the `balance`-level return (top-level field `summary` of `PaymentsCardProps`).
- **Run:** `pnpm test unit --files=payments_card`
- **Commit:**

```
feat(platform): one money summary line for the project's payments (TAT-108)

Paid NPR 5,000 of NPR 20,000 · Balance NPR 15,000, and a line for each other balance state, worded
on the server next to the Payments card's other words.
```

### Task 3. The page's new props

- **Goal:** `show` sends `nextStep`, `project.piece` and (through Task 2) `payments.summary`;
  `bookedWithoutSession` goes.
- **Files:** `app/controllers/projects_controller.ts`, `app/modules/projects/services/waiting_service.ts`
  (comment on `forProjects`: the project page is its second caller, TAT-108),
  `inertia/components/projects.ts` (add `NextStepProps`, the action and kind unions restated, and
  `piece` on `project`; drop `bookedWithoutSession`), `inertia/pages/projects/show.tsx` (stop
  reading `bookedWithoutSession`; nothing else yet), `tests/functional/projects/project_page.spec.ts`,
  `tests/functional/projects/next_step_agreement.spec.ts` (new).
- **Test first:**
  1. `project_page.spec.ts`: update `:62` (`piece`), replace the two `bookedWithoutSession`
     assertions with `nextStep.kind` (`book_session` for the booked project without a tattoo
     session; `next_session` once one is scheduled). Add a group "Project page: the Next step
     (TAT-108)" with one request per row family, owner and artist where they differ: reviewing
     (owner and artist: `send_price`, `anchor` "quote-form"); quoted fresh (`await_answer`,
     primary `client_accepted`, secondary includes `send_quote` with a phone and not without);
     quoted ending in 2 days (`price_ending`); on hold (`on_hold`, primary `resume`);
     deposit_pending with no link (owner `make_link` anchor "deposit"; artist `await_deposit`,
     primary null, no deposit facts in the words); with a young link (`link_sent`); a link 4 days
     old (`chase_deposit`); with a waiting screenshot (owner `check_proof` anchor "payments", artist
     `await_deposit`); a cancelled project with a waiting screenshot (owner `check_proof`, with the
     withdrawn text); a cancelled project holding a verified deposit (owner `record_outcome`, anchor
     "payments"; artist `closed`); booked without a tattoo session (`book_session`, anchor
     "sessions"); booked with a session tomorrow (`next_session`, title has the
     `sessionStartText`); a session that started an hour ago (`record_session`; an artist on
     someone else's session does not get it); in_progress with no session (owner `finish`, artist
     `more_sessions`); healing_check (`healing_check`, owner's secondary includes `record_payment`
     only with a fixed price owed); completed with a fixed price owed (owner `collect_balance`
     "NPR 12,000 still due", anchor "payments"; artist `closed`); completed paid (`closed`
     "Completed"); declined (`closed` "Declined"); an expired quoted project the sweep will cancel
     (`price_ended`). Fails today: no `nextStep` prop.
  2. A query-count test in the same file (D14): with `recordQueries`, the owner's page of a
     deposit_pending project from an inquiry with a waiting screenshot, and the artist's page of a
     booked project, cost the same number of queries with 1 and with 3 sessions, payments,
     references and quote versions (warm up once, as `projects_list.spec.ts:850` does).
  3. `next_step_agreement.spec.ts`: `studio()` and `seedGroups(tenant)` from
     `#tests/helpers/waiting_fixtures`, then for the owner and the artist (assign the seeded
     projects to the artist's profile for the artist pass): read `WaitingService.work` (as
     `inTenantAs`), then GET each project page: for every `needsYou` and `onClient` item,
     `nextStep.anchor === item.hash`, `nextStep.needsYou === (item.waiting.side === "studio")` and
     `nextStep.text` contains `item.text` for the rows whose text holds the Today words (rows 2
     to 9 and 11 of section 5.2); for a seeded project in no group, `nextStep.needsYou` is false. And the money line:
     for a completed fixed-price project with a balance, GET `/projects?status=completed` and the
     page: the list's `line.text` equals `nextStep.title`.
- **Implementation:** in `show`, `const now` already exists (`:284`); hoist `messageProps`,
  `depositProps`, `schedulingProps`, `finishProps`, `paymentsProps` (the `paymentsCard(...)` call)
  and `sessionRows` (the `sessions.map(...)`) into constants above the render and use them in the
  render. Then:

```ts
const state = (
	await this.waiting.forProjects(tenant, membership, [project], now)
).get(project.id);
const startedRow = sessionRows.find(
	({ status, outcomes }) => status === "scheduled" && outcomes.includes("no_show"),
);
```

  map `startedRow` and the first scheduled session with `startsAt > now` back to their
  `ProjectSession` (same index or id) for `sessionStartText`; build `can` (section 6),
  `balanceOwedText` (section 6), and

```ts
const nextStep = nextStepOf({
	status: project.status,
	waiting: state?.waiting ?? null,
	waitingText: state?.text ?? null,
	waitingHash: state?.hash ?? null,
	clientName: client?.name ?? null,
	sweepWillCancel: state ? sweepWillCancel(state.facts, now) : false,
	nextSession,
	startedSession,
	balanceOwedText,
	can,
});
```

  Render `nextStep`, and `piece: excerpt(project.brief, ALERT_EXCERPT_LENGTH)` in `project`
  (`excerpt` and `ALERT_EXCERPT_LENGTH` are imported already, `:14`). Remove `bookedWithoutSession`.
- **Run:** `pnpm test functional --files=project_page` and `--files=next_step_agreement`, then
  `pnpm typecheck`.
- **Commit:**

```
feat(platform): send the Next step, the piece and the money line to the project page (TAT-108)

The page asks WaitingService.forProjects about its one project and nextStepOf picks the card.
A test pins that every Today row's link and words match the page's Next step.
```

### Task 4. The page's pure client rules

- **Goal:** `progressOf`, `cardId`, `offers`, `layoutOf` (`components/project_page.ts`),
  `confirmStep`, `focusBack` (`components/confirm.ts`), `sheetAfterSave` (`components/sheets.ts`),
  `refundLabel`, `priceLabel` (`components/projects.ts`). Plain modules: no value import from `~/`
  (ui.md, Dashboard unit tests).
- **Files:** those four; `tests/unit/inertia/project_page.spec.ts`,
  `tests/unit/inertia/confirm_and_sheets.spec.ts` (new), `tests/unit/inertia/payments_card_form.spec.ts`
  (labels).
- **Test first** (each imports the `.js` specifier with the `@ts-expect-error TS6305` line, as
  `status_groups.spec.ts` does; fails today: the modules or exports don't exist):
  - `progressOf`: every `PROJECT_STATUSES` value but declined and cancelled has five steps;
    reviewing is current at 0, quoted and on_hold at 1, deposit_pending 2, booked and in_progress
    3, healing_check 4; completed all done; declined and cancelled null; an unknown status null.
  - `cardId(id, anchor)`: the id when the anchor differs or is null, undefined when equal; for
    each anchor value, at most one of the five ids is dropped.
  - `offers` and `layoutOf`: primary and secondary membership; blocks (`verify_proof`,
    `issue_quote`, `send_quote`, `deposit_link`, `finish`, `record_outcome`) apart from buttons,
    in order.
  - `confirmStep`: `ask` opens with focus on the safe button; `keep` and `finished` close with
    focus on the trigger. `focusBack(trigger, fallback)`: the trigger when `isConnected`, else
    the fallback, else null (stand-in objects).
  - `sheetAfterSave`: no flash, `{}`, `{ error: undefined }` and `{ success: "…" }` close with no
    message; `{ error: "This quote was revised…" }` stays open with that message.
  - `refundLabel("2000")` is "Record refund of NPR 2,000", `refundLabel("")`, `("0")`, `("abc")`
    "Record refund"; `priceLabel("15000")` "Set the price to NPR 15,000", else "Set price".
- **Implementation:**

```ts
// components/project_page.ts
export const PROGRESS_STEPS = ["Review", "Quote", "Deposit", "Sessions", "Done"] as const;
export type StepState = "done" | "current" | "todo";
const AT: Record<string, number> = {
	reviewing: 0, quoted: 1, on_hold: 1, deposit_pending: 2,
	booked: 3, in_progress: 3, healing_check: 4, completed: 5,
};
/** The progress line for a status; null for declined, cancelled and anything unknown. */
export function progressOf(status: string): { label: string; state: StepState }[] | null {
	const at = Object.hasOwn(AT, status) ? AT[status] : undefined;
	if (at === undefined) return null;
	return PROGRESS_STEPS.map((label, index) => ({
		label,
		state: index < at ? "done" : index === at ? "current" : "todo",
	}));
}
export const CARD_IDS = ["payments", "quote", "quote-form", "deposit", "sessions"] as const;
export type CardId = (typeof CARD_IDS)[number];
/** An element's own id, unless the Next step card carries it (each id appears once). */
export function cardId(id: CardId, anchor: string | null): CardId | undefined {
	return anchor === id ? undefined : id;
}
type Step = { primary: string | null; secondary: string[] };
export function offers(step: Step, action: string): boolean {
	return step.primary === action || step.secondary.includes(action);
}
const BLOCKS = ["verify_proof", "issue_quote", "send_quote", "deposit_link", "finish", "record_outcome"];
export function layoutOf(step: Step) {
	return {
		primary: step.primary,
		blocks: step.secondary.filter((action) => BLOCKS.includes(action)),
		buttons: step.secondary.filter((action) => !BLOCKS.includes(action)),
	};
}

// components/confirm.ts
export type ConfirmEvent = "ask" | "keep" | "finished";
export function confirmStep(event: ConfirmEvent): { open: boolean; focus: "keep" | "trigger" } {
	return event === "ask" ? { open: true, focus: "keep" } : { open: false, focus: "trigger" };
}
export function focusBack<T extends { isConnected: boolean }>(trigger: T | null, fallback: T | null): T | null {
	return trigger?.isConnected ? trigger : fallback;
}

// components/sheets.ts
export function sheetAfterSave(flash: { error?: string | null } | null | undefined) {
	const error = flash?.error ?? null;
	return error ? { close: false, message: error } : { close: true, message: null };
}
```

  Labels in `projects.ts` next to `formatRupees`: a positive finite number of the trimmed text
  gives the amount form, anything else the plain label.
- **Run:** `pnpm test unit --files=project_page`, `--files=confirm_and_sheets`,
  `--files=payments_card_form`, `--files=status_groups`
- **Commit:**

```
feat(platform): pure rules for the project page's progress, ids, confirms and sheets (TAT-108)

progressOf, cardId, offers and layoutOf decide what the page draws; confirmStep, focusBack and
sheetAfterSave are the only state the inline confirm and the sheets keep. All unit-tested.
```

### Task 5. The sheet, the form sheet and the inline confirm

- **Goal:** `ui/sheet.tsx`, `form_sheet.tsx` (with `useFormSheet`), `inline_confirm.tsx`.
- **Files:** those three; `tests/unit/inertia/tap_targets.spec.ts`.
- **Test first:** in `tap_targets.spec.ts` add "the sheet's close button is a shared icon Button":
  `component(await read("sheet.tsx"), "SheetContent")` includes `<Button` and `size="icon"` and
  not `<XIcon className="size-4" />` outside a Button (fails today: no file). In the same test,
  read `../form_sheet.tsx` and `../inline_confirm.tsx` and assert neither contains a raw `<button`
  (every control is the shared `Button`, so the 44 px rule applies).
- **Implementation:**
  - From `apps/platform`: `pnpm dlx shadcn@latest add sheet` (ui.md). Then
    `git diff --stat -- package.json ../../pnpm-lock.yaml components.json inertia/css` must be
    empty; revert anything else the CLI touched. If the CLI can't run offline, write the file by
    hand from shadcn's new-york v4 `sheet` with `import { Dialog as SheetPrimitive } from
    "radix-ui"`. Then edit `SheetContent`: the close is
    `<SheetPrimitive.Close asChild><Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2"><XIcon /><span className="sr-only">Close</span></Button></SheetPrimitive.Close>`;
    the `bottom` side adds `max-h-[90dvh] overflow-y-auto rounded-t-md pb-[env(safe-area-inset-bottom)] lg:mx-auto lg:max-w-xl lg:border-x`;
    the overlay is `bg-background/80` instead of `bg-black/50`; content and overlay add
    `motion-reduce:animate-none`. Run a focused Biome check on the file from the root.
  - `form_sheet.tsx`: `useFormSheet()` returns `{ open, message, onOpenChange, onStart, onSuccess }`
    (`onOpenChange(false)` also clears the message; `onStart` clears it; `onSuccess(page)` applies
    `sheetAfterSave(page.flash)`). `FormSheet` props: `label`, `variant` (default "outline"),
    `title`, `description`, `sheet` (the hook's object), `fallback` (a ref to the page `h1`),
    `children`. It renders section 5.4's frame; `SheetContent` gets
    `onCloseAutoFocus={(event) => { event.preventDefault(); focusBack(trigger.current, fallback.current)?.focus(); }}`.
  - `inline_confirm.tsx`: props `label`, `variant`, `question`, `confirmLabel`, `keepLabel`,
    `onConfirm(finished: () => void)`, `fallback`. State `open`, `saving` through `confirmStep`;
    the panel is a `fieldset` (`min-w-0 rounded-md bg-muted/50 p-3`) with a `legend`
    (`float-left mb-3 w-full`, as `OutcomePanel`), the confirm Button (default variant, "Saving…"
    while saving) and the keep Button (ghost), both `className="h-11"`; the trigger has
    `aria-expanded`; `useEffect` focuses the keep button when it opens; `onKeyDown` Escape is
    `keep`; after `finished`, focus with `setTimeout(() => focusBack(...)?.focus(), 0)` so React
    has committed the new page (the `focusFirstInvalid` precedent).
- **Run:** `pnpm test unit --files=tap_targets`, `pnpm typecheck`, `pnpm exec biome check
  apps/platform/inertia/components` from the root.
- **Commit:**

```
feat(platform): add the shadcn sheet, a form sheet and an inline confirm (TAT-108)

The sheet is Radix Dialog from radix-ui, so no package is added. Its close button is the shared
icon Button (44 px below lg), its overlay a token, and it slides up from the bottom on every width.
```

### Task 6. Five forms into sheets

- **Goal:** Revise the quote, Record payment, Record a refund, Set price, Schedule a session open
  in `FormSheet` (section 5.4); the refund's and the price's `window.confirm` go.
- **Files:** `inertia/components/quote_card.tsx` (new: `QuoteSummary`, `QuoteForm`, `AcceptQuote`,
  `PriceSheet`, `ReviseSheet`, moved from `show.tsx` with fields unchanged), `payments_card.tsx`
  (`RecordPaymentSheet`, `RefundSheet`; export `PendingProof`, `OutcomeForm`),
  `sessions_card.tsx` (`ScheduleSheet`, exported; the card uses it), `pages/projects/show.tsx`
  (imports only; the old cards still render until Task 8).
- **Test first:** `tests/unit/inertia/inline_confirms_source.spec.ts` (new) with its first test:
  `components/payments_card.tsx` and `components/quote_card.tsx` contain no `window.confirm` and
  no `onBefore=` (fails today on `payments_card.tsx:601`). The behaviour itself is checked in the
  browser (section 9); the functional tests of the routes (`payments_http`, `quotes_http`,
  `project_sessions` specs) stay green unchanged, which proves no field or route moved.
- **Implementation:** each sheet owns `useFormSheet()`; its Form keeps `route`, `routeParams`,
  field names and `options={{ preserveScroll: true }}`, adds `onStart={sheet.onStart}` and
  `onSuccess={sheet.onSuccess}`, keeps `onError` focusing the first invalid field (move
  `focusFirstInvalid` from `sessions_card.tsx:299-303` into `form_sheet.tsx`, exported, and import it
  back in `sessions_card.tsx` for the move form). `RecordPaymentForm` keeps `key={recordFormKey(actions)}`; `QuoteForm` in
  the Revise sheet keeps `key={quote.id}` (a refused save because someone revised the quote
  meanwhile remounts it with the new terms, as today, and the sheet shows the flash). The refund
  and price submit buttons read `refundLabel(amount)` and `priceLabel(price)`. Sheets take the page
  `h1` ref as `fallback` (thread `heading` from `show.tsx`).
- **Run:** `pnpm test unit --files=inline_confirms_source`, `pnpm typecheck`
- **Commit:**

```
feat(platform): revise, record, refund, set price and schedule open in a bottom sheet (TAT-108)

Same fields, routes and validation. A sheet closes only after a save without an error; a refused
save keeps it open with what was typed and the message. Refund and price name the amount.
```

### Task 7. Inline confirms for the remaining one-tap actions

- **Goal:** `InlineConfirm` replaces `window.confirm` for decline and withdraw (project), New
  deposit link, and Decline (inquiry).
- **Files:** `inertia/components/change_card.tsx` (new: `ArtistField` and the move buttons from
  `show.tsx`, with `CONFIRM`), `inertia/components/deposit_panel.tsx` (new: `DepositCard`'s body),
  `pages/projects/show.tsx` (use them), `pages/inquiries/show.tsx` (`DeclineButton` →
  `InlineConfirm`, `Page titleRef` for the fallback, `h1` gets `tabIndex={-1}` through `Page`).
- **Test first:** extend `inline_confirms_source.spec.ts`: `pages/projects/show.tsx`,
  `pages/inquiries/show.tsx` and every `.tsx` directly in `inertia/components/` contain no
  `window.confirm` and match no `/[^\w.]confirm\(/` (fails today on `show.tsx:386,544,821` and
  `inquiries/show.tsx:238`). Keep `pages/calendar` out of the list (its `confirm` is local).
- **Implementation:** the questions stay word for word (`CONFIRM` at `show.tsx:789-805`; "Make a
  new link? The link you sent before stops working."; "Decline this inquiry? This can't be
  undone."). Confirm labels: "Client withdrew", "Decline the project", "Make a new link",
  "Decline the inquiry"; keep labels: "Keep the project", "Keep this link", "Keep the inquiry".
  `onConfirm(finished)` posts with `router.post(url, body, { preserveScroll: true, onFinish:
  finished })`.
- **Run:** `pnpm test unit --files=inline_confirms_source`, `pnpm test functional
  --files=project_changes` and `--files=inquiries` (unchanged, green), `pnpm typecheck`
- **Commit:**

```
feat(platform): inline confirms instead of window.confirm on project and inquiry pages (TAT-108)

Decline, Client withdrew, a new deposit link and declining an inquiry ask in the page, with focus
on the safe button; Escape or Keep returns to the button. The questions keep their words.
```

### Task 8. The restructured page

- **Goal:** sections 5.1 to 5.5.
- **Files:** `pages/projects/show.tsx`, `components/page.tsx` (`details`), `progress_line.tsx`,
  `next_step_card.tsx`, `quote_card.tsx` (`QuoteCard`), `payments_card.tsx` (summary, hint, Show
  payments, hides per `offers`), `sessions_card.tsx` (`cardId`, hides Schedule per `offers`),
  `finish_card.tsx` (export `FinishPanel`, no Card or title; `FINISH_TITLES` stays for the server's
  words to match, see below), `message_card.tsx` (`onMarkContacted`).
- **Test first:** extend `inline_confirms_source.spec.ts` with a layout scan of `show.tsx`: the
  first index of `<NextStepCard` < `<SessionsCard` < `<MessageCard` < `<RequestCard` <
  `<NotesCard` < `<ChangeCard` < `<PaymentsCard` < `<QuoteCard` (make Request and Notes named
  components in `show.tsx`), and the source contains `lg:col-span-7`, `lg:col-span-5` and
  `lg:sticky` (fails today). Add to `finish_copy.spec.ts`: `nextStepOf` (imported from
  `#modules/projects/next_step`) titles rows 16 and 18 exactly `FINISH_TITLES.finish` and
  `FINISH_TITLES.complete`, so the card's title and the panel's words can't drift. The rest is
  checked in the browser.
- **Implementation:** as section 5. Notes: the status card, the banner, the outcome hint link, the
  standalone Quote message and `FinishCard` card are gone; `ContactLine` goes into `MessageCard`;
  every element with a card id renders `id={cardId(...)}` plus the scroll-margin classes; the Next
  step card renders `id={nextStep.anchor ?? undefined}`; `FinishPanel`'s and `PendingProof`'s
  `onDone` focus the page `h1`.
- **Run:** `pnpm test unit`, `pnpm test functional --files=project_page`, `pnpm typecheck`,
  `pnpm --filter @tattoo-drip/platform build` (from the root: `pnpm build`)
- **Commit:**

```
feat(platform): restructure the project page around the Next step card (TAT-108)

A header with the piece, status, artist and progress line, one Next step card, then sessions,
messages, the request and notes; payments and the quote in a sticky right column from lg.
```

### Task 9. Docs

- **Files:** `apps/platform/docs/ui.md`, `apps/platform/docs/backend.md` (section 8).
- **Run:** `pnpm check` from the root.
- **Commit:**

```
docs(platform): the project page's Next step, sheets and inline confirms (TAT-108)
```

### Task 10. Browser pass and fixes

Run the list in section 9 on the lane's servers. Fix what fails, one `fix(platform): … (TAT-108)`
commit per finding, each with a test when the finding is in a pure rule or a prop.

## 8. Docs to update

- `ui.md`:
  - New bullet "Project page (TAT-108)" after "Finishing": the header (`Page`'s `details`, the
    piece, `ProgressLine` and `progressOf`, the money line below `lg`); the Next step card
    (server-chosen `nextStep`, its action names and the components that draw them, the marigold
    dot); D4's anchor rule (`cardId`: the Next step card carries the reason's id and the card that
    normally owns it drops it; the five ids and who links to them); D5 (`offers`); the columns and
    the sticky right column; closed projects (D9); "Show payments".
  - New bullet "Sheets and inline confirms (TAT-108)": `ui/sheet.tsx` (bottom on every width, the
    44 px close, the token overlay), `FormSheet` and `useFormSheet` (`sheetAfterSave`, the message
    inside the sheet, focus back to the trigger or the `h1`, never closed on a refusal), which
    forms live in sheets and which stay inline; `InlineConfirm` (`confirmStep`, `focusBack`, the
    safe button first, Escape) for one-tap actions, never inside a sheet; no `window.confirm` on
    the project and inquiry pages (`inline_confirms_source.spec.ts`); Settings and Artists still
    use it (follow-up).
  - "Finishing (TAT-111)": the Finish card is now `FinishPanel` inside the Next step card (drop
    "TAT-108 moves the card into the Next step card").
  - "Today (TAT-107)": replace "keep them (or change `WAITING_HASH` …) when TAT-108 restructures
    the page" with a pointer to the Project page bullet's anchor rule.
  - "App shell": drop "TAT-108 restructures the project page."
- `backend.md`:
  - "What waits, and Today (TAT-107)": `forProjects` has a second caller, the project page
    (TAT-108), which asks about its one project.
  - New bullet "The project page's Next step (TAT-108)" under Clients, inquiries and projects:
    `nextStepOf` and `sweepWillCancel` (`#modules/projects/next_step`, pure), the inputs (`can`
    from the same values the page's cards use, `startedSession` from the No-show rule,
    `nextSession` the list's rule, `balanceOwedText` the list's money rule), the anchor equals
    `WAITING_HASH`, at most four extra queries, and what a closed project still accepts (D9, with
    the artist change and "Mark contacted" left open as a follow-up).
  - Payments: `paymentsCard` also gives `summary`.

## 9. Acceptance and browser checks

Measurable (CI):

- `pnpm test` passes; the new unit tests (`next_step`, `project_page`, `confirm_and_sheets`,
  `inline_confirms_source`, the tap-target and label additions) and functional tests
  (`project_page` Next step group and query count, `next_step_agreement`) are in it.
- No `window.confirm` and no `confirm(` call in `pages/projects/show.tsx`, `pages/inquiries/show.tsx`
  or `inertia/components/*.tsx` (the scan).
- The project page's query count is equal for 1 and 3 of each row kind, owner and artist.
- `git diff main -- package.json pnpm-lock.yaml apps/platform/package.json` is empty.

Browser (manual, Playwright from the repo, lane A servers 3401; at 375 x 812 with touch and at
1280 x 800, light and dark; at least one client named सीता थापा; a fresh page per `tel:`/`viber:`
tap, testing.md). For each state, open the page from its Today row or Projects card link where
one exists and confirm it scrolls to the Next step card (or the named card) with the title
clear of the top bar:

1. Reviewing (from an inquiry): the first quote field is on the first screen at 375; Issue quote
   with an empty price shows the field error inside the card, the typed deposit kept.
2. Quoted: "Waiting for … to answer", Client accepted and Send on WhatsApp on the first screen at
   375; the Viber path still copies and opens (TAT-104).
3. Quoted, ending in 2 days: the dot and "Remind … before the price ends".
4. On hold: Resume in the Next step; the Change card has no Resume.
5. Deposit pending, no link / young link / old link: Make deposit link; then New link asks inline
   (focus on "Keep this link"; Escape returns to New link); Copy link works.
6. A waiting screenshot (owner): Verify and Reject on the first screen at 375; Verify's panel and
   note work; after verifying, focus is on the `h1` and the Next step changes. As the artist:
   "Waiting for the deposit", no screenshot anywhere.
7. Booked without a session: "Book the tattoo session"; Schedule a session opens the sheet (focus
   in Kind); an overlapping time keeps the sheet open with the error under Start time and the
   values typed; a good time closes it, focus lands on the `h1` (the trigger is gone), the toast
   shows. The Sessions card has no second Schedule button.
8. Booked with a session tomorrow; then one that started: "How did the session go?" and its link
   scrolls to the Sessions card's Done/No-show.
9. In progress (owner): Finish the tattoo with the balance line; the confirm panel; as the
   artist: "Schedule the next session".
10. Healing check (owner and artist), with a touch-up scheduled and without.
11. Completed with a fixed price owed: "NPR … still due", Record payment sheet; completed paid:
    "Completed", no change buttons, Notes still save.
12. Cancelled holding a deposit: the outcome form in the Next step; cancelled with an undecided
    screenshot: Verify and Reject work on the closed project; declined: "Declined", no artist
    picker, no Mark contacted, no move buttons.
13. Money: the summary line in the header below `lg` only; Show payments opens and closes the list
    (`aria-expanded`), Reverse still confirms inline; Record a refund's button names the amount;
    an amount over the limit keeps the sheet open with the field error; a refusal by flash (e.g.
    refund on a project needing its outcome first) keeps the sheet open with the message in it.
14. Set price on a booked project without one: the button names the price; after saving, focus
    is on the `h1`.
15. Revise the quote from a stale tab after another tab revised it: the sheet stays open with the
    message and the new terms.
16. Sheets: Escape, the ×, Cancel and a tap on the overlay close them and return focus to the
    trigger; at 375 the sheet fits above the keyboard on iOS-sized viewports (scroll inside); the
    × and every button 44 px tall; dark mode overlay readable.
17. Inquiry page: Decline asks inline; Keep returns focus; Decline the inquiry declines and focus
    lands on the `h1`.
18. 1280 x 800: two columns, the right one (Payments, Quote) stays in view while the left
    scrolls; with the payments list open and taller than the screen it scrolls inside; no focus
    ring clipped; nothing wider than the screen at 375; the progress line's five labels fit at
    375 in light and dark.
19. Heights at 375: every button, link-button, select and input on the page and in the sheets at
    least 44 px (measure).

## 10. Final gates

From the root: `pnpm check`, `pnpm typecheck`, `pnpm build`. Then empty `queue_jobs` in
`tattoo_drip_ux` and run the full platform suite once under the lock:
`flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock timeout -s KILL 1800 pnpm --filter @tattoo-drip/platform test`
(with the lane's env). The storefront is untouched (no `check:page` run needed).

## 11. Review focus (Fable and Codex)

- Role scoping and information exposure: an artist's `nextStep` never names money they can't see
  or a deposit link (rows 1, 5, 12, 19, 21 for artists); `can` comes only from props the role
  already gets; the screenshot images stay owners-only (the Next step reuses `payments.pending`,
  empty for artists).
- Agreement: the page's anchor and words equal `WaitingService.work`'s for every seeded group, and
  the completed money line equals the list's; `sweepWillCancel` is `waitingOf`'s null branch.
- No behaviour hidden in the redesign: every form keeps its route, fields and validation (diff the
  moved components field by field); no service, validator or route changed; the questions of the
  converted confirms kept their words.
- Errors and typed values: no sheet closes on a refusal; a remount happens only where a key
  changes because the server's facts changed (the revised quote, the record form's choices).
- Focus: sheets return focus to the trigger or the `h1`; inline confirms start on the safe
  button; nothing falls to `<body>` after a step that removes its button.
- Query count (D14) and the at-most-four added queries.
- Accessibility: progress line semantics (`aria-current="step"`, the sr-only states), the Next
  step's "Needs you:" text, `aria-expanded`/`aria-controls` on Show payments and the confirm
  triggers, Radix's dialog title and description on every sheet, 44 px targets, Devanagari
  wrapping, token contrast in both themes.

## 12. Risks and rollback

- **Radix focus and Inertia's timing.** A trigger can unmount after a save; `focusBack` falls back
  to the `h1`, and the inline confirm defers its focus one tick. If a browser check shows focus on
  `<body>`, fix it in `focusBack`'s callers, not with new state.
- **Escape inside a sheet** always closes the sheet (Radix listens in the capture phase). That is
  why no inline confirm sits inside a sheet (D8); keep it that way.
- **The toast under a modal** is hidden from screen readers: the message inside the sheet covers
  refusals; success toasts come after the sheet closed.
- **Tall right column at 1280**: the inner scroll is the fallback; if it feels wrong in the browser
  pass, drop `lg:sticky` only (one class) and report.
- **Copy drift** between the server's Next step titles and the panels' own words (Finish): the
  `finish_copy` test pins the two titles.
- **Rollback:** the change is one branch of UI and one pure server module; reverting the merge
  restores the old page. No data, route or contract changed.

## 13. Decisions only the user can make (defaults let the builder proceed)

- **U1. Notes on a closed project:** stay editable (default; they are the studio's internal record)
  or read-only.
- **U2. A server guard for the artist change (and "Mark contacted" without a channel) on a closed
  project:** a small follow-up ticket (default) or in this ticket.
- **U3. Where status moves live:** a "Change this project" card at the end of the page with plain
  buttons (default) or a "⋯ More actions" menu in the header.
- **U4. Refund and Set price:** the sheet's submit button names the amount, no second confirm
  (default), or an extra inline confirm step inside the sheet.
- **U5. Sheets on a computer:** a bottom sheet centered, at most 36 rem wide (default), or a panel
  sliding in from the right.
