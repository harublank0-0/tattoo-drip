# Studio site 3/5 (TAT-127): request page, sticky header and chat button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The intake form moves to its own page, `/request` (`?artist=<slug>` picks that artist); the home page invites with "Got an idea?" and the artist page with "Request a tattoo from <name>"; every studio page gets a header that stays at the top with the studio's name and a Request button, and a floating chat button to WhatsApp or Viber; artists show "Taking new work" or their closed message.

**Architecture:** Storefront only, apart from the dashboard's words for the `inquiry` section. No API change: `/request` reads the studio and the artist list like the artist page, and renders TAT-57's `InquirySection` unchanged as its main content. The `inquiry` section key stays (required, so `/#inquiry` always has a target) and now renders the "Got an idea?" invitation. The header is CSS `position: sticky`, the chat button `position: fixed` around a native `<details>`: no state, focus or DOM code, so it works before hydration and without JavaScript. Seam for ticket 4: `RequestSearch` gains `flash`, `RequestPageData` gains the design, and `InquirySection` gains one optional slot between its h1 and the steps strip; nothing else on the page moves.

**Tech Stack:** TanStack Start + Router (storefront), React 19, `node:test` + `tsx`, lucide-react; AdonisJS + Inertia (dashboard words), Japa; OpenAPI 3.1 + openapi-typescript.

**Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md`, sections "The pages" (header), "Home" ("Got an idea?"), "Artist page" (status, "Request a tattoo from <name>", the form moves off), "Request page" (not the `?flash=` part: ticket 4), "Chat button", Constraints ("Links already shared must keep working", caching), "Left to the builder" (Viber). Ticket 3 of the spec's split. Plans 1 (`docs/superpowers/plans/2026-10-30-studio-site-1-artist-styles-and-links.md`) and 2 (`docs/superpowers/plans/2026-10-30-studio-site-2-photos-and-gallery.md`) are built; their Interfaces are used as given, in particular plan 2's `SiteBar` and `StudioAside` (extracted from `ArtistPage`), `WorkPage` / `WorkPageData` / `workPageData`, `paging.tsx`, the `work` section key and the Look settings' `SECTION_WORDS`.

## Global Constraints

- Base: local `main` after TAT-126 is merged into it (it holds plan 1 TAT-125, plan 2 TAT-126 and `origin/main` up to PR #80, the TAT-84 fix: the dashboard's contact recording uses `inertia/hooks/use-contact-recording.ts`, and a source-scan test fails on any Inertia `optimistic` under `inertia/`). Plan 2 as built also exports `logReadFailed(slug-context…)` from `src/studio/loaders.ts` (log a degraded read as `{ slug, status, code }`), reads Recent work only when the sections include `work`, and writes `?healed=1` through `stringifySearch`/`healedAsOne` in `src/router.tsx`; a storefront test pins `src/router.tsx` and `prototype-removed.test.ts` pins the exact route list (add `/request` there). Branch `harublank00/tat-127-studio-site-35-request-page-sticky-header-and-chat-button` (Linear TAT-127) in the worktree `/home/blank/Coding/tattoo-drip-wt/site-3`. Database `tattoo_drip_site` is reused as plan 2 left it (never drop or recreate it). This plan has no migration.
- **Never touch the user's database `tattoo_drip` or the servers on ports 3333 and 3000.** Every platform command runs with `DB_DATABASE=tattoo_drip_site` and `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform` (the worktree has no `.env`; never read any `.env`). Unset `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS` for test runs. Tests use `PORT=3402`; a dev server for the browser pass uses 3401, the storefront 3404.
- Node 24: prefix commands with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`.
- A spec run that hits a missing import hangs Japa: run platform RED steps as `timeout 90 ... > /tmp/site3-red.log 2>&1`. Never two platform suites at once.
- Narrow storefront runs: `pnpm --filter @tattoo-drip/storefront exec node --import tsx --test <files>`; the whole suite is `pnpm --filter @tattoo-drip/storefront test`.
- Copy, exactly (spec words in bold): header button **"Request"**, on an artist's page **"Request {name}"**; artist page button **"Request a tattoo from {name}"**; home invitation **"Got an idea?"**, then "Tell {studio} what you'd like and where it goes. Add photos if you have them." and the button "Send your idea"; status **"Taking new work"**, else the artist's closed message, else "Not taking new work right now"; chat toggle "Chat", landmark "Chat with {studio}", links "WhatsApp" and "Viber"; WhatsApp message **"Hi, I'm asking about {subject}"** with the subject the artist's name, else "a tattoo" (ticket 4 adds "the {design} flash").
- Paths: `/request`, `/request?artist=<slug>`. Every Request button leads there. An unknown, hidden, renamed or malformed `artist` is the general form, never a not-found (anti-goal: never harder to reach the studio than Instagram).
- Viber: the chat button's Viber link is the plain chat (`viberLink`, unchanged). Viber documents a prefilled `text` only for bot chats (`viber://pa?chatURI=…&text=…`, developers.viber.com/docs/tools/deep-links); a `draft` parameter on `viber://chat?number=` is undocumented and unverified, so nothing is prefilled there.
- No chat button without a valid phone (E.164, `isPhone`). Not on `/deposit` (it lists the studio's WhatsApp and Viber already and its "I've paid" bar owns the bottom of the screen) or the status pages.
- No JavaScript for the header and the chat button; no `useState`, `useEffect`, `useRef`, `tabIndex`, `.focus(`, `addEventListener` or `document.` under `src/studio/components/` (the source guards in `test/studio/lightbox.test.ts`, as plan 2 left them). No new dependency, no third-party script (Turnstile now loads only on `/request`).
- Caching: `/request` answers `pageCacheHeaders` like every page (`public, max-age=0, s-maxage=60, stale-while-revalidate=600`) and holds no per-visitor data.
- The default-theme snapshot (`apps/storefront/test/studio/default-theme.snapshot.json`) changes on purpose twice, in Task 3 and Task 4: delete it, run the tests twice, and check that its diff holds only the changes those tasks name.
- Deploy: the storefront alone; the platform change (Task 5) is words only and can ship in either order.
- Never edit generated files: `apps/storefront/src/routeTree.gen.ts` (`pnpm --filter @tattoo-drip/storefront generate-routes`, then `pnpm build` for its footer), `packages/types/src/openapi.gen.ts` (`pnpm --filter @tattoo-drip/types generate`), `apps/platform/.adonisjs/`, `apps/platform/database/schema.ts`.
- Conventional Commits with area scopes (`storefront`, `platform`, `types`, `docs`), subjects under 100 characters, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A link already shared that ends in `#inquiry`** (`/#inquiry`, `/artists/<slug>#inquiry`, a closed artist's): it lands on an element one tap from the form, and that element is not hidden under the sticky header. Pinned in Task 3 (the targets hold the `/request` link) and Task 4 (scroll padding), checked in Task 6's browser pass.
2. **A `/request` address that is not what we wrote:** Instagram's and Facebook's `?fbclid=…` and `utm_*`, a renamed or hidden artist's slug, `Sita`, `?artist=12` (the router parses it as the number 12), `?artist=a&artist=b`. Each is the general form or the right artist, never a not-found or an error page. Pinned in Task 1 (`request.test.ts`) and Task 2 (`loaders.test.ts`).
3. **The floating chat button over what the client needs:** the form's Send button, a focused field, the footer's last line. Focus scrolls above it and the footer clears it. Pinned in Task 4 (`assets.test.ts`), checked in Task 6.
4. **Closed combinations** (studio closed with an open artist; artist closed with the studio open; both closed): no button leads to a refusal, and each page says what is still possible. Pinned in Task 1 (`requestLink`), Task 2 (request page states), Task 3 (invitation) and Task 4 (header).
5. **A long Devanagari artist name in "Request {name}" at 375 px:** the button wraps inside the bar, the page never scrolls sideways. Pinned by `overflow-wrap` in Task 4 (`assets.test.ts`), checked in Task 6.

---

### Task 1: The request address, the header's Request link and the chat links

**Files:**
- Create: `apps/storefront/src/studio/request.ts`, `apps/storefront/src/studio/chat.ts`
- Modify: `apps/storefront/src/studio/links.ts` (`requestHref`), `apps/storefront/src/studio/inquiry.ts` (`closedMessage`), `apps/storefront/src/studio/copy.ts`
- Test: `apps/storefront/test/studio/request.test.ts` (new), `apps/storefront/test/studio/chat.test.ts` (new), `apps/storefront/test/studio/links.test.ts`, `apps/storefront/test/studio/inquiry.test.ts`, `apps/storefront/test/intake/section.test.ts` (fixture only)

**Interfaces:**
- Produces (`src/studio/request.ts`, pure):
  - `export type RequestSearch = { artist?: string }` (absent, never null, so the router writes nothing back)
  - `export function readRequestSearch(search: Record<string, unknown>): RequestSearch`: `artist` kept when it is a string matching `ARTIST_SLUG`, or a safe non-negative integer turned into its string (the router parses `?artist=12` as a number) that then matches; every other key and value dropped.
  - `export interface RequestLink { readonly href: string; readonly artistName: string | null }`
  - `export function requestLink(studio: StudioView, artist: ArtistView | null): RequestLink | null`: an accepting `artist` gives `{ href: requestHref({ artist: artist.slug }), artistName: artist.name }`; otherwise an accepting studio gives `{ href: "/request", artistName: null }`; otherwise null.
- Produces (`links.ts`): `export function requestHref(search: RequestSearch): string`: `/request`, or `/request?artist=<slug>` (through `URLSearchParams`).
- Produces (`src/studio/chat.ts`, pure): `export interface ChatLinks { readonly whatsapp: string; readonly viber: string }`; `export function chatLinks(studio: StudioView, subject: string | null): ChatLinks | null`: null without a valid phone; `whatsapp` is `whatsappLink(phone, fill(studioCopy.chat.message, { subject: subject ?? studioCopy.chat.anyTattoo }))`, `viber` is `viberLink(phone)`.
- Produces (`inquiry.ts`): the `artist-closed` state gains `readonly closedMessage: string | null` (the selected artist's `closedMessage`).
- Produces (`copy.ts`), added to `studioCopy`:
  ```ts
  request: {
  	bar: "Request",
  	barArtist: "Request {name}",
  	artistButton: "Request a tattoo from {name}",
  	inviteTitle: "Got an idea?",
  	inviteLine: "Tell {studio} what you'd like and where it goes. Add photos if you have them.",
  },
  status: { open: "Taking new work", closed: "Not taking new work right now" },
  chat: {
  	toggle: "Chat",
  	label: "Chat with {studio}",
  	whatsapp: "WhatsApp",
  	viber: "Viber",
  	message: "Hi, I'm asking about {subject}",
  	anyTattoo: "a tattoo",
  },
  ```

- [ ] **Step 1: Set up the worktree**

The coordinator created the worktree and branch on local `main` (after TAT-126's merge). `cd /home/blank/Coding/tattoo-drip-wt/site-3 && PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile`, then `pnpm --filter @tattoo-drip/storefront test`.
Expected: install clean, tests pass, `git status` clean.

- [ ] **Step 2: Write the failing tests**

`request.test.ts` (view models from `studioViewModel(STUDIO)` and `artistViewModels([SITA, ARJUN])`):
```ts
test("the address keeps a well-formed artist slug and nothing else", () => {
	assert.deepEqual(readRequestSearch({ artist: "sita" }), { artist: "sita" });
	assert.deepEqual(readRequestSearch({ artist: 12 }), { artist: "12" });
	assert.deepEqual(readRequestSearch({ artist: "sita", fbclid: "IwAR0", utm_source: "ig" }), { artist: "sita" });
	for (const artist of ["Sita", "-sita", "a", "", " sita", ["sita", "arjun"], null, {}, true, 1.5, -3])
		assert.deepEqual(readRequestSearch({ artist }), {}, String(artist));
	assert.deepEqual(readRequestSearch({ fbclid: "IwAR0" }), {});
});
test("the header's Request: the artist while they take new work, else the studio while it does, else none", () => {
	assert.deepEqual(requestLink(studio, null), { href: "/request", artistName: null });
	assert.deepEqual(requestLink(studio, sita), { href: "/request?artist=sita", artistName: "Sita Rai" });
	assert.deepEqual(requestLink(studio, arjun), { href: "/request", artistName: null });
	assert.equal(requestLink(closedStudio, arjun), null);
	assert.equal(requestLink(closedStudio, null), null);
	assert.deepEqual(requestLink(closedStudio, sita), { href: "/request?artist=sita", artistName: "Sita Rai" });
});
```
`chat.test.ts`:
```ts
test("WhatsApp says what the client was looking at; Viber is the plain chat", () => {
	assert.deepEqual(chatLinks(studio, null), {
		whatsapp: "https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20a%20tattoo",
		viber: "viber://chat?number=%2B9779812345678",
	});
	assert.equal(chatLinks(studio, "Sita Rai")?.whatsapp, "https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20Sita%20Rai");
	assert.equal(chatLinks(studio, "Sita Rai")?.viber, "viber://chat?number=%2B9779812345678");
	const text = new URL(chatLinks(studio, "अर्जुन थापा")!.whatsapp).searchParams.get("text");
	assert.equal(text, "Hi, I'm asking about अर्जुन थापा");
});
test("no valid phone, no chat links", () => {
	assert.equal(chatLinks(studioViewModel(EMPTY_STUDIO), "Sita Rai"), null);
});
```
`links.test.ts`: "requestHref is the request page, with the artist when given": `requestHref({})` is `/request`, `requestHref({ artist: "sita" })` is `/request?artist=sita`, both pass `isAllowedHref`.
`inquiry.test.ts`: "a closed artist's page points to the studio while it is open" also expects `closedMessage: "Books open in March."`; a closed artist with `closedMessage: null` gives `closedMessage: null`.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/studio/request.test.ts test/studio/chat.test.ts test/studio/links.test.ts test/studio/inquiry.test.ts`
Expected: FAIL ("Cannot find module …/request.ts", `requestHref` not exported, missing `closedMessage`).

- [ ] **Step 4: Implement** the two modules, `requestHref`, the copy and the `closedMessage` field per Interfaces. Add `closedMessage: null` to the `artist-closed` literal in `test/intake/section.test.ts` so it typechecks.

- [ ] **Step 5: Run the tests to verify they pass**

Run: the command of Step 3, then `pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): the request address, the header's Request link and the chat links"
```

### Task 2: The request page

**Files:**
- Create: `apps/storefront/src/routes/request.tsx`; regenerate `apps/storefront/src/routeTree.gen.ts`
- Modify: `apps/storefront/src/studio/loaders.ts`, `apps/storefront/src/studio/seo.ts`, `apps/storefront/src/studio/components/inquiry.tsx` (`InquirySection`), `apps/storefront/src/studio/components/pages.tsx` (`RequestPage`), `apps/storefront/src/studio/theme/registry.tsx`, `apps/storefront/src/styles.css`, `apps/storefront/scripts/check-page.mjs`
- Test: `apps/storefront/test/studio/render.test.ts`, `loaders.test.ts`, `seo.test.ts`, `prototype-removed.test.ts`, `theme-render.test.ts` (registry), `apps/storefront/test/intake/section.test.ts`

**Interfaces:**
- Consumes: `RequestSearch`, `readRequestSearch` (Task 1), `requestHref` (Task 1), the `closedMessage` state field (Task 1), plan 2's `SiteBar` and `StudioAside` (locate with `rg -n "function (SiteBar|StudioAside)" apps/storefront/src`).
- Produces (`loaders.ts`): `export interface RequestPageData { readonly studio: StudioView; readonly inquiry: InquiryState; readonly channels: InquiryChannels; readonly seo: PageSeo; readonly theme: ThemeConfig }`; `requestPageData(studio: Studio, artists: readonly Artist[], search: RequestSearch, origin: string, imageOrigin: string | null = null): RequestPageData` (the artist is `findArtist(artistViews, search.artist)` when given; none found is the general form); `loadRequestPage(context: PageContext, search: RequestSearch): Promise<RequestPageData>` (studio and artists in parallel, the artists read through the existing `loadArtists`, so its errors behave as on the other pages; no work read).
- Produces (`seo.ts`): `requestPageSeo(studio: StudioView, artist: ArtistView | null, origin: string): PageSeo`.
- Produces (`InquirySection`): new optional prop `level?: 1 | 2` (default 2): at 1 the heading is the page's `h1` and the strip (`stripAbove`) an `h2`. Task 3 removes `level` and `stripAbove` once this page is the section's only user. The `artist-closed` state renders its `closedMessage` as `<p class="note user-text measure" dir="auto">` under its line, and its general link goes to `/request` (was `/#inquiry`).
- Produces (components): `RequestPage({ data, challengeSiteKey = null }: { data: RequestPageData; challengeSiteKey?: string | null })`: `SiteBar` (plan 2's props), `<main class="page request-page">` holding `InquirySection` (`level={1}`, `stripAbove`) then `StudioAside`, then `SiteFooter`. `Theme` gains `RequestPage`; `ThemedRequestPage(props)`.
- Produces (route `/request`): `validateSearch: readRequestSearch`, `loaderDeps: ({ search }) => search`, `loader: ({ context, deps }) => loadRequestPage(context, deps)`, `head` with `themedHeadTags` / `statusHead`, `headers` with `pageCacheHeaders`, a component passing `challengeSiteKey` from the route context (as `artists/$slug.tsx` does).

- [ ] **Step 1: Write the failing tests**

`render.test.ts`, new describe "the request page (TAT-127)" with `requestHtml(search, studio = STUDIO, artists = [SITA, ARJUN])` rendering `RequestPage` from `requestPageData(studio, artists, search, ORIGIN)`:
- "is the form's own page: one h1, the steps, the panel and the studio's contacts": `assertSafePage`; matches `<h1 id="inquiry-title" class="section-title">Send your idea</h1>`; `headings(html)` is `[1, 2, 2, 2]` (h1, the strip, the panel, the studio block); one `<aside class="inquiry-aside"`; `hrefs` include `/` ("See the studio page"); no `<form` (the form mounts after hydration).
- "?artist=sita picks Sita": the fallback holds `your idea for <bdi>Sita Rai</bdi>`; a `https://wa.me/9779812345678?text=` link whose decoded text names Sita Rai.
- "a closed artist's request page says so, with their own words, and offers the studio's general request": `{ artist: "arjun" }`: `<h1 id="inquiry-title" class="section-title">Inquiries</h1>`, `isn&#x27;t taking new inquiries right now`, `Books open in March.` inside `class="note user-text measure"`, `hrefs` include `/request`, no `inquiry-aside`.
- "a closed studio's request page says so and offers no form": `requestHtml({}, CLOSED_STUDIO, [ARJUN])` holds `<bdi>Black Needle</bdi> isn&#x27;t taking new inquiries right now.` and no `Message on WhatsApp`.

`loaders.test.ts`, describe "loadRequestPage":
- "reads the artists once (the studio from the cache) and picks the address's artist": `loadRequestPage(context, { artist: "sita" })` deep-equals `requestPageData(STUDIO, [SITA, ARJUN], { artist: "sita" }, ORIGIN)`, its `inquiry` is `open` with `preferredArtist.id` `SITA.id`; the calls are the artists URL alone.
- "an unknown, hidden or renamed artist is the general form, never a not-found" (Review Focus 2): `{ artist: "nobody" }` and `{}` give `open` with `preferredArtist` null.
- "a failed artists read fails it like the other pages": a 500 rejects with an error that is not a not-found; the list's `not_found` is a not-found.

`seo.test.ts`, describe "requestPageSeo":
- general: title "Send your idea to Black Needle", description "Tell Black Needle about the tattoo you'd like: the idea, where it goes and the dates that suit you.", canonical `${ORIGIN}/request`, type "website", image null, jsonLd null.
- with Sita: title "Send your idea to Sita Rai at Black Needle", description "Tell Sita Rai about the tattoo you'd like: the idea, where it goes and the dates that suit you.", canonical `${ORIGIN}/request?artist=sita` (Facebook keys a shared link by its canonical `og:url`, so the artist stays in it), image Sita's photo.
- an independent artist named like the studio: title "Send your idea to Sita Rai".

`section.test.ts`:
- "level 1 makes the heading the page's h1 and the strip under it an h2": `level: 1, stripAbove: true` gives `<h1 id="inquiry-title" class="section-title">Send your idea</h1>` and `<h2 id="steps-strip-title"`, no `<h3`.
- "keeps the closed states as TAT-48 left them": the artist-closed link is `href="/request"` and never `/#inquiry`; with `closedMessage: "Books open in March."` a `note` paragraph holds it, with null there is no `note`.

`prototype-removed.test.ts`: the route list gains `routes/request.tsx` (after plan 2's `routes/work.tsx`). `theme-render.test.ts`: the registry's theme has a `RequestPage`. The existing artist-page test "a closed artist's page offers the studio instead" expects `/request` instead of `/#inquiry` until Task 3 rewrites it.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL (`requestPageData`, `RequestPage`, `requestPageSeo` missing; `level` ignored; `/#inquiry` still rendered).

- [ ] **Step 3: Implement the loader, SEO, section, page, registry and route** per Interfaces. `requestPageSeo` uses `requestHref` for the canonical and the artist's name rule of `artistPageSeo` (`sameName`). In `styles.css`: `.request-page > .section:first-child { margin-block-start: 0; }` (the h1 sits under the bar, not 4.5rem down). `check-page.mjs`: after the artist page, `GET /request?artist=sita` is 200 with `<title>Send your idea to Sita Rai at Canary Ink &lt;Studio&gt;</title>`, its canonical `http://${SLUG}.localhost:${storefrontPort}/request?artist=sita`, the page's `Cache-Control`, and API reads of exactly the lookup and the artists list (no work read). Run `pnpm --filter @tattoo-drip/storefront generate-routes`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`, then `pnpm --filter @tattoo-drip/storefront check:page`
Expected: PASS and clean; `routeTree.gen.ts` lists `/request` with its Register footer; "Page check passed"; the default-theme snapshot unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): the request page, with ?artist= picking the artist"
```

### Task 3: The form leaves the home and artist pages; artists show their status

**Files:**
- Modify: `apps/storefront/src/studio/view-model.ts` (`requestHref` replaces `inquiryHref`), `apps/storefront/src/studio/loaders.ts` (data shapes), `apps/storefront/src/studio/components/inquiry.tsx` (`RequestInvite`; `InquirySection` simplified), `apps/storefront/src/studio/components/pages.tsx` (`StudioPage`'s hero, `StudioSection`'s `inquiry` case, `ArtistPage`), `apps/storefront/src/studio/components/artists.tsx` (`ArtistStatus`, `ArtistEntry`, `ArtistProfile`), `apps/storefront/src/styles.css`
- Re-record: `apps/storefront/test/studio/default-theme.snapshot.json`
- Test: `apps/storefront/test/studio/render.test.ts`, `theme-render.test.ts`, `view-model.test.ts`, `loaders.test.ts`, `apps/storefront/test/intake/section.test.ts`

**Interfaces:**
- Consumes: `requestHref`, `studioCopy.request` / `.status` (Task 1); `RequestPage` (Task 2).
- Produces: `ArtistView.requestHref: string` (`/request?artist=<slug>`); `inquiryHref` is gone. `StudioPageData` loses `channels` (it keeps `inquiry`, the invitation's state); `ArtistPageData` loses `inquiry` and `channels`.
- Produces (`components/inquiry.tsx`): `RequestInvite({ state }: { state: InquiryState })`: open, `<section id="inquiry" class="section request-invite" aria-labelledby="inquiry-title">` with `h2` "Got an idea?", `<p class="measure">` of `inviteLine` (`<Fill>`, the studio in `<bdi>`), and `<div class="actions"><a class="action action-primary" href="/request">Send your idea</a></div>`; any other state, the same section with `h2` "Inquiries" and "{studio} isn't taking new inquiries right now." (today's closed words), no link. `InquirySection({ state, channels, challengeSiteKey })`: always the `h1` and the strip (`h2`); `level` and `stripAbove` are gone, and `RequestPage` stops passing them.
- Produces (artist markup): `ArtistStatus({ artist })`: accepting, `<p class="status status-open">Taking new work</p>`; closed with words, `<p class="status status-closed user-text" dir="auto">{closedMessage}</p>`; closed without, `<p class="status status-closed">Not taking new work right now</p>`. The separate closed-message `note` goes from the card and the profile (said once). `ArtistProfile`'s action, only while accepting: `<div id="inquiry" class="actions artist-request"><a class="action action-primary" href={requestHref}><span>Request a tattoo from <bdi>{name}</bdi></span></a></div>`. The roster's "Ask for {name}" links to `requestHref`.

- [ ] **Step 1: Write the failing tests**

`render.test.ts`:
- "the studio page's inquiry section is the 'Got an idea?' invitation: one button to /request, no form and no panel": one `id="inquiry"`, on `<section id="inquiry" class="section request-invite"`, holding `<h2 id="inquiry-title" class="section-title">Got an idea?</h2>` and `<a class="action action-primary" href="/request">Send your idea</a>`; no `inquiry-aside`, no `Message on WhatsApp`; `headings(html)` is `[1, 2, 2, 3, 3, 2]`.
- "every way in goes to the request page and no #inquiry link is left": the studio page's `hrefs` include `/request` (the hero and the invitation) and `/request?artist=sita`, not `/request?artist=arjun`; no href on the studio page or either artist page contains `#inquiry`.
- "a closed studio's invitation refuses instead of inviting": `CLOSED_STUDIO` gives `<h2 id="inquiry-title" class="section-title">Inquiries</h2>` and `<bdi>Black Needle</bdi> isn&#x27;t taking new inquiries right now.`, no `href="/request"` in the section.
- "an open artist's page has no form, and its 'Request a tattoo from' button holds id=inquiry, so an old #inquiry link lands one tap from the form" (Review Focus 1): Sita's page holds `<div id="inquiry" class="actions artist-request"><a class="action action-primary" href="/request?artist=sita"><span>Request a tattoo from <bdi>Sita Rai</bdi></span></a></div>`; no `inquiry-aside`, no `steps-strip`; `headings` is `[1, 2]` (no work photos).
- "a closed artist's status is their own words, said once; no request button and no inquiry target": Arjun's page holds `<p class="status status-closed user-text" dir="auto">Books open in March.</p>`, the words occur once, no `id="inquiry"`, no `Request a tattoo from`; the studio page's card for Arjun has the same status and no `note`.
- "the status says 'Taking new work', and 'Not taking new work right now' for a closed artist without words": Sita's card and page hold `<p class="status status-open">Taking new work</p>`; Arjun with `closedMessage: null` gives `<p class="status status-closed">Not taking new work right now</p>`.
- Replace the tests that pinned the form on these pages ("links to the inquiry, each open artist and every contact", "the inquiry section is headed by what it holds", "has the 4-step strip under the buttons and the same steps in the panel beside the form", "the panel beside the form also offers the chat links", "a closed artist's page offers the studio instead", "an open artist's page invites in the section's heading…") with the tests above; the panel's chat-link checks move to the request page's describe.

`theme-render.test.ts`: the outlines become `[1, 2, 2, 2, 3, 3]` ("follow the config's order", inquiry before artists) and `[1, 2, 2]` (hidden roster); "the inquiry section can't be hidden" is unchanged and passes.
`section.test.ts`: the `level` and strip tests become "the section is the request page's: the h1, the strip under it as an h2, the panel beside it".
`view-model.test.ts`: an artist's `requestHref` is `/request?artist=sita`. `loaders.test.ts`: the expected data objects follow the slimmer shapes.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new and rewritten tests.

- [ ] **Step 3: Implement** per Interfaces. The hero's "Send your idea" links to `/request`; `StudioSection`'s `inquiry` case renders `RequestInvite` with `data.inquiry`; `ArtistPage` drops `InquirySection` (its order is the profile, plan 2's Work section, then `StudioAside`). No new CSS: the invitation is a `.section`, the button row an `.actions`.

- [ ] **Step 4: Re-record the default-theme snapshot**

Delete it, run `pnpm --filter @tattoo-drip/storefront test` twice (the first run records and fails), and read `git diff` of the snapshot.
Expected: second run PASS; the diff is only the inquiry section becoming the invitation, the hero's and the roster's links, the statuses and the dropped closed-message notes, and the artist pages losing the form section and gaining the request button.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): the form leaves the home and artist pages; artists show their status"
```

### Task 4: The header that stays at the top, and the chat button

**Files:**
- Create: `apps/storefront/src/studio/components/chat.tsx`
- Modify: `apps/storefront/src/studio/loaders.ts` (each page's data; plan 2's `workPageData`), `apps/storefront/src/studio/components/pages.tsx` (`SiteBar`, `StudioPage`, `ArtistPage`, `RequestPage`, plan 2's `WorkPage`; locate `WorkPage` with `rg -n "function WorkPage" apps/storefront/src`), `apps/storefront/src/styles.css`
- Re-record: `apps/storefront/test/studio/default-theme.snapshot.json`
- Test: `apps/storefront/test/studio/render.test.ts`, `assets.test.ts`, `theme-render.test.ts` (the bar's markup)

**Interfaces:**
- Consumes: `requestLink`, `RequestLink`, `chatLinks`, `ChatLinks`, `studioCopy.request` / `.chat` (Task 1).
- Produces (data): `StudioPageData`, `ArtistPageData` and plan 2's `WorkPageData` gain `requestLink: RequestLink | null` and `chat: ChatLinks | null`; `RequestPageData` gains `chat` (the request page shows no Request button). The chat subject is the artist's name on their page, the picked artist's (open or closed) on `/request`, the filtered artist's on `/work?artist=<slug>` (from `data.artists`), else null.
- Produces (`SiteBar`): plan 2's props plus `requestLink: RequestLink | null`; markup `<header class="site-bar"><div class="site-bar-inner"><a class="site-bar-home" href="/" dir="auto">…logo and name as before…</a>{button}</div></header>`, the button `<a class="action action-primary site-bar-request" href="/request">Request</a>`, or with an artist `…href="/request?artist=sita"><span>Request <bdi>Sita Rai</bdi></span></a>`, or none for null. Every page renders it before `<main>`; the studio page gains it (its cover hero stays inside `<main>`).
- Produces (`chat.tsx`): `ChatButton({ chat, studioName }: { chat: ChatLinks | null; studioName: string })`: null for null; else `<aside class="chat-float" aria-label="Chat with {studio}"><details><summary class="action action-primary chat-float-toggle"><MessageCircle aria-hidden="true" /><span>Chat</span></summary><ul class="chat-float-links" role="list">` with two `<li>`s, `<a class="action action-secondary" href={whatsapp} rel={linkRel(whatsapp)}>WhatsApp</a>` and `<a class="action action-secondary" href={viber}>Viber</a>`, each href re-checked with `isAllowedHref` like the hero's. Rendered after `SiteFooter` on the studio, artist, work and request pages.
- Produces (CSS): `:root { --site-bar-height: 3.75rem; }` (not redefined for dark).

- [ ] **Step 1: Write the failing tests**

`render.test.ts`, describe "the header and the chat button (TAT-127)" (`bar(html)` = the `<header class="site-bar">…</header>` match):
- "every page has the bar with the studio's name and the right Request button": the studio page's bar holds `<a class="site-bar-home" href="/" dir="auto">Black Needle</a>` and `<a class="action action-primary site-bar-request" href="/request">Request</a>`; Sita's page `href="/request?artist=sita"><span>Request <bdi>Sita Rai</bdi></span></a>`; Arjun's (closed, the studio open) `href="/request">Request</a>`; plan 2's `/work` page `href="/request"`; the request page's bar has no `site-bar-request`; the bar comes before `<main` on all four.
- "a closed studio's bar offers no Request; an open artist's page still offers theirs" (Review Focus 4): `CLOSED_STUDIO`'s studio page and Arjun's page have no `site-bar-request`; `CLOSED_STUDIO` with Sita open gives Sita's.
- "the chat button opens WhatsApp with a message naming what the page shows, and Viber's plain chat": on the studio page one `<aside class="chat-float" aria-label="Chat with Black Needle">` after `</footer>`, a `<summary class="action action-primary chat-float-toggle">` reading Chat, and the decoded hrefs `https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20a%20tattoo` and `viber://chat?number=%2B9779812345678`; Sita's page, `/request?artist=sita` and `/work?artist=sita` (Sita with work photos, so `data.artists` lists her) end the WhatsApp href in `about%20Sita%20Rai`; `/request?artist=arjun` ends it in Arjun's encoded name.
- "no phone, no chat button; the bar stays": `EMPTY_STUDIO` has no `chat-float` and has the bar.
- `assertSafePage` holds for the four pages; the existing test "bidi overrides and a byte order mark reach neither the page, the head nor a prefilled message" also checks the chat button's WhatsApp href on the hostile artist's page.

`assets.test.ts`, describe "the header and the chat button (TAT-127)" (with the file's `ruleBody`):
- "the bar sticks to the top over the content": `.site-bar` has `position: sticky`, `inset-block-start: 0`, `z-index: 1` and `background: var(--paper)`; `:root` defines `--site-bar-height: 3.75rem`; `.site-bar-inner` has `min-block-size: var(--site-bar-height)`.
- "an anchor or a focused control is never hidden under the bar or the chat button" (Review Focus 1, 3): `:root:has(.site-bar)` has `scroll-padding-block-start: calc(var(--site-bar-height) + 1rem)`; `:root:has(.chat-float)` has `scroll-padding-block-end: 5.5rem`; `:root:has(.chat-float) .site-footer` has `padding-block-end: 6rem`; inside `@media (min-width: 60rem)` `.inquiry-aside` has `inset-block-start: calc(var(--site-bar-height) + 1.5rem)`.
- "the chat button floats in the corner above the bar's layer, with a 48 px toggle and no marker": `.chat-float` has `position: fixed`, `z-index: 2` and an `inset-block-end` using `env(safe-area-inset-bottom`; `.chat-float-toggle` has `list-style: none`; `.chat-float-toggle::-webkit-details-marker` has `display: none`; `.chat-float-links` has `position: absolute`.
- The wrap list in "every element that holds it can wrap anywhere" replaces `.site-bar a` with `.site-bar-home` (the Request button is an `.action`, already listed) (Review Focus 5).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the data, the bar and the button** per Interfaces. `chat.tsx` must pass `lightbox.test.ts`'s components guard as it stands: no state, focus, listener or DOM code (the `<details>` opens itself).

- [ ] **Step 4: Implement the CSS** with the theme's tokens only: `.site-bar` (sticky, full width, `--paper`, a `--line` bottom border; replaces today's margin and padding), `.site-bar-inner` (the page's width, `display: flex`, `align-items: center`, `justify-content: space-between`, `gap: 0.75rem`, `padding-block: 0.375rem`), `.site-bar-home` (today's `.site-bar a` rule, plus `min-inline-size: 0`), `.site-bar-request` (`flex: 0 1 auto`, `max-inline-size: 60%`, `text-align: center`), the scroll paddings and the wide `.inquiry-aside` offset above, `.chat-float` (fixed, `inset-inline-end: 1rem`, `inset-block-end: max(1rem, env(safe-area-inset-bottom))`), `.chat-float-links` (absolute above the toggle, `inset-block-end: calc(100% + 0.5rem)`, `inset-inline-end: 0`, a grid of the two links, `--paper` background, `--line-strong` border, `--radius`), the footer padding. The `<dialog>` viewer sits in the top layer above both.

- [ ] **Step 5: Re-record the default-theme snapshot** as in Task 3.
Expected: second run PASS; the diff is only the bar (new on the studio page, restructured on the artist pages) and the chat button.

- [ ] **Step 6: Run the checks**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): a header that stays at the top and a chat button on every page"
```

### Task 5: Page look and the contract call the inquiry section "Got an idea?"

**Files:**
- Modify: `apps/platform/inertia/components/page_look.ts` (`SECTION_WORDS.inquiry`, and any sentence saying the form is on the page)
- Modify: `packages/types/openapi.yaml` (`StorefrontSection.type` description); regenerate `packages/types/src/openapi.gen.ts`
- Test: `apps/platform/tests/unit/inertia/page_look_copy.spec.ts`

**Interfaces:**
- Produces: `SECTION_WORDS.inquiry` = `{ title: "Got an idea?", description: "A short invitation with a button to the page where clients send their idea. Always on your page." }` (the row still reads "Always shown"); the key stays `inquiry`, so stored lists and the API are unchanged.

- [ ] **Step 1: Write the failing test** in `page_look_copy.spec.ts`: `SECTION_WORDS.inquiry` deep-equals the value above (replacing plan 2's "The form" assertion).

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 pnpm test unit --files=page_look_copy.spec.ts` (from `apps/platform`, with the Global Constraints' environment)
Expected: FAIL (title "The form").

- [ ] **Step 3: Implement.** Set the words; `rg -n -i "form where clients|the form" apps/platform/inertia/components/page_look.ts apps/platform/inertia/pages/settings/look.tsx` and reword any line that says the form is on the studio page ("Your page always invites clients to send their idea."; the accent hint about red for mistakes in the form stays true). In `openapi.yaml`, `inquiry (the idea form, always listed)` becomes `inquiry (the "Got an idea?" invitation to the request page, always listed)`; run `pnpm --filter @tattoo-drip/types generate`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=page_look_source.spec.ts`, then `pnpm typecheck` (root)
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform packages/types
git commit -m "feat(platform): Page look calls the inquiry section \"Got an idea?\""
```

### Task 6: Docs, whole-branch checks and the browser pass

**Files:**
- Modify: `apps/storefront/docs/development.md`: Studio page (the routes add `/request`; the first screen's "Send your idea" goes to `/request`; the `#inquiry` bullet becomes the request page: `InquirySection` as its h1 with the strip, the closed states with the artist's words and `/request`, `?artist=` read strictly and an unknown artist the general form; the home's "Got an idea?" keeps `id="inquiry"` and an open artist's "Request a tattoo from" button holds it, so links already shared land one tap from the form; new bullets for the bar (sticky, `--site-bar-height`, the Request rules, the scroll paddings) and the chat button (`<details>`, the spec's message, Viber plain and why, no phone no button, not on `/deposit`); the styles bullet's status words; `check:page`'s `/request`), Themes and branding ("Sections": `inquiry` is the invitation; "Not themable" names the request page's form), Intake form (it lives on `/request`; Turnstile loads only there). `apps/platform/docs/ui.md` (Page look: the inquiry row is "Got an idea?").

- [ ] **Step 1: Update the docs** in the files above, one to three sentences each, in the existing voice. `docs/product.md`, `roadmap.md` and `requirements.md` wait for the last ticket of the split.

- [ ] **Step 2: Run the root gates**

Run (worktree root, Node 24, the Global Constraints' environment): `pnpm check`, `pnpm typecheck`, `pnpm build`, then the full platform suite with `PORT=3402 pnpm -C apps/platform exec node ace test` in the background (empty `queue_jobs` in `tattoo_drip_site` first), `pnpm test` for the packages and storefront, and `pnpm --filter @tattoo-drip/storefront check:page`.
Expected: all clean; the platform log ends with `Tests N passed` and no failures; "Page check passed".

- [ ] **Step 3: Browser pass**

Start the platform on 3401 against `tattoo_drip_site` with `TURNSTILE_SECRET_KEY` unset and the storefront on 3404 without `TURNSTILE_SITE_KEY`, as plan 1's browser pass did. Give one artist a Devanagari name of about 40 characters. With Playwright (plan 1's `playwright-core` and Chromium paths), at 375 × 812 and 1280 × 800, light and dark:
- The bar stays at the top while scrolling the home, artist, `/work` and `/request` pages; its Request button follows the rules (open artist, closed artist, closed studio); "Request {long Devanagari name}" wraps inside the bar and nothing scrolls sideways at 375 px (Review Focus 5).
- `/#inquiry` opens with "Got an idea?" fully below the bar; `/artists/<open slug>#inquiry` opens with "Request a tattoo from" below the bar; each is one tap from the form (Review Focus 1).
- `/request?artist=<slug>` mounts the form with that artist picked; `?artist=nobody&fbclid=x` shows the general form; at 1280 the steps panel sticks below the bar, not under it; send one inquiry and find it in the dashboard's inbox naming the artist.
- The chat button opens by tap and by keyboard (Tab, Enter, Tab to the links); the WhatsApp link's message names the page's artist; with the form's Send button focused by Tab it is not covered; the footer's last line clears it (Review Focus 3); a studio with its phone removed in the dashboard has no button (restore it afterwards).
- With JavaScript off: the bar, the invitation, the request page's chat fallback and the chat button all work.
- Network: the home page requests no intake chunk and nothing from `challenges.cloudflare.com`.
Stop both servers by their exact PIDs.

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/docs apps/platform/docs
git commit -m "docs: the request page, the header that stays at the top and the chat button"
```

- [ ] **Step 5: Tear down**

Leave `tattoo_drip_site` in place for tickets 4 and 5 (they stack on this branch); stop every process this plan started; `git status` clean.
