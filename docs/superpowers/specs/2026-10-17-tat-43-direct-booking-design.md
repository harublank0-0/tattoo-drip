# Direct booking: walk-in, phone or DM (TAT-43)

Date: 2026-10-17
Refs: TAT-43 (Create a project and session directly). Builds on TAT-37 (`Client`, `TattooProject`, `Quote`; `inquiry_id` is null for a direct project), TAT-36 (`SessionService.schedule` and the no-overlap constraint), TAT-64 (quotes, the project page), TAT-46 (projects list, `assignArtist`), TAT-41 (`ClientService.findByPhone`, the `phoneNumber` rule, the client profile) and TAT-83 (the expiry sweep). The calendar is TAT-50; payments are TAT-65/66; roles are TAT-30.

## Goal

At the desk, on a call or in a chat, a staff member books a client in one step: look the client up by phone (or add them), choose the artist, describe the tattoo, optionally note a price, and pick the session time. The project starts in `booked` with its tattoo session, so the artist's time is blocked and two sessions can never overlap.

No migration; no API, SDK or OpenAPI change. Written without the user (unattended run): every open question is a ruling below.

## Rulings

1. **Look the phone up first, then book.** The page has two steps: a phone field that reloads the page with `?phone=` (a plain GET form, like the clients search), then the booking form for the client it found or for a new one. Why: staff see who a number belongs to before anything is saved, so a mistyped number never silently books someone else. Rejected: one form that matches by phone on submit (a typed name would be silently ignored, and a wrong match goes unnoticed); a live lookup while typing (a JSON endpoint and more client code for the same result).
2. **A returning client is used as they are.** The form posts the client's id (checked with `ClientService.findFor`: another tenant's or a deleted id is a 404); the booking never changes their name, email or notes, and the page says so. Why: TAT-41's rule, only an owner's edit changes a client. Rejected: updating the client from the booking form.
3. **A new client needs a phone and a name.** Email is optional, notes are not asked. The phone is the one from the lookup (E.164 through the `phoneNumber` rule). DM-only contacts must give a number too (TAT-37 left this to TAT-43): every live client has a phone (`clients_phone_unless_anonymized`), and it is how they are found again. If someone added that number in the meantime, the booking is refused with a field error naming the client, and the page then shows that client. Rejected: phone-less clients (the database refuses them and nobody could find them again).
4. **Artists use the lookup too, and see only the name.** A match shows the client's name and phone, nothing else; owners also get a "View client" link. Why: artists already see the name and phone on their projects, and the name is what confirms the match. Rejected: hiding the match from artists (they would book blind); owners-only booking (the ticket lets artists book for themselves).
5. **Owners book any live artist; an artist books only their own profile.** Owners choose from the studio's live artists; an artist member books with the live profile linked to their account (shown, not chosen). Any other artist id (another artist's, a deleted one, another studio's) is the field error "Choose an artist from the list." and nothing is saved, as in the inbox's accept. An artist with no linked profile sees an explanation instead of the form. Rejected: a 404 for a bad artist id (a deleted artist is a real race).
6. **No inquiry, no origin column.** The project has `inquiry_id` null and the page has no Request section (already the case). Why: an inquiry is the client's frozen submission, and its `source_channel` says how they found the studio, not how they booked; storing walk-in / phone / DM needs a migration and nothing reads it. Staff can write it in the notes. Rejected: a stand-in inquiry; a new `origin` column.
7. **The project starts `booked`, with its artist set and "contacted" now.** `artist_id` is the session's artist (no `assignArtist` call: the TAT-46 carry-forward's method is owners-only and meant for later changes); `last_contacted_at` is now, because staff just spoke with the client, so the project doesn't sit in the follow-up list as "never contacted". `brief` (required, at most 4,000 characters) is what the tattoo is.
8. **One tattoo session, today or later, in the studio's timezone.** Date from today to a year ahead, start time (24-hour, any minute), length in quarter hours from 0.25 to 12. A time earlier today is allowed (the walk-in is already in the chair); an earlier day is refused, because nothing in the dashboard can complete a session yet and the project would stay `booked` with a past session. The record-as-done path the TAT-36 carry-forward suggests is not built here. The date and time are read in the tenant's timezone (Luxon); a time that doesn't exist on that day (a daylight-saving gap) is a field error, an ambiguous one takes its first occurrence, and the length is elapsed time. Rejected: an end-time field (staff talk in hours, and it can't end before it starts).
9. **An overlap is a field error and nothing is saved.** Client, project, quote and session are written in one `withTransaction`; the session goes through `SessionService.schedule`, whose exclusion constraint settles races. `SessionOverlapError` becomes the field error "{Artist} already has a session at that time. Pick another time." on the start time, after the whole booking rolled back (a new client included). Rejected: checking for overlaps with a query first (racy; the constraint decides, TAT-36).
10. **The quick quote: no price, a fixed price or hourly, never a deposit.** "No price" is the default. Fixed takes a price, hourly a rate and estimated hours, with the quote form's ranges (shared field definitions). The quote is version 1 with `deposit_amount` 0 and `expires_at` at the start of the day after the session day, in the studio's timezone (valid through the session day). Why no deposit: the client is booked now, so no step would ask for one; money taken at the desk is a payment (TAT-66), and the balance due (total minus verified payments) works with a zero deposit. Rejected: a deposit field; an "accepted" flag on the quote (there is no such column; `booked` already says it).
11. **The quote skips `issueQuote` and queues no expiry job.** This overrules the TAT-83 spec's "any new way to issue a quote goes through `ProjectService.issueQuote`". `issueQuote` works only in `reviewing`, `quoted`, `on_hold` and `deposit_pending` and moves the project to `quoted`; a `booked` project never returns to those statuses, and `expireQuote` and the sweep act only on them, so a job could only ever do nothing. The quote is inserted with `QuoteService.create` inside the booking's transaction. Rejected: `issueQuote` followed by a move to `booked` (a pointless job, and a `quoted` → `booked` move that skips the deposit rule).
12. **No price can be added after booking (yet).** From `booked` on, quotes are locked (TAT-64), so a project booked without a price stays without one; the form says "The price can't be changed after booking." Recording the final price at the desk belongs with desk payments and balance due (TAT-66): carry-forward. Rejected: an "add a price" form on booked projects in this ticket.
13. **The project page shows the sessions, and stops showing the quote's expiry once booked.** A read-only Sessions card lists the project's live sessions (time, kind, artist, status). From `booked` on (`booked`, `in_progress`, `completed`, `healing_check`) the quote summary hides "Valid until" and the Expired badge, which no longer mean anything; a project cancelled by expiry still shows them. This also fixes the same wording on projects booked through a quote. Rejected: no sessions on the page (the booked time would vanish with the flash); hiding the expiry in every status.
14. **Where it lives.** `GET /t/:tenant/projects/new` and `POST /t/:tenant/projects`, in the projects route group (owners and artists). A new `BookingService` in the projects module does the work; a new `BookingsController` stays thin. Entry points: "Book session" on the projects list (everyone) and on the client profile (owners; it skips the lookup). No nav item. Rejected: another method on `ProjectService` (581 lines already, and it would gain a `ClientService` dependency for every project page).

The requirement "custom work is never booked until its deposit is verified, unless the quote sets the deposit to zero" holds: a direct booking is the walk-in shortcut of the project rules, and its quote's deposit is zero. A studio that wants a deposit first uses the inquiry flow (intake is TAT-51).

## Routes and access

| Route | Name | Does |
|---|---|---|
| `GET /t/:tenant/projects/new` | `tenant.projects.create` | The page; `?phone=` looks the number up |
| `POST /t/:tenant/projects` | `tenant.projects.store` | Books; redirects to the project page with a flash |

Both go in the existing `/projects` group (auth, dbContext, tenant, `role({ allow: ["owner", "artist"] })`); the route guard test already covers the area. Each gets a case in `tests/isolation/cases.ts`.

## Services

### `ClientService.create` (clients module)

`create(tenant, { name, phone, email })`: a new live client (empty email becomes null, no notes) in its own savepoint; a violation of `clients_tenant_phone_live_unique` becomes `ClientRuleError("phone_taken")` after the savepoint rolled back.

### `BookingService` (`#modules/projects/services/booking_service`)

| Operation | Rule |
|---|---|
| `bookableArtists(tenant, member)` | Owners: the tenant's live artists (by name). Artists: their own linked live profile, or none |
| `book(tenant, member, booking)` | Refuses an artist outside `bookableArtists` (`BookingRuleError("artist_unavailable")`). Then one `withTransaction`: the client (`findFor` for an existing id, a 404 for another tenant's or a deleted one, `BookingRuleError("client_unavailable")` for an anonymized one; `ClientService.create` for a new one), the `booked` project, the quick quote (if any) through `QuoteService.create`, and the tattoo session through `SessionService.schedule`. Returns the project, the session, the client and the artist (`Booking`) |

`booking` is `{ client: { kind: "existing", id } | { kind: "new", name, phone, email }, artistId, brief, startsAt, endsAt, quote: { kind: "fixed", fixedPrice } | { kind: "hourly", hourlyRate, estimatedMinutes } | null }`, in stored units (paisa, minutes, instants). `tenant` carries its `timezone` for the quote's expiry. Errors pass through untouched: `SessionOverlapError`, `ClientRuleError("phone_taken")`, E_ROW_NOT_FOUND.

`BookingRuleError` (`#modules/projects/errors`) has the reasons `artist_unavailable` and `client_unavailable`.

### Helpers

- `#modules/scheduling/times`: `localDateTime(date, time, timezone)` (the instant, or null for an invalid or non-existent local time) and `sessionTimeText(startsAt, endsAt, timezone)`: "Sun 18 Oct 2026, 14:00–17:00", or "Sun 18 Oct 2026, 22:30 – Mon 19 Oct 2026, 01:30" across midnight.
- `#modules/projects/validators/booking`: `bookingValidator` (the shape) and `toBookingInput(form, timezone, now)` (who the client is, the date range, the local time, quarter hours, the price fields of the chosen kind), like `toQuoteInput`. The price fields and their messages move to a shared `priceFields()` / `PRICE_MESSAGES` in `#modules/projects/validators/quote`.
- `#validators/phone` exports `PHONE_MESSAGE` (the rule's message), which the lookup shows for a number it can't read.
- `#modules/projects/quotes` gains `BOOKED_STATUSES` (`booked`, `in_progress`, `completed`, `healing_check`).

## Screen: Book a session

`inertia/pages/projects/new.tsx`, in `AppLayout`, one column (`max-w-2xl`), built from the existing `Page`, `Card`, `Field*`, `Input`, `Textarea`, `RadioGroup`, `Badge` and `Button` components, like the project page's quote form. Title "Book a session"; description "For a walk-in, a call or a message. The project starts as Booked."

Props: `lookup` (below), `artists` (`{ id, name }[]`: the bookable artists), `isOwner`, `dates` (`{ today, max }`, yyyy-MM-dd in the studio's timezone).

`lookup` is one of:

- `null`: no `?phone=` (or an empty one).
- `{ state: "invalid", typed, message }`: the number can't be read; `typed` is what was typed (at most 40 characters), `message` is `PHONE_MESSAGE`.
- `{ state: "found", phone, client: { id, name } }`: a live client of this studio has the number.
- `{ state: "new", phone }`: nobody has it; `phone` is E.164.

Another studio's client is never found (the lookup is tenant-scoped): their number shows as new.

**Empty states (instead of everything below):**

- No bookable artist, owner: "Add an artist before booking a session: every session belongs to one." and an "Add an artist" button (`tenant.artists.create`).
- No bookable artist, artist member: "Only artists with their own profile can book sessions, and your account isn't linked to one yet."

**Step 1, lookup** (`lookup` null or invalid). Card "Client" with a GET form to the page itself:

- "Client's phone": `type="tel"`, `inputMode="tel"`, `name="phone"`, required, prefilled with `typed`; a "Find client" button beside it. No `autoFocus` anywhere on the page (Biome's `a11y/noAutofocus`).
- Below it, the hint "A returning client is found by their number, so their history stays together.", or the error (`FieldError`, linked with `aria-describedby`, `aria-invalid` on the input).

**Step 2, booking** (found or new). One POST form (`tenant.projects.store`) with three cards and the buttons:

1. **Client.** Found: the name (medium weight), the phone below it in muted text, a "Returning client" badge (secondary), the line "Their saved name, email and notes stay as they are.", a hidden `clientId`. New: the phone, a "New client" badge (outline), a hidden `phone`, then "Name" (required, at most 120) and "Email (optional)" (`type="email"`, at most 254). Then "Change number" (outline small button back to step 1) and, for owners with a found client, "View client" (`tenant.clients.show`). A `clientId` or `phone` error shows at the top of the card.
2. **Session.**
   - "Artist": owners get a native select of `artists` (the existing project page style), preselected when there is only one, else starting on a disabled "Choose an artist" option; an artist member sees "{name} (you)" as text with a hidden `artistId`.
   - "Date" (`type="date"`, default today, `min` today, `max` a year ahead), "Start time" (`type="time"`, required), "Length (hours)" (`type="number"`, `inputMode="decimal"`, 0.25 to 12, step 0.25, hint "In quarter hours: 2.5 for two and a half."). One column at 375px, three from `sm`.
   - "What's the tattoo?" (textarea, 3 rows, required, at most 4,000), hint "A few words for the project page, like small rose on the left wrist."
3. **Price (optional).** A radio group (`priceKind`): "No price" ("Book without one.", the default), "Fixed price" ("One price for the whole tattoo."), "Hourly" ("A rate per hour and the hours you expect."). Fixed shows "Price (NPR)"; hourly shows "Rate per hour (NPR)" and "Estimated hours", the quote form's fields and limits. Under it: "No deposit is asked: the client is booked now. The price can't be changed after booking."
4. **Buttons:** "Book session" (disabled, "Saving…" while sending) and "Cancel" (ghost, back to the projects list).

Every field has a visible label tied to its control, `data-invalid` on the `Field`, `aria-invalid` on the control and its `FieldError` linked with `aria-describedby`; the radio group sits in a `FieldSet` with a legend. Everything works with the keyboard (native inputs and select, Radix radios). After a refused POST the page comes back with the same lookup (the referrer keeps `?phone=`), the typed values kept (Inertia preserves the page state) and the errors beside their fields.

**Errors** (field: message):

| When | Field | Message |
|---|---|---|
| New client without a name, or over 120 characters | `name` | Enter the client's name. / Keep the name under 120 characters. |
| A malformed email | `email` | Enter a valid email address. |
| Neither a client nor a phone (a tampered form) | `phone` | Look the client's phone up first. |
| An unreadable phone | `phone` | `PHONE_MESSAGE` |
| Not one of the bookable artists | `artistId` | Choose an artist from the list. |
| No date, not a date, a day before today or more than a year ahead | `date` | Pick a date from today to a year from now. |
| No start time or not HH:mm | `startTime` | Enter the start time, like 14:00. |
| A time that doesn't exist that day | `startTime` | That time doesn't exist on this day because the clocks change. Pick another. |
| No length, or outside 0.25 to 12 | `hours` | Enter a length from 0.25 to 12 hours. |
| Length not in quarter hours | `hours` | Use quarter hours: 0.25, 0.5, 0.75 and so on. |
| The artist is busy | `startTime` | {Artist} already has a session at that time. Pick another time. |
| The number was added meanwhile | `phone` | This number now belongs to {name}. Check the client and book again. |
| No brief / over 4,000 characters | `brief` | Describe the tattoo. / Keep it under 4,000 characters. |
| An unknown price kind | `priceKind` | Choose no price, fixed or hourly. |
| Fixed without a price / hourly without rate or hours | `fixedPrice` / `hourlyRate` / `estimatedHours` | Enter the price. / Enter the hourly rate. / Enter the estimated hours. |
| A price, rate or hours out of range, hours not in quarters | the same fields | The quote form's messages |

An anonymized client (TAT-42; none exist yet) can't be booked: back to step 1 with the flash "This client's details were deleted. Look the number up again."

**Success:** redirect to the project page with the flash "Session booked: {client} with {artist}, {time}." (`sessionTimeText`).

## Changes to existing screens

- **Projects list:** a "Book session" button in the page header (`tenant.projects.create`), for owners and artists.
- **Client profile** (owners): a "Book session" outline button after "Edit details", for a client with a phone, linking to the page with `?phone=` so it opens at step 2. The empty list's text becomes "No clients yet. They appear when an inquiry arrives or you book a session."
- **Project page:** a Sessions card after the status card: each live session, earliest first, as `sessionTimeText` with "{Kind} with {artist}" below it ("Unknown artist" for a deleted profile) and a status badge (Scheduled, Completed, No-show, Cancelled); "No sessions yet." when empty. New props `sessions: { id, whenText, kind, status, artistName }[]` and `quoteExpiryShown` (false from `booked` on), which hides "Valid until" and the Expired badge in the quote summary. Earlier versions keep their dates.

## Tests

- **Unit:** `localDateTime` (a normal time, a daylight-saving gap, an invalid date) and `sessionTimeText` (same day, across midnight); `toBookingInput` (existing and new client, a missing name, no client at all, a past day and a year away, earlier today, a gap time, quarter hours, the three price kinds and their missing fields) and the validator's shape.
- **Functional, services:** `ClientService.create` (saved, empty email null, `phone_taken` with the request still usable, the same phone in another tenant is fine); `BookingService` (a new client with a fixed quote, an existing client unchanged, hourly and no quote, no `ExpireQuoteJob` queued, an overlap saves nothing at all, artists and owners, another tenant's artist and client, an anonymized client, a phone taken meanwhile, `bookableArtists`).
- **Functional, HTTP:** the page's props in each lookup state, for owners and artists, and another studio's client's number shown as new; booking a new and an existing client (redirect, flash, rows); an artist booking themselves and opening the project; each error in the table (field and message, nothing saved); another studio's artist id (field error) and client id (404), with neither studio changed; the project page's `sessions` and `quoteExpiryShown`.
- **Isolation:** both routes in `cases.ts`; the POST case's snapshot holds projects, quotes, sessions and clients.
- **Not automated:** how the page looks (browser pass).

## Browser pass (in the PR)

At 375px and 1280px: "Book session" from the projects list; a returning client's number (badge, unchanged-details line, "View client"), an unknown number (name and email fields), an unreadable number; book with no price, a fixed price and hourly; an overlapping time (error under the start time, values kept); keyboard only through the whole form; the project page's Sessions card and the quote without "Valid until"; "Book session" from a client profile; as an artist with a linked profile, if one can be set up.

## Docs

- `apps/platform/docs/backend.md`: a Bookings bullet in Scheduling (`BookingService`, the rulings that bind other code: no inquiry, zero deposit, no expiry job, the overlap mapping, artists book themselves), `ClientService.create` in the Clients bullet, the scheduling time helpers.
- `docs/requirements.md`: under Sessions, how a direct booking behaves (booked at once, zero deposit, the price can't change after booking).
- `docs/README.md`: no new document, so unchanged.

## Carry-forwards

Posted when the PR is ready: TAT-66 (a project booked without a price needs a way to record the final price at the desk; direct bookings have a zero deposit, so their balance due is the full total), TAT-50 (sessions on the project page exist now with `sessionTimeText`; completing a session, or recording one that already happened, still has no surface), TAT-51 (`ClientService.create` exists; intake must still match with `findByPhone` first), TAT-30 (booking checks the artist's own profile in `BookingService.bookableArtists`; a policy must keep "artists book only themselves").

## Not in this ticket

A calendar or availability (TAT-50, V1), consultations or touch-ups booked directly, several sessions at once, recording a past session as done, deposits or payments (TAT-65/66), adding a price after booking, editing the client from the booking form, any migration or API.

## Assumptions the user can overrule at review

The wording of the page, its errors and the flash; "Book session" as the button name; a 12-hour cap on the session length; today as the earliest date; "No price" as the default; the sessions card's place on the project page.

## Verification

`PORT=3402 node ace test` passes; `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
