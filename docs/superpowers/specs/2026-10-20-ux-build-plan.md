# UX build plan (from the 2026-10-19 audit)

Read with `ux-audit.md` (finding IDs such as P-1) and `2026-10-20-ux-stencil-and-ink-design.md` (direction C, Stencil & Ink). Sizes are in points: 1 point is about half a day. Linear project: **E8 · UI & UX pass**. Tickets: WP-1 TAT-97, WP-2 TAT-98, WP-3 TAT-99, WP-4 TAT-100, WP-5 TAT-101, WP-6 TAT-102, WP-7 TAT-103, WP-8 TAT-104, WP-9 TAT-105, deposit headings TAT-106, WP-10 TAT-107, WP-11 TAT-108, WP-12 TAT-109, WP-13 TAT-110, WP-14 TAT-111, WP-15a TAT-112, WP-16 TAT-113, WP-17 TAT-114, WP-15b TAT-116, smaller items TAT-115.

Rulings (2026-10-20, defaults accepted): direction C; cover and up to 6 work photos per artist before launch; Today home and the new tab bar; default theme follows the phone, then the user's choice; keep "Projects" and add piece titles; finish-a-project and healing check are in the pilot.

The audit screenshots and Playwright scripts that this plan mentions were kept outside the repo (the author's session scratchpad) and are not committed; take new screenshots to compare.

Ground rules for the builder:
- Follow `apps/platform/docs/ui.md` and `apps/storefront/docs/development.md`: shadcn components plus tokens, no custom classes in the dashboard, Biome, and storefront link and safety rules (no in-page `#` links on the deposit page: use buttons).
- Add no runtime dependency. A bottom sheet is shadcn's `sheet` (Radix Dialog, already in the `radix-ui` package), not `drawer` (that needs `vaul`).
- No behaviour change hides inside a visual change: money, quote and status rules stay server-side and tested. Re-ordering a page must not change which forms post where.
- Every check below is done in a browser at **375 × 812** (touch) and **1280 × 800**, in light and dark, with at least one Devanagari client name on screen. Use an isolated database and different ports for these checks (never the developer's own dev servers); a throwaway account is fine.

## The first slice (about 3 days, 6 points): "It looks like ours, and the project page tells me what to do"

What the user will see change: every dashboard screen gets the warm Stencil & Ink palette, Eczar page titles and violet primary buttons (in dark mode too); statuses get colours; the project page opens on the thing to do next instead of four screens of cards; the inquiry page reads top-down; the AdonisJS starter page and robotic error messages are gone.

### WP-1 Stencil & Ink tokens in the dashboard, warmer storefront: 2 pts
- **Touches:** `apps/platform/inertia/css/app.css` (replace the zinc block with the direction-C tokens, mapped to shadcn names; radius 4 px; dark under `[data-theme='dark']`), the Eczar 700 woff2 files + OFL copied into `apps/platform` with the storefront's three `@font-face` blocks (`font-display: optional`), `inertia/components/page.tsx` (the `h1` in the display face), `inertia/components/logo.tsx` (an interim "Tattoo Drip" wordmark in Eczar until a mark exists), `apps/storefront/src/styles.css` (paper, ink and line values only; update the contrast comment).
- **Depends on:** Q1 (direction).
- **Accept:** titles in Eczar for Latin and for a Devanagari client name (`सीता थापा`) at both widths; primary buttons violet and clearly enabled in light and dark (today dark-mode primary is light grey); backgrounds warm off-white / warm near-black; DevTools contrast spot-checks: body ≥ 7:1, muted ≥ 4.5:1, input borders ≥ 3:1; the studio page looks the same apart from warmer colours; storefront `test/studio/assets.test.ts` still passes (font blocks unchanged); `pnpm check`, `pnpm typecheck`, `pnpm build`.
- **Default theme (ruling 4):** on a first visit the dashboard follows the phone's light/dark setting (`prefers-color-scheme`); once the user picks a theme with the toggle, that choice wins and persists. No flash of the wrong theme on load.
- **Risk:** low. Some shadcn components carry zinc-specific classes (`sidebar-*` tokens, `bg-muted/50`); sweep them.

### WP-2 Status colours: 1 pt
- **Touches:** a new `inertia/components/status_badge.tsx`, a status → group map next to `STATUS_LABELS` in `inertia/components/projects.ts`, used by `pages/projects/index.tsx`, `pages/projects/show.tsx`, `pages/clients/show.tsx`, `pages/calendar/index.tsx`.
- **Depends on:** WP-1.
- **Accept:** on Projects at 375, the five groups (waiting on studio, waiting on client, booked, in the chair, closed) are visibly different and always carry the word; "screenshot to check" uses the marigold dot; readable in dark mode; nothing relies on colour alone.
- **Risk:** low.

### WP-3 Project page: next step first (light version): 2 pts
- **Touches:** `inertia/pages/projects/show.tsx`, `inertia/components/payments_card.tsx`, `inertia/components/sessions_card.tsx`.
- **What:** keep the cards and change their **order by status** and what is open: reviewing with no quote → the quote form first; quoted → the Quote card (send message + "Client accepted") first; deposit pending → Deposit (link + message), or Payments when a screenshot waits; booked or in progress → Sessions first. "Record payment", "Record a refund" and "Revise the quote" become buttons that open their existing forms in place. Put Hold / Client withdrew / Decline in a "More actions" `DropdownMenu` (already in `components/ui`). Request, Notes and Earlier versions go last.
- **Accept (375):** a reviewing project shows the first quote field without scrolling past Message, Sessions or Request; a quoted project shows "Send on WhatsApp" for the quote and "Client accepted" on the first screen; a project with a waiting screenshot shows Verify / Reject on the first screen; the Record payment form is closed until tapped; all platform functional tests pass unchanged (no route or field changes).
- **Risk:** medium. The page's forms share one error bag (TAT-85 note); a refused save must reopen the form that failed.

### WP-4 Quick fixes on the doorstep: 1 pt
- `/` no longer shows the AdonisJS starter: signed out → `/login` (or a one-screen "The booking desk for tattoo studios in Nepal" page with Sign in / Create account), signed in → `/dashboard` (`inertia/pages/home.tsx`, `start/routes.ts`).
- Human VineJS messages for signup, login and reset (`app/validators/user.ts` + a messages provider): "Enter your email.", "Use 8 to 32 characters.", "Type the same password again."; label "Full name (optional)".
- Inquiry page (`inertia/pages/inquiries/show.tsx`): order Idea → References → details → Message → Decide; the artist picker full width and 44 px; the phone as a `tel:` link that never wraps mid-number.
- **Accept:** `localhost:3401/` shows no AdonisJS text; an empty signup lists three human messages and no field names; at 375 the inquiry shows the idea and the first reference above the fold, the full artist name in the picker and the phone on one line.

## Slice 2 (about 3.5 days, 7 points): "I know where my page is and what to do next"

### WP-5 "Your studio page" card and the setup checklist: 2 pts
- **Touches:** `inertia/pages/settings/profile.tsx`, `inertia/pages/inquiries/index.tsx` (empty state), `inertia/pages/onboarding/create_tenant.tsx` (show the real host from `app/services/storefront_url.ts` instead of a hard-coded ".tattoodrip.com"; rename "Your address" to "Your page link"), a small server-computed `setup` prop (artists > 0, a payment method on the deposit page, a deposit policy, an inquiry received).
- **Accept:** right after Create, the landing screen shows 4 steps with the next one highlighted and ticks that update as artists and QR codes are added; "Copy link" copies the exact URL that opens the studio page; "Share on WhatsApp" opens `wa.me` with the link; Settings → Profile always shows the link with Open / Copy / Share; artist cards show their own link with Copy.
- **Risk:** low. With `STOREFRONT_URL` unset in development, show the same warning as the deposit panel.

### WP-6 Alerts that say something: 0.5 pt
- **Touches:** `app/modules/notifications/alerts.ts` (detail = client's first name + the start of the idea, as the alert email already does) and its tests.
- **Accept:** the Alerts list reads "Sita Thapa: A koi fish swimming up my calf…" (Devanagari names intact, no phone number).

### WP-7 Tap targets and the filter row: 1 pt
- **Touches:** `inertia/components/ui/button.tsx` (below `lg`: default and `sm` 44 px, icon `size-11`), selects and inputs `h-11` below `lg`, `pages/projects/index.tsx` (status chips as one horizontally scrolling row, ≥ 40 px), `pages/calendar/index.tsx` (the artist filter applies on change; drop "Show").
- **Accept:** at 375 no button, link-button, select or input is under 44 px tall on Inbox, an inquiry, a project, Projects, Calendar or Settings (measure the rendered heights in a browser); at 1280 the density is unchanged; the Projects chips take one row.
- **Risk:** low-medium (layout shifts in tight rows; check the Sessions card's button rows).

### WP-8 One way to message the client: 1.5 pts
- **Touches:** `inertia/components/message_card.tsx`, `inertia/components/chat_message.tsx`.
- **What:** a primary "Send on WhatsApp" (or the client's last-used channel, from TAT-52's last-contact data), the message preview folded to two lines with "Show message", one "Other ways" row (Viber: copy then open; Call; Copy text). "Chat without a message" moves into that row. Recording each tap stays exactly as it is.
- **Accept:** at 375 the card is about a third of the screen; the Viber path still copies first and shows the hint once; every tap still records last contact (existing tests).

### WP-9 Studio page first screen and "How booking works": 1.5 pts (storefront only)
- **Touches:** `apps/storefront/src/studio/components/*` (profile and contact), `src/intake/copy.ts`, `src/styles.css`, `test/studio/render.test.ts`.
- **What:** the hero is the name, one location line ("Thamel, Kathmandu" from the address), "Send your idea" (primary) and "WhatsApp" (secondary); contacts grouped as Chat / Follow / Visit; a 4-step strip (idea → price on WhatsApp → deposit holds your date → session); from 60 rem the form on the left and a sticky steps + policy panel on the right; the Cloudflare sentence moves under Send, with one reassuring line ("Only {studio} sees what you send.") above the form.
- **Accept:** at 375 the first screen holds the name, both buttons and the start of the steps; at 1280 no empty right half beside the form; the link rules in `src/studio/links.ts` hold (only `https:`, `tel:`, `mailto:`, `viber://chat`); no new script or font request.

### Deposit page quick win: state headings: 0.5 pt
- `apps/storefront/src/deposit/copy.ts` and the screen: one heading per state ("Deposit paid", "Screenshot sent", "Your quote is being updated", "This quote has expired", "This booking was cancelled"); paid also shows the amount and reference code as a receipt.
- **Accept:** each state's heading matches its message (check each deposit state in a browser).

## Structural work (after the slices)

| WP | Title | Size | Depends on | Notes |
|---|---|---|---|---|
| WP-10 | **Today** screen and navigation: Today · Inbox · Projects · Calendar · More (Clients, Artists, Settings) | 4 | WP-2, Q3 | New page + controller; `nav_items.ts` and its tests; owners land on Today (`dashboard_controller.ts:36`); a new `/t/:tenant/today` route needs an isolation case in `tests/isolation/cases.ts`. Sections: Needs you (screenshots to check, new requests, quotes expiring within 3 days, booked without a session, deposit links unpaid for 3+ days), Today's sessions, Waiting on clients, and the setup checklist (WP-5) until done. The bell counts only what the tabs don't. **Accept:** at 375, opening the app shows what needs action with counts; each row lands on the exact place to act; artists are reachable in 2 taps. |
| WP-11 | Project page full restructure | 4 | WP-3, WP-8 | Header (client, piece title, artist, status + 5-step progress line), a server-computed `nextStep` prop driving one Next step card, a money summary line ("Paid 5,000 of 20,000 · Balance 15,000") with the ledger behind "Show payments", secondary forms in a bottom `sheet`, inline confirms replacing every `window.confirm` (listed in audit X-8), closed projects read-only, desktop two columns (left 7/12, right 5/12 sticky). **Accept:** per status as in WP-3, plus: at 1280 no empty right third; no browser `confirm()` dialogs on project or inquiry pages. |
| WP-12 | Projects list that says what's waiting; desktop table | 2 | WP-2, WP-15b | Rows: client + piece title, reference thumbnail, status, one "waiting" line (quote age and expiry, screenshot to check, next session, balance). Desktop: a table sortable by "needs you". Drop "never contacted" from rows. |
| WP-13 | Deposit page v2 | 3 + 1 | headings quick win | Storefront: studio header (name, cover or initial, artist), "You pay {studio} directly…" under the amount, a "Pay with" segmented control showing one method at a time and preselecting "How did you pay?", numbered steps 1 Copy code → 2 Pay → 3 Send screenshot, a sticky "I've paid" button (a **button** that scrolls; never an `#` link), desktop QR beside the steps. Contract (+1): add the next scheduled session (start, artist) to the public deposit payload (`openapi.yaml` → generate → platform `DepositPageService` → SDK) for the paid ticket. **Accept:** due page at 375 shows one QR at a time and is under about 1,700 px; picking eSewa shows its QR and preselects eSewa; a paid deposit with a session shows date, time and artist; every token rule in `development.md` "Deposit page" still holds (guard test). |
| WP-14 | Finish a project and healing check | 3 | product decision | Today nothing reaches `completed` or `healing_check` (audit X-2; the TAT-66 "finish a project" carry-forward). "Mark the tattoo finished" in the Next step card (warns if a balance is due), then a healing check with the aftercare message. Backend + UI. |
| WP-15a | Image sizes | 2 | | `ImageService` stores 320 / 640 / 1280 px variants (sharp is already a platform dependency); the API returns `srcset` data; the storefront uses them. Needed before any photo grid. |
| WP-15b | Cover photo and artist work photos (up to 6 per artist) | 5 | WP-15a, Q2 | Migration (tenant cover image; `artist_work_photos` with `enableTenantRls()`, `EXPECTED_POLICIES` entry and isolation tests), Settings and artist form UI (an "Add photos" tray like the intake form's), public API contract and SDK, storefront hero, roster thumbnails, artist-page grid and a simple lightbox. **Accept:** at 375 the studio page opens on the cover with the name over it; each artist card shows 3 work thumbnails; images above the fold under about 250 KB; Lighthouse-style check on a throttled "Slow 4G" profile shows text before images. |
| WP-16 | Brand mark, empty-state line drawings, sidebar identity | 2 + design | Q1 | Inline SVG stencil drawings for empty Inbox, Projects, Calendar, Alerts and Clients; the studio's cover or initial in a stencil frame at the top of the sidebar and the Today header; a real Tattoo Drip mark (`resources/brand/mark.svg`, regenerate icons). |
| WP-17 | Desktop: inbox master-detail, week calendar grid | 4 | WP-1 | Inbox list + preview from 1,024 px; a 7-column time grid (8:00 to 20:00), one colour per artist; the phone keeps today's list. |

## Smaller items (each under 1 point; batch them)

- Devanagari names suggest a transliterated link (`सुजना तामाङ` → `sujana-tamang`) instead of an empty one (`~/lib/slugify`) (P-8).
- Native file inputs → "Add photo" tiles with a preview on the artist and payment-method forms (P-7).
- Messages settings as a list of six with one editor at a time and tap-to-insert placeholder chips (P-9).
- Inbox rows: the first reference as a 56 px thumbnail (P-5).
- A violet loading line under the top bar during Inertia visits; skeletons on the project page (X-10).
- Intake: number the three groups; make "How did you find {studio}?" optional (contract change, about 1 point with tests) (S-5).
- The intake sent state lists the 4 steps with step 1 ticked (S-6).
- Words: "request" for what the client sent (Inbox, Idea, Request cards), "Book a walk-in" vs "Add a session" (X-5).
- A short **piece title** on every project, prefilled from the request ("Koi, left calf"), editable (needs a column; feeds WP-11 and WP-12) (X-5, Q5).
- Closed projects: no artist picker and no "Mark contacted" (X-8).
- Hints at least 14 px on phones; desktop body 15 px (X-11).

## Suggested order

1. Slice 1: WP-1, WP-2, WP-3, WP-4 (6 pts).
2. Slice 2: WP-5, WP-6, WP-7, WP-8, WP-9, deposit headings (7 pts).
3. WP-10 Today (4), then WP-11 project restructure (4).
4. WP-14 finish a project (3): needed before the pilot has run long enough for projects to pile up in "In progress".
5. WP-13 deposit v2 (4), WP-12 projects list (2).
6. If Q2 is yes: WP-15a, WP-15b (7). Then WP-16, WP-17 and the smaller items as time allows.

About 48 points in total (roughly 24 working days). Slices 1 and 2 (about 13 points, 6 to 7 days) answer all three complaints visibly. Everything after that is depth.

## Decisions only the user can make

1. **Visual direction:** C Stencil & Ink (recommended), A Flash Sheet or B Night Studio. Blocks WP-1.
2. **Tattoo photos on the studio page before launch** (cover + up to 6 work photos per artist), although the roadmap puts the portfolio in V1. Recommended: yes, the small version (WP-15a/b, about 7 points), because it is the biggest single lever for "studio feel".
3. **A Today home and a new tab bar** (Today · Inbox · Projects · Calendar · More, with Clients, Artists and Settings under More). Recommended: yes.
4. **Default theme** for new users: follow the phone's light/dark setting on first visit, then the toggle wins. The alternatives are always light (today's code default) or always dark. Recommended: follow the phone.
5. **Words:** keep "Projects" and add a short piece title to each (recommended), or rename to "Bookings" or "Tattoos". Worth asking the friend's studio what they call them.

Also needs a yes (not a design question): whether "finish a project / healing check" (WP-14) is in the pilot scope. Recommended: yes.
