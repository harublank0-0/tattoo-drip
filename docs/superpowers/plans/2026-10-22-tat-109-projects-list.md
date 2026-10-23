# Projects list that says what's waiting, and a desktop table (TAT-109)

> For the Sonnet 5.5 builder. Follow the tasks in order, test first. The standing rules of
> `run7-brief.md` (isolated database, ports, no `.env` reads, Node 24, commit rules, teardown,
> report) apply; they are not repeated here. Where the code below and the code on the branch
> disagree in a small way (a renamed import, a line that moved), adapt and say so in the report;
> where a rule or a decision below would change, stop and report instead.

## 1. Header

- **Ticket:** TAT-109, "Projects list that says what's waiting, and a desktop table" (WP-12 of the
  UX pass; audit findings P-4, P-5, W-2). Platform dashboard only.
- **Branch:** `harublank00/tat-109-projects-list-that-says-whats-waiting-and-a-desktop-table`, cut
  from `54d61f1`, the tip of the TAT-107 branch
  (`harublank00/tat-107-today-screen-and-a-new-tab-bar-today-inbox-projects-calendar`). **Stacked on
  TAT-107**, which is built and in review, not merged. This plan is the first commit of its own.
  The coordinator fast-forwards this branch to the fixed TAT-107 tip before you start (see
  "TAT-107's fix round" below); `git log` should show TAT-107's fix commits under this plan.
- **Lane A:** database `tattoo_drip_ux` (`DB_DATABASE=tattoo_drip_ux` on every platform command),
  platform dev server 3401, tests `PORT=3402`, storefront 3404 and stand-in API 3405 (neither is
  needed). A FULL platform suite run goes through
  `flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock`.
  Targeted runs need no lock (none of them is `setup_roles.spec.ts` or `role_guard.spec.ts`).
- **Goal in plain words:** each project row says who it is for, what the piece is, its status and
  ONE line about what waits ("Deposit screenshot to check", "Price sent 2 days ago", "Next session
  Sat 24 Oct, 11:00", "NPR 15,000 still due"), with what needs you first. "Never contacted" is gone
  from the rows. A "Needs you" view holds exactly the projects Today counts, and every "See all"
  link on Today opens exactly the rest of its group. From 1024 px the list is a table that sorts by
  what needs you or by last contact.
- **Points:** the ticket says 2; this plan is about 3 (the Needs you view, Today's "See all"
  targets and the in-memory order are on top of the rows and the table).

### TAT-107's fix round (read before Task 1)

TAT-107 is in a fix round while this plan is written: a withdrawn project whose deposit screenshot
waits stays in the owner's work as a screenshot to check, an expired quote no longer hides a paid
project's "no session" work, an artist's project stays visible while a screenshot waits, screenshots
sort by when they came, and some words change ("less than a day ago"). **This plan depends on
TAT-107 only through public names**: `WaitingService.work(tenant, member, now)` (its `needsYou` and
`onClient` items, each with `project.id`, `waiting`, `text`, `hash`; the exported `WaitingItem`
type), `needsYouCount` (as the shared `todayCount` prop) and the Today grouping helpers that
`TodayController` itself uses (`groupOf`, `TODAY_GROUP_ORDER`, `TodayGroupKey` from
`#modules/projects/waiting`). It never calls `forProjects`, `waitingOf`, `waitingText` or
`ProjectService.listActive`, never reads `WaitingFacts`, never relies on which columns `work()`'s
projects carry, and no test here hard-codes a waiting sentence: every test compares the list with
`work()`'s own answer for the same studio. If a public name above changed, stop and report.

## 2. Scope fence

All under `apps/platform/` unless named.

New files:
- `app/modules/projects/project_list.ts` (pure: views, order, page, line)
- `inertia/components/project_list.ts` (plain dashboard helpers: links, card line and meta, words)
- `inertia/components/ui/table.tsx` (shadcn, Task 5)
- Tests: `tests/unit/modules/projects/project_list.spec.ts`,
  `tests/unit/inertia/project_list_copy.spec.ts`, `tests/functional/projects/list_reads.spec.ts`,
  `tests/helpers/waiting_fixtures.ts` (Task 3 moves two fixtures here)

Changed files:
- Server: `app/controllers/projects_controller.ts` (`index` only, plus one constructor
  dependency), `app/controllers/today_controller.ts` (the "See all" targets only),
  `app/modules/projects/services/project_service.ts` (one new read, `listKeys`),
  `app/modules/scheduling/services/session_service.ts` (one new read, `nextScheduledFor`),
  `app/modules/scheduling/times.ts` (`sessionStartText`),
  `app/modules/payments/services/payment_service.ts` (`ListFlags.balanceDue`)
- Dashboard: `inertia/pages/projects/index.tsx`, `inertia/components/projects.ts` (the list's
  types), `inertia/pages/today/index.tsx` (`moreHref` only), `inertia/components/today.ts`
  (`TodayMore` only)
- Existing tests whose pinned behaviour changes (each named in its task):
  `tests/functional/projects/projects_list.spec.ts` (rewritten),
  `tests/functional/payments/project_payments_card.spec.ts` (the list test only),
  `tests/functional/projects/project_finish_http.spec.ts` (the board test only),
  `tests/functional/projects/project_finish.spec.ts` (one assertion added),
  `tests/functional/payments/payment_reads.spec.ts` (the listFlags deepEquals),
  `tests/functional/shell/today_page.spec.ts` (fixtures moved out, "See all" targets),
  `tests/unit/inertia/today_copy.spec.ts` (the `More` shape), `tests/unit/modules/scheduling/times.spec.ts`
- Docs: `apps/platform/docs/ui.md`, `apps/platform/docs/backend.md`
- `.adonisjs/**` only if `node ace codegen` writes something (no route, page or controller is
  added or renamed, so it should not; run it once after Task 4 and keep whatever it writes)

**NOT in this plan:**
- Any migration, `database/schema.ts`, `packages/*`, `openapi.yaml`, the storefront; no new route,
  so no `TENANT_ROUTE_ROLES` entry and no new isolation case (the existing
  `GET /t/:tenant/projects` case covers the route; Task 3 adds view-by-view scoping tests).
- A photo thumbnail on the rows, or initials (Decision D7; follow-up hook for TAT-112 there).
- A piece-title column (TAT-115 owns it; the piece is the start of the brief until then, D6).
- Any change to what "needs you" means, to `WaitingService`, `waiting.ts` or to Today's groups,
  rows or words. Money facts (balance due, lapsed price, deposit outcome) are NOT made "needs you"
  (user decision U2).
- The project page (TAT-108), the Inbox thumbnails (TAT-115), caching or memoizing `work()` per
  request, removing `ProjectService.list`'s Active branch (its own tests use it).

## 3. Facts verified on this branch (54d61f1)

Line numbers are at 54d61f1. TAT-107's fix round (`f5df7fa`, `f0111f1` on its branch, checked
before this plan was committed) keeps every public name this plan uses (`work`, `needsYouCount`,
`WaitingItem`, `groupOf`, `TODAY_GROUP_ORDER`, `NeedsYouReason`) and leaves `TodayController`
alone, but moves lines in `project_service.ts` (`findManyFor` :118, `list` :165, `countByStatus`
:222, `scopeTo` :760; `listActive` now also returns an owner's withdrawn project with a waiting
screenshot and only a few columns, which is why this plan never uses it) and in
`today_page.spec.ts` (`Group.more` :63, `studio()` :72, `seedGroups()` :98, the "more than five
rows" test :299, the badge query test :680). Find the spots by name after the fast-forward.

1. **The list today.** `ProjectsController.index` (`app/controllers/projects_controller.ts:110-175`):
   `toProjectFilter(query.status)` and a page number; `ProjectService.list` (one SQL page of 25),
   `countByStatus`, `ClientService.findMany`, `ArtistService.list` (both roles),
   `SessionService.projectsWithScheduledTattoo` (the `noSession` flag), and for owners
   `PaymentService.listFlags`; each row is `{ id, clientName, artistName, status, contactedText,
   noSession, proofWaiting, depositToSettle, quoteLapsed, balanceOwed }`
   (`inertia/components/projects.ts:253-278`). `contactedText` is `lastContactText`, which says
   "never contacted" without a contact (`app/modules/projects/contact.ts:46-56`).
2. **Order and pages.** `ProjectService.list` (`project_service.ts:158-186`): Active and one status
   sort "never contacted first, then the longest since contact"; Closed the most recently changed
   first; `PROJECTS_PER_PAGE = 25` (`:61`). `countByStatus` (`:206-219`), `findManyFor` (`:111-120`,
   the `findFor` rule, no order), `scopeTo` (`:747-758`: owners every live project, an artist only
   projects assigned to their own live profile, nothing without one). `ProjectService.list` is
   also called directly by `tests/functional/projects/project_service.spec.ts:1274-1392`.
3. **Filters.** `ProjectFilter = "active" | "closed" | ProjectStatus` and `toProjectFilter`
   (`app/modules/projects/moves.ts:72-79`; anything unknown, an array included, is "active");
   `CLOSED_STATUSES` declined, cancelled, completed (`:61-65`); `ACTIVE_STATUSES` the rest,
   `healing_check` included (`:68-69`).
4. **The page.** `inertia/pages/projects/index.tsx`: the chip row (TAT-103, one row that scrolls
   below `lg`, wraps from `lg`, scrolls the `[aria-current=page]` chip into view, `:28-56`,
   `:73-94`), rows as one `Link` each with `StatusBadge` and four outline badges plus a destructive
   "no session" badge (`:96-142`), Previous / Next padded to 44 px (`:144-169`). Chips are
   `ACTIVE_FILTERS` (`components/projects.ts:281-289`) between "Active" and "Closed".
5. **What waits (TAT-107).** `WaitingService` (`app/modules/projects/services/waiting_service.ts`):
   `work(tenant, member, now?)` (`:138-163`) gives `needsYou` and `onClient`, each a list of
   `WaitingItem` (`:43-46`: `project`, `waiting`, `text`, `hash`, …) sorted oldest wait first;
   `needsYouCount` (`:166-172`) is `work().needsYou.length` and is shared on every tenant page as
   `todayCount` (`app/middleware/inertia_middleware.ts:64-74`). The Today groups come from
   `groupOf(reason)` and `TODAY_GROUP_ORDER` (`app/modules/projects/waiting.ts:220-253`).
6. **Today's "See all".** `SEE_ALL` (`app/controllers/today_controller.ts:51-59`): proofs, ending
   and sessions go to the unfiltered Projects list (`status: null`), prices to `status=reviewing`,
   deposits to `status=deposit_pending`, requests to the Inbox; "Waiting on clients" goes to the
   unfiltered list (`:205-211`). The page builds `?status=` (`inertia/pages/today/index.tsx:31-35`;
   type `TodayMore`, `inertia/components/today.ts:34-37`). Pinned by `today_page.spec.ts:336-346`
   (prices and requests) and `:279` (no `more` with few rows); `today_copy.spec.ts:6-9, 31-47`.
   None of these lands on the rows Today counted: the TAT-107 review finding this plan fixes.
7. **Owner flags.** `PaymentService.listFlags` (`app/modules/payments/services/payment_service.ts:257-332`;
   `ListFlags` `:66-75`): at most three queries for a page of rows; `balanceOwed` only for a
   healing-check or completed project with a fixed price still owed (`:316-323`, computed from
   `owed(balanceOf(quote, own).due)`). Pinned by `payment_reads.spec.ts:146-187` (whole-object
   `deepEqual`s), `payment_flag_queries.spec.ts:59-110` (query counts), `project_finish.spec.ts:436-472`.
   The list shows flags to owners only; `project_finish_http.spec.ts:439-473` and
   `project_payments_card.spec.ts:90-156` pin that through the list's props.
8. **Sessions.** `SessionService.projectsWithScheduledTattoo` (`session_service.ts:182-194`) is the
   only batch read; there is none for "the next session". `sessionTimeText` (`app/modules/scheduling/times.ts:29-42`)
   formats a range with the year. `ProjectSession` uses soft deletes, so model queries skip deleted rows.
9. **Reference images.** Stored by `ImageService.storeBytes` (`app/modules/media/services/image_service.ts:60-72`)
   as one JPEG or PNG fitted in 2048 px (backend.md, Images), private purpose `reference_image`,
   served only through a 5-minute signed URL that answers `Cache-Control: private, no-store`
   (`:23`, `:30`, `url` `:81-101`): every view would download each image again, full size. Read
   with `InquiryService.images` / `imagesFor` (`inquiry_service.ts:161-169`, `:220-236`). ui.md
   (Phones and slow connections) says lists show lazy-loaded thumbnails, never the full-size file.
   There is no smaller size until TAT-112.
10. **Piece title.** `tattoo_projects` has `brief` (the inquiry's idea, or the booking form's text,
    up to 4,000 characters) and no title column (`database/schema.ts:660-700`); the short title is
    TAT-115. `excerpt(text, max)` (`app/modules/notifications/alerts.ts:38-46`, grapheme-safe, cuts
    at a word, adds "…") with `ALERT_EXCERPT_LENGTH = 80` (`:29`) is what Today's request rows use.
11. **UI pieces.** No `table.tsx` in `inertia/components/ui/` (badge, button, card, checkbox,
    dropdown-menu, empty, field, input, label, radio-group, select, separator, sonner, textarea).
    `components.json` points `utils` at `~/lib/utils`, which does not exist: the components import
    `cn` from the `cn` package. `Page` is `max-w-6xl` with `sm:px-8` (`inertia/components/page.tsx:29`);
    the sidebar is `w-60` (`components/shell/side_nav.tsx:26`), so the content is about 976 px wide
    at 1280. `StatusBadge` (`components/status_badge.tsx`) always shows the word and a mark.
12. **Query budgets.** `today_page.spec.ts:675-698` pins that `GET /t/:tenant/projects` costs the
    same number of queries with one and three of each Today reason (`recordQueries`,
    `tests/helpers/query_count.ts:11`). Its fixtures `studio()` (`:71-88`) and `seedGroups()`
    (`:97-…`) are local to that file.
13. **Route and roles.** `"tenant.projects.index": MEMBERS` (`app/modules/tenancy/access.ts:87`),
    isolation case `GET /t/:tenant/projects` (`tests/isolation/cases.ts:560-566`), in
    `ARTIST_ROUTES` (`tests/functional/tenancy/role_access.spec.ts:28`).
14. **Rules in ui.md.** Lists paginated at 25 (`docs/ui.md:38`), images in lists only as
    thumbnails (`:39`), no truncate or line clamp on text that can hold a client's name (`:49`),
    `StatusBadge` for statuses (`:50`), 44 px below `lg` and the bare-link padding
    `-my-3 flex min-h-11 items-center` (`:19`).

## 4. Decisions

- **D1. One source for "needs you": `WaitingService.work`.** The list calls `work(tenant, member,
  now)` once per request and takes from it, and only from it: which projects need the member
  (the dot, the Needs you view, its count), their order and their line's words and target card.
  Rows nothing waits on get no waiting words. The Needs you chip's count is
  `work().needsYou.length`, the same number as the Today badge (`needsYouCount`) and the same
  rows as Today, by construction. Rejected: calling `forProjects` on the page's rows (the order
  across pages needs every row's state; and after TAT-107's fix `work()` holds projects that are
  not in the Active set, so a second definition would drift); a SQL sort key (would copy the rules
  into SQL).
- **D2. Views and their parameters (all checked against fixed lists by `toListView`).**
  `status`: `active` (default), `needs_you`, `closed` or one `PROJECT_STATUSES` value (anything
  else, arrays included, is `active`). `waiting`: one of `proofs`, `prices`, `ending`, `deposits`,
  `sessions` (the Today group keys except `requests`) or `on_client`; anything else is ignored; when
  set it wins over `status` and selects exactly that Today group's rows (or `work().onClient`), in
  `work()`'s order, under the "Needs you" chip (or "Active" for `on_client`). `sort`: `needs`
  (default) or `contact`; only the Active view and the single open statuses offer it; waiting views
  keep `work()`'s order and closed views keep "latest change first". `page`: as today. No parameter
  ever widens what a member sees: every row comes from `work(tenant, member)`,
  `ProjectService.listKeys` / `findManyFor` / `list` (all `scopeTo`), so an artist's
  `?waiting=proofs` is simply empty. One allow-list for both roles (a role-specific list would copy
  the rule "screenshots are owners'" out of `waiting.ts`).
- **D3. Today's "See all" links change** (`TodayController`): proofs, prices, ending, deposits and
  sessions open `?waiting=<group key>`; "Waiting on clients" opens `?waiting=on_client`; requests
  still open the Inbox. The page then shows the same rows in the same order, its count is the count
  on the link, and the first five rows are the five Today showed. `TodayMore` becomes
  `{ route, waiting }` (the `status` field goes: nothing uses it any more). Rejected: `?status=needs_you`
  for all five (the group's rows would be mixed with every other group's) and keeping
  `reviewing` / `deposit_pending` (supersets: a deposit-pending chip also holds the clients' side).
- **D4. Open views are ordered in memory, closed views stay in SQL.** Open views (Active, one open
  status) read the sort keys of every project in the view with one new query
  (`ProjectService.listKeys`: id, status, created_at, last_contacted_at, `scopeTo`), order them
  (`ordered`: `work().needsYou` first, then `work().onClient`, each in `work()`'s order, then the
  rest oldest first; or `byContact`), cut the page of 25, and load that page's full rows with
  `findManyFor` (one query). Waiting views cut their page from `work()`'s ids the same way. Closed
  views keep `ProjectService.list` (one SQL page). The query count per view is fixed (Section 6).
  Accepted cost: every open project's id and dates are read per request; TAT-107 already reads
  every open project twice per page for the badge, at a pilot's scale of a few dozen.
- **D5. One line per row.** The server sends `line` (what waits, from `work()`; else, for owners,
  one money fact from `listFlags`: a deposit screenshot waiting on a project `work()` does not hold,
  the deposit outcome to record, the price that ended, the balance still due; else null) and,
  separately, `nextSessionText`. The phone card shows `line`, or "Next session …" when there is no
  line; the desktop table shows them in two columns. Money facts never get the needs-you dot and
  never change the order or a count (U2). `noSession`, `proofWaiting`, `depositToSettle`,
  `quoteLapsed`, `balanceOwed` and the four outline badges leave the row props and the page: the
  line says each of them in words. Artists get no money fact (unchanged: today's tests pin that the
  list's flags are owners'), no artist name (it is always them) and no studio-wide numbers.
- **D6. The piece is the start of the brief.** `piece = excerpt(project.brief, ALERT_EXCERPT_LENGTH)`
  on the server (grapheme-safe, as Today's request rows), until TAT-115 adds a short title; then
  `piece` becomes `title ?? excerpt(brief)` and nothing else changes. The page never clamps it.
- **D7. No thumbnail in this ticket, and no initials.** The only stored size is up to 2048 px and
  is served `no-store` with a 5-minute signature (Fact 9): 25 rows would download up to 25
  full-size photos on every visit, which ui.md forbids. Initials would repeat the name next to them,
  and slicing a Devanagari name is fragile. **Hook for TAT-112:** once `ImageService` keeps a 320 px
  variant, add `InquiryService.firstImages(tenant, projectIds)` (one query, the lowest `position`
  live image per project), sign the variant's URL in `ProjectsController.index` after the
  member-scoped page read (that read is the access check), add `thumbnail: { url, width, height } | null`
  to `ProjectRow`, and draw it as a 56 px square at the start of the card (40 px in the table's
  first column) with `loading="lazy"`, `decoding="async"`, `width`/`height` set and `alt=""` (the
  name is beside it). Recommended default; the user may prefer initials (U1).
- **D8. Last contact stays as a second sort, not on the cards.** The table has a "Last contact"
  column and sorts by it; the phone has a small two-option switch. "Never contacted" never
  appears: an empty cell is a dash (screen readers hear "None"), and only the contact sort's cards
  say "No contact yet" in their meta line (it is then the sort key). Rejected: no sort at all
  (the ticket asks for a sortable table) and more sort keys (next session, name: not asked for).
- **D9. Table semantics.** shadcn `Table`; the sorted column's `th` carries `aria-sort`
  (`descending` on "Waiting" for "what needs you first", `ascending` on "Last contact" for
  "oldest contact first"), the other sortable `th` carries none; each sortable header holds one
  Inertia `Link` (a real link: sorting is a visit, Enter works, focus stays on it); an `sr-only`
  `TableCaption` says the order. The client's name is the row's link (no clickable `tr`).
  Cards below `lg`, table from `lg`, both in the DOM with `lg:hidden` / `hidden lg:block`.
- **D10. In a waiting view the parent chip is marked current** ("Needs you", or "Active" for
  `on_client`) with `aria-current="true"` (not `page`), and a header above the rows names the
  group, its count and a link back ("Show all that needs you" / "Show all active projects"). The
  chip row's scroll effect looks for `[aria-current]`.

## 5. Design

### 5.1 Phone (375 x 812, below `lg`)

Top to bottom inside `Page title="Projects"` (actions: "Book session", unchanged). Wrap the
controls in one `div className="flex flex-col gap-3"` so `Page`'s `gap-8` sits only between the
controls, the rows and the pager.

1. **Chips:** Active, Needs you (a marigold dot before the word, `aria-hidden`), the seven open
   statuses, Closed; counts as today. Same scroll row and classes as today.
2. **Waiting header** (only with `waiting`): an `h2` (`text-base font-semibold`, `wrap-anywhere`)
   "Payment screenshots to check" + the count (`text-muted-foreground tabular-nums`), and on the
   right (wrapping under it when narrow) a `link`-variant `Link` "Show all that needs you" (or
   "Show all active projects" for `on_client`), `px-0`, 44 px below `lg` from the button rule.
   Titles: `GROUP_TITLES` from `~/components/today` for the five groups (imported in the page,
   not in the plain module), "Waiting on clients" for `on_client`.
3. **Sort switch** (only when `sort` is not null; `lg:hidden`): `nav aria-label="Sort projects"`,
   text-sm: "Sort:" then "What needs you" and "Last contact". The current one is a `span` with
   `aria-current="true"` and `font-semibold`; the other is a `Link` (`preserveScroll`) with
   `-my-3 flex min-h-11 items-center text-primary underline-offset-4 hover:underline`.
4. **Cards:** `ul className="flex flex-col divide-y rounded-md border bg-card lg:hidden"`; each `li`
   one `Link` to the project page plus `#hash` when the line has one
   (`flex min-h-11 flex-col gap-1 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50`):
   - row 1: client name (`font-medium wrap-anywhere leading-normal`, "Unknown client" without one)
     and `StatusBadge` (`shrink-0`), `flex items-start justify-between gap-3`;
   - row 2: the piece (`text-sm text-muted-foreground wrap-anywhere leading-normal`);
   - row 3 (when `cardLine` gives one): the line (`text-sm wrap-anywhere leading-normal`), with a
     `size-2 rounded-full bg-marigold` dot (`aria-hidden`, `mt-1.5 shrink-0`) and an `sr-only`
     "Needs you: " when `needsYou`;
   - row 4 (when `cardMeta` gives one): `text-sm text-muted-foreground wrap-anywhere`. Owners:
     "With Asha" or "No artist yet"; in the contact sort, joined with " · ", the contact
     ("Contacted 2 days ago on WhatsApp (Quote)") or "No contact yet". Artists: only the contact
     part, only in the contact sort.
   No chevron (the status badge sits at the right). A card is at least 44 px; with a piece and a
   line it is about 100 px, so the first screen holds the chips, the switch and four cards.
5. **Pager:** as today, but its links keep `status`, `waiting` and `sort` (`listHref`).

### 5.2 Desktop (1280 x 800, from `lg`)

Same chips (wrapping), waiting header, no sort switch; then `div className="hidden lg:block"`
holding the shadcn `Table` inside `rounded-md border bg-card`:

| Column | Header | Cell |
|---|---|---|
| 1 | "Client and piece" | name as the row's `Link` (`font-medium wrap-anywhere`, focus ring as above) over the piece (`text-sm text-muted-foreground wrap-anywhere`) |
| 2 | "Status" | `StatusBadge` |
| 3 | "Waiting" (sortable) | dot + `sr-only` "Needs you: " + line text, or a dash |
| 4 | "Next session" | `nextSessionText` ("Sat 24 Oct, 11:00"), or a dash |
| 5 | "Artist" (owners only) | name, or "No artist yet" in muted text |
| 6 | "Last contact" (sortable) | `contactedText`, or a dash |

- shadcn's `TableCell` and `TableHead` are `whitespace-nowrap`: give columns 1, 3 and 6 and their
  heads `whitespace-normal`, every cell `align-top`, so a 66-character Devanagari name or a long
  line wraps instead of widening the table (the container scrolls sideways only as a last resort,
  and the acceptance check says it must not at 1280).
- A dash is `<span aria-hidden="true">–</span><span className="sr-only">None</span>`.
- Sortable header: `TableHead aria-sort={…}` holding
  `Link href={listHref(base, { status: filter, waiting, sort: key })} preserveScroll` with
  `buttonVariants({ variant: "ghost", size: "sm" })` and `-ml-3`, the word, then `ArrowDown`
  (the sorted one) or `ArrowUpDown` (the other) from lucide, `aria-hidden`. In waiting and closed
  views (`sort` null) the headers are plain text.
- `TableCaption className="sr-only"`: `tableCaption(...)` (Section 5.4).
- Row hover is shadcn's `hover:bg-muted/50`; the row has no click handler.

### 5.3 States

- **Loading:** an Inertia visit, as today; chip, sort and pager links use `preserveScroll`.
- **Empty** (`emptyListText`, plain `p className="text-sm text-muted-foreground"`, shown in place
  of both the cards and the table):
  - Active, owner: "No projects yet. Accept a request in the Inbox or book a session, and it shows up here."
  - Active, artist: "No projects for you yet. They show up here when the studio gives you one."
  - Needs you, owner: "Nothing needs you right now. A project shows up here when it needs a price, a deposit link or a session."
  - Needs you, artist: "Nothing needs you right now. Your projects show up here when they need a price or a session."
  - A waiting view: "Nothing left here." (the header's link goes back).
  - One status: "No projects here right now."
  - Closed: "No closed projects yet."
  - A page past the last (`page.current > page.last`): "There's nothing on this page." and a
    `Link` "Back to the first page" (bare-link padding) instead of the view's own sentence.
- **Error:** none of its own (a 404 or 500 is the app's).

### 5.4 Words (plain English, the design doc's voice)

- Lines from `WaitingService` are its own words, unchanged. Owner money facts (server,
  `listLine`): "A deposit screenshot is waiting", "Record whether the deposit was kept or refunded",
  "The price has ended", "NPR 15,000 still due" (`formatMoney`). Card fallback: "Next session Sat
  24 Oct, 11:00". Next session format: `ccc d LLL, HH:mm` in the studio's timezone, en-GB, with the
  year (`ccc d LLL yyyy, HH:mm`) when it is not the studio's current year.
- Captions: needs "Your projects, what needs you first"; contact "Your projects, the longest
  since last contact first"; a waiting view "{title}, the longest wait first" (Needs you: "What
  needs you, the longest wait first"); closed views "Closed projects, the latest change first".

### 5.5 Server or client

Server: which rows, their order, the page, every word of a row (piece, line, next session,
contact), counts. Client: layout, the card's fallback to the next session, the meta join, link
building, empty sentences and captions (all in `inertia/components/project_list.ts`, unit-tested).

### 5.6 Look

Tokens only (`bg-card`, `text-muted-foreground`, `bg-marigold` for dots, `text-primary` for the
switch link); no hex, no palette colour, no custom CSS class. Light and dark come from the tokens.
Status colours only through `StatusBadge`.

## 6. Data and contract

No migration, no openapi/SDK/types change, no new route.

New reads (each one query, tenant-scoped):
- `ProjectService.listKeys(tenant, member, filter: "active" | ProjectStatus)`:
  `TattooProject.query().select("id", "status", "created_at", "last_contacted_at")`, `scopeTo`,
  `whereIn("status", ACTIVE_STATUSES)` for "active" else `where("status", filter)`, ordered
  `created_at asc, id asc`. Doc comment: the Projects list's open views (TAT-109), unpaginated
  because the list orders them by what waits; the page's full rows come from `findManyFor`.
- `SessionService.nextScheduledFor(tenant, projectIds, now = DateTime.now())`:
  `Map<projectId, ProjectSession>`: `status = 'scheduled'`, `ends_at > now`, any kind, ordered
  `starts_at asc, id asc`, the first per project kept in code; no query for `[]`. Callers pass only
  projects the member may open.
- `PaymentService.listFlags` gains `balanceDue: bigint | null` on `ListFlags` (the owed paisa when
  `balanceOwed`, else null; computed where `balanceOwed` is, no new query).

Props of `projects/index` (types in `inertia/components/projects.ts`):

```ts
export type ProjectRow = {
	id: string;
	clientName: string | null;
	/** The start of the brief (TAT-115 will make it the piece title). */
	piece: string;
	/** Owners only; null for artists and for a project without an artist. */
	artistName: string | null;
	status: string;
	/** What waits (WaitingService), else an owner's money fact; null when neither. */
	line: { text: string; needsYou: boolean; hash: string | null } | null;
	/** "Sat 24 Oct, 11:00": the next scheduled session that has not ended; null when none. */
	nextSessionText: string | null;
	/** "Contacted 2 days ago on WhatsApp (Quote)"; null when there was no contact. */
	contactedText: string | null;
};

export type ProjectListProps = {
	/** The current chip: "active", "needs_you", "closed" or one status. */
	filter: string;
	/** A Today group key or "on_client"; null for a plain chip view. */
	waiting: string | null;
	/** The chosen sort; null where the view has its own order (waiting and closed views). */
	sort: "needs" | "contact" | null;
	counts: {
		active: number;
		/** WaitingService.work().needsYou.length: the Today badge's number. */
		needsYou: number;
		closed: number;
		byStatus: Record<string, number>;
	};
	projects: ProjectRow[];
	page: { current: number; last: number; total: number };
};
```

Queries per request, fixed whatever the number of rows (plus the middleware's shared counts):
`work()` (its own fixed set) + `listKeys` (open views only) + `findManyFor` (open and waiting
views) or `list` (closed views) + `countByStatus` + `ClientService.findMany` +
`ArtistService.list` (owners) + `listFlags` (owners, at most three) + `nextScheduledFor`; an
artist's `scopeTo` adds one `ArtistService.list` per scoped read. Task 3 pins "the same for one
and three of each" per view and role.

## 7. Tasks

Run every command from `apps/platform` with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`,
`DB_DATABASE=tattoo_drip_ux` and `PORT=3402`, wrapped in `timeout -s KILL 600`. End each commit
with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (already in the messages below).

### Task 1. The list's pure rules

**Goal:** one module decides a view from the query string, the order, the page and a row's line.

**Failing test first:** `tests/unit/modules/projects/project_list.spec.ts` (fails: the module does
not exist). Build `work`-shaped fixtures by hand: `{ needsYou: [{ project: { id }, waiting: {
side: "studio", reason } , text, hash }], onClient: [...] }` with reasons from the public
`NeedsYouReason` union (`proof_to_check`, `price_to_send`, `quote_ending`, `no_session`) and
`DateTime` keys. Assert:
- `toListView({})` is `{ filter: "active", waiting: null, sort: "needs", page: 1 }`; `status`
  `closed`, `quoted`, `needs_you` pass; `bogus` and `["closed"]` give `active`; `waiting: "proofs"`
  gives `needs_you` + `proofs` even with `status: "closed"`; `waiting: "on_client"` gives `active`;
  `waiting` `requests`, `bogus` or an array give null; `sort` `contact` passes, `bogus` gives
  `needs`; `page` `abc`, `0`, `-3` give 1, `2` gives 2.
- `isClosedFilter`: true for `closed`, `completed`, `declined`, `cancelled`; false for `active`,
  `needs_you`, `quoted`, `healing_check`.
- `waitingIds`: Needs you gives every `needsYou` id in order; `ending` only the `quote_ending`
  ones, in order; `on_client` the `onClient` ids.
- `ordered(keys, "needs", work)`: the `needsYou` ids first in `work`'s order, then `onClient`'s,
  then the rest oldest first (feed the keys in a shuffled order); `"contact"`: never contacted
  first, then the oldest contact, ties by creation.
- `pageOf`: 27 ids give 25, 2 and 0 rows on pages 1, 2 and 3, `lastPage` 2; `[]` gives `lastPage` 1.
- `inOrder(ids, rows)`: rows in the ids' order, a missing id dropped.
- `listLine`: a studio item gives `needsYou: true` with its text and hash; a client item
  `needsYou: false`; without an item the flags in order (screenshot, outcome, lapsed price,
  balance), `balanceDue: 1_500_000n` reading "NPR 15,000 still due"; nothing gives null.
- `contactLine(null, …)` is null; a contact two days ago on WhatsApp reads
  "Contacted 2 days ago on WhatsApp" (with `now` fixed).

**Implementation:** `app/modules/projects/project_list.ts` (Biome-format it):

```ts
import type { DateTime } from "luxon";
import type { ContactVia } from "#modules/notifications/messages";
import { lastContactText } from "#modules/projects/contact";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { CLOSED_STATUSES, type ProjectFilter, toProjectFilter } from "#modules/projects/moves";
import { formatMoney } from "#modules/projects/quotes";
import {
	groupOf,
	type NeedsYouReason,
	TODAY_GROUP_ORDER,
	type TodayGroupKey,
	type Waiting,
} from "#modules/projects/waiting";

/**
 * The Projects list (TAT-109): which projects a view holds, their order, a page, and the one line
 * a row says. Pure. Whether a project needs the member, its order among those that do and its
 * words are WaitingService.work's answer only (Today's and its badge's), so the two never disagree.
 */

/** How an open view is sorted: what needs you first (the default), or the longest since contact. */
export const LIST_SORTS = ["needs", "contact"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

type StudioGroup = Exclude<TodayGroupKey, "requests">;
/** A Today group on its own (where Today's "See all" goes), or the projects waiting on clients. */
export type WaitingView = StudioGroup | "on_client";
export const WAITING_VIEWS: readonly WaitingView[] = [
	...TODAY_GROUP_ORDER.filter((key): key is StudioGroup => key !== "requests"),
	"on_client",
];

/** The chip a view sits under: a ProjectFilter, or everything that needs the member. */
export type ListFilter = ProjectFilter | "needs_you";

export type ListView = {
	filter: ListFilter;
	/** A Today group or the clients' side; null for a plain chip view. */
	waiting: WaitingView | null;
	sort: ListSort;
	page: number;
};

/** A view from the query string, every value checked against a fixed list; anything else is the default. */
export function toListView(query: Record<string, unknown>): ListView {
	const waiting = WAITING_VIEWS.find((key) => key === query.waiting) ?? null;
	let filter: ListFilter;
	if (waiting === "on_client") filter = "active";
	else if (waiting !== null || query.status === "needs_you") filter = "needs_you";
	else filter = toProjectFilter(query.status);
	return {
		filter,
		waiting,
		sort: LIST_SORTS.find((key) => key === query.sort) ?? "needs",
		page: Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1),
	};
}

/** Closed views come from the database a page at a time, the latest change first. */
export function isClosedFilter(filter: ListFilter): filter is "closed" | ProjectStatus {
	return filter === "closed" || CLOSED_STATUSES.some((status) => status === filter);
}

/** What the list reads of WaitingService.work's answer (its items carry more). */
export type WorkIds = {
	needsYou: readonly { project: { id: string }; waiting: { reason: NeedsYouReason } }[];
	onClient: readonly { project: { id: string } }[];
};

/** The ids of Needs you, of one Today group or of the clients' side, in work's order. */
export function waitingIds(
	view: Pick<ListView, "waiting">,
	work: WorkIds,
): string[] {
	if (view.waiting === "on_client") return work.onClient.map(({ project }) => project.id);
	const group = view.waiting;
	return work.needsYou
		.filter(({ waiting }) => group === null || groupOf(waiting.reason) === group)
		.map(({ project }) => project.id);
}

/** What the order reads of a project. */
export type ListKey = { id: string; createdAt: DateTime; lastContactedAt: DateTime | null };

const oldestFirst = (a: ListKey, b: ListKey) =>
	a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id);

/** The longest since contact first: never contacted, then the oldest contact; ties oldest first. */
export function byContact(a: ListKey, b: ListKey): number {
	const at = (key: ListKey) => key.lastContactedAt?.toMillis() ?? -1;
	return at(a) - at(b) || oldestFirst(a, b);
}

/**
 * An open view in order. "needs": work's needsYou first, then its onClient, each in work's own
 * order, then the projects nothing waits on, oldest first. "contact": byContact.
 */
export function ordered<K extends ListKey>(keys: readonly K[], sort: ListSort, work: WorkIds): K[] {
	if (sort === "contact") return [...keys].sort(byContact);
	const position = new Map(
		[...work.needsYou, ...work.onClient].map(({ project }, index) => [project.id, index]),
	);
	const rest = Number.MAX_SAFE_INTEGER;
	return [...keys].sort(
		(a, b) => (position.get(a.id) ?? rest) - (position.get(b.id) ?? rest) || oldestFirst(a, b),
	);
}

/** One page, `perPage` long; a page past the end is empty. */
export function pageOf<T>(rows: readonly T[], page: number, perPage: number) {
	return {
		rows: rows.slice((page - 1) * perPage, page * perPage),
		total: rows.length,
		lastPage: Math.max(1, Math.ceil(rows.length / perPage)),
	};
}

/** `rows` in the order of `ids`; an id without a row (gone meanwhile) is left out. */
export function inOrder<R extends { id: string }>(ids: readonly string[], rows: readonly R[]): R[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	return ids.flatMap((id) => byId.get(id) ?? []);
}

/** A row's one line, and the card on the project page it opens. */
export type ListLine = { text: string; needsYou: boolean; hash: string | null };

/** An owner's money facts on a row (PaymentService.listFlags). */
export type RowFlags = {
	proofWaiting: boolean;
	depositToSettle: boolean;
	quoteLapsed: boolean;
	balanceDue: bigint | null;
};

/**
 * What a row says: what waits on it (work's item: the only thing that marks a row as needing the
 * member), else an owner's money fact (never marked, so the order and the counts stay Today's),
 * else null (a card then shows the next session).
 */
export function listLine(
	item: { waiting: Waiting; text: string; hash: string | null } | null,
	flags: RowFlags | null,
): ListLine | null {
	if (item) {
		return { text: item.text, needsYou: item.waiting.side === "studio", hash: item.hash };
	}
	if (!flags) return null;
	if (flags.proofWaiting) {
		return { text: "A deposit screenshot is waiting", needsYou: false, hash: "payments" };
	}
	if (flags.depositToSettle) {
		return {
			text: "Record whether the deposit was kept or refunded",
			needsYou: false,
			hash: "payments",
		};
	}
	if (flags.quoteLapsed) return { text: "The price has ended", needsYou: false, hash: "quote" };
	if (flags.balanceDue !== null) {
		return { text: `${formatMoney(flags.balanceDue)} still due`, needsYou: false, hash: "payments" };
	}
	return null;
}

/** The last contact for the table, "Contacted 2 days ago on WhatsApp"; null when there was none. */
export function contactLine(
	at: DateTime | null,
	timezone: string,
	via: ContactVia,
	now: DateTime,
): string | null {
	if (!at) return null;
	const text = lastContactText(at, timezone, via, now);
	return text.charAt(0).toUpperCase() + text.slice(1);
}
```

If `ContactVia` is not exported under that path, import it where `contact.ts` does.

**Run:** `timeout -s KILL 600 node ace test unit --files=project_list.spec.ts`

**Commit:**
```
feat(platform): the Projects list's views, order and line as pure rules (TAT-109)

toListView reads status, waiting, sort and page against fixed lists. ordered sorts a view
from WaitingService.work's own answer, so Needs you on Projects is Today's, row for row.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 2. Three reads: sort keys, next sessions, the balance still due

**Goal:** the list can order every open project and say the next session and the amount owed,
each in one query.

**Failing tests first:**
- `tests/functional/projects/list_reads.spec.ts` (new; fails: the methods do not exist):
  - "listKeys gives every open project the member may see, oldest first": an owner gets the
    tenant's active projects (not a cancelled one), with `id`, `status`, `createdAt`,
    `lastContactedAt`; `"quoted"` only quoted ones; an artist linked to a profile only theirs; an
    artist without a profile none; from studio B's context (`inTenant(b, …)` with studio A as the
    tenant) none (testing.md, "the limit of that table").
  - "nextScheduledFor gives each project its first scheduled session that has not ended, in one
    query": project 1 with scheduled sessions in 3 and 10 days gets the 3-day one; project 2 with a
    scheduled session that ended yesterday and one in 5 days gets the 5-day one; project 3 with
    only cancelled, completed or no-show sessions gets none; a touch-up counts; `[]` runs no query;
    `recordQueries` shows one `from "project_sessions"` statement for three projects; studio B's
    context sees nothing. Use `DateTime.now().plus(...)` times (the default `makeSession` time is a
    fixed date) and distinct artists or times so sessions don't overlap.
- `tests/unit/modules/scheduling/times.spec.ts`: `sessionStartText` gives "Sat 24 Oct, 11:00" for
  05:15 UTC on 24 Oct 2026 in Asia/Kathmandu with `now` in 2026, and "Sat 2 Jan 2027, 11:00" for
  2 Jan 2027 with `now` on 22 Oct 2026; the year follows the studio's day (a `now` of 31 Dec 2026
  20:00 UTC is already 2027 in Kathmandu, so 24 Oct 2026 shows its year).
- `tests/functional/payments/payment_reads.spec.ts:146-187`: add `balanceDue: null` to each
  `deepEqual` (they fail once the field exists: that is the red step for the field).
  `tests/functional/projects/project_finish.spec.ts:436-472`: also assert
  `all.map(({ id }) => flags.get(id)?.balanceDue)` is `[due, due, null, null, null]` where `due`
  is what the fixture leaves owed on the fixed NPR 15,000 quote (read `workDone` for payments it
  records; with none it is `1_500_000n`).

**Implementation:** `ProjectService.listKeys` and `SessionService.nextScheduledFor` as in Section 6
(doc comments say TAT-109 and who may be passed); `sessionStartText(startsAt, timezone, now =
DateTime.now())` in `times.ts` next to `sessionTimeText` (en-GB, `ccc d LLL, HH:mm`, the year when
`startsAt` in the zone is not `now`'s year in the zone); in `listFlags` compute
`const due = … owed(balanceOf(quote, own).due)` where `balanceOwed` is computed now, set
`balanceOwed = due > 0n` and `balanceDue = due > 0n ? due : null`, and document the field on
`ListFlags`. `payment_flag_queries.spec.ts` must still pass unchanged (no new query).

**Run:** `timeout -s KILL 600 pnpm test functional --files=list_reads.spec.ts`, then
`--files=payment_reads.spec.ts`, `--files=project_finish.spec.ts`,
`--files=payment_flag_queries.spec.ts`, and `node ace test unit --files=times.spec.ts`.

**Commit:**
```
feat(platform): next sessions and the balance still due for the Projects list (TAT-109)

ProjectService.listKeys gives every open project's sort keys, SessionService.nextScheduledFor
the first scheduled session of many projects, each in one query; listFlags gives the amount due.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 3. The list's props: what waits, Needs you, the order, the page

**Goal:** `ProjectsController.index` serves the props of Section 6 from `work()` and the new reads.

**Fixtures first (no behaviour change):** move `studio()` and `seedGroups()` (and whatever they
need, such as `SITA_THAPA`) out of `tests/functional/shell/today_page.spec.ts` into
`tests/helpers/waiting_fixtures.ts`, unchanged (take the version on the branch after TAT-107's fix
round), export them, import them back in `today_page.spec.ts`, and run that spec green before
going on (include the move in this task's commit).

**Failing tests first:** rewrite `tests/functional/projects/projects_list.spec.ts` (it fails today:
the props are not there). Compare with `work()` itself: in a test, `const waiting = () =>
app.container.make(WaitingService)` and `inTenantAs(tenant, user, () => waiting().work(tenant,
member, now))` (see `waiting_service.spec.ts:26` for the pattern), never a hard-coded waiting
sentence. Tests:
1. "an owner sees the open projects with their piece, line, next session and counts" (replaces
   the first test): the same seed as today plus a long brief; rows carry `piece` (the excerpt),
   `artistName` "Sita", `contactedText` "Contacted 2 days ago" for Sita's and null for a project
   never contacted; the booked project without a session has `line.needsYou` true and
   `line.hash` "sessions"; the booked one with a session (give it `DateTime.now().plus({ days: 5 })`
   times, not `makeSession`'s fixed date) has `line` null and a `nextSessionText`; no row has `noSession`, `proofWaiting`, `depositToSettle`, `quoteLapsed`,
   `balanceOwed` or a "never contacted" anywhere (`JSON.stringify(props.projects)`); counts as
   today plus `counts.needsYou === props.todayCount`.
2. "filters, waiting views and sorts come from fixed lists" (extends the second test): its four
   cases still hold; `?status=needs_you` gives `filter` "needs_you"; `?waiting=proofs&status=closed`
   gives `filter` "needs_you", `waiting` "proofs"; `?waiting=requests` and `?waiting=bogus` give
   `waiting` null and `filter` "active"; `?sort=bogus` gives `sort` "needs"; `?status=closed&sort=contact`
   and `?status=needs_you&sort=contact` give `sort` null.
3. "an artist sees only their own projects" (keeps the third test): plus every artist row has
   `artistName` null.
4. "the open views put what needs you first, in Today's order": with `seedGroups(…, 1)` plus a
   booked project with a session (nothing waits) and an in-progress one, the Active view's ids are
   `work().needsYou` ids (those in open statuses), then `work().onClient` ids, then the two others;
   each waiting row's `line` equals `{ text, needsYou: side === "studio", hash }` of its `work()`
   item.
5. "Needs you holds exactly the projects Today counts": `?status=needs_you` ids equal
   `work().needsYou` ids in order; `page.total === counts.needsYou === props.todayCount`;
   for each studio group key, `?waiting=<key>` ids equal the `work().needsYou` ids whose
   `groupOf(reason)` is that key; `?waiting=on_client` ids equal `work().onClient` ids.
6. "the contact sort puts the longest since contact first": three active projects contacted
   never, 9 and 2 days ago, created in another order, come back never, 9, 2; `sort` "contact".
7. "pages of 25 in every open view": 27 reviewing projects give 25 rows on page 1, 2 on page 2,
   none on page 3, `page.last` 2, no id on two pages; the same in `?status=needs_you`.
8. "no view ever shows another studio's projects": two studios (`studioWithOwner` twice, distinct
   slugs) seeded with `seedGroups`; for A's owner and each of `""`, `?status=needs_you`, each
   `?waiting=` value, `?status=closed`, `?status=reviewing`, `?sort=contact`, the props'
   JSON holds none of B's project ids or client names, and a control holds A's.
9. "an artist's views hold only their own projects and no owner facts": an artist linked to a
   profile, with a deposit-pending project assigned to them that has a submitted screenshot and a
   finished fixed-price project that still owes; in every view of test 8 the rows are only their
   projects, `?waiting=proofs` is empty, and the JSON holds no "screenshot" (except what
   `work()` itself gives this artist, compare with it), no "still due" and no other artist's name.
10. "every view costs the same queries for one and three of each": with `recordQueries` around
    the request, for the owner (`""`, `?status=needs_you`, `?waiting=deposits`, `?status=closed`)
    and the linked artist (`""`), the count with `seedGroups(…, 1)` equals the count after adding
    two more copies.

Update the list tests elsewhere to the new props, keeping what they prove:
- `project_payments_card.spec.ts:90-156`: the owner's waiting project has `line.needsYou` true and
  `line.hash` "payments"; the lapsed project's `line.text` is "The price has ended"; the closed one's
  is "Record whether the deposit was kept or refunded"; the artist's row for the waiting project
  has no money fact (its `line` is null or equal to what `work()` gives the artist).
- `project_finish_http.spec.ts:439-473`: the owner's closed owing row reads "NPR 15,000 still due"
  (or the fixture's amount, via `formatMoney`), the healing-check row that owes nothing has no
  money line, and the artist's closed row's `line` is null.

**Implementation** (`ProjectsController.index`; inject `WaitingService` with the
`biome-ignore lint/style/useImportType` comment like the other dependencies):
1. `view = toListView(ctx.request.qs())`, `now = DateTime.now()`, `isOwner`.
2. `work = await this.waiting.work(tenant, membership, now)`.
3. Page rows: if `isClosedFilter(view.filter)`, `ProjectService.list(tenant, membership,
   view.filter, view.page)`; else ids are `waitingIds(view, work)` when `view.waiting !== null ||
   view.filter === "needs_you"` (narrow with that explicit check), otherwise
   `ordered(await this.projects.listKeys(tenant, membership, view.filter), view.sort, work)` ids;
   `pageOf(ids, view.page, PROJECTS_PER_PAGE)`; rows `inOrder(slice.rows, await
   this.projects.findManyFor(tenant, membership, slice.rows))`.
4. Then `countByStatus`, `clients.findMany` (page rows), `artists.list` (owners only),
   `payments.listFlags` (owners only), `sessions.nextScheduledFor` (page ids, `now`), and
   `waitingOn = new Map([...work.needsYou, ...work.onClient].map((item) => [item.project.id, item]))`.
5. Each row: `piece: excerpt(project.brief, ALERT_EXCERPT_LENGTH)`; `artistName` for owners;
   `line: listLine(waitingOn.get(id) ?? null, isOwner && flags.has(id) ? { proofWaiting,
   depositToSettle, quoteLapsed, balanceDue } : null)`; `nextSessionText` via `sessionStartText`;
   `contactedText: contactLine(project.lastContactedAt, timezone, { channel, kind }, now)`.
6. Props: `filter`, `waiting`, `sort` (null for closed and waiting views), `counts` with
   `needsYou: work.needsYou.length`, `projects`, `page: { current: view.page, last, total }`.
   Drop the `projectsWithScheduledTattoo` call and the `lastContactText` use from `index` (the
   `show` action keeps its own). Update `ProjectRow` / `ProjectListProps` in
   `inertia/components/projects.ts` now so `pnpm typecheck` passes with the old page (remove the
   page's uses of the gone fields minimally; Task 6 redraws it).

**Run:** `timeout -s KILL 600 pnpm test functional --files=projects_list.spec.ts`, then
`--files=project_payments_card.spec.ts`, `--files=project_finish_http.spec.ts`,
`--files=today_page.spec.ts`, `--files=role_access.spec.ts`, `--files=cross_tenant.spec.ts`;
`pnpm typecheck`.

**Commit:**
```
feat(platform): the Projects list says what waits and puts what needs you first (TAT-109)

Rows carry the piece, one line from WaitingService (or an owner's money fact), the next
session and the last contact. Needs you is a view; pages of 25 come from a fixed set of reads.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 4. Today's "See all" opens just that group

**Goal:** each "See all" on Today lands on the same rows in the same order (D3).

**Failing tests first:**
- `today_page.spec.ts`: the "more than five rows" test (`:298-347`) expects `prices.more` to be
  `{ route: "tenant.projects.index", waiting: "prices" }` and `requests.more`
  `{ route: "tenant.inbox.index", waiting: null }`; update the `Group` type's `more` (`:62`). Add
  "See all opens the same rows on Projects": `seedGroups(…, 6)` for the owner; for every group with
  `more` on Today (proofs, prices, ending, deposits, sessions) and for `waiting.more`, `more` is
  `{ route: "tenant.projects.index", waiting: <key or "on_client"> }`, and
  `GET /t/<slug>/projects?waiting=<key>` has `page.total` equal to the group's `count` (or
  `waiting.count`) and its first five ids equal Today's rows' ids for that group.
- `tests/unit/inertia/today_copy.spec.ts`: the `More` type and the two `moreText` inputs use
  `waiting` instead of `status` (the texts are unchanged).

**Implementation:** `TodayController`: `More = { route: …; waiting: WaitingView | null } | null`
(import the type from `#modules/projects/project_list`); `SEE_ALL` gives proofs, prices, ending,
deposits and sessions `{ route: "tenant.projects.index", waiting: <its key> }` and requests
`{ route: "tenant.inbox.index", waiting: null }`; `waiting.more` is `{ route:
"tenant.projects.index", waiting: "on_client" }`; update the comment above `SEE_ALL` ("…and the
list's view that holds exactly the group"). Dashboard: `TodayMore = { route; waiting: string |
null }` in `components/today.ts`; `moreHref` in `pages/today/index.tsx` appends
`?waiting=${more.waiting}` when set. Then `node ace codegen` once (keep whatever it writes) and
`pnpm typecheck`.

**Run:** `timeout -s KILL 600 pnpm test functional --files=today_page.spec.ts`,
`node ace test unit --files=today_copy.spec.ts`, `pnpm typecheck`.

**Commit:**
```
feat(platform): the See all links on Today open just that group on Projects (TAT-109)

Each project group's link and Waiting on clients' carry ?waiting=<group>, so the list shows
the same rows in the same order and the count on the page is the count on the link.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 5. The shadcn table

**Goal:** `inertia/components/ui/table.tsx` exists, from shadcn (no new dependency).

From `apps/platform`: `pnpm dlx shadcn@latest add table`. Change its `cn` import from
`~/lib/utils` to `import { cn } from "cn";` (as every other component; the alias does not exist).
If the CLI cannot reach the registry, write the new-york `table.tsx` by hand (the eight exports
`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`,
`TableCaption`, each with its `data-slot`, `Table` inside a `relative w-full overflow-x-auto`
container) and say so in the report. Check `package.json` did not change. Run the focused Biome
check from the root on that file (`pnpm exec biome check apps/platform/inertia/components/ui/table.tsx`)
and `pnpm typecheck`.

**Commit:**
```
chore(platform): add the shadcn table component (TAT-109)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 6. Cards on phones, a sortable table on desktop

**Goal:** the page of Section 5.

**Failing test first:** `tests/unit/inertia/project_list_copy.spec.ts` (fails: the module does not
exist; load it like `today_copy.spec.ts` does, `.js` specifier and the `@ts-expect-error TS6305`
line, with a local type restating its shape). Assert:
- `listHref("/t/x/projects", { status: "active" })` is `/t/x/projects?status=active`; with
  `waiting: "proofs"` only `?waiting=proofs` (no status); `sort: "contact"` adds `sort=contact`,
  `sort: "needs"` and `sort: null` add nothing; `page: 2` adds `page=2`, page 1 nothing.
- `cardLine`: a row with a line gives it; without one, "Next session Sat 24 Oct, 11:00" from
  `nextSessionText`, `needsYou` false; neither gives null.
- `cardMeta`: owner "With Asha" / "No artist yet"; in the contact sort " · Contacted …" or
  " · No contact yet" appended; artist null outside the contact sort.
- `emptyListText` gives each sentence of Section 5.3 for its view and role, and the past-the-end
  sentence; `tableCaption` each caption of Section 5.4 (it takes the title for waiting views).

**Implementation:**
- `inertia/components/project_list.ts`: plain (types from `~/components/projects` with `import
  type` only; no value import through `~/`): `listHref`, `cardLine`, `cardMeta`, `emptyListText`,
  `tableCaption`, `ON_CLIENT_TITLE = "Waiting on clients"`, `SORT_LABELS = { needs: "What needs you",
  contact: "Last contact" }`.
- `inertia/pages/projects/index.tsx`: Section 5. Chips: insert `{ value: "needs_you", label:
  "Needs you", count: counts.needsYou }` after Active, with the dot; a chip is current when its value
  is `filter`, with `aria-current` `"page"` in a plain view and `"true"` in a waiting view (D10); the
  layout effect queries `[aria-current]`. Chip hrefs: `listHref(base, { status: chip.value, sort })`
  (the closed chip may carry it; the server ignores it there). Sort links reset the page; the pager
  keeps everything. Use `isOwner = tenant.role === "owner"` for the Artist column and the meta.
  Remove the `Badge` import and `PROOF_WAITING_STATUS` use if nothing else needs them (leave the
  constant in `projects.ts`: `status_groups.spec.ts` pins the screenshot status).

**Run:** `node ace test unit --files=project_list_copy.spec.ts`, `--files=tap_targets.spec.ts`,
`--files=status_groups.spec.ts`; `pnpm typecheck`; root `pnpm check`.

**Commit:**
```
feat(platform): the Projects list as cards on phones and a sortable table on desktop (TAT-109)

Cards show the client, the piece, the status and one line; from lg a table sorts by what
needs you or by last contact, with aria-sort on the sorted column. Never contacted is gone.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 7. Docs

See Section 8. **Commit:**
```
docs(platform): describe the Projects list's views, sort and table (TAT-109)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task 8. Browser pass and fixes

Seed a studio in `tattoo_drip_ux` (owner, a linked artist, `seedGroups`-like data with at least six
of one Today group, a booked project with a session, a finished project that owes, 27 or more open
projects for paging, a 66-character Devanagari client name and a long Devanagari brief), start the
dev server on 3401, run the checklist of Section 9, fix what it finds test-first where it is
behaviour, commit each fix as `fix(platform): <what> on the Projects list (TAT-109)` (check with
commitlint), update the docs if a fix changes what they say, stop the server and drop nothing else.

## 8. Docs to update

- `apps/platform/docs/ui.md`: a new bullet "Projects list (TAT-109)" after the Today bullet:
  `inertia/pages/projects/index.tsx`; the server decides the rows, their order and their words
  (`ProjectsController.index`, `#modules/projects/project_list`), the page lays them out with
  `components/project_list.ts`; chips Active, Needs you (its count is the Today badge's), the open
  statuses, Closed; `?waiting=<group>` views (Today's "See all") under the parent chip with a
  header and a way back; cards below `lg` (name, piece, `StatusBadge`, one line with the marigold
  dot and an `sr-only` "Needs you:" when it needs you, the next session otherwise, owners' artist),
  a shadcn table from `lg` (columns, `aria-sort` on the sorted column, the header links, the dashes,
  `whitespace-normal` on the text columns: shadcn cells are `nowrap`); "Never contacted" is not
  shown; no thumbnail until TAT-112 (the hook of D7). In the Today bullet, say "See all" opens that
  group on Projects (`?waiting=`), not a status.
- `apps/platform/docs/backend.md`: in "Projects and quotes (TAT-64)", replace the list sentence
  ("`list` / `countByStatus` for the projects list … from `ClientService.findMany`, `ArtistService.list`
  and `SessionService.projectsWithScheduledTattoo`") with the TAT-109 reads: closed views through
  `list` (SQL pages), open views through `listKeys` ordered in memory by `ordered` and loaded with
  `findManyFor`, waiting views from `WaitingService.work`, the parameters and their allow-lists,
  the fixed query set. In "What waits, and Today (TAT-107)", replace "TAT-109's list passes its page
  of rows and reuses `waitingText`" with what the list really uses (`work()` only, so the list,
  Today and the badge share one answer) and the new `SEE_ALL` targets. In the TAT-66 payments
  bullet, add `balanceDue` to `listFlags`. In Scheduling, add `nextScheduledFor`.

## 9. Acceptance and browser checks

Measurable (tests):
- `counts.needsYou === todayCount` and the Needs you view's `page.total` equals it (Task 3, test 5).
- Every Today "See all" view has the group's count and its first five rows (Task 4).
- Query counts equal for one and three of each seed, per view and role (Task 3, test 10).
- No other studio's ids or names in any view; an artist sees only their projects and no money fact
  (Task 3, tests 8 and 9; `cross_tenant.spec.ts` and `role_access.spec.ts` still pass).
- No "never contacted" in any row prop (Task 3, test 1).

Browser (Chromium, 375 x 812 touch and 1280 x 800, light and dark, owner and artist, with the long
Devanagari name on screen):
1. 375: chips one row, Needs you chip with its dot and the Today badge's number; every card, chip,
   sort link, "Show all…" link and pager link measures at least 44 px tall; `scrollWidth` 375 on
   `/projects`, `?status=needs_you`, `?waiting=<key>`, `?status=closed`; the long name and brief
   wrap, nothing is cut or ellipsised; first screen holds the chips, the switch and at least three
   cards above the tab bar.
2. 375: a card with a needs-you line shows the dot; a card with nothing waiting and a session shows
   "Next session …"; no card says "Never contacted"; in "Last contact" sort the meta says the contact
   or "No contact yet".
3. Tap a card with `#payments` / `#quote` / `#sessions`: the project page lands on that card (its
   top clears the top bar).
4. From Today, each "See all": the list shows the group header with the same count, the parent chip
   current, the same first five rows in the same order; "Show all that needs you" returns.
5. 1280: the table, no horizontal scroll in the table container or the page with the long name; the
   Artist column only for owners; dashes for empty cells.
6. Keyboard at 1280: Tab reaches the "Last contact" header link, Enter sorts, focus stays on that
   link, `aria-sort="ascending"` moves to its `th` and "Waiting" loses it; Enter on "Waiting" brings
   `descending` back; the client links show the focus ring in light and dark.
7. A screen reader query (accessibility tree): the caption names the order; a needs-you line reads
   "Needs you: …"; a dash reads "None".
8. Network: `/projects` makes no request to `/files/` or `/uploads/` and no third-party request.
9. Contrast (computed, both themes): row text and line text 7:1 or better, muted text (piece,
   meta) 4.5:1 or better on `bg-card`.
10. Artist (linked): three tabs, the list shows only their projects, no Artist column, no money
    lines, `?waiting=proofs` shows the empty sentence.

## 10. Final gates

From the worktree root: `pnpm check`, `pnpm typecheck`, `pnpm build`. Then empty `queue_jobs` in
`tattoo_drip_ux` and run the full platform suite once through the flock (see Header). The
storefront is untouched (no storefront tests needed). `git status` clean.

## 11. Review focus (Fable and Codex)

- **Role and tenant scoping of every view:** every row comes from `work(tenant, member)`,
  `listKeys`, `findManyFor` or `list` (all `scopeTo`); no parameter reaches a query unchecked
  (`toListView`); an artist gets no money fact, no artist names, no screenshots beyond what `work()`
  gives them; `findManyFor` is the access check before any per-row read.
- **One definition:** nothing outside `WaitingService.work` marks a row as needing you, orders it
  among those that do, or counts it; the money facts never change the order or a count.
- **Query count:** no per-row query (`nextScheduledFor`, `listFlags`, `findMany` all batch); the
  extra cost of `listKeys` and the second `work()` per request.
- **Information exposure:** props carry only what the screen shows (no brief beyond the excerpt,
  no facts, no token, no image URL).
- **Accessibility:** `aria-sort` on one `th` at a time, header links keyboard-operable with focus
  kept, the caption, the dot never the only carrier of meaning (`sr-only` text), 44 px below `lg`,
  no truncation of names.

## 12. Risks and rollback

- **TAT-107 changes under this branch.** Mitigated by depending only on `work()` and the Today
  grouping names and by tests that compare with `work()`. If the fast-forward brings a conflict in
  `today_page.spec.ts` (Task 3's fixture move) or `project_service.ts`, keep TAT-107's version and
  re-apply this plan's small edit.
- **Scale.** Open views read every open project's keys and `work()` runs twice per request (badge
  and list). Fine at a pilot's few dozen; if a studio passes a few hundred open projects, the
  fallback is to memoize `work()` per request and to move the needs rank into a stored column: a
  later ticket, noted in backend.md.
- **shadcn table `nowrap`.** Long Devanagari names would widen the table; Section 5.2's
  `whitespace-normal` and the browser check cover it.
- **Rollback:** revert this branch's commits; no migration or contract to undo. Today's "See all"
  then goes back to the unfiltered list (the TAT-107 behaviour).

## 13. Decisions only the user can make (defaults let the builder proceed)

- **U1. Thumbnail.** Default: no photo and no initials until TAT-112 ships a small size (D7's hook).
  Alternative: a one-letter initials tile now (reworked when photos come).
- **U2. Money facts as "needs you".** Default: "NPR 15,000 still due", "The price has ended" and
  "Record whether the deposit was kept or refunded" show as plain lines, without the dot, and don't
  count on Today, the badge or Needs you (Today's definition stays TAT-107's). Alternative: add them
  to `WaitingService`'s rules in a follow-up so Today, the badge and the list all count them.
- **U3. Default view.** Default: Projects opens on Active, with what needs you first. Alternative:
  open on Needs you (an empty studio would then open on an empty view).
