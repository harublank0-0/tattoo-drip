# Artist calendar: day and week (TAT-50)

Date: 2026-10-17
Refs: TAT-50 (Artist calendar of sessions, day and week). Builds on TAT-36 (`ProjectSession`, its `active` column and the no-overlap constraint, `SessionService`), TAT-46 (projects list, `ProjectService.findFor` visibility), TAT-41 (`ClientService.findMany`), TAT-67 (the shell's `navItems`) and TAT-43 (direct booking, see "Depends on TAT-43"). Availability and slots are V1 (TAT-35, TAT-40, TAT-45); roles are TAT-30; linking an artist's account to a profile is TAT-33.

## Goal

An artist opens their phone and sees today's sessions, or the week: when, who, what. An owner sees the same for the whole studio or for one artist. Tapping a session opens its project. Read-only.

No migration; no API, SDK or OpenAPI change. Written without the user (unattended run): every open question is a ruling below.

## Depends on TAT-43

This branch starts at TAT-43's finished tip (3bc345b, after its review fixes). Used from it: `SESSION_KIND_LABELS` and `SESSION_STATUS_LABELS` (`inertia/components/projects.ts`); the booking page `GET /t/:tenant/projects/new` (`tenant.projects.create`, `BookingsController.create`, `inertia/pages/projects/new.tsx`, `inertia/components/bookings.ts`, `lastBookableDay` in `#modules/projects/quotes`) for ruling 14; its isolation cases and docs, which this ticket's edits sit next to. Only the "Book session" action and the docs touch TAT-43's files, so they come last in the plan; if TAT-43 changes again before this is built, rebase first and re-read those files.

## Rulings

1. **One page, the URL is the state.** `GET /t/:tenant/calendar?view=day|week&date=yyyy-MM-dd&artist=<id>`. Defaults: the day view of today in the studio's timezone. An unknown `view` is the day view and a `date` that isn't a real yyyy-MM-dd is today, without an error (like the projects list's `?status=`). Why: links, Back and a refresh show the same thing; no client state to lose. Rejected: a route per view; React state for the date.
2. **The day view is an agenda list, not an hour grid.** Sessions in time order, each a row with its times in a left column. Why: at 375px an hour grid spends most of the screen on empty hours for a day of two to five sessions, and the studio-wide view would need one column per artist; a list is a plain `<ul>`, reads well with a screen reader and is easy to tap. Rejected: an hour grid.
3. **The week view is seven stacked day sections, at every width.** Sunday to Saturday, each day a heading and its agenda list (or "No sessions."). Why: seven columns at 375px are 53px each, too narrow for a name; one layout for all widths is one thing to build and check. Rejected: a seven-column grid (also as a desktop-only variant: two layouts); horizontal swiping between days (hidden content, no keyboard affordance).
4. **Weeks start on Sunday.** Why: the launch market's week (Nepal's working week starts on Sunday and its calendars put Sunday first). A per-studio setting can come with the first studio outside Nepal. Rejected: ISO Monday; a setting now (a migration and a settings field for one pilot).
5. **Days are the studio's local days, and a session shows on every day it overlaps.** A day runs from local midnight to the next local midnight in `tenant.timezone` (Luxon), so it is 23 or 25 hours long on a clock-change day. A session crossing midnight is listed on both days; a time on the other day carries its weekday ("22:30" to "Tue 01:30" on Monday, "Mon 22:30" to "01:30" on Tuesday). Ranges are half-open like the constraint: a session ending at 00:00 is only on the day it starts. Rejected: listing a session only on its start day (the next morning would look free while the artist is still working).
6. **Only active sessions.** The TAT-36 carry-forward: `where active`, so scheduled and completed sessions show, cancelled and no-show ones don't (the project page still lists them). A completed session carries a "Completed" badge; scheduled is the normal state and has none. Rejected: cancelled sessions struck through (clutter, and they look booked at a glance).
7. **Who sees which calendar.** Owners see the whole studio by default (every artist's sessions, the artist named on each row) and one artist with `?artist=`. An artist member sees only the sessions of the live artist profile linked to their account, with no picker; without a linked profile (until TAT-33 links accounts) they get an explanation, not an error. An `artist` that isn't a live artist of this studio (unknown, deleted, another studio's, malformed) is a 404 for an owner; for an artist member anything but their own profile's id is a 404. The id is compared with the studio's artist list in memory, so a malformed id never reaches the database. Rejected: ignoring `artist` for artists (a link would silently show a different calendar than it names); owners defaulting to their own profile.
8. **A row shows what the project page shows, for the session's artist.** Start and end, the client's name ("Unknown client" if the client row is gone; an anonymized client keeps its stored name, as on the project page), the kind, the brief's first line (at most 100 characters), the artist (studio-wide view) and Completed. The row links to the project page. A calendar belongs to the session's artist, not the project's: when an owner reassigns a project (TAT-46), its sessions keep their artist. Such a session on an artist's calendar shows its times and kind with "Not assigned to you", no client, no brief, no link, because the project page would 404 for them. Who may open which project is `ProjectService.findManyFor` (the `findFor` rule), not a second copy of it. For an owner the same no-details row can only mean the project was deleted (nothing deletes projects yet; TAT-42's cascade will delete its sessions) and reads "Project not available". Rejected: hiding such sessions (the artist's time is taken; the calendar would lie); showing the client to an artist who can't open the project.
9. **No migration: the range read uses the no-overlap constraint's own index.** `SessionService.listInRange` filters `active` and `tstzrange(starts_at, ends_at) && tstzrange(from, to)`, which is the expression of `project_sessions_artist_no_overlap`, a gist index on `(artist_id, tstzrange(starts_at, ends_at)) WHERE active`, so one artist's day or week is an index search. The studio-wide read adds only the tenant filter (RLS and `tenant_id`) and is served by that gist or `(tenant_id, starts_at)`; at pilot sizes (a few thousand sessions per studio per year) it is small either way. Rejected: `starts_at < to and ends_at > from` on the `(tenant_id, artist_id, starts_at)` btree (bounded only above, so it reads the artist's whole history before the window); a new `(tenant_id, tstzrange)` gist index (no evidence it is needed); capping session length to bound a btree scan (changes TAT-36's rules).
10. **One read per module, so no N+1.** A new `CalendarService` (scheduling module) loads the artists (`ArtistService.list`), the sessions (`listInRange`), the projects (`ProjectService.findManyFor`) and their clients (`ClientService.findMany`): four or five queries whatever the number of sessions. The controller only shapes props. Rejected: a query per session; the controller assembling it (business rules in a controller).
11. **Controls: Day/Week, Previous/Today/Next, and an artist picker for owners. No date picker.** All are links or a GET form, so they work without JavaScript and with the keyboard. The picker is a native select with a "Show" button (no submit on change: WCAG 3.2.2). A far date is reachable by Next or the URL. Rejected: a date input (another row of controls on a 375px screen for something Next covers); a select that navigates on change.
12. **A Now marker on today.** On the studio's today (the day view, or today's section of the week), a "Now 13:05" rule sits before the first session that hasn't started yet. The browser places it from the session instants and moves it every minute; the time is formatted in the studio's timezone. Rejected: placing it on the server (stale while the page stays open); a coloured line without text.
13. **A Calendar tab after Projects** (the TAT-67 carry-forward): owners get Inbox, Projects, Calendar, Clients, Settings; artists get Projects, Calendar, which turns their bottom tab bar on. Icon: lucide `CalendarDays`. `/t/:tenant` still lands owners on the Inbox and artists on Projects. Rejected: landing artists on the calendar (changes TAT-67's ruling; easy to do later).
14. **"Book session" opens TAT-43's booking page on the day shown.** The page header has "Book session" for owners and for artists with a linked profile, linking to `/t/:tenant/projects/new?date=<date>`. The booking page gains `?date=`: a day from today to a year ahead becomes the Date field's default and survives the phone lookup and "Change number"; any other value falls back to today. Rejected: a "Book" link per day in the week view (clutter); prefilling the artist too (more changes to TAT-43's page; an owner picks the artist in one tap).
15. **Read-only, and the TAT-43 carry-forward stays open.** No editing, completing, no-show, cancelling, moving, drag and drop or free slots here. The MVP requirement "Mark a session completed, no-show or cancelled, or move it to another time" has no ticket yet; the user should file one (the project page's Sessions card is the natural place). Rejected: adding those actions here (each write needs its own service rules and tests; 3 points).
16. **No paging.** A day or a week bounds the list. The "25 per page" rule in `docs/ui.md` is for open-ended lists; it gains that exception. Rejected: paging a busy day.

## Routes and access

| Route | Name | Does |
|---|---|---|
| `GET /t/:tenant/calendar` | `tenant.calendar.index` | The calendar; `?view=`, `?date=`, `?artist=` |

A new `/calendar` group: auth, dbContext, tenant, `role({ allow: ["owner", "artist"] })`; `tenant_routes.spec.ts` gets the area in its role-guard list. One isolation case (owner, 200, no snapshot: it writes nothing). The cross-tenant artist id gets its own HTTP test (the isolation harness only swaps the slug and `:id` path segments, not query strings).

## Services

### `SessionService.listInRange` (scheduling)

`listInRange(tenant, { from, to, artistId })`: the tenant's active sessions with `tstzrange(starts_at, ends_at) && tstzrange(from, to)`, for one artist or (`artistId` null) all, ordered by `starts_at`, then `id`.

### `ProjectService.findManyFor` (projects)

`findManyFor(tenant, member, ids)`: the live projects among `ids` that `member` may open, through the private `scopeTo` that `findFor` and `list` use; `[]` for no ids without a query.

### `CalendarService` (`#modules/scheduling/services/calendar_service`)

`load(tenant, member, { artistId, from, to })` returns `{ scope, artists, entries }`:

- `scope`: `{ kind: "studio" }`, `{ kind: "artist", artist }` or `{ kind: "unlinked" }` (ruling 7; E_ROW_NOT_FOUND for a refused `artistId`).
- `artists`: owners get the studio's live artists by name (the picker); artist members get none.
- `entries`: `{ session, artistName, project }` per session in range, in order; `artistName` null for a deleted profile; `project` is `{ id, brief, clientName }` when the member may open it, else null.

It depends on `ArtistService`, `SessionService`, `ProjectService` and `ClientService`. No class depends on itself through another module (`ProjectService` uses `SessionService`; nothing uses `CalendarService`).

### Helpers (`#modules/scheduling/calendar`)

Pure and unit-tested: `toCalendarView`, `toCalendarDate(value, today)`, `calendarDays(view, date)` (the day, or Sunday to Saturday), `shiftDate(view, date, steps)`, `dayBounds(day, timezone)` (local midnight to local midnight, as instants), `overlapsDay`, `timesOnDay` ("14:00", or "Mon 01:30" for a time on another day), `dayLabel` ("Sun 1 Nov"), `rangeText` ("Mon 2 Nov 2026", "1–7 Nov 2026", "29 Nov – 5 Dec 2026", "27 Dec 2026 – 2 Jan 2027") and `briefPreview`. Calendar dates are computed as plain dates (UTC zone), so date arithmetic never meets a clock change; only `dayBounds` uses the studio's zone.

## Screen: Calendar

`inertia/pages/calendar/index.tsx` in `AppLayout`, one column (`max-w-3xl`), from the existing `Page`, `Badge`, `Button`/`buttonVariants`, `Field`/`FieldLabel` and Inertia `Link`. Prop types and `nowIndex` live in `inertia/components/calendar.ts` (no imports, so a unit test can load it, like `nav_items.ts`).

**Props:** `view`, `date`, `today` (yyyy-MM-dd, the studio's), `timezone`, `rangeText`, `previous` / `next` (the dates one step away), `scope` (`"studio" | "artist" | "unlinked"`), `artistFilter` (owners: `{ selected, artists: { id, name }[] }`; artists: null), `canBook` (ruling 14, added last), `days: { date, label, sessions }[]`. A session: `id`, `startsAt` / `endsAt` (epoch milliseconds, for the Now marker), `startText` / `endText`, `kind`, `status`, `artistName`, `project: { id, clientName, brief } | null`.

**Visual direction.** The theme is the stock zinc tokens (`docs/ui.md`), so the character comes from layout: the appointment book. The one strong element is the time column: start time in semibold tabular figures, end time muted below it, a fixed `w-18` gutter so every row's text starts on the same line. Everything else stays quiet: no icons on rows, no colour coding, no middle-dot meta strings; the kind reads as words ("Tattoo with Sita", the project page's phrasing).

**Layout at 375px, top to bottom:**

```
Calendar                      [Book session]
Your sessions                  (artists only)
[ Day | Week ]          [<] [Today] [>]
Artist [All artists       v] [Show]   (owners)
Mon 2 Nov 2026  (Today)                (h2)
+---------------------------------------+
| 09:00  Bikash             [Completed] |
| 09:30  Consultation with Ram          |
|        Koi fish                       |
|--- Now 13:05 -------------------------|
| 15:45  Maya Gurung                    |
| 17:45  Tattoo with Sita               |
|        A small fine-line moth on the… |
+---------------------------------------+
```

- **Header:** `Page` title "Calendar"; description "Your sessions" for artist members; action "Book session" (default button) when `canBook`.
- **Toolbar** (`<nav aria-label="Calendar">`, wraps on narrow screens): a segmented Day/Week pair of links (`aria-current="page"` and semibold on the current one, not only a fill), then Previous, Today, Next as outline links, 44px tall. Previous and Next are chevron icons with `aria-label` "Previous day" / "Next day" ("week" in the week view). Every link keeps the other parameters (`view`, `date`, and `artist` for an owner who chose one).
- **Artist picker** (owners): a GET form to the page with hidden `view` and `date`, a labelled native select ("Artist": "All artists", then each live artist), and an outline "Show" button. With no artists at all, a line instead: "Every session belongs to an artist. Add an artist to start booking." with "Add an artist" linking to `tenant.artists.create`.
- **Range heading** (`h2`, `aria-live="polite"`, so Previous and Next announce the new range): `rangeText`, plus a "Today" badge in the day view of today. After an Inertia visit, focus stays on the link that was pressed, so Next can be pressed again.
- **Agenda** (day view: one list; week view: per day a `<section aria-labelledby>` with an `h3` "Sun 1 Nov" and a "Today" badge on today, then its list). A day without sessions says "No sessions." in muted text. Lists are `<ul>` with dividers in a bordered card.
- **A row** is a link to the project page (`min-h-11`, hover tint, a visible focus ring) holding the time column (start, a visually hidden "to", end) and the body: client name (medium weight, one line, truncated) with a "Completed" outline badge at the right; "{Kind}" or, in the studio-wide view, "{Kind} with {Artist}" ("Unknown artist" for a deleted profile); the brief preview (muted, one line). A row without project details is not a link and reads "Not assigned to you" (artists) or "Project not available" (owners) in muted text, then the kind.
- **Now marker:** a list item "Now 13:05" in small semibold text followed by a 1px rule in the foreground colour, before the first session whose start is after now (at the end if all have started); only on today's list, never on an empty day.
- **Unlinked artist:** the page shows only the header and "Your calendar shows the sessions booked with your artist profile, and your account isn't linked to one yet."

Keyboard: everything is a native link, select or button in reading order. Dark mode follows the tokens.

## Tests

- **Unit:** the helpers (both views; Sunday-to-Saturday weeks from a Sunday, a Wednesday, a Saturday and across a year; New York's 25-hour 1 November 2026 and 23-hour 8 March 2026; Kathmandu's +05:45; a session across midnight on both days, one ending at midnight on one day only; range texts; fallbacks for `view` and `date`; the brief preview); `nowIndex`; `navItems` with Calendar (owners five items, artists two, the artists' tab bar now shows).
- **Functional, services:** `listInRange` (overlap at both edges, touching sessions left out, cancelled, no-show and deleted left out, completed kept, the artist filter, order, and from another tenant's context nothing of this tenant's); `findManyFor` (owner, assigned artist, unlinked artist, deleted, another tenant's ids); `CalendarService.load` (each scope and each refused `artistId`, entries with and without project details, a deleted artist's name).
- **Functional, HTTP:** the default props for an owner; a day's rows exactly; the week with a session past midnight on two days; inactive sessions left out and Completed kept; fallbacks; one artist; another studio's, a deleted and a malformed artist id are 404 while this studio's artist opens; an artist's own calendar with a no-details row and a 404 for another artist's id; an unlinked artist's explanation; `canBook` per member; the booking page's `?date=` (in range, past, too far, malformed, kept through the lookup).
- **Isolation:** the route's case in `cases.ts`; the role guard's area list.
- **Not automated:** how it looks (browser pass).

## Browser pass (in the PR)

At 375px and 1280px, light and dark: an owner's day and week (studio-wide and one artist), Previous / Today / Next and the view toggle keeping the artist, a session past midnight on both days, the Now marker on today, a completed session, an empty week, "Book session" opening the booking form on the shown day; as an artist with a linked profile (if one can be set up): the Calendar tab and the tab bar, own sessions only; as an artist without one: the explanation. Keyboard only through the toolbar, the picker and the rows; a screen reader announcing the range after Next. Book sessions through TAT-43's page first: the dev seeder makes none.

## Docs

- `apps/platform/docs/backend.md`: Scheduling gains `listInRange` and a Calendar bullet (`CalendarService`, who sees what, local days, Sunday weeks, the read-only page); Projects gains `findManyFor`.
- `apps/platform/docs/ui.md`: range views are bounded by their range instead of paged.
- `docs/requirements.md`: under Sessions, how the calendar behaves.
- `docs/README.md`: no new document, so unchanged.

## Carry-forwards

Posted when the PR is ready: TAT-30 (calendar visibility is `CalendarService` plus `ProjectService.findManyFor`; a policy must keep "artists see their own sessions, details only for projects they can open"), TAT-33 (unlinked artists see an explanation; linking makes their calendar work with no other change), TAT-42 (a deleted project's sessions show as "Project not available" until its cascade deletes them), TAT-35 / TAT-45 (reuse `dayBounds`, `calendarDays` and `listInRange`; weeks start on Sunday), TAT-74 (`listInRange` gives a day's sessions for reminders). For the user: file a ticket for "Mark a session completed, no-show or cancelled, or move it" (ruling 15).

## Not in this ticket

Editing, completing, cancelling or moving sessions; drag and drop; free slots or availability (V1); a month view; a date picker; per-day booking links; prefilling the artist on the booking page; calendar export or sync; a "Today" home screen; any migration, API or SDK change.

## Assumptions the user can overrule at review

Sunday as the first day of the week; the day view as the default; owners starting on the whole studio; the Calendar tab after Projects; "Not assigned to you" and "Project not available"; a 100-character brief preview; no date picker; the Now marker's minute updates.

## Verification

`PORT=3402 node ace test` passes; `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
