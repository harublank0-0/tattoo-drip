# TAT-84: slow-connection pass on the existing dashboard pages

## 1. Header

- **Ticket:** TAT-84, "Slow-connection pass on the existing dashboard pages" (Linear, In Progress, MVP · pilot, labels MVP and platform). Written 2026-10-17 as a TAT-67 follow-up; one comment carries the TAT-43 and TAT-50 review carry-forwards (focus after a refused submit, 44 px defaults, the calendar's time column). Both are in scope.
- **Estimate:** **5 points** (seven build tasks with seven commits, a baseline and final gates: two global visit rules, one shared button, two optimistic visits, two excerpts, three one-line fixes, docs, and a throttled browser pass at two widths). The audit (section 3) found more than 5 points of open items; the rest are proposed follow-ups in section 13.
- **Branch:** `harublank00/tat-84-slow-connection-pass-on-the-existing-dashboard-pages`, worktree `/home/blank/Coding/tattoo-drip-wt/tat-84`.
- **Base commit:** `1e65ce6` (main, TAT-95 merged). This plan is the one commit on top.
- **Lane A:** database `tattoo_drip_ux`, platform dev **3401**, tests **3402** (`PORT=3402`), storefront 3404 and stand-in API 3405 (not used: platform-only ticket). `SESSION_DRIVER=memory` for every test run. A FULL platform suite run goes under `flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock …`; the targeted runs below need no lock (none includes `setup_roles.spec.ts` or `role_guard.spec.ts`).
- **Goal in plain words:** a studio owner on a weak phone connection in Nepal never taps into silence. When the connection drops, the dashboard says so, and for a save it says to look before trying again. One-tap project buttons say "Saving…" and send once. "Mark contacted" shows at once, and a notes save keeps going if they tap another tab. After a refused form, the field to fix is focused and in view. The inbox and the client page send only the text they show. Small fixes: the agenda's time column, the clients search's Clear link and the keyboard behaviour on Android.

Shorthand used below: **T** = `cd apps/platform && DB_DATABASE=tattoo_drip_ux PORT=3402 SESSION_DRIVER=memory timeout -s KILL 600 node ace test` (plus the standing env from `run7-brief.md`; Node 24: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`). Commands run from the worktree root unless they start with `cd`. Paths without a prefix are under `apps/platform/`.

## 2. Scope fence

The builder may change:

- Dashboard: `inertia/components/visits.ts` (new), `inertia/app.tsx`, `inertia/components/form_sheet.tsx` (the body of `focusFirstInvalid` only), `inertia/components/change_card.tsx`, `inertia/components/next_step_card.tsx` (the `resume` case only), `inertia/components/messages.ts` (one constant), `inertia/pages/projects/show.tsx` (the Mark contacted call and `NotesForm`), `inertia/components/day_agenda.tsx` (one class list), `inertia/pages/clients/index.tsx` (the Clear link's classes).
- Server: `resources/views/inertia_layout.edge` (the viewport meta), `app/controllers/inquiries_controller.ts` (the Inbox row's `idea`), `app/controllers/clients_controller.ts` (three excerpts), `.adonisjs/**` only if `node ace codegen` changes it (expected: no change).
- Tests: `tests/unit/inertia/visits.spec.ts` (new), `tests/unit/inertia/slow_connection_source.spec.ts` (new), `tests/functional/inquiries/inbox.spec.ts`, `tests/functional/clients/client_payments.spec.ts`, `tests/functional/shell/head.spec.ts`.
- Docs: `apps/platform/docs/ui.md`, `apps/platform/docs/testing.md` (one sentence).

**NOT in this plan:**

- Settings and Artists one-tap writes (delete an artist, move or delete a payment method, the members actions, work photo move and remove, logo and cover remove) and their `window.confirm` boxes: follow-up F1.
- Thumbnails on the Projects list rows (`ui.md:29`'s note for after TAT-112): follow-up F2. It adds bytes; it is not a slow-connection fix.
- A save cancelled by a tap elsewhere for every other form (Inertia interrupts an in-flight sync visit when a new one starts): follow-up F3. Only the notes save is made safe here (D4).
- Hiding the tab bar while a field is focused (D6): follow-up F4, only if a real Android phone shows the bar riding the keyboard.
- Accept staying enabled while Decline is out on the inquiry page (and back): follow-up F5.
- Saying a lost connection inside an open sheet (a modal hides the toast's live region from screen readers): follow-up F6.
- Skeleton screens (audit X-10's second half), a retry button on the toast, prefetching, a `srcset` for thumbnails, the reference images' `private, no-store` cache rule (a privacy decision from TAT-16), lazy loading of the Settings QR codes and of the payment screenshot (one image each, kept sharp on purpose: `app/modules/media/services/image_service.ts:25-40`).
- Any route, migration, `openapi.yaml`, `TENANT_ROUTE_ROLES` entry, isolation case, the storefront, `packages/*`, `docs/requirements.md`.

## 3. Facts verified on this branch (1e65ce6)

### The audit

Every ticket bullet, carry-forward and "Phones and slow connections" rule (`docs/ui.md:58-66`), checked against the code as it is now. Statuses: **done** (by which ticket), **partly**, **open**. Tasks below cover only what is open or partly open.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Ticket: thumbnails for reference images (Inbox, inquiry page, project Request) | **Done, TAT-112** | `inertia/components/references.tsx:17-31` draws `thumbnailUrl` with `loading="lazy"` and `decoding="async"`, the link opens `url` in a new tab; `app/modules/inquiries/reference_view.ts:22-26` signs `images.urlFor(..., THUMBNAIL_WIDTH)` (320, `image_service.ts:45`); the grid is on `inquiries/show.tsx:123`, `projects/show.tsx:308`, `clients/show.tsx:222`; the Inbox row shows a count only (`inquiries/index.tsx:111-112`). Pinned by `tests/functional/inquiries/inbox.spec.ts:214` ("the inquiry page's grid shows the signed 320 px copy"). |
| 2 | Ticket: in-flight state on Decline (inquiry page) | **Done, TAT-108** | `inquiries/show.tsx:239-267` uses `InlineConfirm`; its confirm button is `disabled={state.saving}` and says `busyLabel` (`inline_confirm.tsx:100-107`); `confirmStep` ignores a second confirm while saving (`components/confirm.ts`); pinned by `inline_confirms_source.spec.ts` ("sends its request only from the step that starts it"). Left over: Accept stays enabled while Decline is out (F5). |
| 3 | Ticket: optimistic UI for project notes and "Mark contacted" | **Open** | No `optimistic` anywhere in `inertia/` (`rg -c optimistic inertia` is empty). Notes: `projects/show.tsx:338-371`, a plain sync `<Form>` that says "Saving…" (`:366`). Mark contacted: `message_card.tsx:115-127` calls `onMarkContacted`, which is `() => markContacted()` (`projects/show.tsx:84-88, 164`): no in-flight state and nothing changes until the server answers. Inertia is 3.8.0 (`node_modules/@inertiajs/react/package.json`), which has `optimistic` on visits and on `<Form>` (see "Inertia 3.8" below). |
| 4a | Ticket and rule: list props carry only what each screen shows | **Partly** | Done: the Projects list's `piece` is `excerpt(project.brief, ALERT_EXCERPT_LENGTH)` (`projects_controller.ts:234`), Today's request rows `excerpt(inquiry.idea, …)` (`today_controller.ts:176`) and only `TODAY_ROWS` rows per group (`:119-122`), the calendar `briefPreview` (`app/modules/scheduling/calendar.ts:13, 143-152, 174`). Open: the Inbox sends each row's whole idea (`inquiries_controller.ts:81`) for a `line-clamp-2` preview (`inquiries/index.tsx:107`); the client page sends whole briefs and ideas (`clients_controller.ts:134, 143, 155`) for `line-clamp-1` lines (`clients/show.tsx:119-120, 172-174, 202-203`). An idea or brief can be 4,000 characters (`packages/types/openapi.yaml:931`). |
| 4b | Ticket and rule: forms disable their button and say "Saving…" | **Partly** | Every `<Form>` passes `processing` to its button. Open on the project page: Put on hold and Resume in "Change this project" are plain `router.post` buttons (`change_card.tsx:78-87, 117-125`) and so is the Next step's Resume (`next_step_card.tsx:119-137`): nothing is disabled, and a second tap is refused with `move_not_allowed` (`app/modules/projects/errors.ts:60`) as an error toast; the artist picker's Save is disabled but keeps saying "Save" (`change_card.tsx:167-169`). Settings and Artists one-tap writes have no in-flight state either (`artists/index.tsx:80-90`, `settings/payments.tsx:189-202`, `settings/members.tsx:252-345`, `work_photo_tray.tsx:126-136`, `logo_form.tsx:34-41`, `cover_photo_form.tsx:38`, `shell/account_menu.tsx:92-102`): F1. |
| 5 | Ticket: 44 px on the account avatar and the studio switcher | **Done, TAT-103** | `shell/account_menu.tsx:35-41` uses `size="icon"`, which is `max-lg:size-11` (`ui/button.tsx:30`); `tenant_switcher.tsx:41-44` uses `size="sm"`, which is `max-lg:min-h-11` (`ui/button.tsx:28`); the bell is `size-11` (`shell/alerts_link.tsx:30`); tabs are `min-h-14` (`shell/tab_bar.tsx:19-20`). Pinned by `tests/unit/inertia/tap_targets.spec.ts`. |
| 6 | Ticket (TAT-67 review): hide the fixed tab bar while a field is focused on Android; consider `interactive-widget=resizes-visual` | **Open, decided in D6** | `resources/views/inertia_layout.edge:5` is `width=device-width, initial-scale=1, viewport-fit=cover`; the tab bar is `fixed inset-x-0 bottom-0` (`shell/tab_bar.tsx:35-38`); nothing reacts to focus. Pinned: `tests/functional/shell/head.spec.ts:21` checks `viewport-fit=cover` only. |
| 7 | Carry-forward: focus after a refused submit (repo-wide) | **Partly** | `focusFirstInvalid` (`form_sheet.tsx:99-103`: after a tick, focus the first `[aria-invalid="true"]` in a container) is used three times: the five sheets (`form_sheet.tsx:57`), the session move form (`sessions_card.tsx:312`) and the account page (`account/show.tsx:84`). The other `<Form>`s (about forty: the auth pages, onboarding, new booking, clients edit, artists, every Settings page, the quote and payment cards, notes, the artist picker, Accept) leave focus on the submit button, and the error can be off-screen above it on a phone. A radio group marks its root `div` (`projects/new.tsx:513-516`), which `.focus()` can't take. |
| 8 | Carry-forward: `Button` and `Input` defaults below 44 px | **Done, TAT-103** | `ui/button.tsx:21-34` (every size), `ui/input.tsx:10`, `ui/select.tsx:39, 111`, `ui/dropdown-menu.tsx:74`; `tap_targets.spec.ts`. Left over: the Clients search's "Clear" link is about 20 px tall (`clients/index.tsx:42-44`, `self-center text-sm underline`). |
| 9 | Carry-forward: the calendar's 72 px time column wraps "Mon 22:30" at 375 px | **Open** | `components/day_agenda.tsx:103` is `flex w-18 shrink-0 flex-col tabular-nums`; the start time is `font-semibold` at the body size (16 px); `timesOnDay` writes `ccc HH:mm` for a time on another day (`app/modules/scheduling/calendar.ts:107-117`). "Mon 22:30" in Roboto 16 px semibold is about 75 px. Used by the calendar and Today's sessions. No test pins the class. |
| 10 | Rule: open-ended lists paginated at 25 | **Done** | `INQUIRIES_PER_PAGE` (`inquiry_service.ts:20, 53, 68`), `CLIENTS_PER_PAGE` (`client_service.ts:10, 162`), `PROJECTS_PER_PAGE` (`project_service.ts:86, 202`; the waiting views cut with `pageOf`, `project_list.ts:139-143`), `ALERTS_PER_PAGE` (`alert_service.ts:30, 205`). The calendar lists a day or a week; Today cuts groups to `TODAY_ROWS`; the client page lists one client's history. |
| 11 | Rule: lazy thumbnails in lists and grids | **Done** | `references.tsx:24-25`; artist cards `artists/index.tsx:95-99` (`photoUrl` is the 320 copy, `artists_controller.ts:211-216`); work photos `work_photo_tray.tsx:141-146`. The Settings payment methods' QR images (`settings/payments.tsx:207-212`) are not lazy: one public copy kept sharp on purpose (`image_service.ts:33`), a handful of rows. Accepted. |
| 12 | Rule: optimistic UI only for notes and "Mark contacted" | **Holds** | Nothing is optimistic today (item 3). Task 4 adds exactly those two, and its source spec fails for any other. |
| 13 | Rule: 44 px targets below `lg` | **Done, TAT-103**, one residue | See items 5 and 8. The residue (Clear) is fixed in Task 6; section 9's browser scan reports anything else. |
| 14 | Rule: nothing wider than 375 px | **Done as far as the code shows** | No fixed width over 375 px below `sm` (`message_card.tsx:78` is `sm:w-72`); the Projects table is `lg` only (`projects/index.tsx:270`); the inquiry Details grid is `grid-cols-[auto_minmax(0,1fr)]` with `wrap-anywhere` (`inquiries/show.tsx:132`); every UX ticket since TAT-100 was browser-passed at 375. Re-measured on every page in section 9. |
| 15 | Found: a visit cut off by the network says nothing | **Open** | Inertia 3.8 fires `inertia:networkError` and rejects the visit's promise (`node_modules/@inertiajs/core/dist/index.js:3067-3074`); nothing in the app listens. `OfflineBar` (`components/shell/offline_bar.tsx`) shows only while `navigator.onLine` is false (`hooks/use-online.ts`), which a phone with signal but no data never reports; `FlashToasts` (`components/flash_toasts.tsx:14-31`) shows only the server's flash. So a tap on a dead connection ends with the button back to normal and no word. |
| 16 | Found: a save cancelled by a tap elsewhere | **Open, F3** (notes only here) | Every non-async visit interrupts the in-flight sync visit (`core/dist/index.js:3339-3341`); a POST whose body was not fully sent is lost without a word. |
| 17 | Audit X-10: progress on slow visits | **Done** (the bar) | `inertia/app.tsx:26-28` sets Inertia's progress bar to `var(--primary)` (violet); skeletons are not built (out of scope). |

### Inertia 3.8 (read in `node_modules/@inertiajs/core/dist/index.js`)

- `router.on(type, callback)` registers `inertia:<type>` on `document`; a callback that returns `false` on a cancelable event calls `preventDefault()` (`:1707-1715`, `:3259-3265`).
- Order for a refused `<Form>`: `setPage`, then `fireErrorEvent` (global `error`), then the visit's own `onError` (`:2628-2632`), then `finish` after the response is handled (`.finally(() => this.finish())`, `:3076-3089`; `fireFinishEvent(visit)` carries `visit.method`, `:72-74`). The Form's errors are set in its `onError`, so a focus scheduled at `finish` runs after the same state update that `focusFirstInvalid` waits for today.
- A network failure: `onNetworkError`, then `fireNetworkErrorEvent(error)` (cancelable; if prevented, no promise rejection), then `finish` (`:3067-3077`). A cancelled or interrupted visit fires neither `networkError` nor `finish` (`:3064-3066`, `:3083-3086`).
- `optimistic`: `router.post(url, data, { optimistic: (props) => partialProps })` applies the props at once, makes the visit async (`options.async ?? true`, `:3317-3322`), puts the baseline back when the visit does not succeed (`:3708-3747`), and an async response is not applied when the person has moved to another page (`shouldSetPage`, `:2760-2773`). Sync navigations do not cancel optimistic visits (`:3335-3338`). `<Form optimistic={(props, formData) => …}>` passes the same option (`@inertiajs/react/dist/index.js:1050`); the type is `FormComponentOptimisticCallback` (`core/types/types.d.ts:581, 588`), and the Adonis `Form` wrapper passes every prop through (`@adonisjs/inertia/build/src/client/react/index.js:120-140`).

### The pieces this plan builds on

- `excerpt(text, max)` (`app/modules/notifications/alerts.ts:38-46`): whitespace collapsed, at most `max` graphemes (`Intl.Segmenter`, never half a Devanagari syllable), cut at a word when one ends in the second half, then "…". `ALERT_EXCERPT_LENGTH = 80` (`:29`).
- `lastContactText(at, timezone, via)` (`app/modules/projects/contact.ts:46-56`) is "contacted today" for a contact now with `NO_VIA` (`app/modules/notifications/messages.ts:146`); the project page's `contactedText` and `lastChannel` props come from it (`projects_controller.ts:615-620`), and `markContacted` stores `channel: null` for "Mark contacted" (`project_service.ts:703-718`, `validators/contact.ts:24-29`).
- `focusBack(trigger, fallback)` and `ignoreHeldEnter` (`components/confirm.ts`) are what `InlineConfirm` uses; `ChangeCard` and `NextStepCard` already receive the page heading as `fallback`.
- `MOVE_LABELS` (`components/projects.ts:35-40`): hold "Put on hold", resume "Resume", decline, withdraw. Only decline and withdraw ask first (`change_card.tsx:17-49`).
- Dashboard unit tests (`docs/testing.md`, "Dashboard unit tests"): a tested module imports nothing but React and plain modules and is loaded with a `.js` specifier and a `@ts-expect-error TS6305` line; jsdom is a devDependency (`fold.spec.ts`). Source scans read files with `readFile(new URL("../../../inertia/<file>", import.meta.url))` (`inline_confirms_source.spec.ts:4-5`).
- `inline_confirms_source.spec.ts` scans every `components/*.tsx` for `window.confirm` and `/[^\w.]confirm\(/`: the new code must not call a function named `confirm`.

## 4. Decisions

- **D1. Plan only what is open.** Items 1, 2, 5, 8, 10, 11 and 17 are done; this plan does not touch them. The most valuable open items for an owner on a weak connection come first (15, 3, 4b, 7), then the cheap ones (4a, 9, the Clear link, 6).
- **D2. A lost connection is one toast from one listener** (`watchVisits` in `components/visits.ts`, installed once in `app.tsx`). A page that didn't load: "Couldn't load the page. Check your connection and try again." A save: "The connection dropped before this was confirmed. Open the page again to see whether it saved, then try again if it didn't." It never retries by itself: the server may have recorded a payment before the answer was lost, and a retry would record it twice. The listener cancels Inertia's promise rejection (no console error). *Rejected:* `onNetworkError` on each of about fifty writes (too many places, easy to forget); an automatic retry; a "Retry" button in the toast (same double-write risk, and Sonner's action button is under 44 px).
- **D3. Focus after a refused form is one rule for every form,** in the same module: a capture-phase `submit` listener on `document` remembers the form that was sent; when that visit's answer has field errors (`error`), at its `finish` the first invalid control of that form gets focus after a tick and is scrolled to the middle of the screen (`scrollIntoView({ block: "center" })`, clear of the sticky top bar and the tab bar). A radio group marked on its root gives focus to its checked choice, else its first. `focusFirstInvalid` uses the same two helpers. A refusal without field errors (a flash) leaves focus where it is. *Rejected:* an error summary at the top of each form (new UI in some forty forms; each error already sits under its field and is tied to it); focusing the first `[aria-invalid]` in the whole document (another form's old error could win).
- **D4. Optimistic through Inertia's own `optimistic` option, for the two changes `ui.md:65` allows.** "Mark contacted": `contactedText` becomes "contacted today" and `lastChannel` null at once (exactly what the server answers: Mark contacted records no channel, so the leading chat button becomes WhatsApp as it already does after the answer); Inertia puts both back if the visit fails, and D2's toast says why. Notes: the textarea already shows what was typed, so the visible change is nil; the gain is that the optimistic visit is async, so a tap on another tab while it is out does not cancel the save. The notes button still says "Saving…" while it is out (honest, and the ui.md rule). *Rejected:* hand-written local state and rollback; making the chat links' records optimistic (they open another app, and their words need the channel and message labels).
- **D5. One `MoveButton` for the moves that ask nothing** (Put on hold, Resume; in "Change this project" and in the Next step card): disabled and "Saving…" while the request is out, a ref so a second click in the same frame sends nothing, `ignoreHeldEnter`, and after the answer focus on the button or, when the move removed it, the page heading (`focusBack`, as `InlineConfirm` does). It replaces the two `router.post(moves.store)` copies. *Rejected:* asking first with `InlineConfirm` (a question for a reversible move); one page-wide busy flag (couples unrelated cards).
- **D6. Android keyboard: state the browser default, hide nothing.** Add `interactive-widget=resizes-visual` to the viewport meta. Chrome on Android has used this behaviour by default since version 108: the keyboard shrinks only the visual viewport, so a `position: fixed; bottom: 0` bar stays at the bottom of the layout viewport, under the keyboard. Nearly every phone in Nepal runs Chrome or a Chromium browser, and the dashboard has been built and checked under this default; the key makes any other browser that reads it behave the same. The "rides above the keyboard" note came from a review, not from a real phone. Hiding the bar on focus needs focus listeners, flickers as focus moves between fields, and would hide the navigation from a tablet with a hardware keyboard. *Rejected:* JS hiding on `focusin`/`focusout`; a CSS `:has(:focus)` rule (an arbitrary variant on the layout root, harder to read than it is worth); `resizes-content` plus hiding (every keyboard open would resize the page). If the pilot's Android phone shows the bar riding the keyboard, F4 builds the hiding (user decision U1).
- **D7. Excerpts on the server, with `excerpt`.** The Inbox row's idea: 280 graphemes (two lines of the widest row at 1280 px, about 135 characters each; the `line-clamp-2` still cuts on a phone). The client page's brief, idea and payment row brief: `ALERT_EXCERPT_LENGTH` (80), the length the Projects list already uses for one line. The inquiry and project pages keep the whole text. *Rejected:* cutting in the browser (the bytes are already sent); a separate row shape for the Decided view (small gain once the idea is cut).
- **D8. The agenda's time column is `w-20 whitespace-nowrap`** (80 px; "Mon 22:30" fits, and nowrap guarantees one line on any font). *Rejected:* `min-w-18` (rows would no longer line up when one has a day prefix); `w-18 whitespace-nowrap` alone (a long time would overflow into the name).
- **D9. Keep the three local `focusFirstInvalid` calls.** They scope focus to their sheet or fieldset and now share the D3 helpers; the global rule focuses the same field, so the second call changes nothing a person sees. Removing them would widen the diff with no gain.
- **D10. No new tap-target sweep.** TAT-103's component rule covers buttons, inputs, selects and menu rows; this plan fixes the one residue it found (Clear). Section 9's scan reports any other control under 44 px; one on a page this plan touches is fixed in Task 6 if it is a class change, anything else goes to the report for a follow-up.

### Decisions only the user can make (the builder proceeds with the default)

- **U1. Android keyboard:** keep Chrome's default (D6) and check on a real Android phone at the friend's shop; build F4 only if the tab bar rides the keyboard there. **Default: yes.**
- **U2. What a lost save says:** "Open the page again to see whether it saved, then try again if it didn't", with no retry button. **Default: this wording, no retry.**
- **U3. Optimistic only for "Mark contacted" and the notes save** (D4), as `ui.md:65` says; the chat links keep recording in the background without it. **Default: keep the rule.**
- **U4. The follow-ups in section 13:** none blocks launch. **Default: create them after this merges; none before launch.**

## 5. Design

No new screen, no custom CSS class, no new token, no new dependency. Light and dark use existing tokens only (the toast is Sonner's `toast.error` through `components/ui/sonner.tsx`, as the flash errors are).

### A lost connection (every page)

- **What happens:** a tap or a save whose request gets no answer at all (the phone has signal but no data, the line drops mid-request, the browser is offline) shows an error toast at the top centre, like a flash error. A GET (a tab, a link, a pager, the calendar filter, a partial reload): "Couldn't load the page. Check your connection and try again." Any other method (a form, a button that posts, Mark contacted, the notes save): "The connection dropped before this was confirmed. Open the page again to see whether it saved, then try again if it didn't." The button that was busy goes back to normal (Inertia's `finish`), so the person can act.
- **With the browser offline:** the existing `OfflineBar` still shows under the top bar ("You're offline. Changes won't save until you're back online.") and the toast comes as well, so the tap that failed is answered.
- **Not covered:** an answer that comes back slowly (the button says "Saving…" and Inertia's violet progress bar runs: that is the honest state); a server error page (unchanged).
- **Screen readers:** Sonner's live region announces the toast (the same as flash errors). Inside an open sheet the modal hides that region (`ui.md:23`): F6.

### Focus after a refused form (every form)

- When a form posts and the answer has field errors, focus moves to the first field to fix in that form, which scrolls to the middle of the screen. At 375 px that clears the top bar (`--top-bar-height`, at least 56 px) and the tab bar (56 px plus the safe area). Inside a sheet the sheet scrolls in its inner box. On a phone, focusing a text field opens the keyboard on it; that is the field to fix (as on the account page since TAT-95).
- A radio group with the error (the booking form's price choice) gives focus to its checked choice, else its first.
- A refusal shown as a toast (a rule, a limit, a stale page) moves nothing: focus stays where it was.
- The field's own error text is unchanged (under the field, tied with `aria-describedby` where the form already does so).

### One-tap moves on the project page

- **Put on hold** and **Resume** ("Change this project", left column, after Notes) and **Resume** (Next step card, when the step offers it) keep their variants and places. While the request is out the button is disabled and says "Saving…"; a second tap or a held Enter sends nothing. After the answer: the status badge in the header shows the new status; focus is on the button if it is still there, else on the page `h1` (the client's name, `tabIndex={-1}` already), as after Decline. At 375 px the buttons are 44 px (the shared `Button`); "Saving…" is shorter than "Put on hold", so nothing reflows.
- The owner's artist picker: Save says "Saving…" while it is out (it is already disabled).

### "Mark contacted" and Notes

- **Mark contacted** (the Message the client card, open projects only): on tap, the card's contact line reads "contacted today" at once, and when the last contact was a Viber message the leading button becomes "Send on WhatsApp" at once, as the server's answer would make it. The server's toast "Marked as contacted." still comes with the answer. If the request fails, the line and the button go back to what they were and D2's toast explains. The button stays enabled: a second tap records the contact again (the same field set to now).
- **Notes:** unchanged on screen (the textarea shows what was typed; Save notes says "Saving…" while it is out). The owner can tap another tab or link while it is out and the save still finishes; its "Notes saved." toast is then not shown (the person has left the page). A refused or failed save shows its field error (if still on the page) or D2's toast.

### The agenda, the Clear link, the keyboard

- **Agenda** (Today's sessions and the calendar): the time column is 80 px and never wraps, at 375 and 1280 px, light and dark. The client's name column is 8 px narrower and still wraps (`wrap-anywhere`), so a long Devanagari name is never cut.
- **Clients search, Clear:** the link fills the row's height, 44 px below `lg` (the row is 36 px from `lg`, as now), still `text-sm underline`.
- **Keyboard:** no visible change on Chrome for Android (it is its default); see D6.

### What the server decides and what the browser does

- Server: the excerpts (Task 5). Browser: everything else; no new prop, no new query.

## 6. Data and contract

- **Props:** `inquiries/index` `inquiries[].idea` becomes `excerpt(idea, 280)`; `clients/show` `projects[].brief`, `inquiries[].idea` and `payments.rows[].projectBrief` become `excerpt(…, ALERT_EXCERPT_LENGTH)`. Types stay `string`; the page code is unchanged. `inquiries/show`'s `inquiry.idea` (`inquiries_controller.ts:136`) and the project page's brief stay whole.
- **Queries:** none added or removed (the excerpts are computed on rows already read).
- **No** migration, route, `TENANT_ROUTE_ROLES` entry, isolation case, `openapi.yaml`, SDK or types change. Run `node ace codegen` after Task 5 and keep any diff (expected none).

## 7. Tasks

### Task 0: baseline (no commit)

- `T unit --files=tap_targets`, `T unit --files=inline_confirms_source`, `T unit --files=page_placements_source`, `T unit --files=message_ways`, `T functional --files=inbox`, `T functional --files=client_payments`, `T functional --files=clients_pages`, `T functional --files=head`. All green before any change; note any failure in the report before going on.

### Task 1: a lost connection says so

- **Files:** `inertia/components/visits.ts` (new), `inertia/app.tsx`, `tests/unit/inertia/visits.spec.ts` (new).
- **Test first** (`visits.spec.ts`, group "A lost connection (TAT-84)"; import the module like `fold.spec.ts` does, with a `@ts-expect-error TS6305` line and a restated `VisitsModule` type; build a document with `new JSDOM(html).window.document` and pass it in, so no globals are installed; a fake `on` stores each callback by type and returns a function that deletes it):
  - `connectionLostText("get")` and `("GET")` are `PAGE_LOST`; `"post"`, `"put"`, `"delete"` are `SAVE_LOST`.
  - Neither text contains "network", "request", "server", "error" or "HTTP" (plain words).
  - After `watchVisits(on, doc, notify)`: the `networkError` callback returns `false`; then `finish` with `{ detail: { visit: { method: "get" } } }` calls `notify` once with `PAGE_LOST`; a second `finish` calls nothing (the flag resets); `networkError` then `finish` with `"post"` gives `SAVE_LOST`; a `finish` with no `networkError` before it gives nothing.
  - The returned function removes the three callbacks (the fake's map is empty) and the document's submit listener (Task 2 checks the latter).
  - Fails today: `components/visits.ts` does not exist.
- **Implementation:** `inertia/components/visits.ts`, no imports (the doc comment says it is installed once by `app.tsx` and that the unit tests load it with a jsdom document). This task writes the whole module except the focus part (Task 2 adds `firstInvalidField`, `focusField`, the submit listener and the `error` handling):

  ```ts
  export const PAGE_LOST =
  	"Couldn't load the page. Check your connection and try again.";
  export const SAVE_LOST =
  	"The connection dropped before this was confirmed. Open the page again to see whether it saved, then try again if it didn't.";

  /** The toast for a visit the network cut off: a page load (GET) or a save (anything else). */
  export function connectionLostText(method: string): string {
  	return method.toLowerCase() === "get" ? PAGE_LOST : SAVE_LOST;
  }

  type VisitEvent = { detail: { visit?: { method: string } } };
  /** Inertia's `router.on`, narrowed to the events used here. */
  export type OnVisit = (
  	type: "error" | "networkError" | "finish",
  	callback: (event: VisitEvent) => boolean | undefined,
  ) => () => void;

  /**
   * Installs the dashboard's visit rules and returns what removes them. A visit the network
   * cut off (no answer at all) gets a toast at its `finish`, which carries the method; the
   * `networkError` handler returns false, so Inertia does not reject the visit's promise.
   * It never retries: a save may have reached the server before the answer was lost.
   */
  export function watchVisits(
  	on: OnVisit,
  	doc: Document,
  	notify: (text: string) => void,
  ): () => void {
  	let lost = false;
  	const stops = [
  		on("networkError", () => {
  			lost = true;
  			return false;
  		}),
  		on("finish", (event) => {
  			if (lost) notify(connectionLostText(event.detail.visit?.method ?? "get"));
  			lost = false;
  			return undefined;
  		}),
  	];
  	return () => {
  		for (const stop of stops) stop();
  	};
  }
  ```

  (`doc` is used from Task 2; Biome may flag it as unused until then: prefix it `_doc` in this task or add Task 2's listener now, whichever Biome accepts.)
- `inertia/app.tsx`: after `createInertiaApp(...)`, `watchVisits((type, callback) => router.on(type, callback), document, (text) => toast.error(text))` with `router` from `@inertiajs/react`, `toast` from `sonner`, `watchVisits` from `./components/visits`. Inertia's `router.on` is generic per event name; if the union `type` does not type-check, cast the callback (`callback as never`) or register the events one by one inside the wrapper. A comment: the dashboard's visit rules, installed once for every layout (the toasts render in each layout's `FlashToasts`).
- **Run:** `T unit --files=visits`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/inertia/components/visits.ts apps/platform/inertia/app.tsx apps/platform/tests/unit/inertia/visits.spec.ts`.
- **Commit:**
  ```
  feat(platform): say so when a tap fails for lack of a connection (TAT-84)

  A visit that dies on the network now shows a toast instead of nothing: a page that didn't
  load says to check the connection; a save says to open the page again and look before
  trying again, so a payment is never sent twice on a guess. The rules live in
  components/visits.ts.
  ```

### Task 2: after any refused form, focus the field to fix

- **Files:** `inertia/components/visits.ts`, `inertia/components/form_sheet.tsx`, `tests/unit/inertia/visits.spec.ts`.
- **Test first** (`visits.spec.ts`, group "Focus after a refused form (TAT-84)"; jsdom document with two forms, form B FIRST in the DOM with an `aria-invalid="true"` input, form A after it with a plain input, a `div role="radiogroup" aria-invalid="true"` holding two `button role="radio"` (the second `aria-checked="true"`), then an `aria-invalid="true"` input; stub `window.HTMLElement.prototype.scrollIntoView` to record `[element, options]`; wait for a tick with `await new Promise((r) => setTimeout(r, 0))` before asserting):
  - Dispatch `submit` on form A (`new window.Event("submit", { bubbles: true, cancelable: true })`), call `error`, then `finish` (`"post"`): `doc.activeElement` is A's checked radio (not B's input: the form that was sent wins), and `scrollIntoView` got `{ block: "center" }`.
  - `firstInvalidField` on a container whose first marked element is an `input` returns that input; on a group with no checked choice returns its first `button`; on `null` or a container with nothing marked returns `null`.
  - `error` and `finish` with no `submit` before them: focus does not move.
  - `submit` on A, then A removed from the document, then `error` and `finish`: focus does not move (no crash).
  - `submit` on A, then `finish` without `error` (a saved form): focus does not move.
  - The cleanup function removes the submit listener: spy on `doc.removeEventListener` and assert one call with `"submit"`, the listener and `true`.
  - Fails today: `firstInvalidField` and the submit listener do not exist.
- **Implementation** (`visits.ts`; add to the module comment: a form whose answer has field errors gets focus on its first invalid field, scrolled to the middle of the screen):

  ```ts
  const FOCUSABLE =
  	'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])';

  /**
   * The control to fix first in `scope`: the first element marked `aria-invalid="true"`, or,
   * when that is a group (a radio group marks its root), its checked choice, else its first.
   */
  export function firstInvalidField(scope: ParentNode | null): HTMLElement | null {
  	const invalid = scope?.querySelector<HTMLElement>('[aria-invalid="true"]');
  	if (!invalid) return null;
  	if (invalid.matches(FOCUSABLE)) return invalid;
  	return (
  		invalid.querySelector<HTMLElement>('[aria-checked="true"]') ??
  		invalid.querySelector<HTMLElement>(FOCUSABLE)
  	);
  }

  /** Focuses `field` in the middle of the screen, clear of the top bar and the tab bar. */
  export function focusField(field: HTMLElement | null): void {
  	if (!field) return;
  	field.focus({ preventScroll: true });
  	field.scrollIntoView?.({ block: "center" });
  }
  ```

  In `watchVisits`: `let sent: HTMLFormElement | null = null; let refused = false;`; a capture-phase listener `doc.addEventListener("submit", remember, true)` where `remember` sets `sent` when `(event.target as Element | null)?.tagName === "FORM"`; `on("error", () => { refused = true; return undefined; })`; in the `finish` callback, before resetting: `const form = refused && sent?.isConnected ? sent : null; if (form) setTimeout(() => focusField(firstInvalidField(form)), 0);` then `sent = null; refused = false; lost = false;`. The cleanup also calls `doc.removeEventListener("submit", remember, true)`. Comment why focus waits for `finish` and a tick: the `<Form>` sets its errors in its own `onError`, which Inertia calls after the global `error` event; `finish` comes after it, so the tick runs after that state update, as `focusFirstInvalid` always did.
- `form_sheet.tsx:99-103`: `focusFirstInvalid(container)` becomes `setTimeout(() => focusField(firstInvalidField(container)), 0)` with both imported from `~/components/visits`; its doc comment says it shares the rule with the global one (`visits.ts`) and stays for the sheets, the session move form and the account page (D9).
- **Run:** `T unit --files=visits`, `T unit --files=inline_confirms_source`, `T unit --files=confirm_and_sheets`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/inertia/components/visits.ts apps/platform/inertia/components/form_sheet.tsx apps/platform/tests/unit/inertia/visits.spec.ts`.
- **Commit:**
  ```
  feat(platform): after any refused form, focus the first field to fix (TAT-84)

  One listener notes which form was sent and, when the answer has field errors, moves focus
  to its first invalid field (a radio group's first choice) and scrolls it to the middle of
  the screen, clear of the top bar and the tab bar. focusFirstInvalid uses the same rule.
  ```

### Task 3: one-tap moves say "Saving…" and send once

- **Files:** `inertia/components/change_card.tsx`, `inertia/components/next_step_card.tsx`, `tests/unit/inertia/slow_connection_source.spec.ts` (new).
- **Test first** (`slow_connection_source.spec.ts`, a source scan like `inline_confirms_source.spec.ts`, with its `read` helper; the file's top comment: Playwright is not in CI, so the in-flight states are pinned at the source and measured in a browser pass; group "One-tap moves send once (TAT-84)"):
  - `components/change_card.tsx` contains `export function MoveButton(`, `sending.current`, `disabled={saving}`, `"Saving…"`, `onKeyDown={ignoreHeldEnter}` and `focusBack(`; the part of `ChangeCard` after `const ask = CONFIRM[move]` renders `<MoveButton` and contains no `onClick={() => post(move)}`.
  - `components/next_step_card.tsx` contains `<MoveButton` and does not contain `tenant.projects.moves.store`.
  - `ArtistField` in `change_card.tsx` contains `processing ? "Saving…" : "Save"`.
  - Fails today: no `MoveButton`; the Resume case posts itself; Save has no busy word.
- **Implementation:**
  - `change_card.tsx`, a named export below `ChangeCard`:

    ```tsx
    /**
     * A move that asks nothing (Put on hold, Resume), in this card and in the Next step card
     * (TAT-84). One tap sends it once: while the request is out the button is disabled and
     * says "Saving…", a second click in the same frame and a held Enter do nothing, and the
     * answer puts focus back on it, or on the page heading when the move removed it.
     */
    export function MoveButton({
    	projectId,
    	move,
    	variant = "secondary",
    	fallback,
    }: {
    	projectId: string;
    	move: ManualMoveName;
    	variant?: "default" | "outline" | "secondary";
    	fallback: RefObject<HTMLElement | null>;
    }) {
    	const tenant = useTenant();
    	const button = useRef<HTMLButtonElement>(null);
    	// The state, applied at once: a double click can come before React renders.
    	const sending = useRef(false);
    	const [saving, setSaving] = useState(false);
    	const send = () => {
    		if (sending.current) return;
    		sending.current = true;
    		setSaving(true);
    		router.post(
    			urlFor("tenant.projects.moves.store", { tenant: tenant.slug, id: projectId }),
    			{ move },
    			{
    				preserveScroll: true,
    				onFinish: () => {
    					sending.current = false;
    					setSaving(false);
    					setTimeout(() => focusBack(button.current, fallback.current)?.focus(), 0);
    				},
    			},
    		);
    	};
    	return (
    		<Button
    			ref={button}
    			type="button"
    			variant={variant}
    			disabled={saving}
    			onKeyDown={ignoreHeldEnter}
    			onClick={send}
    		>
    			{saving ? "Saving…" : MOVE_LABELS[move]}
    		</Button>
    	);
    }
    ```

    Imports: `useRef`, `useState` from React; `focusBack`, `ignoreHeldEnter` from `~/components/confirm`. In `ChangeCard`, the no-question branch (`:116-125`) becomes `<MoveButton key={move} projectId={projectId} move={move} fallback={fallback} />`; the `post` helper stays for the `InlineConfirm` moves and loses its now unused optional `finished` default only if Biome asks. Update the component comment to name `MoveButton`.
  - `ArtistField` (`:167-169`): the button text is `{processing ? "Saving…" : "Save"}`.
  - `next_step_card.tsx`, `case "resume"` (`:119-137`): `return <MoveButton projectId={projectId} move="resume" variant={variant} fallback={fallback} />;` with `import { MoveButton } from "~/components/change_card"`; drop the `router` import if nothing else uses it (check: `rg -n 'router\.' inertia/components/next_step_card.tsx`).
- **Run:** `T unit --files=slow_connection_source`, `T unit --files=page_placements_source`, `T unit --files=inline_confirms_source`, `T functional --files=page_affordances`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/inertia/components/change_card.tsx apps/platform/inertia/components/next_step_card.tsx apps/platform/tests/unit/inertia/slow_connection_source.spec.ts`.
- **Commit:**
  ```
  fix(platform): put on hold and Resume say Saving… and send once (TAT-84)

  The one-tap moves of the project page are one MoveButton, in Change this project and in
  the Next step card: disabled with "Saving…" while the request is out, a held Enter
  ignored, focus back on the button or the page heading after. The artist picker's Save
  says "Saving…" too.
  ```

### Task 4: "Mark contacted" shows at once; a notes save outlives the page

- **Files:** `inertia/components/messages.ts`, `inertia/pages/projects/show.tsx`, `tests/unit/inertia/slow_connection_source.spec.ts`.
- **Test first** (`slow_connection_source.spec.ts`, group "Optimistic only for Mark contacted and notes (TAT-84)"):
  - `MARKED_CONTACTED_TEXT` (imported from `../../../inertia/components/messages.js` with the TS6305 line) equals `lastContactText(DateTime.now(), "Asia/Kathmandu", NO_VIA)` (`#modules/projects/contact`, `#modules/notifications/messages`, `luxon`).
  - `pages/projects/show.tsx` contains `MARKED_CONTACTED_TEXT`, `lastChannel: null`, exactly one match of `/\boptimistic:/` and exactly one of `/\boptimistic=\{/`, and `onMarkContacted={closed ? undefined : markContactedAtOnce}`.
  - Every other `.ts`/`.tsx` file under `inertia/` (walk it with `readdir(dir, { recursive: true })`, skipping `components/ui/`) has no match of `/\boptimistic\s*[:=]/` (`ui.md:65`: nothing else is optimistic).
  - Fails today: no constant, no optimistic use.
- **Implementation:**
  - `messages.ts` (no imports, stays so):
    ```ts
    /**
     * The contact line once "Mark contacted" is tapped (TAT-84), before the server answers: the
     * server's `lastContactText` for a contact now with no channel (pinned by
     * slow_connection_source.spec.ts).
     */
    export const MARKED_CONTACTED_TEXT = "contacted today";
    ```
  - `projects/show.tsx`: below `markContacted` (`:84-88`), a `markContactedAtOnce` for the button only:
    ```ts
    // "Mark contacted" (TAT-84): the contact line and the leading chat button change at once,
    // as the server's answer will; Inertia puts them back if the request fails.
    const markContactedAtOnce = () =>
    	router.post(urlFor("tenant.projects.contacted.store", params), {}, {
    		preserveScroll: true,
    		preserveState: true,
    		optimistic: () => ({ contactedText: MARKED_CONTACTED_TEXT, lastChannel: null }),
    	});
    ```
    and `onMarkContacted={closed ? undefined : markContactedAtOnce}` (`:164`). The chat links keep `markContacted` unchanged. If the optimistic callback's return type complains (the page props are typed loosely by Inertia), type it as `Partial<ProjectPageProps>` or cast; do not widen anything else.
  - `NotesForm` (`:345-371`): add `optimistic={(_props, data) => ({ notes: data.notes ?? null })}` to the `<Form>` (adapt to the route body's type), with a comment: the textarea already shows what was typed; this makes the save async, so a tap on another tab while it is out does not cancel it (Inertia never applies its answer to another page). Keep `options={{ preserveScroll: true }}` and the "Saving…" label.
- **Run:** `T unit --files=slow_connection_source`, `T unit --files=message_ways`, `T unit --files=inline_confirms_source`, `T functional --files=page_affordances`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/inertia/components/messages.ts apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/unit/inertia/slow_connection_source.spec.ts`.
- **Commit:**
  ```
  feat(platform): mark contacted shows at once and a notes save outlives the page (TAT-84)

  Both use Inertia's optimistic visits, the two changes ui.md allows: the contact line says
  "contacted today" before the server answers (rolled back if the request fails), and a
  notes save keeps going when the owner taps another tab while it is out.
  ```

### Task 5: the Inbox and the client page send only the text they show

- **Files:** `app/controllers/inquiries_controller.ts`, `app/controllers/clients_controller.ts`, `tests/functional/inquiries/inbox.spec.ts`, `tests/functional/clients/client_payments.spec.ts`.
- **Test first:**
  - `inbox.spec.ts`, group "Inbox pages", new test "a long idea is two lines' worth in the inbox and whole on its page (TAT-84)": an owner's studio (`studioWithOwner()`), a client named "सीता थापा", one new inquiry whose `idea` is about 600 characters of words with Devanagari in it (for example 60 times `"सीता wants a koi"` joined by spaces). GET `inbox()` with Inertia: `props.inquiries[0].idea` equals `excerpt(idea, 280)` (import `excerpt` from `#modules/notifications/alerts`), ends with "…" and is shorter than `idea`. GET the inquiry page (`/t/black-needle/inbox/<id>`, as the test at `:161` does): `props.inquiry.idea` equals `idea`. Fails today: the row carries the whole idea.
  - `client_payments.spec.ts`, new test "a long brief and idea are one line's worth on the client page (TAT-84)", reusing that file's `verified()` and studio setup: an inquiry and a project for one client with a 300-character `idea` and `brief`, and a verified payment on the project (`makePayment(tenant, project, verified())`). GET the client page: `projects[0].brief`, `inquiries[0].idea` and `payments.rows[0].projectBrief` each equal `excerpt(text, ALERT_EXCERPT_LENGTH)`. Fails today: whole texts.
- **Implementation:**
  - `inquiries_controller.ts`: import `excerpt` from `#modules/notifications/alerts`; a module constant `/** The Inbox row shows two lines of the idea (line-clamp-2): enough to fill both at 1280 px. */ const IDEA_PREVIEW_LENGTH = 280;`; `:81` becomes `idea: excerpt(inquiry.idea, IDEA_PREVIEW_LENGTH)`. `:136` (the inquiry page) is unchanged.
  - `clients_controller.ts`: import `ALERT_EXCERPT_LENGTH` and `excerpt` from `#modules/notifications/alerts`; `:134` `brief: excerpt(project.brief, ALERT_EXCERPT_LENGTH)`, `:143` `idea: excerpt(inquiry.idea, ALERT_EXCERPT_LENGTH)`, `:155` `projectBrief: excerpt(briefs.get(payment.projectId) ?? "", ALERT_EXCERPT_LENGTH)`, with one comment above the render: the page shows one line of each (`line-clamp-1`), like the Projects list's piece.
  - `cd apps/platform && DB_DATABASE=tattoo_drip_ux node ace codegen`; keep any diff (expected none).
- **Run:** `T functional --files=inbox`, `T functional --files=client_payments`, `T functional --files=clients_pages`, `T functional --files=client_history`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/app/controllers/inquiries_controller.ts apps/platform/app/controllers/clients_controller.ts apps/platform/tests/functional/inquiries/inbox.spec.ts apps/platform/tests/functional/clients/client_payments.spec.ts`.
- **Commit:**
  ```
  perf(platform): the inbox and the client page send only the text they show (TAT-84)

  The inbox row shows two lines of the idea and the client page one line of each brief and
  idea, so the server sends an excerpt (whole graphemes, cut at a word) instead of up to
  4,000 characters a row. The inquiry and project pages keep the whole text.
  ```

### Task 6: the agenda's times, the Clear link and the keyboard

- **Files:** `inertia/components/day_agenda.tsx`, `inertia/pages/clients/index.tsx`, `resources/views/inertia_layout.edge`, `tests/functional/shell/head.spec.ts`, `tests/unit/inertia/slow_connection_source.spec.ts`.
- **Test first:**
  - `head.spec.ts:9-25` ("links the manifest, icons and theme colors"): replace the `"viewport-fit=cover"` entry with the whole tag `'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual" />'`. Fails today.
  - `slow_connection_source.spec.ts`, group "Small fixes (TAT-84)": `components/day_agenda.tsx` contains `w-20` and `whitespace-nowrap` in the class list of the time column (the `span` before `{session.startText}`) and no `w-18`; in `pages/clients/index.tsx`, the `Link` whose text is "Clear" has `max-lg:min-h-11` and no `self-center`. Fails today.
- **Implementation:**
  - `day_agenda.tsx:103`: `className="flex w-20 shrink-0 flex-col whitespace-nowrap tabular-nums"`; add to the `SessionItem` comment: the time column fits "Mon 22:30" on one line (TAT-50's note).
  - `clients/index.tsx:42-44`: `className="flex items-center text-sm underline max-lg:min-h-11"` (the form row is `flex`, so the link fills its height: 44 px below `lg`, 36 px from `lg`, as the Search button).
  - `inertia_layout.edge:5`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual" />`. Check the other layouts render the same edge file (`rg -n 'viewport' resources/views`); if another view has its own viewport meta, leave it (storefront pages are not here).
- **Run:** `T functional --files=head`, `T unit --files=slow_connection_source`, `T unit --files=now_marker`, `pnpm --filter @tattoo-drip/platform typecheck`, `pnpm exec biome check apps/platform/inertia/components/day_agenda.tsx apps/platform/inertia/pages/clients/index.tsx apps/platform/tests/unit/inertia/slow_connection_source.spec.ts apps/platform/tests/functional/shell/head.spec.ts`.
- **Commit:**
  ```
  fix(platform): agenda times on one line, Clear at 44 px, the keyboard resize stated (TAT-84)

  "Mon 22:30" no longer wraps in the agenda's time column at 375 px (w-20, nowrap); the
  clients search's Clear link is a 44 px target; the viewport meta names
  interactive-widget=resizes-visual, Chrome's default since 108, so the tab bar stays under
  the keyboard in any browser that reads it.
  ```

### Task 7: docs

- **Files and content:** section 8. Then the browser pass (section 9) on the platform dev server at 3401, against `tattoo_drip_ux`.
- **Run:** `pnpm check`.
- **Commit:**
  ```
  docs(platform): the slow-connection rules as built (TAT-84)

  ui.md says what a lost connection shows, where focus goes after a refused form, which
  one-tap buttons say "Saving…", the two optimistic visits, the keyboard and the agenda's
  time column.
  ```

### Task 8: final gates (no commit unless a gate needs a fix)

Section 10.

Every commit message above passed `printf '%s' "<message>" | pnpm exec commitlint` at planning time (each body line is at most 100 characters); the builder appends its `Co-Authored-By` line after a blank line.

## 8. Docs to update

- **`apps/platform/docs/ui.md`, "Phones and slow connections" (`:58-66`):**
  - The forms bullet (`:64`): a one-tap write that asks nothing disables its button and says "Saving…" too (`MoveButton` in `components/change_card.tsx` for Put on hold and Resume; `InlineConfirm`'s `busyLabel` for the ones that ask). Settings' and Artists' one-tap writes still lack it (a follow-up).
  - The optimistic bullet (`:65`): the two that exist, through Inertia's `optimistic` option: "Mark contacted" (`MARKED_CONTACTED_TEXT`, `components/messages.ts`, pinned against the server's `lastContactText`; `lastChannel` null as the server stores it) and the project notes save (no visible change: the visit becomes async, so a tap elsewhere while it is out doesn't cancel it). `slow_connection_source.spec.ts` fails for any other optimistic use.
  - A new bullet "A lost connection (TAT-84)": `watchVisits` (`components/visits.ts`, installed once in `app.tsx`) turns a visit the network cut off into a toast at its `finish`: `PAGE_LOST` for a GET, `SAVE_LOST` for anything else; it never retries (a payment may have been recorded before the answer was lost); `OfflineBar` still covers a browser that knows it is offline. A slow answer is not a lost one: the button says "Saving…" and the progress bar runs.
  - A new bullet "After a refused form (TAT-84)": the same module remembers the form that was sent (a capture `submit` listener) and, when its answer has field errors, at `finish` and after a tick focuses `firstInvalidField(form)` (the first `aria-invalid="true"` control; a radio group's checked or first choice) with `focusField` (no browser scroll, then `scrollIntoView({ block: "center" })`, clear of both bars). Every `<Form>` gets it with no code; keep `aria-invalid` on the control (`:14`), since that is what it looks for. `focusFirstInvalid` (sheets, the session move form, the account page) uses the same helpers. A refusal without field errors moves nothing.
  - The tap-target bullet (`:66`) and the keyboard: the viewport meta carries `interactive-widget=resizes-visual` (Chrome's default since 108): the keyboard covers the fixed tab bar instead of pushing it up, and nothing hides the bar on focus.
  - The props bullet (`:62`): where the excerpts are: the Projects list's piece and the client page's lines (80 graphemes), the Inbox row's idea (280, two lines), the calendar's brief preview (100), Today's rows (80); `excerpt` (`#modules/notifications/alerts`) never cuts a grapheme.
- **`ui.md`, Tap targets bullet (`:19`):** "A bare text link that is a control (the list pages' Previous and Next)" gains "and the Clients search's Clear, which fills its form row".
- **`ui.md`, Today bullet (`:28`), the day agenda sentence:** its time column is `w-20` with `whitespace-nowrap`, so "Mon 22:30" stays on one line at 375 px.
- **`apps/platform/docs/testing.md`, "Dashboard unit tests":** one sentence: a module that takes the document as an argument needs no jsdom globals (`visits.spec.ts` passes `new JSDOM(html).window.document`).

## 9. Acceptance

### Measurable checks

- **Lost page load:** at 375 x 812, `context.setOffline(true)`, tap the Projects tab: within 2 s a toast reads exactly `PAGE_LOST`, and `OfflineBar` shows. `setOffline(false)`.
- **Lost save:** `page.route("**/projects/*/notes", (route) => route.abort("internetdisconnected"))`, type in Notes, Save notes: a toast reads exactly `SAVE_LOST`; the button reads "Save notes" again and is enabled; no `Uncaught (in promise)` in the console. `page.unroute(...)`.
- **Mark contacted at once:** throttle with CDP (`Network.emulateNetworkConditions`, `latency: 3000`, `downloadThroughput: 50_000`, `uploadThroughput: 20_000`) on a project whose last contact was a Viber message: within 500 ms of the click, the Message card's description reads "contacted today" and the leading button reads "Send on WhatsApp"; after the answer, the toast "Marked as contacted." With the request aborted instead, both go back within 1 s of the failure and `SAVE_LOST` shows.
- **Notes outlive the page:** same throttle, type "Prefers mornings, बिहान", Save notes, then tap the Today tab within 300 ms; wait 8 s; open the project: the textarea holds the new text (and the server row has it: reload).
- **One request per move:** latency 2000 ms, double-click "Put on hold" in Change this project: exactly 1 POST to `/moves` (count with `page.on("request")`), the button reads "Saving…" and is disabled while it is out, no error toast; after the answer the badge reads "On hold" and `document.activeElement` is the `h1` or the new Resume button. Repeat with Resume in the Next step card (status on hold).
- **Focus after a refusal:** Clients, edit a client, enter another client's phone number, Save: `document.activeElement.id === "phone"`, and its bounding rect has `top >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-bar-height"))` and `bottom <= innerHeight - 56`. The account page with a wrong current password: focus on the current password field (unchanged behaviour). In a sheet (Record payment with an amount the server refuses, if one is reachable without hand-editing; otherwise skip and say so): focus stays inside the sheet on the refused field.
- **Agenda:** a session from 22:30 to 01:30 the next day; the calendar day view of the next day at 375: the start time element has `getClientRects().length === 1` and its column is 80 px wide; same in Today's sessions.
- **Clear:** `/clients?q=x` at 375: the Clear link's height is 44 px; at 1280, 36 px.
- **Keyboard meta:** `document.querySelector('meta[name="viewport"]').content` includes `interactive-widget=resizes-visual`. The real behaviour needs a real Android phone (U1).
- **Excerpts:** the Inbox at 375 and 1280 with the 600-character Devanagari idea: the row still shows two lines and ends with an ellipsis; the inquiry page shows the whole idea.
- **Widths:** on Today, Inbox (New and Decided), an inquiry, Projects (Active, a waiting view), a project (open and closed), Calendar (day and week), Clients (list, a client, edit), Alerts, Artists, Settings (each page) and the account page at 375: `document.documentElement.scrollWidth <= 375`.
- **Tap targets:** on the same pages at 375, list every visible `a, button, input, select, textarea, [role="button"], [role="radio"]` whose box is under 44 px tall, leaving out links inside a sentence (a `p` with other text) and the 16 px checkbox and radio marks (their hit area is the `after:` box). Expected: none on the pages this plan touches; report the rest (D10).
- **Themes and scripts:** the screens above in light and dark, with a Devanagari client name (सीता थापा) in the project header, the Inbox row and the agenda.

### Browser check list

- 375 x 812 (touch) and 1280 x 800; light and dark; a Devanagari client name on screen.
- Every measurable check above, with a screenshot of: the two toasts, Mark contacted mid-flight (throttled), Put on hold mid-flight ("Saving…"), the focused phone field after the refusal, the agenda with "Mon 22:30", the Clear link.
- The project page still reads Next step, Sessions, Message the client, Request, Notes, Change this project, then Payments and Quote (no reflow from "Saving…").

## 10. Final gates

- Root: `pnpm check`, `pnpm typecheck`, `pnpm build`.
- The full platform suite once, after emptying `queue_jobs` in `tattoo_drip_ux` (the standing rule): `cd apps/platform && DB_DATABASE=tattoo_drip_ux PORT=3402 SESSION_DRIVER=memory flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock timeout -s KILL 1800 node ace test` (no `sh -c`: the variables pass through `flock` to the test run).
- No storefront, `packages/*` or `check:page` run (nothing there changes).

## 11. Review focus (Fable and Codex)

- **The global listeners** (`visits.ts`, `app.tsx`): installed once; nothing from the server's answer or the form's values goes into a toast (fixed strings only); the `submit` listener keeps only a reference to the form element and drops it at the next `finish`; a form that was removed or never sent cannot steal focus; returning `false` from `networkError` suppresses only Inertia's promise rejection (no other default exists in 3.8, `core/dist/index.js:3067-3074`).
- **Optimistic visits:** exactly two (the source scan); the Mark contacted words match the server's (the pin); the rollback on failure; that an async response is never applied to another page (Inertia's `shouldSetPage`) and that a notes save finishing after the person left neither moves them back nor shows its toast on another page. No money, quote, status or decision is optimistic.
- **Double submits:** `MoveButton`'s ref guard, `ignoreHeldEnter`, and that `InlineConfirm` and the sheets are unchanged; that a refused move (`move_not_allowed` from another tab) still shows its toast and leaves the button usable.
- **Focus and accessibility:** focus in a sheet stays in the sheet (the submitted form is inside it); `scrollIntoView({ block: "center" })` inside the sheet's inner scroll box; focus after a move lands on a real element (the button or the `h1`), never `<body>`; the toast's live region (and F6 inside a sheet).
- **Information exposure and tenancy:** no new route, prop or query; the excerpts shorten text the member could already read; role scoping unchanged (the Inbox and the client page are owner pages; the project page's notes and Mark contacted keep their routes and guards).
- **Text:** `excerpt` on Devanagari (no half syllable), the 280 and 80 lengths against the real layouts.

## 12. Risks and rollback

- **Inertia's `optimistic` is new in 3.x.** The lockfile pins 3.8.0; an upgrade that changes it fails the browser check, not CI (the source scan only proves the option is passed). Rollback: revert Task 4's commit; Mark contacted and notes go back to plain posts.
- **Focus moves where it didn't before** (about forty forms). On a phone, focusing a text field opens the keyboard on the field to fix: intended, and what the account page and the sheets already do. If a page's refusal marks a field that isn't the one to fix, that page's `aria-invalid` is wrong, not this rule. Rollback: revert Task 2 (the sheets' and the account page's local calls keep working with the old body if the revert also restores `form_sheet.tsx`).
- **The lost-connection toast and `OfflineBar` both show when offline.** Accepted: the bar says why, the toast answers the tap.
- **Firefox for Android and other browsers that read `interactive-widget`** now cover the bottom of an open sheet with the keyboard instead of shrinking the page, as Chrome already does; the focused field is still scrolled into view by the browser. Rollback: drop the key (Task 6 is one line).
- **A tap on another tab during any save other than notes** can still cancel it (F3); unchanged by this plan.
- Every task is one commit; each can be reverted alone (Task 2 depends on Task 1's module, Task 4's scan file is created in Task 3: revert in reverse order if needed).

## 13. Proposed follow-up tickets (not created)

| # | Title | One line | Points |
|---|---|---|---|
| F1 | Settings and Artists one-tap writes say "Saving…" and ask in the page | Delete an artist, move or delete a payment method, the members actions, work photo move and remove, logo and cover remove and Log out get in-flight states, and the `window.confirm` boxes become `InlineConfirm` (audit X-8's remainder). | 2 |
| F2 | Thumbnails on the Projects list | The first reference image as a 56 px lazy thumbnail on cards and 40 px in the table, as `ui.md:29` describes (`InquiryService.firstImages`, signed after the member-scoped read). | 2 |
| F3 | A save is never cancelled by a tap elsewhere | Make the dashboard's remaining writes async (or warn before leaving while one is out), so a tab tapped during "Saving…" can't cancel a request whose body wasn't sent. | 2 |
| F4 | Hide the tab bar while typing, if a real Android phone needs it | Only if the pilot's phone shows the bar riding the keyboard under `resizes-visual`: hide it below `lg` while a text field has focus. | 1 |
| F5 | The Decide card sends one request at a time | Accept waits while Decline is out and the other way round, so a quick second tap can't flash "already decided". | 1 |
| F6 | A lost connection is said inside an open sheet | The sheet shows `SAVE_LOST` in its `role="alert"` paragraph like a refusal, because a modal hides the toast's live region from screen readers. | 1 |
