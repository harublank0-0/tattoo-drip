# TAT-110: Deposit page v2 (studio header, one QR at a time, steps, session on the receipt)

## 1. Header

- Ticket: TAT-110, WP-13 of the UX pass (`docs/superpowers/specs/2026-10-20-ux-build-plan.md`, row WP-13; audit `2026-10-20-ux-audit.md` D-2 to D-5). 5 points (storefront 3 + contract 1, sized 5).
- Branch: `harublank00/tat-110-deposit-page-v2-studio-header-one-qr-at-a-time-steps-session`, base `6c33791` (main, TAT-54 merged).
- Lane B: database `tattoo_drip_uy`; platform dev 3421, platform tests `PORT=3422`, storefront dev 3424, stand-in API 3425. A full platform suite run is wrapped in `flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock …`. Targeted specs need no lock. The storefront work needs no database.
- Goal in plain words: today a client on a phone scrolls past three full-size QR codes (about 3,400 px) before they reach the upload, and then gets asked again how they paid. After this ticket the page opens with the studio's mark and name. The amount comes next, with "You pay {studio} directly" under it, then three numbered steps (copy the code, pay, send the screenshot). The client picks one way to pay and sees only that QR. The pick also answers "How did you pay?". An "I've paid" button takes them to step 3. On a computer the QR sits beside the steps. Once the deposit is paid, the receipt shows the date, time and artist of the next session. That last part needs one additive field in the public deposit API.
- All commands need `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH` in front.

## 2. Scope fence

The builder may change only:

- `packages/types/openapi.yaml`, `packages/types/src/index.ts`, and `packages/types/src/openapi.gen.ts` (regenerate it only, never edit by hand)
- `packages/sdk/test/client.test.ts`, `packages/react/test/deposit.test.ts` (fixtures only)
- `apps/platform/app/modules/scheduling/services/session_service.ts`
- `apps/platform/app/modules/payments/services/deposit_page_service.ts`
- `apps/platform/app/transformers/public_deposit_transformer.ts`
- `apps/platform/tests/helpers/deposits.ts`
- `apps/platform/tests/functional/payments/deposit_page_service.spec.ts`
- `apps/platform/tests/functional/api/deposits.spec.ts`
- `apps/platform/tests/functional/scheduling/next_scheduled_session.spec.ts` (new)
- `apps/storefront/src/deposit/{copy.ts,view-model.ts,loader.ts,browser.ts}`
- `apps/storefront/src/deposit/components/{deposit-page.tsx,deposit-screen.tsx,proof-form.tsx,proof-picker.tsx}` and a new `apps/storefront/src/deposit/components/steps.tsx`
- `apps/storefront/src/studio/text.ts` (export `graphemes` only)
- `apps/storefront/src/styles.css` (the deposit block only, lines 364 to 432 today)
- `apps/storefront/test/deposit/*`
- Docs: `apps/storefront/docs/development.md`, `apps/platform/docs/backend.md`, `docs/requirements.md`, `docs/sdk.md`

NOT in this plan:

- The cover photo in the deposit header. It waits for TAT-112's small image sizes (user decision U2).
- An artist avatar. The deposit payload has no artist photo, and adding one is another contract change.
- The studio's address and map link, and a "what to bring" note on the receipt (audit D-2 extras).
- Merging "How did you pay?" into "Pay with" (user decision U1).
- The session on any state but `paid` (user decision U3).
- A Nepali copy file.
- Studio themes on the deposit page. It stays not themable: its route writes no brand `<style>`.
- Any migration, new route or new runtime dependency.
- The dashboard (`apps/platform/inertia`).
- `check-page.mjs` changes.

## 3. Facts verified on this branch

Contract and platform:

- `packages/types/openapi.yaml:351-381`: `getDeposit` answers `{ data: DepositPage }`. `DepositPage` (`:867-926`) has `additionalProperties: false`, and every property is required (nullable ones are `[x, "null"]`). The document says "Changes within v1 must be additive" (`:7`). A nullable object is written `oneOf: [{ $ref }, { type: "null" }]` (`Artist.photo`, `:738-740`).
- `packages/types/src/index.ts:24-27` exports `DepositState`, `DepositPaymentMethod`, `DepositPage` and `DepositProofForm`. The SDK re-exports every type (`packages/sdk/src/index.ts:1`). `deposits.get` passes the JSON through without checking it (`packages/sdk/src/client.ts:255-266`). An older storefront therefore ignores a new field.
- Fixtures typed `DepositPage`: `packages/react/test/deposit.test.ts:14-31` (typed, so its `tsc -p tsconfig.test.json` breaks when a required field is missing), `apps/storefront/test/deposit/fixtures.ts:12-51` (typed). `packages/sdk/test/client.test.ts:555-573` is untyped.
- `DepositPageService.show` (`apps/platform/app/modules/payments/services/deposit_page_service.ts:109-145`) reads the link, the quote, the project, `remaining`, `pendingProof` and the state, then `artistName` (`:213-220`, one `ArtistService.list` when the project has an artist; live profiles, hidden ones included), then `lastDecisionRejected` and the methods only in `due`. The constructor is at `:86-94` (7 services). `submitProof` calls `show` three times (`:164`, `:178`, `:194`).
- `PublicDepositTransformer` (`apps/platform/app/transformers/public_deposit_transformer.ts:12-43`) says it never sends sessions. It writes `proofSubmittedAt` as `toUTC().toISO() ?? null` (`:31`).
- Exactly two places build `DepositPageService` by hand: `apps/platform/tests/helpers/deposits.ts:27-48` (`depositServices`) and `apps/platform/tests/functional/payments/deposit_page_service.spec.ts:292-300`. The container injects it everywhere else.
- `SessionService` (`apps/platform/app/modules/scheduling/services/session_service.ts`) has `listForProject` (`:144-154`, tenant plus project, ordered `starts_at, id`) and `assertProjectOf` (`:624-628`). Its constructor takes `ArtistService` and `DepositService` (`:102-105`). `DepositService` depends only on `QuoteService`, so `DepositPageService → SessionService` makes no cycle.
- `ProjectSession` uses the soft-delete mixin, so model queries skip deleted rows (`app/models/mixins/soft_deletes.ts`). Its statuses are `scheduled`, `completed`, `no_show` and `cancelled`, and its kinds are `consultation`, `tattoo` and `touch_up` (`models/project_session.ts:5-14`). `project_sessions` has the index `(tenant_id, project_id)` (`database/migrations/1791600000000_create_project_sessions_table.ts:50`).
- Test helpers: `makeSession(tenant, project, artist, over)` (`tests/helpers/pipeline.ts:254-271`; default 2 Nov 2026 10:00 to 12:00 UTC; the no-overlap constraint is per artist). `makeArtist(tenant, slug)` always names the artist "Sita" (`:43-45`). `makePayment` (`:206-220`). `recordQueries(fn)` (`tests/helpers/query_count.ts`). `studioWithDeposit` and the `verified()` payment pattern for a paid page are at `deposit_page_service.spec.ts:42-59` and `:213-216`.
- The HTTP test pins the whole body: `tests/functional/api/deposits.spec.ts:63-104` (`assertApiData`, deepEqual). No other spec deep-compares a `DepositPage` (checked with `rg`).
- The public isolation case for `GET /api/v1/tenants/:tenant/deposits/:token` is at `tests/isolation/public_cases.ts:102-109`. No route is added here, so no case is needed.
- QR codes are stored with `ImageService` under the purpose `payment_qr`, which is public (`app/modules/media/services/image_service.ts:14`). Each method's `qrImageUrl` is already in the payload (`deposit_page_service.ts:222-236`). The deposit page lists methods in `position` order and never cash (`payment_method_service.ts:68-75`).
- Payment method rules (`app/modules/payments/rules.ts:22-27, 85-120`): Fonepay must have a QR and keeps no details. eSewa and Khalti have a QR or an ID. A bank has its name, the account name and the number, and a QR is optional. So every listed method has a QR or a number, unless its QR URL fails `safeImageUrl`.

Storefront:

- The token is read only in `components/deposit-screen.tsx` (`useLocationHash`, `:31-46`). The server renders the shell (`DepositForHash`, `:63-88`). `DepositLoaded` (`:91-205`) draws `DepositFrame`, `DepositIntro`, `StateRegion`/`StateMessage`, `DueView` with `ProofForm`, and `ContactLine`.
- `components/deposit-page.tsx`:
  - `DepositFrame` (`:32-63`) is `<main class="deposit">` holding the h1, plus a footer with `copy.footer`.
  - `DepositIntro` (`:165-193`) holds the brief and "with {artist}".
  - `StateMessage` (`:196-228`) holds the state sentence and, for `submitted` and for paid with an amount, a `<dl>` with Amount and Reference code (`receiptAmount`, `view-model.ts:260-266`).
  - `DueView` (`:231-307`) holds amount, code, "How to pay" with every method and the same-phone hint, then the policy, then the form.
  - `MethodCard` (`:310-378`) renders the h3 label, the QR `img` (280×280, eager only for the first one with a QR, `referrerPolicy="no-referrer"`), the caption and the details with `CopyButton`.
- `view-model.ts`:
  - `depositView` (`:83-111`); method ids are positional, `method-${index}` (`:117`).
  - `kinds`: each kind once, in order (`:106`).
  - `takesProof` (`:108-109`).
  - `formatReceived` (`:180-203`) builds en-GB parts in the studio's timezone.
- `proof-form.tsx`:
  - The default `method` is the only kind, or "" (`:90-93`).
  - The heading is `<h2 id="proof-title">` (`:273`), inside `<section className="deposit-block" aria-labelledby="proof-title">` (`:272`).
  - The ChoiceField radios have the ids `method-0…` (`components/ui/form.tsx:236`), and the error summary targets `method-0` (`problems.ts:236-259`).
- `copy.ts`:
  - `footer` (`:218-219`): "You pay {studio} directly. Tattoo Drip runs this page for them and never handles your money."
  - `methods.title` "How to pay" and `samePhone` (`:139-151`).
  - `form.title` "After you pay, send a screenshot" (`:156`).
- `loader.ts:13-34`: `DepositShell = { studioName, timezone, phone }` from the cached studio. It makes no API call (`test/deposit/loader.test.ts`).
- `test/deposit/guard.test.ts`:
  - It bans storage, `console.`, `location.search`, `searchParams`, `style={`, `target=`, `dangerouslySetInnerHTML`, posthog and sentry in `src/deposit/**`.
  - It bans `href="#…"` and the `disabled=` attribute.
  - Only `deposit-screen.tsx` may read `location.hash`.
  - Imports are limited to relative paths, `react`, the SDK, the hooks, `@tanstack/react-form` and `lucide-react`.
  - `seo.ts` and `head-copy.ts` imports are pinned.
- Tests that pin today's look, and that this plan changes on purpose:
  - `render.test.ts:85-98` (footer words), `:277-372` (due: every method, three `aria-live` regions, copy buttons for every number, "first QR eager, others lazy"), `:239-275` (artist in the intro).
  - `form.test.ts:138-168` (h2 text, no radio checked with two kinds).
  - `screen.test.ts:15-33` ("You pay Black Needle directly." in the shell).
  - `copy.test.ts:84,140-143` (`form.title`, the footer).
- Theme seam (TAT-54):
  - `parseThemeConfig(storefrontInput(studio), imageOrigin)` (`src/studio/theme/config.ts:236-253`, `theme/source.ts`) gives a checked `logo` (`BrandImage { src, width, height }`, on the API's origin only) and a `heroImage`. The API sends no `storefront` yet, so both are null on every real page.
  - `config.ts` is pure: it imports only `../links.ts` and `../text.ts`.
  - `development.md:101`: the deposit page is not themable, and its route adds no brand `<style>`.
  - Test helpers: `withStorefront`, `IMAGE_ORIGIN`, `LOGO` (`test/studio/theme-fixtures.ts`).
- `src/studio/text.ts:92-100`: `graphemes` (Intl.Segmenter, else `Array.from`) is private. The studio name always exists: `cleanLine(name) ?? slug` (`src/studio/view-model.ts:111`).
- `styles.css`:
  - `html { scroll-behavior: smooth }` unless reduced motion (`:148-150`).
  - `.step::before` is the studio page's numbered square (`:211`).
  - The deposit block is at `:364-432`: one 28rem column, gap 2rem, QR `max-inline-size: 17.5rem` with a white background.
- `node -e` probe of the planned formatter: `2026-10-24T05:15:00Z` in `Asia/Kathmandu` gives `Sat 24 Oct 2026, 11:00 am`, and `18:45Z` gives `Sun 25 Oct 2026, 12:30 am`. en-GB writes September as `Sept`, the same as `formatReceived` and the platform's `formatDay`. Segmenter gives `का` for "कालो".
- `pnpm dev` pins port 3000 and loads `.env.local` (`apps/storefront/package.json:9`). On lane B, run Vite directly (§9).

## 4. Decisions

Decisions made here, each with its reason and the alternative rejected:

1. **Contract.**
   - `DepositPage.nextSession` is required and nullable: `oneOf: [{ $ref: DepositSession }, { type: "null" }]`.
   - The new schema is `DepositSession { startsAt: string (date-time, a UTC instant), artistName: string | null }`, with `additionalProperties: false`. The type `DepositSession` is exported from `@tattoo-drip/types`, and so from the SDK.
   - Why: every `DepositPage` property is "always there". The change is additive, because an older storefront ignores it and the SDK checks nothing at runtime. A newer storefront against an older API reads `undefined` as null (decision 9).
   - Rejected: an optional `?:` property, which breaks the contract's "always there" style; a preformatted `startsText`, which bakes English into the API, while the page already formats instants in the studio's timezone (`formatReceived`); a `timezone` field, which repeats what the shell already has from `getStudio` for the same tenant.
2. **Which session.** The project's earliest session that is `scheduled`, not soft-deleted and has `ends_at > now`, of any kind, ordered by `starts_at` and then `id`.
   - Why: "your next visit" is whatever comes next, a consultation or a touch-up included. Using `ends_at` keeps a session that is under way on the receipt and drops stale ones whose outcome was never recorded.
   - Rejected: tattoo sessions only (a touch-up after a finished piece is still the next visit); `starts_at > now` (the visit would vanish from the receipt while it is happening).
3. **Which artist.** The session's own `artist_id`, named from the live profiles (`ArtistService.list`, hidden ones included, the same rule as `artistName`). A deleted profile gives `artistName: null`.
   - Rejected: the project's artist, which is wrong for a guest artist or a swap.
4. **When.** `nextSession` is filled only when the state is `paid`, and is null in every other state. `cancelled` wins over `paid` already (`depositState`).
   - Why: the least exposure. A cancelled or expired booking must never show a time, and the ticket asks only for the paid ticket. Pages in other states make no extra query.
   - Rejected: sending it always and hiding it in the storefront (U3 covers `submitted`).
5. **Time zone and format.** The storefront formats `startsAt` in the shell's `timezone` with `formatSessionStart`: en-GB parts, 12-hour, "Sat 24 Oct 2026, 11:00 am", like `formatReceived` on the same page. A zone the browser doesn't know gives null, and the session rows are then left out. It never falls back to UTC, which would show a wrong time.
   - Rejected: 24-hour "11:00" like the dashboard calendar. One time style per page.
6. **Header.**
   - Inside `<main>`, above the h1: a mark, the studio's name (`dir="auto"`, display face) and, once read, "with {artist}" (the project's artist).
   - The artist line moves out of `DepositIntro`, which keeps only the brief.
   - The mark is the theme's checked **logo** (`parseThemeConfig(storefrontInput(studio), apiUrl).logo`, carried in `DepositShell.logo`), else the studio's initial (its first grapheme as typed) in a violet-outlined square.
   - Never the cover (U2). The accent stays violet. The deposit route still writes no brand `<style>`, and a guard pins that.
   - Rejected: the cover now. It is the full stored photo, up to 2048 px, with no small size before TAT-112, at the top of a payment page on mobile data. It competes with the QR, and at 3:1 it costs about 115 px of height.
7. **Copy.**
   - Under the amount (due only): "You pay {studio} directly. Tattoo Drip never handles your money."
   - The footer on every state becomes "Tattoo Drip runs this page for {studio}." so the money line is not said twice.
   - The step headings are "Copy the code", "Pay" and "Send the screenshot". `form.title` changes, and its pinned test changes on purpose.
   - The sticky button reads "I've paid: send the screenshot".
   - Rejected: keeping the old footer next to the new line (said twice on one screen).
8. **"Pay with" is a native radio group.**
   - `<fieldset class="deposit-paywith">` with a visually hidden legend "Pay with", and one `<label>` around each `<input type="radio" name="pay-with" id="pay-with-N">` with the method's own label (`dir="auto"`).
   - It sits outside the proof `<form>`, so Enter can't send anything. The radio dot stays visible, so the choice never relies on colour alone.
   - Arrow keys move and select, which is native. Tab enters at the checked one. The panel follows in reading order, with no live region, because the change is the client's own.
   - Shown only with two or more methods.
   - Rejected: ARIA tabs (custom key handling, and tab semantics are wrong for a choice that also answers a question); `aria-pressed` buttons (no arrow keys, no group); a `<select>` (one more tap, and it hides the options).
9. **No JavaScript.** Nothing of the deposit renders without JavaScript. The token is in the fragment, and the server renders only the shell with its `<noscript>` line. So the control has no server state to degrade to, and it never appears before hydration. Native radios need no custom script for keyboard or screen-reader use.
10. **Selection.**
    - `DepositLoaded` keeps `pickedMethod: string | null` (a `MethodView.id`). The pure `selectedMethod(methods, picked)` gives the picked method while it is still listed, else the first, else null.
    - The pick preselects "How did you pay?" one way: each new pick sets the form's `method`. A manual change in step 3 stays until the next pick. On load, the first method's kind is preselected.
    - Rejected: two-way sync (picking an answer in step 3 would swap the QR under the client's eyes, and it can loop); merging both questions (U1).
11. **One panel for the picked method, keyed by its id.** `<div key={method.id} class="deposit-method-panel">` holds the QR figure, the caption, the same-phone hint and the details. A switch makes a fresh `img`, so the previous QR never shows while the next one loads, which would let a client scan the wrong code. It also makes a fresh `CopyButton`, so a "Copied" never sits next to another method's number. The QR is always eager.
12. **Steps are numbered h2 headings**: `<span class="deposit-step-number" aria-hidden="true">N</span><span class="sr-only">Step N: </span>Title`. They are not an `<ol>`, because the desktop grid needs the panel as a sibling of the step blocks. The "Deposit due" h2 above the amount becomes `sr-only`: the h1 already says what to do, and that saves about 35 px.
13. **"I've paid" is a `<button type="button">`** in a `.deposit-paid-bar` placed in the DOM right before step 3.
    - The bar is `position: sticky; inset-block-end: 0`, below 60rem only. While the client is in steps 1 and 2 it sticks to the bottom of the screen; once they reach step 3 it settles in its own place above it. It never covers Send. This is CSS only.
    - Styled `action action-secondary`, so Send stays the one primary action.
    - Tapping calls `showProofStep()` (`browser.ts`): `getElementById("proof-title")`, `scrollIntoView({ block: "start" })` (smooth unless reduced motion, from the CSS), then `focus({ preventScroll: true })`. The h2 gets `tabIndex={-1}` and `scroll-margin-block-start: 1rem`.
    - The URL is never touched.
    - `:root:has(.deposit-paid-bar)` gets `scroll-padding-block-end: 5rem` below 60rem, so a keyboard focus in steps 1 and 2 is never hidden under the bar (WCAG 2.4.11).
    - Rejected: a fixed bar hidden by an IntersectionObserver (JavaScript, a flash, and it covers Send unless it hides in time); a `#proof-title` link (it replaces the token, which is banned).
14. **Desktop (from 60rem), only while due with methods.**
    - `DepositFrame` gets `wide`, so `main` and the footer become `min(60rem, 100% - 4rem)`.
    - The header, h1 and brief span the top. `.deposit-due` becomes two columns, `minmax(0, 1fr) minmax(0, 22rem)` with a 3rem gap. The left column holds amount, code, pay, proof and policy; the right holds the panel, sticky at 1.5rem with `align-self: start`.
    - QR `max-inline-size: 20rem`. The bar and the same-phone hint are `display: none`.
    - `grid-area` names are set **only inside that media query**: a named area that the template doesn't define makes implicit lines, and every item would land in one cell.
    - Rejected: a second copy of the QR toggled with `display: none` (the TAT-105 steps pattern), which puts two alts and two copy buttons in the DOM.
15. **Copying is unchanged.** `CopyButton`/`copyText` works as before: the clipboard API, else `execCommand`; "Copied" for 2 s, "Couldn't copy. Press and hold the text to copy it." for 6 s, in a polite region. It sits on the code (step 1) and on the picked method's number or ID. `user-select: all` stays. There is no Copy on the amount, because the page never formats paisa.
16. **Empty cases.**
    - No method: step 2 shows `copy.methods.none`. There is no panel, no bar, no form and no wide layout.
    - One method: no radios. The panel opens with "Pay with {label}", and "How did you pay?" is preselected as today.
    - A method without a QR: the panel holds the details only (on a desktop, in the right column).
    - A method with neither (its QR URL failed `safeImageUrl`): "Ask {studio} for these details."
17. **Height levers, all applied by design:**
    - one panel;
    - QR 15rem below 60rem;
    - an `sr-only` "Deposit due" h2;
    - an `sr-only` "Payment screenshot" legend (the step 3 heading names it);
    - a shorter same-phone hint;
    - gaps of 1.5rem in `.deposit` and `.deposit-due`, and top padding of 1.5rem;
    - a one-line footer with a 2rem top margin.

    My estimate for the 3-method fixture at 375 px is still about 1,900 to 2,150 px. See U1.
18. **Queries.** A paid page makes exactly one session query, and still at most one artists query, shared by both names. A page in any other state makes no session query. A test pins this.
19. **Isolation.**
    - The session query is filtered by `tenant_id` and the resolved link's `project_id` (`assertProjectOf` first), and runs inside the public request's RLS context.
    - A functional test proves that another project's and another studio's sessions never show.
    - `tests/isolation/public_cases.ts` is unchanged: no new route, and the GET case still covers it.

User-only decisions (each with the default the builder uses): see section 13.

## 5. Design

Voice: a calm studio manager, short and specific. Words go in `copy.ts`. Names inside sentences go in `<bdi>` (`<Fill>`). User text gets `dir="auto"`. No uppercase, letter-spacing, clamps or ellipses on user text. Colours come only from tokens: `--paper`, `--ink`, `--ink-muted`, `--line`, `--line-strong`, `--stencil`, `--stencil-wash`, `--on-stencil`, `--destructive`. They are already defined for light and dark (`styles.css:55-105`). The QR keeps its white background in both schemes so it stays scannable. Server-computed: the shell (name, timezone, phone, logo), and so the header, the h1, the skeleton and the contact links. Client: everything from `useDeposit`.

### 375 × 812, due, three methods, eSewa picked

```
[B] Black Needle                      header: 2.75rem mark (logo, else initial), name in Eczar 1.125rem
    with Sita Rai                     muted 0.9375rem, after load
Pay your deposit to Black Needle      h1 (unchanged)
Fine line peony on the left forearm   brief (folded over 240 characters, as today)
NPR 3,000                             amount 2.5rem Eczar; sr-only h2 "Deposit due"
Pay by 28 Oct 2026, in 10 days.
You pay Black Needle directly. Tattoo Drip never handles your money.   (muted)
(1) Copy the code                     numbered h2 (2rem violet-outlined square, like .step::before)
[ 7K3M9Q ] [Copy code]
Write this code in the payment remark (or note).
(2) Pay
(o) Fonepay  (•) eSewa  (o) Bank transfer       radios as chips, wrap, each at least 44px tall
[ eSewa QR, 15rem ]
Scan it with your eSewa app.
On this phone? Press and hold the QR code to save it, then choose it in your payment app's scanner.
Account name  Black Needle
eSewa ID      9812345678  [Copy]
[ ↓ I've paid: send the screenshot ]  sticky at the bottom until here; secondary style, full width
(3) Send the screenshot               h2#proof-title, tabIndex -1
How did you pay?  (o) Fonepay (•) eSewa (o) Bank transfer    preselected from step 2
[+ Add screenshot]  A screenshot or a photo of the payment: JPEG, PNG or WebP.
[ Send screenshot ]                   primary
Deposit policy …
Questions? Message Black Needle: WhatsApp  Viber
──
Tattoo Drip runs this page for Black Needle.
```

### 1280 × 800, due

The header, h1 and brief run across a 60rem column. Below them, the left column (about 35rem) holds the amount, steps 1 to 3 and the policy. The right column (22rem) holds the picked method's panel, sticky: the QR at 20rem, the caption and the details. There is no bar and no same-phone hint. The QR's top is on the first screen.

### Other states and the shell

- Loading (and the server render): header (mark and name, no artist yet), h1, skeleton, noscript line, contact.
- Problems: header, the matching h1 (TAT-119), the message.
- `submitted`, `updating`, `expired` and `cancelled` are as today in the 28rem column, with the header above.

### Paid receipt (inside the existing stencil-framed `.deposit-state`)

```
Your deposit is paid. Thank you!
Amount          NPR 3,000
Reference code  7K3M9Q
Your session    Sat 24 Oct 2026, 11:00 am      <time dateTime="2026-10-24T05:15:00.000Z">
Artist          आरव श्रेष्ठ                     dir="auto"; row left out when null
```

- A paid page with `amount: 0` ("No deposit is needed for this booking.") shows a `<dl>` with only the session rows when there is a session.
- With no session, or a zone the browser doesn't know, the receipt is as today.

### Details

- Devanagari and long names: header name, chip labels, artist and details have `overflow-wrap: anywhere` and `dir="auto"`. The initial is a grapheme ("का", not "क").
- Tap targets: chips, Copy, I've paid, Add screenshot and Send are at least 44 px tall. Contact links stay 44 px wide as well.
- Chip CSS: border `--line-strong` (3.4:1). The checked chip has border `--stencil` and background `--stencil-wash`, plus the radio dot (`accent-color: var(--stencil)`). Focus: `label:has(:focus-visible)` gets a 2px `--stencil` outline.
- Empty, error and loading states: section 4, decision 16, and above.

## 6. Data and contract

`packages/types/openapi.yaml`:

- In `getDeposit`'s description, add ", and once it is paid, the project's next session".
- Add `nextSession` to `DepositPage.required` and to its properties:

```yaml
        nextSession:
          description: Once the deposit is paid, the project's next session; null in every other state and when none is scheduled.
          oneOf: [{ $ref: "#/components/schemas/DepositSession" }, { type: "null" }]
```

- The new schema, next to `DepositPage`:

```yaml
    DepositSession:
      type: object
      description: |
        The project's earliest session that is still scheduled and hasn't
        ended, of any kind (TAT-110).
      required: [startsAt, artistName]
      additionalProperties: false
      properties:
        startsAt:
          type: string
          format: date-time
          description: When it starts, as a UTC instant. Show it in the studio's `timezone` (getStudio).
          examples: ["2026-10-24T05:15:00.000Z"]
        artistName:
          type: [string, "null"]
          description: The session's own artist; null when that profile was deleted.
```

- Then run `pnpm --filter @tattoo-drip/types generate`. Add `export type DepositSession = Schemas["DepositSession"];` to `packages/types/src/index.ts` after `DepositPage`. The SDK needs no code change.

Platform:

- `SessionService.nextScheduled(tenant, project, now = DateTime.utc())`: one query on the existing `(tenant_id, project_id)` index.
- `DepositPage` (the service type) gains `nextSession: NextSession | null` with `export type NextSession = { startsAt: DateTime; artistName: string | null }`.
- The transformer adds `nextSession`.
- No migration, no RLS change, no route and no `TENANT_ROUTE_ROLES` or isolation-case entry.
- Queries: a paid page makes 1 more query than today. Other states make none more. At most 1 artists read stays.

Storefront:

- `DepositShell` gains `logo: BrandImage | null`. `DepositView` gains `session: SessionView | null`.

## 7. Tasks

Every task: write the failing test first, run it and see it fail, implement, run again, commit. The builder ends each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every message below passed `pnpm exec commitlint` (subject and body).

### T0. Baseline (no commit)

- Write a stand-in API in your scratchpad: plain `node:http`, no dependencies, on port 3425. Model it on `/home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/tat106-browser/fake-api.mjs` (read it; don't run it from there).
  - It answers `GET /api/v1/tenants/:slug` with studio "Black Needle" (`+9779812345678`, `Asia/Kathmandu`) and a Devanagari studio "कालो सुई ट्याटु स्टुडियो". A third studio variant sends `storefront: { branding: { logo: { url: "http://localhost:3425/uploads/logo.svg", width: 240, height: 80 } } }`.
  - It answers `GET /api/v1/tenants/:slug/deposits/:token` per token, and `/uploads/*.svg` with 280×280 SVG squares, `image/svg+xml`.
- Fixture `due3` (the budget fixture):
  - brief "Fine line peony on the left forearm", artist "Sita Rai", `due 300000` "NPR 3,000", `payBy` 10 days from today, code `7K3M9Q`;
  - methods: Fonepay (QR, no details); eSewa (QR, account name "Black Needle", ID `9812345678`); Bank transfer (no QR, "Nabil Bank", "Black Needle Pvt Ltd", `01234567890123`);
  - policy `"Deposits hold your date.\nThey are kept if you cancel within 48 hours."`.
- Other tokens:
  - due variants `due2` (the eSewa and bank methods of `test/deposit/fixtures.ts`), `due1` (eSewa only), `due0` (no methods);
  - `paid-session` (`nextSession: { startsAt: <now + 3 days at 05:15Z>, artistName: "आरव श्रेष्ठ" }`), `paid-session-noartist`, `paid-none` (`nextSession: null`), `paid-old` (the field missing), `paid-zero-session`;
  - `submitted`, `updating`, `expired`, `cancelled`, and a 404 token.
- Start the storefront from `apps/storefront`: `API_URL=http://localhost:3425 STOREFRONT_URL='http://{tenant}.localhost:3424' pnpm exec vite dev --port 3424 --strictPort`.
- With Playwright (playwright-core and Chromium as in run7), at 375×812 (isMobile, DPR 2, light), open `http://black-needle.localhost:3424/deposit#<due3 token>`. Wait for `.deposit-amount` and `document.fonts.ready`, then record `document.documentElement.scrollHeight`. This is the "before" value.
- Stop the dev server by its PID, and keep the API running.

### T1. The contract (types, fixtures)

- Failing test first: add `nextSession: null` to `PAGE` in `packages/react/test/deposit.test.ts` and in `apps/storefront/test/deposit/fixtures.ts`, and to the SDK's untyped `PAGE` (`packages/sdk/test/client.test.ts:555`). `pnpm --filter @tattoo-drip/react typecheck` fails: "Object literal may only specify known properties".
- Implement: the `openapi.yaml` edits in section 6, then `pnpm --filter @tattoo-drip/types generate`, then the `index.ts` export.
- Run: `pnpm --filter @tattoo-drip/types typecheck && pnpm --filter @tattoo-drip/sdk test && pnpm --filter @tattoo-drip/react typecheck && pnpm --filter @tattoo-drip/react test && pnpm --filter @tattoo-drip/storefront typecheck`.
- Commit:

```
feat(types): the deposit page carries its next session once paid (TAT-110)

DepositPage.nextSession is a DepositSession (startsAt, a UTC instant, and artistName)
or null. Required and nullable like every DepositPage property; older storefronts
ignore it. The SDK, React and storefront fixtures gain nextSession: null.
```

### T2. `SessionService.nextScheduled`

- Failing test first: new `apps/platform/tests/functional/scheduling/next_scheduled_session.spec.ts`, modelled on `scheduled_tattoo_projects.spec.ts:1-25`, with group `SessionService.nextScheduled (TAT-110)` and `wrapInGlobalTransaction`. Use `now = DateTime.utc().startOf("hour")` and sessions relative to it.
  1. "the earliest scheduled session that hasn't ended, of any kind": a completed one yesterday; a cancelled one tomorrow; a `no_show` one in 2 days; a soft-deleted scheduled one in 1 day (`softDelete()`); a scheduled consultation in 3 days (artist A); a scheduled tattoo in 10 days (artist B). It returns the consultation.
  2. "one under way still counts; one that ended without an outcome doesn't": a scheduled session that started 1 h ago and ends in 1 h, which is returned. Then with only a scheduled one that ended 1 h ago, it returns null.
  3. "only this project's, only this tenant's": another project of the same client in the same studio has a session tomorrow, and studio B (`studioWithOwner("next-b-110")`) has one too. The project with none gets null.
  4. "refuses another tenant's project": calling with tenant B and A's project throws (`assertProjectOf`).
  - Use `makeSession` with different artists, or different times for one artist (no overlap).
  - It fails today with `TypeError: sessions.nextScheduled is not a function`.
- Implement, in `session_service.ts` after `listForProject`:

```ts
	/**
	 * The project's next session (TAT-110, the paid deposit page): its
	 * earliest live `scheduled` session that hasn't ended at `now`, of any
	 * kind, or null. One query on the (tenant_id, project_id) index.
	 */
	async nextScheduled(
		tenant: TenantRef,
		project: TattooProject,
		now: DateTime = DateTime.utc(),
	): Promise<ProjectSession | null> {
		assertProjectOf(tenant, project);
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("status", "scheduled")
			.where("ends_at", ">", now.toJSDate())
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc")
			.first();
	}
```

- Run: `DB_DATABASE=tattoo_drip_uy PORT=3422 timeout -s KILL 300 pnpm -C apps/platform exec node ace test functional --files=next_scheduled_session`.
- Commit:

```
feat(platform): find a project's next scheduled session (TAT-110)

SessionService.nextScheduled: the earliest live scheduled session of the project that
hasn't ended, any kind, or null; one query on the (tenant_id, project_id) index.
```

### T3. The paid deposit page shows it (service, transformer, HTTP)

- Failing tests first:
  - `tests/functional/api/deposits.spec.ts:71-101`: add `nextSession: null` to the expected body. It fails, because the key is missing.
  - New test in the GET group: "a paid page carries the next session as a UTC instant and the session's artist".
    - Set up `deposit()`, then `makePayment(tenant, project, { status: "verified", verifiedAt: DateTime.utc() })`, then set `project.status = "booked"`.
    - Use a second artist `Artist.create({ tenantId, name: "Aarav Shrestha", slug: "aarav" })`.
    - Add `makeSession(tenant, project, aarav, { startsAt: DateTime.utc(2030, 3, 2, 5, 15), endsAt: DateTime.utc(2030, 3, 2, 8, 15) })`.
    - Expect, with `assertApiData`, the whole paid body (`due: 0`, `dueText: "NPR 0"`, `paymentMethods: []`, `state: "paid"`) with `nextSession: { startsAt: "2030-03-02T05:15:00.000Z", artistName: "Aarav Shrestha" }`, and `project.artistName` still "Sita".
  - New group `DepositPageService.show: the next session (TAT-110)` in `deposit_page_service.spec.ts`:
    1. "a paid page names the project's next session and that session's own artist". `artistName` is the project's ("Sita"); `nextSession.artistName` is "Aarav Shrestha"; `startsAt.toMillis()` matches.
    2. "only a paid page has one". With a future scheduled session, the `due`, `submitted`, `updating`, `expired` and `cancelled` (a verified payment plus `cancelled`) pages all give `nextSession: null`. Reuse the setups of the "each state" test at `:193-247`.
    3. "another project's and another studio's sessions never show". Studio A's paid project has none, while another A project and a paid studio-B project have sessions. A's `nextSession` is null and B's is B's own.
    4. "a session whose artist profile was deleted shows without a name" (`artist.softDelete()`).
    5. "a paid page reads the sessions once and the artists at most once; a due page reads no session". Use `recordQueries` around `show`. Count `queries.filter((sql) => /project_sessions/.test(sql))` (1 paid with 3 sessions and 2 artists, 0 due) and `/from "artists"/` (≤ 1).
  - They fail because `nextSession` is undefined and the count is 0.
- Implement:
  - `tests/helpers/deposits.ts`: make `const sessions = new SessionService(artists, deposits);`, use it for `ProjectService` and as the new last argument of `DepositPageService`, and return `sessions`.
  - `deposit_page_service.spec.ts:292-300`: pass `base.sessions` as the last argument.
  - `deposit_page_service.ts`:
    - import `SessionService` with the same `biome-ignore` comment as the other services;
    - append `private sessions: SessionService` to the constructor;
    - add `NextSession` and `nextSession` to the `DepositPage` type.
  - In `show`, after `state`:

```ts
		const next =
			state === "paid"
				? await this.sessions.nextScheduled(tenant, project)
				: null;
		const nameOf = await this.artistNames(tenant, [
			project.artistId,
			next?.artistId ?? null,
		]);
```

  - Then use `artistName: nameOf(project.artistId)` and `nextSession: next ? { startsAt: next.startsAt, artistName: nameOf(next.artistId) } : null`.
  - Replace `artistName()` with:

```ts
	/** One read of the live profiles (hidden ones too) when any id is set; a lookup by id. */
	private async artistNames(
		tenant: DepositStudio,
		ids: (string | null)[],
	): Promise<(id: string | null) => string | null> {
		if (!ids.some(Boolean)) return () => null;
		const artists = await this.artists.list(tenant);
		return (id) => artists.find((artist) => artist.id === id)?.name ?? null;
	}
```

  - Transformer: `const startsAt = page.nextSession?.startsAt.toUTC().toISO() ?? null;` and `nextSession: page.nextSession && startsAt ? { startsAt, artistName: page.nextSession.artistName } : null`. Rewrite its doc comment: "…never notes, the client, the quote history, the price or the proof image; of the sessions, only the next one's start and artist, once paid (TAT-110)".
- Run:
  - `DB_DATABASE=tattoo_drip_uy PORT=3422 timeout -s KILL 600 pnpm -C apps/platform exec node ace test functional --files=deposit_page_service --files=deposits --files=deposit_refusals --files=public_api`. If several `--files` aren't taken, run them one after another.
  - `pnpm --filter @tattoo-drip/platform typecheck`.
- Commit:

```
feat(platform): a paid deposit page shows the next session and its artist (TAT-110)

DepositPageService.show reads SessionService.nextScheduled only once the page is
paid and names the session's own artist from the one artists read it already
makes. The transformer sends startsAt as a UTC instant.
```

### T4. Storefront view model and copy

- Failing tests first:
  - `test/deposit/view-model.test.ts`:
    - `selectedMethod`: picked present gives it; unknown or null gives the first; `[]` gives null.
    - `formatSessionStart`: `"2026-10-24T05:15:00.000Z"` in `Asia/Kathmandu` gives `"Sat 24 Oct 2026, 11:00 am"`; `18:45Z` gives `"Sun 25 Oct 2026, 12:30 am"`; `"nope"` gives null; `"Not/AZone"` gives null.
    - `studioInitial`: "Black Needle" gives "B", "कालो सुई" gives "का", "  x" gives "x".
    - `depositView(page({ state: "paid", nextSession: { startsAt, artistName: "  Aarav  " } })).session` deep-equals `{ startsAt, artistName: "Aarav" }`. For `state: "due"` with a session it is null. For `nextSession` missing (`{ ...PAGE, nextSession: undefined }` cast) it is null. For a `startsAt` that isn't a date it is null.
  - `test/deposit/copy.test.ts`:
    - the money line moves from the footer to `copy.due.direct` (`/\{studio\} directly/`, `/never handles your money/`);
    - the footer matches `/runs this page for \{studio\}/`;
    - `form.title` is `"Send the screenshot"` (TAT-110 replaces the TAT-65 wording; say so in the test).
  - These fail because the functions are missing.
- Implement:
  - `src/studio/text.ts`: `export function graphemes`.
  - `view-model.ts`: the four functions, and `session: state === "paid" ? sessionView(page.nextSession) : null` in `depositView`.

```ts
export interface SessionView {
	/** The API's UTC instant, for <time dateTime>. */
	readonly startsAt: string;
	readonly artistName: string | null;
}

/** The API's nextSession, or null: missing (an API before TAT-110), null, or a start that isn't a date. */
function sessionView(
	value: DepositPage["nextSession"] | undefined,
): SessionView | null {
	if (!value || typeof value.startsAt !== "string") return null;
	if (Number.isNaN(Date.parse(value.startsAt))) return null;
	return { startsAt: value.startsAt, artistName: cleanLine(value.artistName) };
}

/** The picked method while it is listed, else the first, else null. */
export function selectedMethod(
	methods: readonly MethodView[],
	picked: string | null,
): MethodView | null {
	return methods.find((method) => method.id === picked) ?? methods[0] ?? null;
}

/** The studio's mark when it has no logo: its first user-perceived character, as typed. */
export function studioInitial(name: string): string {
	return graphemes(name.trim())[0] ?? "";
}
```

  - `formatSessionStart(iso, timeZone)` is `formatReceived`'s body with `weekday: "short"` added, returning `` `${weekday} ${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod.toLowerCase()}` `` (probe in section 3).
  - `copy.ts`:
    - add `steps: { label: "Step {count}: ", code: "Copy the code", pay: "Pay" }`;
    - add `payWith: { legend: "Pay with", only: "Pay with {label}" }`;
    - add `paidButton: "I've paid: send the screenshot"`;
    - add `due.direct: "You pay {studio} directly. Tattoo Drip never handles your money."`;
    - set `methods.samePhone: "On this phone? Press and hold the QR code to save it, then choose it in your payment app's scanner."`;
    - add `methods.missing: "Ask {studio} for these details."`;
    - add `states.session: "Your session"` and `states.artist: "Artist"`;
    - set `footer: "Tattoo Drip runs this page for {studio}."` and `form.title: "Send the screenshot"`;
    - remove `methods.title`, which nothing uses after T6. Keep it until T6 if T4's typecheck needs it.
- Run: `pnpm -C apps/storefront exec node --import tsx --test test/deposit/view-model.test.ts test/deposit/copy.test.ts`, then `pnpm --filter @tattoo-drip/storefront typecheck`.
- Commit:

```
feat(storefront): read the next session and the picked method on the deposit page (TAT-110)

selectedMethod, formatSessionStart (the studio's timezone, like the screenshot's
time), studioInitial and the session view; an older API without nextSession is null.
```

### T5. Header, footer, the direct line, the logo in the shell

- Failing tests first:
  - `test/deposit/loader.test.ts`:
    - the shell deep-equals `{ …, logo: null }`;
    - `depositShell(withStorefront({ branding: { logo: LOGO } }), IMAGE_ORIGIN).logo` equals `{ src, width, height }`;
    - the same logo with origin `"https://other.example"` gives null;
    - a `heroImage` alone gives `logo: null` (the deposit page never takes the cover).
  - `render.test.ts` "the frame":
    - `DepositFrame { studioName: "मीना Ink" }` has a `.deposit-header` with `<span class="deposit-mark" aria-hidden="true">म</span>` and `<p class="deposit-studio" dir="auto">मीना Ink</p>`;
    - with `logo` it has one `img` with `alt=""` and `referrerpolicy="no-referrer"`, and no mark;
    - with `artistName: "Sita Rai"` it reads "with <bdi>Sita Rai</bdi>";
    - the footer text is "Tattoo Drip runs this page for मीना Ink.";
    - one h1 still.
  - The intro tests (`:239-275`): the artist is no longer in `DepositIntro`.
  - The due test: `textOf` matches "You pay Black Needle directly. Tattoo Drip never handles your money.", and `<h2 id="deposit-due-title" class="sr-only">`.
  - `screen.test.ts:32`: the shell's footer text.
  - These fail today.
- Implement:
  - `loader.ts`: `logo: BrandImage | null` in `DepositShell`; `depositShell(studio, imageOrigin: string | null = null)` sets `logo: parseThemeConfig(storefrontInput(studio), imageOrigin).logo`; `loadDepositShell` passes `context.tattoo.connection.apiUrl`. Its comment says only the logo is read, never the colours, font or cover.
  - `deposit-page.tsx`: a `DepositHeader({ studioName, logo, artistName })`. The logo is `<img className="deposit-logo" src width height alt="" decoding="async" fetchPriority="low" referrerPolicy="no-referrer">`. `DepositFrame` gains the props `logo?`, `artistName?` and `wide?`, and renders the header as `main`'s first child.
  - `DepositIntro` keeps only the brief.
  - `DueView`'s amount section gets the `sr-only` h2 and the `due.direct` line (`<p className="deposit-muted"><Fill …/></p>`).
  - `deposit-screen.tsx`: pass `logo={shell.logo}` everywhere `DepositFrame` is used, and `artistName={view?.artistName ?? null}` in `DepositLoaded`.
  - CSS:
    - `.deposit-header` (grid `auto 1fr`, gap 0.75rem, align center);
    - `.deposit-mark` (2.75rem square, 1.5px `--stencil` border, `--stencil` text, display face 1.5rem, the 0.25rem offset frame like `.deposit-state::after`);
    - `.deposit-logo` (`block-size: 2.75rem; inline-size: auto; max-inline-size: 8rem; object-fit: contain`);
    - `.deposit-studio` (display face 1.125rem, `overflow-wrap: anywhere`).
- Run: `pnpm -C apps/storefront exec node --import tsx --test test/deposit/*.test.ts`, then the storefront typecheck.
- Commit:

```
feat(storefront): a studio header and the direct-payment line under the amount (TAT-110)

The mark is the studio's checked logo or its initial, never the cover; the accent
stays violet and the route still writes no brand style. The footer now says who
runs the page.
```

### T6. Steps, Pay with, one panel, the preselect

- Failing tests first. `render.test.ts` "due" uses `dueHtml(view, today, selected = selectedMethod(view.methods, null))` and passes `selected` and `onSelect: () => undefined`.
  - Three h2 steps with `aria-hidden` numbers and `sr-only` "Step 1: ", "Step 2: " and "Step 3: " (the last from the form, in `form.test.ts`).
  - With `PAGE` (eSewa and bank), a `fieldset.deposit-paywith` has a legend "Pay with" and two radios `pay-with-0` / `pay-with-1` with `name="pay-with"`. `pay-with-0` is `checked`. There is **one** `img`, the eSewa QR (eager, `referrerpolicy`, 280×280). The copy buttons are `["Copy code 7K3M9Q", "Copy 9812345678"]` and there are 2 polite regions.
  - With `selected` = the bank method: no `img`, the text "Nabil Bank", radio 1 checked.
  - With one method: no fieldset, and the text "Pay with <bdi>eSewa</bdi>".
  - With no methods: the `methods.none` note, no fieldset and no `img`.
  - A method with neither QR nor details: "Ask Black Needle for these details."
  - Delete "the first QR loads at once, the others when scrolled to" (`:332-354`). Its rule is gone, and the new test is "only the picked method's QR is on the page".
  - `form.test.ts`:
    - the heading is `<h2 id="proof-title" … tabindex="-1">` containing "Send the screenshot";
    - with `paidWith: "bank"` the `method-1` radio is `checked`;
    - with `paidWith: null` and two kinds nothing is checked, as today;
    - `formHtml` gains `paidWith: null`.
  - They fail today.
- Implement:
  - New `components/steps.tsx`:
    - `StepHeading({ step, id?, focusable?, children })` (decision 12);
    - `PayWith({ methods, selected, onSelect })` (decision 8; `null` below two methods);
    - `MethodPanel({ method, single, studioName })` holds: the single line; the QR `figure` (with `key`), caption and `samePhone` (`className="deposit-muted deposit-same-phone"`); the details `dl` moved from `MethodCard`; else `methods.missing`.
  - Delete `MethodCard`.
  - `DueView` props become `{ view, studioName, today, selected: MethodView | null, onSelect(id: string): void, form }`. It renders the `<div className="deposit-due">` with:
    - the amount section (class `deposit-due-amount`);
    - step 1 (class `deposit-due-code`);
    - step 2 (class `deposit-due-pay`: the heading, then `PayWith` or the none note);
    - the panel (`<MethodPanel key={selected.id} …/>`, class `deposit-method-panel`) when `selected`;
    - the `form`;
    - the policy section (class `deposit-due-policy`).
  - `ProofForm`:
    - add the prop `paidWith: DepositMethodKind | null`;
    - the section gets class `deposit-block deposit-due-proof`;
    - the h2 becomes `<StepHeading step={3} id="proof-title" focusable>{copy.form.title}</StepHeading>`;
    - the default `method` is `paidWith && kinds.includes(paidWith) ? paidWith : kinds.length === 1 ? kinds[0] : ""`, then this effect (a pick sets the answer; a re-render never does):

```ts
	const appliedPaidWith = useRef(paidWith);
	useEffect(() => {
		if (paidWith === appliedPaidWith.current) return;
		appliedPaidWith.current = paidWith;
		if (paidWith) form.setFieldValue("method", paidWith);
	}, [paidWith, form]);
```

  - `ProofPicker`: the legend gets `className="deposit-label sr-only"`. The step heading names the field, the summary label stays, and `form.test.ts` still finds the legend.
  - `deposit-screen.tsx`:
    - `const [pickedMethod, setPickedMethod] = useState<string | null>(null)`;
    - `const selected = view?.state === "due" ? selectedMethod(view.methods, pickedMethod) : null`;
    - pass `selected` and `onSelect={setPickedMethod}` to `DueView`, and `paidWith={selected?.kind ?? null}` to `ProofForm`;
    - `wide={view?.state === "due" && view.methods.length > 0}` on `DepositFrame` (used in T7).
  - CSS:
    - `.deposit-due { display: grid; gap: 1.5rem; }`;
    - `.deposit-step-title` (flex, gap 0.75rem, `scroll-margin-block-start: 1rem`);
    - `.deposit-step-number` (copy the look of `.step::before` at `styles.css:211`);
    - `.deposit-paywith` (reset fieldset);
    - `.deposit-paywith-options` (flex wrap, gap 0.5rem);
    - `.deposit-paywith-option` (inline-flex, `min-block-size: 2.75rem`, padding 0.375rem 0.875rem, border 1px `--line-strong`, radius, `overflow-wrap: anywhere`, cursor pointer; `:has(:checked)` border `--stencil`, background `--stencil-wash`, weight 600; `:has(:focus-visible)` outline 2px `--stencil`, offset 2px; `input` 1rem, `accent-color: var(--stencil)`);
    - `.deposit-method-panel` (grid, gap 0.75rem, justify-items start);
    - the QR `max-inline-size: 15rem`;
    - `.deposit` gap and top padding 1.5rem;
    - remove `.deposit-methods` and `.deposit-method`.
- Run: the storefront deposit tests, typecheck, and `pnpm exec biome check apps/storefront/src/deposit apps/storefront/test/deposit apps/storefront/src/styles.css` from the root.
- Commit:

```
feat(storefront): one way to pay at a time, in three numbered steps (TAT-110)

Pay with is a native radio group outside the form; only the picked method's QR and
details are on the page, and the pick preselects How did you pay?.
```

### T7. "I've paid", and the desktop layout

- Failing tests first, in `render.test.ts`:
  - When `form` is not null, `DueView` has exactly one `.deposit-paid-bar` holding `<button type="button" class="action action-secondary">` whose text is "I've paid: send the screenshot". It is placed after the panel and before the form, which you can tell from the markup order.
  - There is no bar when `form` is null.
  - The "everywhere" test still finds no `href="#`.
  - `test/studio/assets.test.ts`-style CSS checks (put them in `test/deposit/render.test.ts` or a new `test/deposit/styles.test.ts` that reads `src/styles.css`):
    - `.deposit-paid-bar` has `position: sticky` and `inset-block-end: 0` and is `display: none` inside `@media (min-width: 60rem)`;
    - the `grid-area` declarations of `.deposit-due` children appear only inside that media block (regex over the CSS outside the block);
    - `.deposit-method-panel` is sticky there.
  - They fail today.
- Implement:
  - `browser.ts`: `export function showProofStep(): void` (decision 13: `getElementById("proof-title")`, `scrollIntoView({ block: "start" })`, `focus({ preventScroll: true })`). Its comment says it never touches the URL.
  - `steps.tsx`: `PaidBar()` renders `<div className="deposit-paid-bar"><button type="button" className="action action-secondary" onClick={showProofStep}><ArrowDown aria-hidden="true" />{copy.paidButton}</button></div>`. `DueView` renders it between the panel and `form` when `form` is not null.
  - `DepositFrame` gets `wide`: `main` is `deposit deposit-wide` and the footer is `deposit-footer deposit-wide`.
  - CSS (inside the deposit `@layer components`):
    - `.deposit-paid-bar { position: sticky; inset-block-end: 0; z-index: 1; padding-block: 0.75rem max(0.75rem, env(safe-area-inset-bottom)); border-block-start: 1px solid var(--line); background: var(--paper); }`;
    - `.deposit-paid-bar .action { inline-size: 100%; }`;
    - `@media (max-width: 59.99rem) { :root:has(.deposit-paid-bar) { scroll-padding-block-end: 5rem; } }`;
    - `@media (min-width: 60rem)`:
      - `.deposit.deposit-wide, .deposit-footer.deposit-wide { width: min(60rem, 100% - 4rem); }`;
      - `.deposit-wide .deposit-due { grid-template-columns: minmax(0, 1fr) minmax(0, 22rem); column-gap: 3rem; grid-template-areas: "amount panel" "code panel" "pay panel" "proof panel" "policy panel"; }`;
      - the five `grid-area` assignments;
      - `.deposit-wide .deposit-method-panel { position: sticky; inset-block-start: 1.5rem; align-self: start; }`;
      - `.deposit-wide .deposit-qr { max-inline-size: 20rem; }`;
      - `.deposit-paid-bar, .deposit-same-phone { display: none; }`;
    - the footer: margin-top 2rem, padding-block 1rem 1.5rem.
- Run: the storefront tests, typecheck, biome (as in T6).
- Commit:

```
feat(storefront): an I've paid button, and the QR beside the steps on a desktop (TAT-110)

A button, never a fragment link: it scrolls step 3 into view and moves focus to its
heading. From 60rem the picked method sits in a sticky column on the right.
```

### T8. The paid receipt with the session

- Failing tests first, in `render.test.ts` "the other states". `stateHtml` gains a `sessionStart` argument.
  - A paid page with a session and `sessionStart = "Sat 24 Oct 2026, 11:00 am"`: the `<dl>` reads, in order, Amount, Reference code, "Your session" with `<time dateTime="2026-10-24T05:15:00.000Z">Sat 24 Oct 2026, 11:00 am</time>`, and "Artist" with `<dd dir="auto">आरव श्रेष्ठ</dd>`.
  - With `artistName: null` there is no Artist row.
  - With `sessionStart: null` (an unknown zone) there are no session rows.
  - A zero deposit with a session has a `dl` with only the two session rows.
  - Every non-paid state's markup is unchanged with a session in the page (the view model already nulls it).
  - They fail today.
- Implement:
  - `StateMessage` gains `sessionStart: string | null`. It renders the rows above when `view.session && sessionStart`, and keeps the `<dl>` whenever `amount !== null` or there are session rows.
  - `deposit-screen.tsx` passes `sessionStart={view.session ? formatSessionStart(view.session.startsAt, shell.timezone) : null}`.
- Run: the storefront tests and typecheck.
- Commit:

```
feat(storefront): the paid receipt shows the session's date, time and artist (TAT-110)
```

### T9. Guards

- Failing tests first, in `test/deposit/guard.test.ts`:
  - "the deposit route adds no brand style": `routes/deposit.tsx` doesn't match `/themedHeadTags|brandingCss|theme\/head/`, and `src/deposit/**` doesn't match `/brandingCss|themedHeadTags/`.
  - "every image on the deposit page sends no Referer": every `<img` JSX opening tag in `src/deposit/**` (multi-line, up to its `/>`) contains `referrerPolicy="no-referrer"`. Add the attribute to the proof preview in `proof-picker.tsx:56-60`. It is a `blob:` URL, but one rule for every image is easier to keep.
  - "the I've paid button never writes the URL": `browser.ts` doesn't match `/location\.|history\./`.
  - The preview line fails until the attribute is added. The rest pass already, so they are regression guards; say so in the test names' comment.
- Run: the storefront tests.
- Commit:

```
test(storefront): guard the deposit page's images and its unbranded head (TAT-110)
```

### T10. Docs (see section 8)

- Commit:

```
docs: deposit page v2 and the next session in the public contract (TAT-110)

development.md (layout, Pay with, the I've paid button, the receipt), backend.md,
requirements.md and sdk.md.
```

### T11. Browser pass and measurements

- Run against the T0 stand-in API (3425) and the storefront on 3424 (the T0 command).
- For the paid-with-session path, also run end to end against the real platform on lane B:
  - Platform dev on 3421 with `DB_DATABASE=tattoo_drip_uy` and `STOREFRONT_URL='http://{tenant}.localhost:3424'`, and the storefront with `API_URL=http://localhost:3421`.
  - Use a throwaway owner (`account:verify` with `DB_DATABASE`). Add an eSewa method with a QR, a Fonepay one and a bank one.
  - Take a project to `deposit_pending`, send the link, upload a screenshot on the page, verify it in the dashboard, and add a session with a second artist.
  - Open the link: the receipt shows date, time and artist.
- Fix what fails, test first where it is behaviour, with a `fix(storefront): …` commit (checked with commitlint).
- Use the checklist in section 9.

### T12. Final gates

As in section 10.

## 8. Docs to update

- `apps/storefront/docs/development.md`, "Deposit page":
  - First paragraph: what the page shows is now the studio header, the amount with "you pay the studio directly", three numbered steps, one way to pay at a time and the policy.
  - New bullet "Layout (TAT-110)":
    - the header (logo or initial, never the cover; `DepositShell.logo` from `parseThemeConfig`; the accent stays violet; the route writes no brand style);
    - the steps as numbered h2s;
    - `PayWith` as native radios `name="pay-with"` outside the form;
    - `selectedMethod` and the one-way preselect of "How did you pay?";
    - the panel keyed by method id (no stale QR, no stale "Copied");
    - only the picked QR on the page;
    - the "I've paid" `.deposit-paid-bar`: a button, sticky in flow before step 3 below 60rem, `showProofStep()` scrolls and focuses `#proof-title` without touching the URL, and the `scroll-padding-block-end` reason;
    - from 60rem the `deposit-wide` two columns, with the warning that `grid-area` names live only in the media query.
  - Data bullet: the paid receipt shows `nextSession` (paid only), formatted by `formatSessionStart` in the studio's timezone, and left out when the zone is unknown; an API without the field is null.
  - Tap targets bullet: add the chips and the I've paid button.
  - Pure modules bullet: add `selectedMethod`, `formatSessionStart`, `studioInitial`, `steps.tsx`, and `showProofStep` in `browser.ts` (browser pass only).
  - Guard bullet: images, the route's head, `browser.ts`.
  - Browser pass bullet: arrow keys in Pay with, the bar and its focus, 1280 with the QR beside the steps.
- `apps/storefront/docs/development.md`, "Themes and branding", the "Not themable" bullet: "…the deposit page (its route adds no brand `<style>`; its header shows only the checked logo, TAT-110)".
- `apps/platform/docs/backend.md`:
  - `:72` (deposit page): `show` adds `nextSession` once `paid` (`SessionService.nextScheduled`, the session's own artist from the same single artists read; one extra query on a paid page only; the transformer sends a UTC instant).
  - `:88` (Scheduling): add `nextScheduled` to the list of `SessionService` reads.
- `docs/requirements.md:138`: the deposit page also shows, once paid, the date, time and artist of the project's next session.
- `docs/sdk.md:29`: "…a single project's deposit details (and, once paid, its next session's start and artist)…".

## 9. Acceptance with measurable checks, and the browser check list

Measured checks:

- **Height.** At 375×812 (isMobile, DPR 2, light), measure the `due3` fixture with `document.documentElement.scrollHeight` after `.deposit-amount` shows and `document.fonts.ready`, once for each Pay with pick, and report the maximum.
  - Target: ≤ 1,700 px.
  - Bar for this ticket (U1 default): ≤ 2,150 px, and at least 1,000 px less than T0's "before".
  - Also report `due2` and the per-section heights (header, h1, brief, amount, step 1, step 2 with the panel, bar, step 3, policy, contact, footer) so U1 can be decided from facts.
- **Exactly one `img.deposit-qr`** in the DOM for any pick, and none for the bank pick.
- **eSewa.** Clicking the eSewa chip makes the one QR's `src` the eSewa QR and checks `input[name="method"][value="esewa"]`. Arrow Right on the focused group moves to the next method, swaps the panel and changes "How did you pay?" too.
- **"I've paid".** After a tap, `#proof-title`'s `getBoundingClientRect().top` is between 0 and 40 px once scrolling ends, `document.activeElement.id === "proof-title"`, and `location.href` is unchanged (the token is still in the fragment). There is no `#…` href on the page (`document.querySelectorAll('a[href^="#"]').length === 0`).
- **Tap targets.** At 375, every visible `button`, `a`, `label.deposit-paywith-option` and `label.deposit-pick` is at least 44 px tall. Log any that aren't.
- **Desktop.** At 1280×800, the panel's left edge is to the right of step 2's right edge, the QR's top is under 800 px, the panel stays in view while scrolling to Send, and `.deposit-paid-bar` is not displayed.
- **Contrast.** Spot checks in DevTools, light and dark: a chip label on paper, and the checked chip text on wash, at ≥ 4.5:1; the chip border at ≥ 3:1.
- **Paid.** `paid-session` shows "Your session" with the date and time in Asia/Kathmandu, and "Artist" with the Devanagari name. `paid-old` (no field) shows the old receipt without errors. `paid-zero-session` shows the session rows only.
- **Queries.** These are platform tests (T3.5).
- **Token rules.** With DevTools/Playwright network logging: only the API's request carries the token; no request has a `Referer`; `localStorage` is empty; the `sessionStorage` keys are the router's scroll keys only (no token, no href); `check:page` passes.

Browser check list. At 375×812 and 1280×800, light and dark, with the Latin and the Devanagari studio and the Devanagari artist:

- every state (`due3`, `due2`, `due1`, `due0`, paid ×4, `submitted`, `updating`, `expired`, `cancelled`, the dead link, a missing token);
- the logo studio (the logo shows, and no `<style>` from the brand is in the head);
- a keyboard-only run: Tab through the header, the code Copy, the Pay with group (arrows), the panel's Copy, I've paid (focus moves to step 3), "How did you pay?", the picker, Send;
- the sticky bar never covers a focused element or Send;
- Copy in Chrome (the clipboard), and the failure text when the permission is blocked;
- a long Devanagari studio name and labels wrap without a horizontal scrollbar (`scrollWidth === clientWidth`);
- reduced motion: the I've paid scroll jumps instead of animating.

## 10. Final gates

- From the root: `pnpm check`, `pnpm typecheck`, `pnpm build` (the storefront build ends with the client-bundle check).
- `pnpm --filter @tattoo-drip/storefront test`; `pnpm --filter @tattoo-drip/sdk test`; `pnpm --filter @tattoo-drip/react test`.
- `pnpm -C apps/storefront check:page` after the build.
- The full platform suite once, with `queue_jobs` emptied first in `tattoo_drip_uy`: `DB_DATABASE=tattoo_drip_uy PORT=3422 flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock timeout -s KILL 1500 pnpm -C apps/platform exec node ace test`. Run it in the background and wait for the notification.
- `git status` clean. `packages/types/src/openapi.gen.ts` matches `generate`: run it again and expect no diff.

## 11. Review focus (Fable and Codex)

- **Information exposure.** `nextSession` is only in `paid`, only a start and an artist's name (no end, kind, notes or other sessions), only a future or current session, only this link's project, tenant-scoped under RLS. `cancelled` wins. The transformer's comment and `requirements.md` say so.
- **Token rules.** No `#` link; `showProofStep` writes no URL; no storage; the logo `img` and the QR send no Referer; the guard tests still pass as written. Is the shell's new loader data (the logo) public only?
- **Query counts.** One session query on paid pages and none otherwise; still at most one artists read; `submitProof`'s three `show` calls add nothing (it's `due`).
- **Form behaviour.** The preselect effect must never override a manual change on a plain re-render (`depositView` makes new arrays each render). The summary's `method-0` target still points to the form's radio (the Pay with ids are `pay-with-N`). `takesProof`, the refusal handling and focus after Send are unchanged.
- **Wrong-QR risk.** The panel is keyed by method id, so there is no stale image or "Copied". Watch positional ids when a refetch reorders methods (risk 3).
- **Accessibility.** Radio group semantics and the visible dot; focus after "I've paid"; focus not obscured by the sticky bar; one h1; the `sr-only` h2 and legend; `dir="auto"` and `<bdi>`.
- **CSS.** `grid-area` names only inside the media query; the sticky panel's `align-self: start`; no `style=` props; tokens only.

## 12. Risks and rollback

1. **The height target is missed** (likely; U1). The levers are listed and the measurements will show where the height goes. A follow-up can merge "How did you pay?" into "Pay with" (about 110 px).
2. **`:has()`**, used for the chip's checked style and the scroll padding, is missing in old browsers. The radio dot still shows the choice; only the scroll padding is lost.
3. **Positional method ids.** If the studio reorders or removes methods while the page is open, a refetch can move the pick to another method. The panel then shows that method's own QR and details (never a mix), and "How did you pay?" follows. This is rare; a content key is a follow-up if it ever matters.
4. **Two methods with the same label** (two "Bank transfer") look alike as chips; the panel's bank name tells them apart. Follow-up: add the bank name to repeated labels.
5. **Deploy order.** The platform field is additive and an old storefront ignores it. A new storefront against an old API reads `undefined` as null.
6. **Rollback.** Revert the storefront commits (T4 to T9) on their own and the page is today's. Revert T2 and T3 and the API stops sending the field; the new storefront then shows the old receipt. Revert T1 only together with T3.

## 13. User-only decisions (defaults the builder uses)

- **U1. Height budget.** With every lever, the 3-method due page is about 1,900 to 2,150 px at 375 px (today: about 3,400). 1,700 px needs "How did you pay?" merged into "Pay with" and more cuts.
  - Default: keep "How did you pay?", preselected, as the ticket says. Accept ≤ 2,150 px when it is at least 1,000 px shorter than today. File the merge as a follow-up.
- **U2. The cover in the deposit header.**
  - Default: no. Show the studio's checked logo, else its initial, until TAT-112 gives a small image size.
- **U3. The session on the "Screenshot sent" page too.**
  - Default: no, paid only. That is the least exposure, and it is what the ticket asks.
