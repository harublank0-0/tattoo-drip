# Studio site 5/5 (TAT-128): Good to know and opening hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 1. Header

- **Ticket:** TAT-128 "Studio site 5/5: Good to know section and opening hours" (Linear estimate 3, a guess; this plan's estimate: **5 points**, see Risks).
- **Branch:** `harublank00/tat-128-studio-site-55-good-to-know-section-and-opening-hours` in the worktree `/home/blank/Coding/tattoo-drip-wt/site-5`, dependencies installed.
- **Base:** `ec29563` (TAT-126 "Studio site 2/5", Task 1 of 8, built by another session in `tattoo-drip-wt/site-2`). Tasks 1 to 7 build on it; Task 8 needs TAT-126's final tip (see "Rebasing on TAT-126" below).
- **Lane:** database `tattoo_drip_uz` (create it as run4-brief says: grants from `apps/platform/database/setup_roles.sql`, then `pnpm migrate`), platform dev server **3431**, platform tests **3432**, storefront dev **3434**, stand-in API **3435**. Every platform command: `DB_DATABASE=tattoo_drip_uz ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform`; for test runs also `env -u TURNSTILE_SECRET_KEY -u STOREFRONT_SERVER_KEYS -u TRUST_PROXY -u ALERT_EMAILS`. Node 24: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`. A RED run that may hit a missing import: `timeout 90 … > /tmp/site5-red.log 2>&1` (Japa hangs on import errors).
- **Full platform suite** (and any run that includes `setup_roles.spec.ts` or `role_guard.spec.ts`) under BOTH locks, nested: `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock <cmd>`.
- **Never touch** the worktrees `site-1`, `site-2`, `main-integration`, the main folder `/home/blank/Coding/tattoo-drip`, or the databases `tattoo_drip` / `tattoo_drip_site`; never the servers on 3333 / 3000.
- **Goal in plain words:** a studio writes its weekly opening hours (one open and one close time per weekday, or closed), dated closed days with a short note, and four short texts (walk-ins, age rule, "Before your session", "Aftercare") on a new owner-only dashboard page. The studio page gets a "Good to know" section with those parts plus the existing deposit policy, each shown only when filled in, and the cover says the city and today's state ("Open now · till 8 pm"), right even when the cached page is 10 minutes old. Hours and closures are stored as rows the later scheduling project can read as studio-wide hours and closures.
- **Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md`: "Home", "Good to know" (home section), "Good to know" under "The content behind the pages", "Constraints" (caching, plain text, tenant isolation), "My calls" 7 and 9, "Left to the builder" (open state under the cache; an independent studio), "Docs to update". This is the LAST ticket of the split, so it also does the product docs that tickets 2 to 4 left for it.

### Rebasing on TAT-126

The branch starts at TAT-126's Task 1 (`ec29563`). TAT-126 (plan `docs/superpowers/plans/2026-10-30-studio-site-2-photos-and-gallery.md`) keeps landing commits on `harublank00/tat-126-studio-site-25-full-portfolios-photo-styles-healed-photos` (read-only to you: never check it out, never commit to it; the ref is shared through the repository).

- **Before each task:** `git log --oneline HEAD..harublank00/tat-126-studio-site-25-full-portfolios-photo-styles-healed-photos`. If it lists commits, `git rebase harublank00/tat-126-studio-site-25-full-portfolios-photo-styles-healed-photos`, resolve conflicts keeping both sides (yours add fields, cases and keys next to theirs), run `pnpm migrate` (their migrations run even if numbered before yours: they are independent of Task 1's), regenerate (`pnpm --filter @tattoo-drip/types generate`, `node ace codegen`) and rerun the previous task's tests. Small rebases often beat one big one.
- **Task 8 needs TAT-126 Task 7** ("Recent work on the home page, ordered and hidden from Page look": `SECTION_KEYS = ["work", "artists", "inquiry"]`, `sectionList`, `SECTION_WORDS`, the Sections list on Page look, migration `1791700000002_add_work_section_to_tenants.ts`). Check with `git log --oneline harublank00/tat-126-… | grep -i "ordered and hidden from Page look"`. If it is not there when you reach Task 8, stop after Task 7 and report "waiting on TAT-126 Task 7"; do not build Task 8 against the old radio group.
- After the last rebase, these TAT-126 things exist and Tasks 7 to 9 rely on them: `SiteBar` / `StudioAside` in `components/pages.tsx` (not touched here), `StudioSection`'s `work` case, `studioPageData(studio, artists, origin, imageOrigin = null, recentWork: unknown = null)`, `DEFAULT_STOREFRONT` = work, artists, inquiry in `test/studio/fixtures.ts`, `src/studio/paging.tsx` and the `lightbox.test.ts` guard "no file under `src/studio/` other than `lightbox.ts` and `paging.tsx` contains `document.`".

### Integration (for the session that merges 126, 127, 129, then 128)

TAT-127 (`/request`, sticky header, chat button; plan in another session's scratchpad) and TAT-129 (flash; assumed to add a `flash` section key, `/flash` pages and a flash table) merge BEFORE this branch. Expected textual conflicts and how to resolve them:

- **Section keys** (`app/modules/storefront/look.ts`, storefront `src/studio/theme/config.ts`, `packages/types/openapi.yaml` `StorefrontSection.type` enum and `StorefrontConfiguration.sections.maxItems`, dashboard `inertia/components/page_look.ts` `SECTION_WORDS`): the final list is `work, artists, flash, info, inquiry` (spec order: Recent work, Artists, Flash, Good to know, "Got an idea?"); `maxItems` is the list's length (5). `page_look_columns.spec.ts` and Task 8's migration test compare the database default with `DEFAULT_SECTIONS.join(",")`, so a stale literal fails loudly.
- **Migration order:** this branch's two migrations are `1791790000000_…` and `1791790000001_…`. `ls apps/platform/database/migrations | tail -6` after the merge: they must be the last two (Task 8's sets the column default for new studios; a later section migration would drop `info` from it). If 129's sort later, rename ours above them (they ran only in `tattoo_drip_uz` and the integration database: roll back there first).
- **`StudioSection`** (`components/pages.tsx`): one `case` per key (`work` from 126, `flash` from 129, `info` here, `inquiry` from 127 renders `RequestInvite`); keep all.
- **`StudioPageData` / `loadStudioPage`** (`src/studio/loaders.ts`): 126 adds `recentWork`, 127 removes `channels` and adds `requestLink` / `chat`, this branch adds `goodToKnow` and `openNow` (set in `loadStudioPage`, not through `studioPageData`'s parameters). Keep every field.
- **`studioCopy`** (`src/studio/copy.ts`): this branch adds one top-level key `goodToKnow`; 126 extends `work`, 127 adds `request`, `status`, `chat`. Keep all.
- **`src/styles.css`**: this branch appends one block (`.profile-hours`, `.know-*`); keep every block.
- **`Studio` in `openapi.yaml`**: this branch adds `openingHours`, `closedDays`, `goodToKnow` to `required` and `properties`; keep anything 126/129 added there.
- **Isolation tables** (`tests/isolation/cases.ts`, `tests/helpers/tenants.ts` `seededStudio`, `tests/helpers/public_isolation.ts`, `tests/functional/rls/catalog_guard.spec.ts` `EXPECTED_POLICIES`): additive on both sides.
- **Routes and roles** (`start/routes.ts` settings group, `app/modules/tenancy/access.ts`): additive.
- **Docs**: this branch rewrites `docs/product.md`, `docs/roadmap.md` and `docs/requirements.md` lines about the studio site as the whole split (1 to 5) shipped, including flash; if TAT-129 did not ship, drop the flash words there.

---

## 2. Scope fence

**May change (create or modify):**

- Platform: `apps/platform/database/migrations/1791790000000_create_studio_hours_and_closures.ts` (new), `…/1791790000001_add_good_to_know_section_to_tenants.ts` (new, Task 8); `app/modules/scheduling/opening_hours.ts` (new, pure), `app/modules/scheduling/models/studio_hour.ts`, `…/models/studio_closure.ts` (new), `app/modules/scheduling/services/opening_hours_service.ts` (new), `app/modules/scheduling/validators/opening_hours.ts` (new), `app/modules/tenancy/services/tenancy_service.ts` (one type, one method), `app/modules/tenancy/validators/good_to_know.ts` (new), `app/controllers/good_to_know_controller.ts` (new), `app/modules/storefront/services/studio_page_service.ts`, `app/transformers/public_studio_transformer.ts`, `app/modules/storefront/look.ts` (Task 8), `start/routes.ts`, `app/modules/tenancy/access.ts`, `inertia/pages/settings/good_to_know.tsx` (new), `inertia/components/good_to_know.ts` (new, words and pure helpers), `inertia/layouts/settings.tsx` (one nav item), `inertia/pages/settings/payments.tsx` (one sentence), `inertia/components/page_look.ts` (Task 8, one `SECTION_WORDS` entry); generated `database/schema.ts`, `.adonisjs/`.
- Platform tests: new `tests/unit/modules/scheduling/opening_hours.spec.ts`, `tests/functional/rls/studio_hours.spec.ts`, `tests/functional/scheduling/opening_hours_service.spec.ts`, `tests/functional/scheduling/good_to_know_http.spec.ts`, `tests/unit/inertia/good_to_know_copy.spec.ts`; modified `tests/functional/rls/catalog_guard.spec.ts`, `tests/isolation/cases.ts`, `tests/helpers/tenants.ts`, `tests/helpers/public_isolation.ts`, `tests/functional/api/public_studio.spec.ts`, `tests/functional/api/studio_page_privacy.spec.ts`, `tests/functional/storefront/studio_page_service.spec.ts`, `tests/functional/tenancy/tenancy_service.spec.ts`, and in Task 8 `tests/unit/modules/storefront/look.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts`, `tests/functional/tenancy/page_look_columns.spec.ts`.
- Packages: `packages/types/openapi.yaml`, `packages/types/src/index.ts` (three names), generated `packages/types/src/openapi.gen.ts`; test fixtures `packages/sdk/test/client.test.ts`, `packages/react/test/studio.test.ts`, `packages/react/test/lists.test.ts`.
- Storefront: new `src/studio/hours.ts` (pure time logic), `src/studio/good-to-know.ts` (view models), `src/studio/open-now.tsx` (the one stateful island this ticket adds), `src/studio/components/good-to-know.tsx`; modified `src/studio/loaders.ts`, `src/studio/components/pages.tsx` (three small hunks), `src/studio/copy.ts` (one key), `src/styles.css` (one block), `src/studio/theme/config.ts` (Task 8); tests: new `test/studio/hours.test.ts`, `test/studio/good-to-know.test.ts`; modified `test/studio/fixtures.ts`, `test/studio/loaders.test.ts`, `test/studio/lightbox.test.ts`, `test/studio/theme-config.test.ts` (Task 8), `test/tenancy/helpers.ts` only if the type checker asks.
- Docs (Task 9): `docs/product.md`, `docs/roadmap.md`, `docs/requirements.md`, `docs/data-model.md`, `docs/sdk.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `apps/platform/database/README.md`, `apps/storefront/docs/development.md`.

**NOT in this plan:**

- Split hours, hours past midnight, "open by appointment", extra open dates, per-artist hours or time off (scheduling project, TAT-130 and V1).
- Using the hours anywhere but the studio page and this settings page (no booking or slot rules, no Today or calendar change).
- JSON-LD `openingHoursSpecification` (spec non-goal on structured data; follow-up).
- A "notify me" or reviews; a link from the cover line to the section.
- Editing a closed-days entry in place (remove and add again), deleting ended entries automatically.
- The artist page, `/work`, `/request` and `/flash` pages: they show neither the section nor the cover line.
- Anything in TAT-127's request page, header or chat button, or in TAT-129's flash.
- The setup checklist, onboarding, the message templates (the "Aftercare" chat message stays its own text).

## 3. Facts verified on this branch (at `ec29563`)

- Tenants already hold `timezone` (default `Asia/Kathmandu`, `DEFAULT_TIMEZONE` at `app/modules/tenancy/models/tenant.ts:26`), `address` and `deposit_policy` (`database/schema.ts`, `TenantSchema` from line 835). No city column exists.
- **The cover's city line already exists:** `StudioView.location` (`src/studio/view-model.ts:59-60`, built at line 189 with `locationLine(addressText)`); `locationLine` (`src/studio/text.ts:75`) takes "Thamel, Kathmandu" from the address (TAT-105). `StudioPage` renders it at `src/studio/components/pages.tsx:45` as `<p className="profile-location user-text" dir="auto">{studio.location ?? studio.typeLabel}</p>`. Pinned by `test/studio/text.test.ts:134` and the first-screen tests in `render.test.ts:332`.
- `StudioSection` (`pages.tsx:106-125`) switches on `artists` and `inquiry`; `SECTION_KEYS = ["artists", "inquiry"]` in both `app/modules/storefront/look.ts:20` and storefront `src/studio/theme/config.ts:21`; `tests/unit/modules/storefront/look.spec.ts:51` fails when the two drift. TAT-126 Task 7 replaces this with an ordered show/hide list (see Rebasing).
- `tenants.storefront_sections` is checked by `tenants_storefront_sections_format`: `^[a-z]+(,[a-z]+){0,7}$` and holds `inquiry` (`database/migrations/1791696000000_add_page_look_to_tenants.ts`). **Section keys are lowercase letters only (no hyphen) and at most 8.**
- **The deposit policy is private today on purpose:** `studio_page_service.ts:25` ("Never the deposit settings, which the settings page says the deposit page shows"), `public_studio_transformer.ts:13` ("Never the tenant id, the deposit settings…"), the canary `"canary-policy-44"` in `tests/functional/api/studio_page_privacy.spec.ts:26,83`, the Payments page sentence "Shown to clients on the deposit page." (`inertia/pages/settings/payments.tsx:58`), `docs/requirements.md:138` ("never deposit policies") and `apps/platform/docs/backend.md:53` ("Never in these answers: … the deposit policy or percentage"). The spec now shows it in Good to know; all of these change (Task 5, Task 4, Task 9). The percentage stays private.
- `getStudio` costs **one** query (`ArtistService.listVisible`), pinned in `tests/functional/storefront/studio_page_service.spec.ts:417-446` ("studio", 1). `pagesWith()` there (line 41) builds `StudioPageService(artists, images, workPhotos)` by hand.
- Public reads are cached `public, max-age=60, stale-while-revalidate=600` (`app/middleware/public_cache_middleware.ts`), the storefront's pages `public, max-age=0, s-maxage=60, stale-while-revalidate=600` (`PAGE_CACHE`, `src/studio/cache.ts:9-10`). A page can be served up to 60 + 600 s = 11 minutes after it was rendered.
- The storefront dehydrates successful queries into the page (`src/api/query-client.ts`, `shouldDehydrateQuery`), so the whole `Studio` object travels in every studio page's HTML.
- `src/studio/components/` may hold no `useEffect`, `useState`, `useRef`, `tabIndex`, `.focus(`, `addEventListener` or `document.` (`test/studio/lightbox.test.ts:56-77`). Stateful islands live in `src/studio/` (TAT-126 adds `paging.tsx` there).
- Owner-only settings routes: the `/settings` group in `start/routes.ts:103-205`; `TENANT_ROUTE_ROLES` settings entries `app/modules/tenancy/access.ts:32-60` (`OWNERS`); isolation cases `tests/isolation/cases.ts` (e.g. `/t/:tenant/settings/messages` at 898-917); `seededStudio` `tests/helpers/tenants.ts:99`, its return object near 330-358; `publicMarkers` `tests/helpers/public_isolation.ts:12-28`; `EXPECTED_POLICIES` `tests/functional/rls/catalog_guard.spec.ts:25-53`.
- RLS helper `enableTenantRls` / `disableTenantRls` (`database/helpers/tenant_rls.ts`); a settings table replaced in place, not soft-deleted, is `message_templates` (`database/migrations/1791670000001_create_message_templates_table.ts`).
- Advisory lock precedent: `lockAddress` (`app/modules/tenancy/services/invitation_service.ts:139-147`, `pg_advisory_xact_lock(hashtextextended(?, 0))`).
- `todayIn(timezone, now)` and `lastBookableDay(today)` are in `app/modules/projects/quotes.ts:166,178`; the scheduling validators already import them (`app/modules/scheduling/validators/session.ts:4`). `toSessionTimes` there throws `errors.E_VALIDATION_ERROR(problems)` for cross-field rules (line ~95): the pattern Task 2 copies.
- `<Input type="time">` and `type="date"` precedent: `inertia/components/sessions_card.tsx:329-360`. Inertia 3.8's `Form` turns `hours[sun][opens]` names into nested objects (`formDataToObject`, `node_modules/@inertiajs/core/dist/index.js:4044`); the isolation helper sends bodies with `request.form(body)` (`tests/helpers/isolation.ts:56`).
- No `date` or `time` column exists yet. Lucid's generator types `time` as `string` and `date` as `DateTime` with `@column.date` (`node_modules/@adonisjs/lucid/build/src/orm/schema_generator/rules.js`).
- Page look's saved message explains the cache: "It can take up to 15 minutes to show on your page." (`app/modules/tenancy/look_messages.ts`).
- Mockup (`.superpowers/brainstorm/399618-1793296889/content/site-v3.html:70,83-86`, local, read-only): cover "Thamel, Kathmandu · Open now till 8 pm"; Good to know as a two-column list (Hours "Sun–Fri 11–8 · Sat closed", Walk-ins, Age, Deposit) then two folded rows "Before your session" and "Aftercare".

## 4. Decisions

1. **Weekly hours and closed days are two RLS tables in the scheduling module, the texts are tenant columns.** `studio_hours` (one row per open weekday: `weekday smallint` 0 = Sunday … 6 = Saturday, `opens_at time`, `closes_at time`, unique per weekday, `closes_at > opens_at`) and `studio_closures` (`starts_on date`, `ends_on date`, `note varchar(120)`), both with `tenant_id`, `enableTenantRls()`, not soft-deleted (settings replaced in place, like `message_templates`). Why: rows with SQL types are what a slot engine joins against ("studio-wide hours and closures"; `AvailabilityException` in `docs/data-model.md:79`), and the database itself refuses a closing time before the opening. Weekday numbers match Postgres `extract(dow)` and JS `getDay()`. Rejected: a JSON column on `tenants` (no checks, and scheduling would parse it); four more text columns are fine on `tenants` because they are profile text like `intro` and `deposit_policy`.
2. **Closed days are date ranges** (first day, last day, note), at most 60 days each, starting today to a year ahead, at most **20 that have not ended**. Why: Dashain and Tihar are multi-day; the cap bounds the public payload and the page. Overlaps are allowed (harmless). Ended rows stay in the table and are never shown.
3. **The public data rides on `getStudio`; no new endpoint, SDK method or hook.** `Studio` gains `openingHours`, `closedDays` (not ended, earliest first) and `goodToKnow` (five texts). Why: the cover needs the hours on the first screen, the studio read is already cached and loaded on every page, and a separate read would add a request and a failure mode on mobile data. Cost: 2 more indexed queries per uncached `getStudio` and up to ~7 KB more in the dehydrated studio (typically a few hundred bytes). Contract first still holds: `openapi.yaml` → generate → the SDK and hooks return the new fields with no code change (fixtures only). Rejected: `GET /tenants/{tenant}/good-to-know`.
4. **"Open now" is computed in the browser from the hours, the closures and the studio's timezone**, re-checked every 30 s; the server render shows the state only when it cannot change within the page's cache life (11 minutes, sampled each minute), otherwise an empty line that the browser fills on hydration. Why: a server-computed value baked into a page cached for up to 11 minutes would say "Open now" after closing (spec anti-goal); a short-lived value would need a shorter cache, which the spec forbids. The steady server state means most visitors, and visitors without JavaScript, see it at once. Cost: one stateful island (`src/studio/open-now.tsx`) and a viewer with a wrong phone clock sees a wrong state (accepted).
5. **The city is TAT-105's location line, unchanged**, and today's state is its own line under it. Why: the city already comes from the address; a separate line keeps the 48-character location rule and avoids a layout jump when the browser fills the state (the line keeps its height). Rejected: a new `city` field (double work for the owner).
6. **Words.** Cover: "Open now · till 8 pm", "Closed now · opens at 11 am" (before opening), "Closed now · opens tomorrow at 11 am" / "· opens Sunday at 11 am" (after closing), "Closed today · opens …" (a closed weekday), "Closed today · {note}" during a closure, "Closed now" / "Closed today" when nothing opens within 7 days. Times 12-hour as Nepali studios write them ("8 pm", "10:30 am"). The week starts on Sunday (Nepal's week, and the calendar's), grouped: "Sun – Fri 11 am – 8 pm", "Sat Closed", "Every day 11 am – 8 pm". Closed days: "Tue 20 Oct", "20 – 28 Oct", "30 Oct – 2 Nov", "30 Dec 2026 – 2 Jan 2027" (a year only when a range crosses one; no "this year" logic, so the text never depends on the clock).
7. **Section layout** follows the mockup: a definition list (Hours, Closed days, Walk-ins, Age, Deposit) then "Before your session" and "Aftercare" as native `<details>` (long texts, no JavaScript, like TAT-127's chat button). Each part only when filled; no part, no section (spec call 7).
8. **Section key `info`** (lowercase letters only, the database check's shape), titled "Good to know" on Page look, default place just before `inquiry`. The migration inserts it before `inquiry` in every stored list, so every studio gets it shown in the spec's place (it renders nothing until something is filled in) and an owner's earlier order stays.
9. **One dashboard page, three forms:** "Opening hours" (seven rows, a checkbox per day, two time inputs when open), "Closed days" (the list with Remove, then an add form), "For clients" (the four texts, and a line pointing to Payments for the deposit policy). Owner-only, in the settings nav after Page look as "Good to know" (lucide `Clock`). Field names are distinct across the forms because a page shares one error bag (`hours.*`, `closedFrom` / `closedTo` / `closedNote`, `walkIns` / `ageRule` / `beforeSession` / `aftercare`). Ticking a day copies the times of the nearest open day above it (else below it, else 11:00–20:00), so a week is mostly ticks. Removing a closed day needs no confirm (re-adding is easy).
10. **Saves are serialized per studio with an advisory lock** (`tattoo-drip:opening-hours:<tenantId>`), so replacing the week (delete, insert) never hits the unique index under a double submit, and the 20-closure cap counts exactly. Rejected: locking the tenant row from the scheduling module (tenants change only through `TenancyService`).
11. **Limits:** walk-ins 300, age rule 200, "Before your session" 2000, "Aftercare" 2000 characters (the deposit policy keeps its 2000); closed-day note 120, one line. All plain text, trimmed, empty is null.
12. **An independent studio** reads the same: no public word says "studio"; the dashboard says "your page".

**The owner may overrule these; build the default:**

1. The deposit policy shows publicly in Good to know as soon as this ships, for every studio that wrote one (default: yes, as the spec says; the Payments page says so). Alternative: a separate "show on my page" switch.
2. "Open now" is computed on the visitor's phone from the hours (default), with a server-rendered state only when it holds for the cache life. Alternative: a shorter page cache.
3. Closed days are ranges of up to 60 days, at most 20 ahead, with a one-line note of 120 characters; no "open on a special date" or changed hours for one day (default).
4. The week starts on Sunday, times read "8 pm" / "10:30 am", and the public words are English (default); studio texts stay as written.
5. Good to know is switched on for every existing studio, just before "Got an idea?" (default; it shows nothing until filled in). Alternative: off until the owner turns it on in Page look.

## 5. Design

### 5.1 Studio page cover (storefront, `StudioPage` in `components/pages.tsx`)

- Under the location line, inside `profile-heading` (so it sits on the cover's scrim when there is a cover): `{data.openNow ? <OpenNow view={data.openNow} /> : null}`.
- `OpenNow` renders `<p className="profile-hours">` holding `<strong>{lead}</strong>` and, with a detail, ` · ` and `<span className="user-text" dir="auto">{detail}</span>`; empty while the state is unknown (server render not steady, before hydration).
- No line at all when the studio set no open weekday and no closed days, or its timezone is unusable.
- CSS: `.profile-hours { min-block-size: 1.4em; max-inline-size: 36rem; color: var(--ink-muted); font-size: 1.0625rem; line-height: 1.4; overflow-wrap: anywhere; }`, `.profile-cover .profile-hours { color: var(--on-photo); }`. Theme tokens only; same contrast as the location line in both schemes.
- 375 px: the line wraps under the location; a 120-character Devanagari note wraps inside the cover box (`overflow-wrap: anywhere`), never sideways. 1280 px: one line.

### 5.2 Good to know section (storefront, `components/good-to-know.tsx`)

```html
<section id="good-to-know" class="section" aria-labelledby="good-to-know-title">
  <h2 id="good-to-know-title" class="section-title">Good to know</h2>
  <dl class="know-list">
    <div class="know-item"><dt>Hours</dt><dd><ul class="know-lines" role="list">
      <li><span class="know-when">Sun – Fri</span> <span>11 am – 8 pm</span></li>
      <li><span class="know-when">Sat</span> <span>Closed</span></li></ul></dd></div>
    <div class="know-item"><dt>Closed days</dt><dd><ul class="know-lines" role="list">
      <li><span class="know-when">20 – 28 Oct</span> <span class="user-text" dir="auto">Closed for Dashain</span></li></ul></dd></div>
    <div class="know-item"><dt>Walk-ins</dt><dd class="user-text" dir="auto">…</dd></div>
    <div class="know-item"><dt>Age</dt><dd class="user-text" dir="auto">…</dd></div>
    <div class="know-item"><dt>Deposit</dt><dd class="user-text" dir="auto">…</dd></div>
  </dl>
  <details class="know-more"><summary><span>Before your session</span><ChevronDown aria-hidden="true" /></summary>
    <p class="user-text measure" dir="auto">…</p></details>
  <details class="know-more"><summary><span>Aftercare</span>…</summary>…</details>
</section>
```

- Each `know-item` and each `details` only when filled; the `dl` only with at least one item; no section when everything is empty (`goodToKnowIsEmpty`).
- CSS (one block appended to `src/styles.css`, tokens only): `.know-list { display: grid; gap: 1rem; margin: 0; }`; `.know-item { display: grid; gap: 0.25rem; }` and inside the existing `@media (min-width: 40rem)` (or a new one) `.know-item { grid-template-columns: 9rem minmax(0, 1fr); gap: 1rem; }`; `.know-item dt { color: var(--ink-muted); font-size: 0.9375rem; font-weight: 600; }`; `.know-item dd { min-inline-size: 0; margin: 0; overflow-wrap: anywhere; }`; `.know-lines { display: grid; gap: 0.25rem; margin: 0; padding: 0; list-style: none; }`; `.know-when { display: inline-block; min-inline-size: 7rem; font-weight: 600; }`; `.know-more { border-block-end: 1px solid var(--line); }`; `.know-list + .know-more { margin-block-start: 1.5rem; }`; `.section-title + .know-more, .know-list + .know-more { border-block-start: 1px solid var(--line); }`; `.know-more > summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-block-size: 3rem; cursor: pointer; font-weight: 600; list-style: none; }`; `.know-more > summary::-webkit-details-marker { display: none; }`; `.know-more > summary svg { flex: none; color: var(--stencil); transition: rotate 150ms ease; }`; `.know-more[open] > summary svg { rotate: 180deg; }`; `@media (prefers-reduced-motion: reduce) { .know-more > summary svg { transition: none; } }`; `.know-more > p { margin-block: 0 1rem; }`.
- Tap targets: each summary is 48 px tall (`min-block-size: 3rem`), full width. Keyboard: native `<details>` (Enter / Space). Focus ring: the global `:focus-visible`.
- Light/dark: tokens only (`--ink-muted`, `--line`, `--stencil`).

### 5.3 Dashboard: Settings, Good to know (`inertia/pages/settings/good_to_know.tsx`)

`GoodToKnow.layout = [AppLayout, SettingsLayout]`, three `Section`s (`~/components/section`), shadcn `Field` / `FieldLabel` / `FieldError` / `FieldDescription`, `Checkbox`, `Input`, `Textarea`, `Button`; no custom CSS classes.

1. **"Opening hours"**, description "Your page shows them in Good to know, and today's on its cover, like "Open now · till 8 pm". Times are {timezone} time." (`timezone` prop; for Asia/Kathmandu "Times are Asia/Kathmandu time."). One `<Form route="tenant.settings.hours.update">`, keyed by the stored week's JSON (a save remounts it with the stored values). A `<fieldset>` with an `sr-only` legend "Opening hours"; seven rows, Sunday first, each `grid gap-2 lg:grid-cols-[10rem_1fr_1fr] lg:items-center`: a controlled `Checkbox` (no `name`) with the full day name as its label ("Sunday"), and for a ticked row a hidden `<input type="hidden" name="hours[<day>][open]" value="1">` (what is sent never depends on how Radix's checkbox submits); when ticked, two `Input type="time"` (`hours[<day>][opens]` labelled "Opens <Sunday>" for screen readers and "Opens" visibly, the same for "Closes"); when not ticked, "Closed" in `text-muted-foreground`. A day's error (`errors["hours.sun"]`) shows under its row (`FieldError`, `aria-describedby` from the time inputs). Button "Save hours" ("Saving…" while processing). Rows live in `useState` (the dashboard may use hooks), built by `weekRows(props.week)`; ticking calls `tickDay(rows, index, checked)`.
2. **"Closed days"**, description "Holidays and days off, like Dashain or Tihar. On those days your cover says you're closed and shows your note." A `ul` (`divide-y`) of the upcoming ones from `closedDays` (server-worded `when` like "Tue 20 Oct 2026" or "20 – 28 Oct 2026", then the note in `text-muted-foreground wrap-anywhere`), each with an outline `Button` "Remove" (`aria-label` from `removeLabel(when)`: "Remove closed days Tue 20 Oct 2026") that calls `router.delete(urlFor("tenant.settings.closed_days.destroy", { tenant, id }), { preserveScroll: true })`. Empty: "No closed days ahead." (`text-sm text-muted-foreground`). Then `<Form route="tenant.settings.closed_days.store" resetOnSuccess>`: "First day" (`type="date"`, `name="closedFrom"`, `min` / `max` from `dates`), "Last day (optional)" (`name="closedTo"`, description "Leave it empty for one day."), "Note (optional)" (`name="closedNote"`, `maxLength={120}`, placeholder "Closed for Dashain, back on 28 October"), button "Add closed days". The three inputs wrap to one column at 375 px, three columns from `lg`.
3. **"For clients"**, description "Short answers to what clients ask before they come. Your page shows each one you fill in and leaves out the rest." `<Form route="tenant.settings.good_to_know.update">`: "Walk-ins" (`Textarea` rows 2, `maxLength={300}`, placeholder "Welcome for small flash. Bigger pieces need a booking."), "Age" (`Textarea` rows 2, 200, placeholder "18 and over, with a photo ID."), "Before your session" (rows 5, 2000, placeholder "Eat a good meal, sleep well and wear clothes that leave the spot free."), "Aftercare" (rows 5, 2000, placeholder "Keep the wrap on for 2 hours, then wash gently with clean water and mild soap."); then a `p` with `depositLine(hasDepositPolicy)` and a `Link` "Payments" to `tenant.settings.payments`; button "Save".
4. **Task 8 adds at the top**, when `shownOnPage` is false: a bordered note (`rounded-md border p-3 text-sm`) "Good to know is hidden on your page. Show it in Page look." with a `Link` to `tenant.settings.look`.

- Flash messages: "Opening hours saved. They can take up to 15 minutes to show on your page.", "Closed days added. They can take up to 15 minutes to show on your page.", "Closed days removed.", "Saved. It can take up to 15 minutes to show on your page."
- 44 px: the components already are below `lg` (ui.md "Tap targets"); `Checkbox` has its 44 px hit area.
- Devanagari: notes and texts render as text with `wrap-anywhere`; nothing truncates.
- Payments page (`payments.tsx:58`): the Deposits description becomes "Shown to clients on the deposit page, and in Good to know on your studio page."

### 5.4 Page look (Task 8, on TAT-126's Sections list)

`SECTION_WORDS.info = { title: "Good to know", description: "Your hours, closed days, walk-ins, age rule, deposit policy, and what to do before and after a session. Shows only what you filled in." }`. TAT-126's list draws the row, its show checkbox and its move buttons; nothing else changes there.

## 6. Data and contract

### 6.1 Migration `1791790000000_create_studio_hours_and_closures.ts` (Task 1)

`up`:
- `studio_hours`: `id uuid pk default uuidv7()`, `tenant_id uuid not null references tenants(id) on delete cascade`, `weekday smallint not null`, `opens_at time not null`, `closes_at time not null`, `created_at timestamptz not null`, `updated_at timestamptz null`, `unique (tenant_id, weekday)` (also the tenant index); checks `studio_hours_weekday_range` (`weekday between 0 and 6`) and `studio_hours_closes_after_opens` (`closes_at > opens_at`); `enableTenantRls("studio_hours")`.
- `studio_closures`: `id`, `tenant_id` (same reference), `starts_on date not null`, `ends_on date not null`, `note varchar(120) null`, timestamps, index `studio_closures_tenant_ends` on `(tenant_id, ends_on)`; checks `studio_closures_ends_after_starts` (`ends_on >= starts_on`) and `studio_closures_note_not_blank` (`note is null or btrim(note) <> ''`); `enableTenantRls("studio_closures")`.
- `tenants`: `walk_ins_text varchar(300) null`, `age_rule_text varchar(200) null`, `before_session_text varchar(2000) null`, `aftercare_text varchar(2000) null`.
- Doc comment: why rows (scheduling will read them as studio-wide hours and closures, `docs/data-model.md`), why not soft-deleted (settings replaced in place), weekday 0 = Sunday like `extract(dow)`.

`down`: `disableTenantRls` on both, drop both tables, drop the four columns.

Models (`app/modules/scheduling/models/`): `StudioHour extends StudioHourSchema`, `StudioClosure extends StudioClosureSchema` (check the generated class names in `schema.ts` after migrating). Tenant model gains the four columns through the regenerated schema.

### 6.2 Service and pure rules (Task 2)

`app/modules/scheduling/opening_hours.ts` (pure, imported by the validator, the service, the controller and the dashboard words test):
```ts
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_OPENS = "11:00";
export const DEFAULT_CLOSES = "20:00";
export const MAX_UPCOMING_CLOSURES = 20;
export const MAX_CLOSURE_DAYS = 60;
export const CLOSURE_NOTE_MAX = 120;
export type OpeningDay = { day: Weekday; opens: string; closes: string }; // "HH:mm"
export type ClosureInput = { startsOn: string; endsOn: string; note: string | null }; // yyyy-MM-dd
export type ShownClosure = { from: string; to: string; note: string | null };
/** The dashboard's words for a closed-days entry, always with the year: "Tue 20 Oct 2026", "20 – 28 Oct 2026", "30 Oct – 2 Nov 2026", "30 Dec 2026 – 2 Jan 2027". */
export function closedDaysWhen(from: string, to: string): string;
```

`app/modules/scheduling/validators/opening_hours.ts`:
- `openingHoursValidator = vine.create({ hours: vine.object(Object.fromEntries(WEEKDAYS.map((day) => [day, vine.object({ open: vine.boolean().optional(), opens: vine.string().trim().nullable().optional(), closes: vine.string().trim().nullable().optional() }).optional()]))).optional() })` (an emptied time box arrives as null through `convertEmptyStringsToNull`, so the shape accepts it and `toOpeningWeek` words the error on the day).
- `toOpeningWeek(form): OpeningDay[]`: for each weekday in order whose `open` is true: both times must match `CLOCK_TIME` ("Enter both times, like 11:00 and 20:00."), and `closes > opens` as strings ("Close after you open. Hours can't run past midnight."); a problem is reported on `hours.<day>` with rule `hours`; any problem throws `errors.E_VALIDATION_ERROR(problems)` (the `toSessionTimes` pattern). A day not ticked is closed, whatever times came with it.
- `closedDaysValidator = vine.create({ closedFrom: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/), closedTo: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), closedNote: vine.string().trim().maxLength(CLOSURE_NOTE_MAX).regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u).nullable().optional() })` (an empty box arrives as null; a hand-made request may leave it out) with messages: `closedFrom.required` / `closedFrom.regex` "Pick a day from today to a year from now.", `closedTo.regex` "Pick the same day or a later one, at most 60 days after the first.", `closedNote.maxLength` / `closedNote.regex` "Keep the note to one line of 120 characters or fewer.".
- `toClosure(form, timezone, now = DateTime.now()): ClosureInput`: `today = todayIn(timezone, now)`; `closedFrom` a real date (`DateTime.fromISO(x, { zone: "utc" }).isValid`) from `today` to `lastBookableDay(today)`; `closedTo` defaults to `closedFrom`, real, `>= closedFrom`, at most `MAX_CLOSURE_DAYS - 1` days after it; `note` trimmed, empty is null; throws `E_VALIDATION_ERROR` on `closedFrom` / `closedTo`.

`app/modules/scheduling/services/opening_hours_service.ts` (`OpeningHoursService`, no constructor dependencies; every query scoped by `tenant_id` and run in the request transaction):
- `week(tenant): Promise<OpeningDay[]>`: one query, `order by weekday`, times as `"HH:mm"` (`opensAt.slice(0, 5)`).
- `replaceWeek(tenant, days: OpeningDay[]): Promise<void>`: `withTransaction`: the advisory lock, delete the tenant's rows, insert one row per day (`StudioHour.createMany(rows, { client: trx })`).
- `upcomingClosures(tenant, today: string): Promise<StudioClosure[]>`: `ends_on >= today`, `order by starts_on, ends_on, id`, `limit MAX_UPCOMING_CLOSURES`.
- `addClosure(tenant, input: ClosureInput, today: string): Promise<StudioClosure>`: `withTransaction`: the advisory lock, count the tenant's rows with `ends_on >= today`; at `MAX_UPCOMING_CLOSURES` throw `ClosureLimitError` (exported, in `app/modules/scheduling/errors.ts` next to the module's other errors); else insert.
- `findClosure(tenant, id): Promise<StudioClosure>`: `firstOrFail` (the routes' 404, like `PaymentMethodService.findFor`). `removeClosure(tenant, closure): Promise<void>`: delete.
- `forPage(tenant, now = DateTime.now()): Promise<{ openingHours: OpeningDay[]; closedDays: ShownClosure[] }>`: `week` and `upcomingClosures(tenant, todayIn(tenant.timezone, now))`, mapped to `{ from: startsOn.toISODate(), to: endsOn.toISODate(), note }`. Two queries.
- The lock: `trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [`tattoo-drip:opening-hours:${tenant.id}`])`, taken first in both writes.

`TenancyService` (`tenancy_service.ts`): `export type GoodToKnowTexts = { walkInsText: string | null; ageRuleText: string | null; beforeSessionText: string | null; aftercareText: string | null }` and `updateGoodToKnow(tenant: Tenant, input: GoodToKnowTexts): Promise<Tenant>` written like `updateDepositSettings` (line 312: `merge`, `save`, only the four columns are dirty). Validator `app/modules/tenancy/validators/good_to_know.ts`: `updateGoodToKnowValidator = vine.create({ walkIns: vine.string().trim().maxLength(300).nullable(), ageRule: …200…, beforeSession: …2000…, aftercare: …2000… })` (the profile validator's empty-is-null pattern); the controller maps the field names to the columns.

### 6.3 Routes (Task 3), all in the `/settings` group, all `OWNERS`

| Method | Path | Name | Controller |
|---|---|---|---|
| GET | `/t/:tenant/settings/good-to-know` | `tenant.settings.good_to_know` | `GoodToKnowController.show` |
| PUT | `/t/:tenant/settings/good-to-know` | `tenant.settings.good_to_know.update` | `.update` (texts) |
| PUT | `/t/:tenant/settings/hours` | `tenant.settings.hours.update` | `.updateHours` |
| POST | `/t/:tenant/settings/closed-days` | `tenant.settings.closed_days.store` | `.storeClosedDays` |
| DELETE | `/t/:tenant/settings/closed-days/:id` (`router.matchers.uuid()`) | `tenant.settings.closed_days.destroy` | `.destroyClosedDays` |

Place them after `tenant.settings.messages.update` (`routes.ts` ~179) with a comment "Good to know and opening hours (TAT-128)", and the five `TENANT_ROUTE_ROLES` entries after `"tenant.settings.messages.update"` with the same comment. Every write redirects to `tenant.settings.good_to_know`.

`show` props (2 queries: week, upcoming closures; the tenant row is loaded): `timezone`, `week: { day: Weekday; open: boolean; opens: string; closes: string }[]` (7 rows, Sunday first; closed rows carry `DEFAULT_OPENS` / `DEFAULT_CLOSES`), `closedDays: { id: string; when: string; note: string | null }[]`, `dates: { today, max }` (`todayIn`, `lastBookableDay`), `texts: { walkIns, ageRule, beforeSession, aftercare }` (string or null), `hasDepositPolicy: boolean` (a non-blank policy), and in Task 8 `shownOnPage: boolean` (`lookOf(tenant).sections.includes("info")`). `storeClosedDays` turns `ClosureLimitError` into `E_VALIDATION_ERROR` on `closedFrom`: "You can list up to 20 closed days ahead. Remove one to add another."

### 6.4 Contract (Task 5), `packages/types/openapi.yaml`

New schemas next to `Studio`:
```yaml
    OpeningHours:
      type: object
      description: |
        One weekday the studio opens (TAT-128): one opening and one closing time,
        24-hour, in the studio's `timezone`. Hours never run past midnight.
      required: [day, opens, closes]
      additionalProperties: false
      properties:
        day: { type: string, enum: [sun, mon, tue, wed, thu, fri, sat] }
        opens: { type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", examples: ["11:00"] }
        closes:
          type: string
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          description: Later than `opens`, on the same day
          examples: ["20:00"]
    ClosedDays:
      type: object
      description: |
        Days the studio is closed whatever its hours say (TAT-128), from `from`
        to `to`, both included, in the studio's `timezone`.
      required: [from, to, note]
      additionalProperties: false
      properties:
        from: { type: string, format: date }
        to: { type: string, format: date, description: The last closed day; the same as `from` for one day }
        note:
          type: [string, "null"]
          maxLength: 120
          description: The studio's words, one line, plain text
          examples: ["Closed for Dashain, back on 28 October"]
    GoodToKnow:
      type: object
      description: |
        What clients ask before they come (TAT-128), as plain text the studio
        wrote; null when not set. Show each only when set.
      required: [walkIns, ageRule, depositPolicy, beforeSession, aftercare]
      additionalProperties: false
      properties:
        walkIns: { type: [string, "null"], maxLength: 300 }
        ageRule: { type: [string, "null"], maxLength: 200 }
        depositPolicy: { type: [string, "null"], maxLength: 2000, description: The policy the deposit page also shows }
        beforeSession: { type: [string, "null"], maxLength: 2000 }
        aftercare: { type: [string, "null"], maxLength: 2000 }
```
`Studio.required` gains `openingHours, closedDays, goodToKnow`; properties: `openingHours` (array of `OpeningHours`, `maxItems: 7`, "The weekdays the studio opens, Sunday first; a weekday not listed is closed. [] when the studio set no hours."), `closedDays` (array of `ClosedDays`, `maxItems: 20`, "Closed days that haven't ended in the studio's timezone, earliest first."), `goodToKnow` (`$ref`). The `Studio` description's privacy sentence stays true ("what its owners were told the studio page shows"). `packages/types/src/index.ts`: `export type OpeningHours`, `ClosedDays`, `GoodToKnow`. Regenerate. No SDK or hook code changes; `docs/sdk.md` documents the fields (Task 9).

Transformer (`public_studio_transformer.ts`): writes `openingHours` (`{ day, opens, closes }`), `closedDays` (`{ from, to, note }`) and `goodToKnow` (each text trimmed, blank as null; `depositPolicy` from `tenant.depositPolicy`), field by field. Its header comment and `studio_page_service.ts:25` say: the deposit policy is shown (Good to know), never the default percentage, payment methods or members. `StudioPageService` gets `OpeningHoursService` as its **last** constructor parameter and `studio(tenant)` adds `hours: await this.hours.forPage(tenant)` and the texts from the row: **3 queries** (was 1).

### 6.5 Isolation

- `EXPECTED_POLICIES`: `studio_closures: ["tenant_isolation:ALL"]`, `studio_hours: ["tenant_isolation:ALL"]` (alphabetical).
- `seededStudio` seeds, through the service in the studio's context, Sunday to Friday 11:00–20:00 (`openingHours`) and one closed day 20 to 21 days after today (Asia/Kathmandu) with note `${name} closed day` (`closedDay`, returned with a comment like the others). `IsolationCase.resource` gains `"closedDay"`.
- `cases.ts` (owner, snapshot `goodToKnowRows`: the tenant row's four texts, the hours rows by weekday and the closures by `starts_on, id`): GET `/t/:tenant/settings/good-to-know` (200); PUT same path, body `{ walkIns: "Isolation walk-ins", ageRule: "", beforeSession: "", aftercare: "" }` (302); PUT `/t/:tenant/settings/hours`, body `{ hours: { sun: { open: "1", opens: "10:00", closes: "18:00" } } }` (302; it replaces the seeded week, so A's snapshot changes); POST `/t/:tenant/settings/closed-days`, body `(own) => ({ closedFrom: <today + 30 days in Asia/Kathmandu>, closedTo: "", closedNote: "Isolation" })` (302); DELETE `/t/:tenant/settings/closed-days/:id`, `resource: "closedDay"` (302). If `request.form` does not nest the hours body, send it as bracket keys (`"hours[sun][open]": "1"` …).
- `publicMarkers` gains `studio.closedDay.note` (it carries B's name; belt and braces).
- No public route is added, so `public_cases.ts` is unchanged; the existing getStudio case now covers the new fields.

## 7. Tasks

Each task: rebase check first (see "Rebasing on TAT-126"), the failing tests, the code, the commands, the commit. Platform commands run from `apps/platform` with the lane's environment; storefront and package commands from the worktree root.

### Task 1: The tables and columns

**Files:** create `database/migrations/1791790000000_create_studio_hours_and_closures.ts`, `app/modules/scheduling/models/studio_hour.ts`, `app/modules/scheduling/models/studio_closure.ts`, `tests/functional/rls/studio_hours.spec.ts`; modify `tests/functional/rls/catalog_guard.spec.ts`; regenerate `database/schema.ts`.

- [ ] **Step 1: Write the failing tests.** `catalog_guard.spec.ts`: add the two `EXPECTED_POLICIES` entries. `studio_hours.spec.ts` (mirror `rls/artist_work_photos.spec.ts` and `#tests/helpers/rls`), two groups:
  - studio_hours: "under context A only A's rows come back; with no context none"; "an insert with another tenant's id fails the policy check"; "update and delete of another tenant's rows affect zero rows"; "a weekday outside 0 to 6 is refused" (`studio_hours_weekday_range`); "closing at or before opening is refused" (`studio_hours_closes_after_opens`, both `=` and `<`); "a second row for the same weekday is refused" (the unique index).
  - studio_closures: the same three RLS tests; "a last day before the first is refused, the same day is fine" (`studio_closures_ends_after_starts`); "a blank note is refused, null is fine" (`studio_closures_note_not_blank`).
  - tenants: "a studio's Good to know texts start empty" (the four columns null for `studioWithOwner()`).
- [ ] **Step 2: Run them; they fail.** `timeout 90 env … PORT=3432 pnpm test functional --files=studio_hours.spec.ts --files=catalog_guard.spec.ts > /tmp/site5-red.log 2>&1`; expect missing relations / policy mismatch.
- [ ] **Step 3: Write the migration and models** (6.1). `pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`; read the generated `StudioHourSchema` / `StudioClosureSchema` and the four tenant columns. `pnpm migrate:rollback` then `pnpm migrate` again: both succeed and `git diff database/schema.ts` shows only this task's additions.
- [ ] **Step 4: Run the tests; they pass.** Same command without `timeout` / redirect; then `pnpm typecheck` (platform).
- [ ] **Step 5: Commit.** `git add apps/platform && git commit` with:
  ```
  feat(platform): store a studio's opening hours, closed days and Good to know texts

  Two tenant-owned tables with row-level security: studio_hours (one opening and closing time
  per open weekday, 0 = Sunday) and studio_closures (dated closures with a short note), shaped
  so scheduling can later read them as studio-wide hours and closures. Four plain-text columns
  on tenants for walk-ins, the age rule, before a session and aftercare. TAT-128.
  ```

### Task 2: The rules and the service

**Files:** create `app/modules/scheduling/opening_hours.ts`, `app/modules/scheduling/validators/opening_hours.ts`, `app/modules/scheduling/services/opening_hours_service.ts`, `app/modules/tenancy/validators/good_to_know.ts`; modify `app/modules/scheduling/errors.ts` (`ClosureLimitError`), `app/modules/tenancy/services/tenancy_service.ts` (`GoodToKnowTexts`, `updateGoodToKnow`, placed after `updateDepositSettings`); tests `tests/unit/modules/scheduling/opening_hours.spec.ts` (new), `tests/functional/scheduling/opening_hours_service.spec.ts` (new), `tests/functional/tenancy/tenancy_service.spec.ts` (one test).

- [ ] **Step 1: Write the failing tests.**
  - Unit `opening_hours.spec.ts`: `toOpeningWeek` — "ticked days in week order, Sunday first, times as given": `{ hours: { mon: { open: true, opens: "11:00", closes: "20:00" }, sun: { open: true, opens: "10:30", closes: "18:00" } } }` gives `[{ day: "sun", … }, { day: "mon", … }]`; "an unticked day is closed whatever times it sent"; "no hours at all is a closed week" (`{}` gives `[]`); "a missing or malformed time is an error on that day" (`hours.tue`, "Enter both times, like 11:00 and 20:00."; `"25:00"`, `"9:00"`, missing `closes`); "closing at or before opening is an error" (`hours.wed`, "Close after you open. Hours can't run past midnight."); "two bad days give two errors". `toClosure` with `now` 2026-10-30 10:00 Asia/Kathmandu: "one day when the last day is empty" (`{ startsOn: "2026-11-02", endsOn: "2026-11-02", note: null }`); "a range with a trimmed note"; "yesterday, an impossible date (2026-02-30) and a day more than a year ahead are refused on closedFrom"; "a last day before the first, or 60 days after it, is refused on closedTo; 59 days after is fine". `closedDaysWhen`: the four shapes of 6.2 and "Tue 20 Oct 2026" for one day.
  - Functional `opening_hours_service.spec.ts`: "replaceWeek stores the open days and week reads them Sunday first as HH:mm"; "replacing the week drops the days left out"; "two replaceWeek calls at once both finish and leave one of the two weeks" (`Promise.all` of two `inTenant` calls with different weeks: no unique violation; the stored week equals one of them); "upcomingClosures leaves out the ended ones and lists the rest earliest first" (yesterday's, today's, next week's); "addClosure refuses the 21st upcoming one with ClosureLimitError and counts no ended ones"; "removeClosure deletes one; findClosure of another studio's id is not found" (run from B's context); "forPage gives the week and the upcoming closures as from, to and note in two queries" (`recordQueries`, the empty-context baseline as in `studio_page_service.spec.ts:432-440`).
  - `tenancy_service.spec.ts`: "updateGoodToKnow stores the four texts and clears a null one, leaving the profile alone".
- [ ] **Step 2: Run them; they fail** (`timeout 90 …`, missing modules).
- [ ] **Step 3: Implement** per 6.2. The service's doc comment names the lock and why (a double submit must not hit the weekday's unique index; the cap must count exactly).
- [ ] **Step 4: Run them; they pass.** `PORT=3432 pnpm test unit --files=opening_hours.spec.ts`, `PORT=3432 pnpm test functional --files=opening_hours_service.spec.ts --files=tenancy_service.spec.ts`, `pnpm typecheck`.
- [ ] **Step 5: Commit.**
  ```
  feat(platform): read and save opening hours and closed days, with their rules

  One open and one close time per weekday, before midnight; closed days from today to a year
  ahead, at most 60 days each and 20 upcoming. Saves take a per-studio advisory lock, so a
  double submit never hits the weekday index and the cap counts exactly. TAT-128.
  ```

### Task 3: The owner routes

**Files:** create `app/controllers/good_to_know_controller.ts`; modify `start/routes.ts`, `app/modules/tenancy/access.ts`, `tests/isolation/cases.ts`, `tests/helpers/tenants.ts`, `tests/helpers/public_isolation.ts`; create `tests/functional/scheduling/good_to_know_http.spec.ts`; regenerate `.adonisjs/`. The page component is Task 4: create `inertia/pages/settings/good_to_know.tsx` here as a stub that renders `<Section title="Good to know" />` so `inertia.render` resolves (Task 4 replaces it).

- [ ] **Step 1: Write the failing tests** in `good_to_know_http.spec.ts` (owner of `studioWithOwner`, an artist via `artistIn`):
  - "the page gives the week Sunday first, the upcoming closed days worded, the texts and the dates": props `week` has 7 rows, a ticked one with its times, a closed one with `11:00` / `20:00`; `closedDays[0].when` "Tue 20 Oct 2026"-style; `texts`; `hasDepositPolicy`; `dates.today` is the studio's today.
  - "saving the hours stores the ticked days and redirects with the saved message" (form body with bracket keys; flash "Opening hours saved. They can take up to 15 minutes to show on your page.").
  - "a day closing before it opens is an error under that day and nothing changes" (`hours.mon`).
  - "adding closed days stores them; the last day defaults to the first" and "the 21st upcoming one is refused on closedFrom with the limit sentence".
  - "removing closed days deletes them; another studio's id is a 404 and deletes nothing".
  - "saving the texts stores them; an empty box clears one"; "a 301-character walk-ins text is a field error".
  - "an artist gets a 404 on every Good to know route" (all five).
  - Isolation: the five cases of 6.5 (the guard in `tenant_routes.spec.ts` and `cross_tenant.spec.ts` / `role_access.spec.ts` then run them).
- [ ] **Step 2: Run them; they fail** (`timeout 90 … --files=good_to_know_http.spec.ts --files=tenant_routes.spec.ts`).
- [ ] **Step 3: Implement** routes, roles, controller (6.3; thin: validate, call the service, flash, redirect), seeds and cases. `node ace codegen`.
- [ ] **Step 4: Run them; they pass.** `PORT=3432 pnpm test functional --files=good_to_know_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=role_access.spec.ts --files=public_api.spec.ts`, `pnpm typecheck`.
- [ ] **Step 5: Commit.**
  ```
  feat(platform): owner routes for Good to know, opening hours and closed days

  Five owner-only settings routes with TENANT_ROUTE_ROLES entries and isolation cases; the
  seeded studios now have a week of hours and one closed day, so every case sees them. TAT-128.
  ```

### Task 4: The settings page

**Files:** create `inertia/components/good_to_know.ts`, `tests/unit/inertia/good_to_know_copy.spec.ts`; replace the stub `inertia/pages/settings/good_to_know.tsx`; modify `inertia/layouts/settings.tsx` (one `NavItem` after "Page look": label "Good to know", route `tenant.settings.good_to_know`, icon `Clock`), `inertia/pages/settings/payments.tsx:58`.

- [ ] **Step 1: Write the failing unit test** `good_to_know_copy.spec.ts` (the `@ts-expect-error TS6305` import pattern of `page_look_copy.spec.ts`):
  - `DAY_NAMES` has exactly the server's `WEEKDAYS` keys in order, `sun` "Sunday" … `sat` "Saturday".
  - `weekRows(week)` keeps the props' 7 rows; `tickDay(rows, 2, true)` on rows where Sunday is open 10:00–18:00 and Monday closed gives Tuesday 10:00–18:00 open; with nothing open above but Friday open below, Friday's times; with nothing open, the row's own times; `tickDay(rows, 0, false)` closes Sunday and keeps its times.
  - `removeLabel("Tue 20 Oct 2026")` is "Remove closed days Tue 20 Oct 2026".
  - `depositLine(true)` is "Your deposit policy shows here too. Change it in Payments."; `depositLine(false)` "Add a deposit policy in Payments and it shows here too."
  - `HOURS_INTRO("Asia/Kathmandu")`, `CLOSED_INTRO`, `TEXTS_INTRO` equal the sentences of 5.3; `NO_CLOSED_DAYS` is "No closed days ahead.".
  - The flash words live in `#modules/scheduling/opening_hours` as `HOURS_SAVED`, `CLOSED_DAYS_ADDED`, `CLOSED_DAYS_REMOVED`, `TEXTS_SAVED` (the sentences of 5.3, "up to 15 minutes" like `LOOK_SAVED_MESSAGE`); this test pins their text, and the controller uses them.
- [ ] **Step 2: Run it; it fails.** `PORT=3432 pnpm test unit --files=good_to_know_copy.spec.ts`.
- [ ] **Step 3: Implement** the words module and the page per 5.3 (no custom CSS classes; `Checkbox` from `~/components/ui/checkbox`; time and date inputs as in `sessions_card.tsx`). Move the flash words into `opening_hours.ts` and use them in the controller.
- [ ] **Step 4: Run the checks.** The unit test, `PORT=3432 pnpm test unit --files=tap_targets.spec.ts --files=nav_items.spec.ts`, `pnpm typecheck`, and a quick look at the page in the dev server on 3431 (full browser pass is Task 9).
- [ ] **Step 5: Commit.**
  ```
  feat(platform): the Good to know settings page

  Opening hours as seven rows with a checkbox and two times (ticking a day copies the nearest
  open day's times), closed days with Remove and an add form, and the four texts for clients.
  The Payments page says the deposit policy also shows in Good to know. TAT-128.
  ```

### Task 5: The public studio read and the contract

**Files:** `packages/types/openapi.yaml`, `packages/types/src/index.ts`, regenerate `openapi.gen.ts`; `packages/sdk/test/client.test.ts`, `packages/react/test/studio.test.ts`, `packages/react/test/lists.test.ts` (fixtures: `openingHours: []`, `closedDays: []`, `goodToKnow` all null); `apps/storefront/test/studio/fixtures.ts` (`STUDIO` gains the same empty values, so nothing on the studio page changes; add `GOOD_TO_KNOW_STUDIO` with Sunday–Friday 11:00–20:00, one closure `{ from: "2026-11-02", to: "2026-11-04", note: "दशैं बिदा, back on 5 November" }` and all five texts, one in Devanagari) and `apps/storefront/test/tenancy/helpers.ts` if typed; platform `app/modules/storefront/services/studio_page_service.ts`, `app/transformers/public_studio_transformer.ts`, `tests/functional/api/public_studio.spec.ts`, `tests/functional/api/studio_page_privacy.spec.ts`, `tests/functional/storefront/studio_page_service.spec.ts` (and `tests/functional/artists/work_photo_service.spec.ts:741`, which builds the service by hand).

- [ ] **Step 1: Write the failing tests.**
  - `public_studio.spec.ts`: "has exactly the documented fields" gains the three keys; "a studio that set nothing has no hours, no closed days and empty Good to know"; "hours, upcoming closed days and the texts are served; an ended closure is not" (`openingHours` `[{ day: "sun", opens: "11:00", closes: "20:00" }, …]`, `closedDays` with `from`, `to`, `note`, texts trimmed, a whitespace-only text as null, `depositPolicy` as saved); "saving the hours changes the ETag".
  - `studio_page_privacy.spec.ts`: `"canary-policy-44"` leaves the canaries; a new assertion: the policy appears in getStudio exactly once, at `goodToKnow.depositPolicy`, and never in `/artists` or `/artists/shown`; the percentage `37` is in no answer as `defaultDepositPercent` (keys checked by the exact-fields test).
  - `studio_page_service.spec.ts`: the query-count test's "studio" becomes **3**; `pagesWith()` passes `new OpeningHoursService()` last.
  - Storefront and packages: `pnpm typecheck` fails until the fixtures have the fields (that is the failing check for them).
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement** 6.4: contract, `pnpm --filter @tattoo-drip/types generate`, the type names, fixtures, the service and transformer, the comments that said the policy is private.
- [ ] **Step 4: Run them; they pass.** `PORT=3432 pnpm test functional --files=public_studio.spec.ts --files=studio_page_privacy.spec.ts --files=studio_page_service.spec.ts --files=work_photo_service.spec.ts --files=public_api.spec.ts`, `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm --filter @tattoo-drip/storefront test`, `pnpm typecheck` (root).
- [ ] **Step 5: Commit.**
  ```
  feat(types): opening hours, closed days and Good to know in the public studio

  getStudio now carries openingHours, closedDays (not ended, earliest first) and goodToKnow:
  walk-ins, the age rule, the deposit policy (now public, as the spec decided), before your
  session and aftercare. Two more queries per read. No new SDK call: the fields ride on
  client.studio.get(). TAT-128.
  ```

### Task 6: Opening hours and today's state in the storefront (pure)

**Files:** create `apps/storefront/src/studio/hours.ts`, `apps/storefront/test/studio/hours.test.ts`.

- [ ] **Step 1: Write the failing tests** (`node:test`; build instants with a helper `at("2026-10-30T19:55")` = that wall time in Kathmandu, `new Date(Date.parse(local + "Z") - (5 * 60 + 45) * 60_000)`; 2026-10-30 is a Friday). Week `W` = Sunday to Friday 11:00–20:00, Saturday closed.
  - `zonedNow`: "+05:45 is honoured: 18:14:59Z is Friday 23:59, 18:15Z is Saturday 00:00"; "an unknown timezone is null"; "an invalid Date is null".
  - `coverState` / `coverText`: Friday 19:55 → "Open now" / "till 8 pm"; Friday 20:00 → "Closed now" / "opens Sunday at 11 am"; Saturday 10:00 → "Closed today" / "opens tomorrow at 11 am"; Sunday 09:00 → "Closed now" / "opens at 11 am"; Monday 12:00 inside the closure 2 to 4 Nov with a Devanagari note → "Closed today" / the note, never "Open now"; Sunday 21:00 before that closure → "opens Thursday at 11 am"; a closure with no note → detail null; no open weekday and no closure → null; a closure with no weekly hours → "Closed today" with its note; every day closed for the next 7 days → "Closed now" with no detail.
  - `steadyCoverState`: Friday 19:48 → the open state (stays open through 19:59); Friday 19:49 → null (it closes inside 11 minutes); Friday 23:50 → null (midnight changes "opens Sunday" to a closed-weekday state); `PAGE_MAX_AGE_MS` equals `(s-maxage + stale-while-revalidate) * 1000` parsed from `PAGE_CACHE` (`src/studio/cache.ts`), so a cache change fails here.
  - `clockText`: `00:30` "12:30 am", `09:05` "9:05 am", `11:00` "11 am", `12:00` "12 pm", `12:30` "12:30 pm", `20:00` "8 pm", `23:59` "11:59 pm".
  - `hoursLines`: `W` → `[{ days: "Sun – Fri", hours: "11 am – 8 pm" }, { days: "Sat", hours: "Closed" }]`; Sunday closed, Monday–Tuesday 11–8, Wednesday 10:30–6, Thursday–Saturday 11–8 → four lines; every day the same → `[{ days: "Every day", hours: "11 am – 8 pm" }]`; all closed → `[]`.
  - `closedDaysText`: "Tue 20 Oct", "20 – 28 Oct", "30 Oct – 2 Nov", "30 Dec 2026 – 2 Jan 2027".
  - `readWeek` / `readClosures` (defensive, the API is trusted but not blindly): a non-array is empty; an unknown `day`, a malformed time, `closes <= opens` and a second entry for a day are dropped; closures with a malformed or impossible date, `to < from`, or a note over 120 graphemes (note becomes null) are handled; at most 20 kept; notes pass through `cleanLine`.
- [ ] **Step 2: Run it; it fails.** `pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/studio/hours.test.ts`.
- [ ] **Step 3: Implement** `src/studio/hours.ts`. The tricky part, verified in a scratch run against the cases above:

```ts
import { PAGE_CACHE } from "./cache.ts";
import { cleanLine, graphemes } from "./text.ts";

/** One open weekday, "HH:mm" 24-hour, in the studio's timezone. */
export interface OpeningDay { readonly opens: string; readonly closes: string }
/** Sunday first; null is closed. Always 7 entries. */
export type Week = readonly (OpeningDay | null)[];
export interface Closure { readonly from: string; readonly to: string; readonly note: string | null }
export type CoverState =
	| { readonly kind: "open"; readonly closes: string }
	| { readonly kind: "later"; readonly opens: string }
	| {
			readonly kind: "closed";
			/** A closed weekday ("Closed today") rather than after hours ("Closed now"). */
			readonly allDay: boolean;
			readonly next: { readonly inDays: number; readonly weekday: number; readonly opens: string } | null;
	  }
	| { readonly kind: "closure"; readonly note: string | null };

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How long a page may be served after it was rendered: s-maxage plus stale-while-revalidate. */
export const PAGE_MAX_AGE_MS = (() => {
	const seconds = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(PAGE_CACHE)?.[1] ?? 0);
	return (seconds("s-maxage") + seconds("stale-while-revalidate")) * 1000;
})();

const formats = new Map<string, Intl.DateTimeFormat | null>();
function zonedFormat(timeZone: string): Intl.DateTimeFormat | null {
	let format = formats.get(timeZone);
	if (format === undefined) {
		try {
			format = new Intl.DateTimeFormat("en-US", {
				timeZone, year: "numeric", month: "2-digit", day: "2-digit",
				weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
			});
		} catch {
			format = null; // an unknown zone: no open state, never a wrong one
		}
		formats.set(timeZone, format);
	}
	return format;
}

/** The studio's wall clock at `at`: its date, weekday (0 = Sunday) and minutes since midnight. */
export function zonedNow(at: Date, timeZone: string): { date: string; weekday: number; minutes: number } | null {
	const format = zonedFormat(timeZone);
	if (!format || Number.isNaN(at.getTime())) return null;
	const part: Record<string, string> = {};
	for (const { type, value } of format.formatToParts(at)) part[type] = value;
	const weekday = SHORT_DAYS.indexOf(part.weekday as (typeof SHORT_DAYS)[number]);
	if (weekday === -1) return null;
	return {
		date: `${part.year}-${part.month}-${part.day}`,
		weekday,
		minutes: Number(part.hour) * 60 + Number(part.minute),
	};
}

export function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const closureOn = (closures: readonly Closure[], date: string) =>
	closures.find((closure) => closure.from <= date && date <= closure.to);

/** Today's state at `at`, or null when there is nothing to say (no hours and no closure today, or no usable zone). */
export function coverState(week: Week, closures: readonly Closure[], timeZone: string, at: Date): CoverState | null {
	const now = zonedNow(at, timeZone);
	if (!now) return null;
	const closure = closureOn(closures, now.date);
	if (closure) return { kind: "closure", note: closure.note };
	if (week.every((day) => day === null)) return null;
	const today = week[now.weekday] ?? null;
	if (today) {
		if (now.minutes < minutesOf(today.opens)) return { kind: "later", opens: today.opens };
		if (now.minutes < minutesOf(today.closes)) return { kind: "open", closes: today.closes };
	}
	for (let inDays = 1; inDays <= 7; inDays++) {
		const weekday = (now.weekday + inDays) % 7;
		const day = week[weekday] ?? null;
		if (day && !closureOn(closures, addDays(now.date, inDays))) {
			return { kind: "closed", allDay: today === null, next: { inDays, weekday, opens: day.opens } };
		}
	}
	return { kind: "closed", allDay: today === null, next: null };
}

/**
 * The state at `at` when it stays the same for the page's whole cache life
 * (checked each minute: states change only on the minute), else null. What
 * the server may render: a cached copy is then still right when served.
 */
export function steadyCoverState(
	week: Week, closures: readonly Closure[], timeZone: string, at: Date, window = PAGE_MAX_AGE_MS,
): CoverState | null {
	const first = coverState(week, closures, timeZone, at);
	if (!first) return null;
	const key = JSON.stringify(first);
	for (let ms = 60_000; ms <= window; ms += 60_000) {
		const later = coverState(week, closures, timeZone, new Date(at.getTime() + ms));
		if (JSON.stringify(later) !== key) return null;
	}
	return first;
}

/** "8 pm", "10:30 am", "12 pm": how studios here write a time. */
export function clockText(time: string): string {
	const hours = Number(time.slice(0, 2));
	const minutes = time.slice(3, 5);
	const hour = hours % 12 === 0 ? 12 : hours % 12;
	const half = hours < 12 ? "am" : "pm";
	return minutes === "00" ? `${hour} ${half}` : `${hour}:${minutes} ${half}`;
}

export function coverText(state: CoverState): { lead: string; detail: string | null } {
	switch (state.kind) {
		case "open":
			return { lead: "Open now", detail: `till ${clockText(state.closes)}` };
		case "later":
			return { lead: "Closed now", detail: `opens at ${clockText(state.opens)}` };
		case "closure":
			return { lead: "Closed today", detail: state.note };
		case "closed": {
			const lead = state.allDay ? "Closed today" : "Closed now";
			if (!state.next) return { lead, detail: null };
			const day = state.next.inDays === 1 ? "tomorrow" : LONG_DAYS[state.next.weekday];
			return { lead, detail: `opens ${day} at ${clockText(state.next.opens)}` };
		}
	}
}

export interface HoursLine { readonly days: string; readonly hours: string }

/** The week as Good to know lists it: Sunday first, equal neighbours grouped. [] when no day is open. */
export function hoursLines(week: Week): HoursLine[] {
	if (week.every((day) => day === null)) return [];
	const text = (day: OpeningDay | null) => (day ? `${clockText(day.opens)} – ${clockText(day.closes)}` : "Closed");
	const lines: HoursLine[] = [];
	let start = 0;
	for (let i = 1; i <= 7; i++) {
		if (i < 7 && text(week[i] ?? null) === text(week[start] ?? null)) continue;
		const days = start === 0 && i === 7 ? "Every day"
			: start === i - 1 ? SHORT_DAYS[start] : `${SHORT_DAYS[start]} – ${SHORT_DAYS[i - 1]}`;
		lines.push({ days, hours: text(week[start] ?? null) });
		start = i;
	}
	return lines;
}

/** "Tue 20 Oct", "20 – 28 Oct", "30 Oct – 2 Nov", "30 Dec 2026 – 2 Jan 2027": no year unless the range crosses one. */
export function closedDaysText(from: string, to: string): string {
	const part = (date: string) => {
		const [y, m, d] = date.split("-").map(Number);
		return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
	};
	const a = part(from);
	const b = part(to);
	if (from === to) return `${SHORT_DAYS[a.weekday]} ${a.d} ${MONTHS[a.m - 1]}`;
	if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
	if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
	return `${a.d} – ${b.d} ${MONTHS[b.m - 1]}`;
}
```
  Plus `readWeek(value: unknown): Week` (from the API's `[{ day, opens, closes }]`: `WEEKDAY_KEYS.indexOf(day)`, `CLOCK` on both, `closes > opens`, first per day wins) and `readClosures(value: unknown): Closure[]` (`DATE` plus a `Date.UTC` round trip, `to >= from`, note `cleanLine` and null past 120 `graphemes`, at most 20). The time words ("Open now", "till", day and month names) stay in `hours.ts` because the functions build them; the section's labels go in `studioCopy.goodToKnow` (Task 7). A Nepali version would replace both together.
- [ ] **Step 4: Run it; it passes;** `pnpm --filter @tattoo-drip/storefront typecheck`.
- [ ] **Step 5: Commit.**
  ```
  feat(storefront): opening hours and today's open state in the studio's timezone

  Pure: the studio's wall clock from Intl (Kathmandu's +05:45 included), today's state with
  closed days first, a state that stays right for the page's 11-minute cache life, and the
  words: "Open now · till 8 pm", "Sun – Fri 11 am – 8 pm", "20 – 28 Oct". TAT-128.
  ```

### Task 7: The section and the cover line

**Files:** create `src/studio/good-to-know.ts`, `src/studio/open-now.tsx`, `src/studio/components/good-to-know.tsx`, `test/studio/good-to-know.test.ts`; modify `src/studio/loaders.ts` (`StudioPageData`, `studioPageData`, `loadStudioPage`), `src/studio/components/pages.tsx` (the import, the cover line), `src/studio/copy.ts` (`goodToKnow` key), `src/styles.css` (one block), `test/studio/lightbox.test.ts`, `test/studio/loaders.test.ts`, `test/studio/assets.test.ts`.

**Interfaces:**
- `good-to-know.ts`: `GoodToKnowView = { hours: readonly HoursLine[]; closedDays: readonly { when: string; note: string | null }[]; walkIns; ageRule; depositPolicy; beforeSession; aftercare: string | null }`; `goodToKnowView(studio: Studio): GoodToKnowView` (texts through `cleanText`; missing fields from an older API are empty); `goodToKnowIsEmpty(view): boolean`; `OpenNowView = { timezone: string; week: Week; closures: readonly Closure[]; initial: CoverState | null }`; `openNowView(studio: Studio, at: Date | null): OpenNowView | null` (null with no open weekday and no closures, or when `zonedNow(new Date(0), timezone)` is null; `initial` is `steadyCoverState(…, at)` or null when `at` is null).
- `StudioPageData` gains `goodToKnow: GoodToKnowView` and `openNow: OpenNowView | null`. `studioPageData(…)` sets `openNow: openNowView(studio, null)` (no clock: pure and deterministic, as today's tests expect); `loadStudioPage` returns `{ ...data, openNow: openNowView(studio, new Date()) }`. No new parameter, so TAT-126's `recentWork` parameter does not collide.
- `copy.ts`: `goodToKnow: { title: "Good to know", hours: "Hours", closedDays: "Closed days", walkIns: "Walk-ins", age: "Age", deposit: "Deposit", beforeSession: "Before your session", aftercare: "Aftercare" }`, inserted after `artist` (before `booking`).
- `open-now.tsx`: `OpenNow({ view })`: `useState(view.initial)`; `useEffect` sets `coverState(view.week, view.closures, view.timezone, new Date())` at once and every 30 s (`setInterval`, cleared on unmount); renders 5.1's markup. No `document.`, no `window.`.
- `components/good-to-know.tsx`: `GoodToKnowSection({ view })`: null when empty; else 5.2's markup (lucide `ChevronDown`, `aria-hidden`).

- [ ] **Step 1: Write the failing tests** in `good-to-know.test.ts` (render with `renderToStaticMarkup`, `assertSafePage` from `test/studio/safety.ts` where it fits):
  - "a studio that filled nothing has no section, no cover line, and the same page as before" (`STUDIO`: no `id="good-to-know"`, no `profile-hours`; the default-theme snapshot test keeps passing untouched).
  - "every part shows when filled, in order: hours, closed days, walk-ins, age, deposit, then the two folded texts" (`GOOD_TO_KNOW_STUDIO`: `<h2 id="good-to-know-title" class="section-title">Good to know</h2>`, `dt` texts in order, "Sun – Fri" with "11 am – 8 pm", "Sat" with "Closed", "2 – 4 Nov" with the Devanagari note in a `dir="auto"` span, two `<details class="know-more">` with summaries "Before your session" and "Aftercare").
  - "each part alone shows alone": only `ageRule` → one `know-item`, no `details`; only `aftercare` → no `dl`, one `details`.
  - "studio text is text": a note and a text holding `<b>x</b>` render escaped.
  - "the server renders today's state only when it holds for the cache life": `openNowView(GOOD_TO_KNOW_STUDIO, at("2026-10-30T19:48"))` renders `<p class="profile-hours"><strong>Open now</strong> · <span class="user-text" dir="auto">till 8 pm</span></p>` inside the cover's heading, right after `profile-location`; at 19:49 the `<p class="profile-hours">` is empty; during the closure (`at("2026-11-02T12:00")`) it holds "Closed today" and the note and never "Open now".
  - "no hours and no closed days, no cover line"; "an unknown timezone, no cover line".
  - "an older API without the fields is the page without them" (`studioPageData({ ...STUDIO, openingHours: undefined, … } as unknown as Studio, …)` renders no section, no line).
  - `loaders.test.ts`: "loadStudioPage sets today's steady state from the clock; studioPageData has none" (with `GOOD_TO_KNOW_STUDIO` in the stand-in cache: `openNow.initial` is a state or null, `studioPageData(...).openNow.initial` is null; the existing deep-equal tests keep `STUDIO`, whose `openNow` is null either way).
  - `lightbox.test.ts`: "open-now.tsx holds the cover's only timer and touches no DOM": it contains `setInterval` and `clearInterval`, no `document.` and no `window.`; no other file under `src/studio/` contains `setInterval`.
  - `assets.test.ts`: `.know-more > summary` has `min-block-size: 3rem` and `list-style: none`; `.know-more > summary::-webkit-details-marker` has `display: none`; `.profile-hours` has `min-block-size: 1.4em` and `overflow-wrap: anywhere`; `.know-item dd` has `overflow-wrap: anywhere`.
- [ ] **Step 2: Run them; they fail.** `pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/studio/good-to-know.test.ts test/studio/loaders.test.ts test/studio/lightbox.test.ts test/studio/assets.test.ts`.
- [ ] **Step 3: Implement** per Interfaces, 5.1 and 5.2. `GoodToKnowSection` is not in `StudioSection` yet (Task 8); the tests render it directly.
- [ ] **Step 4: Run the checks.** `pnpm --filter @tattoo-drip/storefront test` (the whole suite: the snapshot must not change), `typecheck`, `build`, `check:page` (its stand-in studio has no new fields: the older-API path).
- [ ] **Step 5: Commit.**
  ```
  feat(storefront): the Good to know section and today's state on the cover

  The section lists hours, closed days, walk-ins, age and deposit, then folds Before your
  session and Aftercare; each part only when filled, no section when empty. The cover's line
  says today's state: the server renders it only when it holds for the cache life, and a small
  island recomputes it in the browser every 30 seconds. TAT-128.
  ```

### Task 8: Good to know joins Page look's sections (after TAT-126 Task 7)

Rebase first (see "Rebasing on TAT-126"); stop and report if TAT-126 Task 7 is not on its branch.

**Files:** create `apps/platform/database/migrations/1791790000001_add_good_to_know_section_to_tenants.ts`; modify `app/modules/storefront/look.ts` (`SECTION_KEYS`, `DEFAULT_SECTIONS`: `info` before `inquiry`), `inertia/components/page_look.ts` (`SECTION_WORDS.info`), `app/controllers/good_to_know_controller.ts` (`shownOnPage`), `inertia/pages/settings/good_to_know.tsx` (the hidden note), `packages/types/openapi.yaml` (`StorefrontSection.type` enum gains `info`, its description names it "`info` (Good to know: hours, closed days and what clients ask)", `sections.maxItems` +1), storefront `src/studio/theme/config.ts` (`SECTION_KEYS`, `THEME_SECTIONS["stencil-and-ink"].order`), `src/studio/components/pages.tsx` (`StudioSection`'s `info` case: `<GoodToKnowSection view={data.goodToKnow} />`); tests `tests/unit/modules/storefront/look.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts`, `tests/functional/tenancy/page_look_columns.spec.ts`, `tests/functional/api/public_studio.spec.ts`, `tests/functional/scheduling/good_to_know_http.spec.ts`, `tests/unit/inertia/good_to_know_copy.spec.ts`, storefront `test/studio/fixtures.ts` (`DEFAULT_STOREFRONT`), `test/studio/theme-config.test.ts`, `test/studio/good-to-know.test.ts`; regenerate `openapi.gen.ts`, `schema.ts`, `.adonisjs/`.

- [ ] **Step 1: Write the failing tests.**
  - `look.spec.ts`: "the default is Recent work, artists, Good to know, then the form" (`DEFAULT_SECTIONS` as TAT-126 left it with `info` before `inquiry`); `sectionList([…, "info", "info"])` keeps one; the drift test (unchanged) now compares lists that hold `info`.
  - `page_look_copy.spec.ts`: `SECTION_WORDS.info` deep-equals 5.4's words; the "exactly the server's keys" test passes with `info`.
  - `page_look_http.spec.ts`: "hiding Good to know stores the list without it"; the "offers every section" test's `sectionKeys` gains `info`.
  - `page_look_columns.spec.ts`: "a new studio's sections are the default list" compares the raw column with `DEFAULT_SECTIONS.join(",")` imported from `#modules/storefront/look` (no literal: a later key added to the list without a migration fails here).
  - `public_studio.spec.ts`: the default `storefront.sections` gains `{ type: "info" }` before `inquiry`.
  - `good_to_know_http.spec.ts`: "the page says when Good to know is hidden on the studio page" (`shownOnPage` false after storing a list without `info`, true by default). `good_to_know_copy.spec.ts`: `HIDDEN_NOTE` is "Good to know is hidden on your page. Show it in Page look.".
  - Storefront `theme-config.test.ts`: the default order holds `info` before `inquiry`; "an older API's list without info shows no Good to know". `good-to-know.test.ts`: "the section sits where the configuration puts it" (default list: after artists, before the inquiry section; a list with `info` first: right after the intro); "a studio that hides Good to know shows none even when filled".
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Migrate.** `up`: `update tenants set storefront_sections = regexp_replace(storefront_sections, '(^|,)inquiry(,|$)', '\1info,inquiry\2') where not ('info' = any (string_to_array(storefront_sections, ',')))` (in the TypeScript string the backreferences are `\\1` and `\\2`), then `alter table tenants alter column storefront_sections set default '<DEFAULT_SECTIONS.join(",") as it stands, e.g. work,artists,info,inquiry>'`. `down`: `update tenants set storefront_sections = array_to_string(array_remove(string_to_array(storefront_sections, ','), 'info'), ',')` and the previous default (TAT-126's literal). Before migrating, `select slug, storefront_sections from tenants` (as the owner, `podman exec -i tattoo-drip_postgres_1 psql -U postgres -d tattoo_drip_uz`); after `pnpm migrate` (then the `biome` step), each list is the old one with `info` just before `inquiry`, and `select count(*) from tenants where not ('info' = any (string_to_array(storefront_sections, ',')))` is 0. `pnpm migrate:rollback` restores the lists exactly; `pnpm migrate` again.
- [ ] **Step 4: Implement** the rest per Files; regenerate; `node ace codegen`.
- [ ] **Step 5: Run them; they pass.** The platform specs above plus `--files=page_look_source.spec.ts --files=public_api.spec.ts`; `pnpm --filter @tattoo-drip/storefront test` (the default-theme snapshot unchanged: an empty Good to know renders nothing); `pnpm typecheck` (root).
- [ ] **Step 6: Commit.**
  ```
  feat(storefront): the Good to know section joins Page look's ordered, hideable list

  A new section key, info, titled Good to know, just before the "Got an idea?" invitation by
  default. The migration adds it before inquiry in every studio's list, so earlier orders stay;
  it renders nothing until the studio fills something in. The settings page says when it is
  hidden. TAT-128.
  ```

### Task 9: Docs, gates, browser pass

**Files:** the docs of section 8.

- [ ] **Step 1: Update the docs** (section 8).
- [ ] **Step 2: Gates** (section 10).
- [ ] **Step 3: Browser pass** (section 9).
- [ ] **Step 4: Commit.**
  ```
  docs: the Good to know section and opening hours; the studio site moves into the pilot

  Backend, UI, database and storefront guides for the hours, closed days, texts and the cover
  line; the SDK guide's studio fields; the data model's studio hours and closures, which the
  slot engine will read; product, roadmap and requirements now list the studio site in the
  pilot. TAT-128.
  ```
- [ ] **Step 5: Tear down** per run7-brief: stop the servers by exact PID, drop `tattoo_drip_uz`, delete scratch files, `git status` clean.

Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; check each message with `printf '%s' "<message>" | pnpm exec commitlint` (the messages above pass as written; body lines are under 100 characters).

## 8. Docs to update (Task 9)

- `apps/platform/docs/backend.md`: Scheduling gets a bullet "Opening hours and closed days (TAT-128)": the tables, `OpeningHoursService` (`week`, `replaceWeek`, `upcomingClosures`, `addClosure` with the 20 cap, `findClosure`, `removeClosure`, `forPage`), the advisory lock and why, weekday 0 = Sunday, ended rows kept and never shown, the five owner routes. Public API "Studio page reads": `getStudio` now costs three queries (visible artists, hours, upcoming closures), carries `openingHours`, `closedDays`, `goodToKnow`; the deposit policy is public (Good to know), the percentage never; fix "Never in these answers … the deposit policy".
- `apps/platform/docs/ui.md`: a "Settings, Good to know (TAT-128)" bullet: the three forms, field names (one error bag), `tickDay`, no confirm on Remove, the hidden note; Page look's Sections list gains "Good to know".
- `apps/platform/database/README.md`: the "not soft-deleted" list gains `studio_hours` and `studio_closures` (settings replaced in place; a removed closed day is deleted); the first `date` and `time` columns: `@column.date` gives a Luxon date, compare `yyyy-MM-dd` strings in SQL.
- `apps/storefront/docs/development.md`, Studio page: the cover's "today's state" line (`open-now.tsx`, the steady server state over `PAGE_MAX_AGE_MS`, the 30 s refresh, empty without hours), the Good to know section (`components/good-to-know.tsx`, each part only when filled, `<details>` without JavaScript), `src/studio/hours.ts` as the one place for time words; Themes: the `info` section.
- `docs/data-model.md`: new MVP rows **StudioHours** ("one opening and closing time per open weekday, in the studio's timezone; the slot engine will bound artists' availability by them") and **StudioClosure** ("dated closures with a note; the studio-wide part of `AvailabilityException`"); the V1 `ArtistAvailability, AvailabilityException` row says studio-wide closures are `StudioClosure`.
- `docs/sdk.md`: "The studio page reads `client.studio.get()`" gains `openingHours`, `closedDays`, `goodToKnow`; the MVP row of "Public API by stage" says "`studio.get` (profile, studio page config, hours and Good to know)".
- `docs/requirements.md`: line 69's V1 bullet keeps "more themes, custom domain"; the MVP list gains a checked bullet for the studio website (gallery, artist portfolios, flash, request page, chat button, Good to know with opening hours and closed days); "Studio page rules" (line 138) says the page shows the deposit policy in Good to know, never payment details; line 143 says the deposit page is the one page that shows a project's deposit and payment methods (the policy is public now).
- `docs/roadmap.md`: the V1 "Studio site with portfolio, flash, themes and a custom domain" becomes "More studio site themes and a custom domain"; the MVP "loop" sentence's "studio page" becomes "studio website (portfolios, flash, request page, Good to know)".
- `docs/product.md:59`: the Studio page bullet says the pilot has the full site (portfolios, flash, request page, Good to know with hours); V1 adds more themes and a custom domain.

## 9. Acceptance and browser checks

**Measurable:**
- `getStudio` = 3 queries (test); the settings page `show` = 2 queries beyond the tenant row (`recordQueries` in `good_to_know_http.spec.ts`, one assertion).
- A studio that filled nothing: the default-theme snapshot is byte-identical; no `profile-hours`, no `good-to-know` in the HTML.
- Every summary and button ≥ 44 px at 375 px (Playwright `boundingBox().height`), the summaries 48 px.
- No horizontal scroll at 375 px with a 120-character Devanagari note and a 300-character Devanagari walk-ins text (`document.documentElement.scrollWidth <= 375`).
- Contrast: `.profile-hours` on paper and on the cover's scrim ≥ 4.5:1 in light and dark (same tokens as `.profile-location`, whose contrast `cover.test.ts` already pins).
- "Open now" never appears on a closure day, before opening or after closing (pure tests over the cases of Task 6; browser spot check below).

**Browser (Playwright, `playwright-core` and Chromium paths from run7-brief), 375 × 812 and 1280 × 800, light and dark.** Start the platform on 3431 against `tattoo_drip_uz` and the storefront on 3434 with `API_URL=http://localhost:3431`. Make a throwaway owner (run7-brief), a studio with an address "Thamel\nKathmandu", a cover photo and an artist with a Devanagari name.
- Dashboard: the nav shows "Good to know" after "Page look"; tick Sunday to Friday (ticking copies the first day's times), set Wednesday 10:30–18:00, save; a day with 20:00–11:00 shows its error under the row; add "Closed for Dashain" for two days next week and a one-day closure with a Devanagari note; remove one; fill the four texts (one in Devanagari); the deposit line links to Payments. An artist's account gets a 404 on `/t/<slug>/settings/good-to-know`.
- Storefront home: the cover reads "Thamel, Kathmandu" then today's state. Change today's hours in the dashboard so the studio is open now (reload the storefront page: each server render has its own QueryClient and no CDN sits in front in development), then so it closed an hour ago, then add a closure for today: the cover says "Open now · till …", then "Closed now · opens …", then "Closed today · <note>". With Playwright's clock (`page.clock.install` / `setFixedTime`) set 5 minutes before closing, the server-rendered line is empty and the island fills "Open now · till …"; advance the clock past closing by 1 minute: within 30 s it says "Closed now · opens …". With JavaScript off, the line shows when steady and the section's `<details>` open.
- Page look: hide Good to know (it disappears from the home page after the cache; check with a fresh storefront render), move it above Artists, show it again; the settings page shows the hidden note while it is hidden.
- `/artists/<slug>` and `/work` are unchanged.
Stop both servers by their exact PIDs.

## 10. Final gates

From the worktree root, Node 24, the lane's environment: `pnpm check`, `pnpm typecheck`, `pnpm build`; empty `queue_jobs` in `tattoo_drip_uz`, then the full platform suite in the background under both locks: `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock flock /home/blank/Coding/tattoo-drip-wt/_scratch-archive-2026-10-20/td-platform-suite.lock env … PORT=3432 pnpm -C apps/platform exec node ace test > /tmp/site5-suite.log 2>&1` (the log ends with `Tests N passed` and no failures); `pnpm test` (packages and storefront); `pnpm --filter @tattoo-drip/storefront check:page` ("Page check passed").

## 11. Review focus (Fable and Codex)

1. **Tenant isolation:** both tables have RLS and `EXPECTED_POLICIES` entries; every service query filters `tenant_id`; `findClosure` of another studio's id is a 404 and deletes nothing (http spec, isolation case, service spec from B's context); the advisory lock key includes the tenant id.
2. **Role scoping:** all five routes are `OWNERS`; `role_access.spec.ts` sends them as an artist (404, snapshot unchanged).
3. **Information exposure:** `getStudio` now sends the deposit policy (deliberate, spec) and nothing else new from the row: never `defaultDepositPercent`, closure ids, ended closures, timestamps. The privacy spec and the exact-fields tests pin it. The Payments page and the docs tell owners the policy is public.
4. **Correctness under the cache:** the server never renders a state that changes within 11 minutes (Task 6 tests, `PAGE_MAX_AGE_MS` tied to `PAGE_CACHE`); a closure day never says open; Kathmandu's +05:45 and a midnight crossing; hydration renders the same markup as the server (the island starts from `view.initial`, set in the loader data).
5. **Query counts and payload:** getStudio 3 queries, no per-row query; the dehydrated studio grows only by what the studio wrote.
6. **Accessibility:** `dl` semantics, `<details>` with a 48 px summary and an `aria-hidden` chevron, the cover line as plain text (no live region), labels on every time input ("Opens Sunday"), errors tied with `aria-describedby`, Remove buttons named with their dates.
7. **Integration:** the migration order, the section list's final order and the shared files listed under "Integration".

## 12. Risks and rollback

- **Estimate: 5 points, not 3.** Two RLS tables with the isolation harness, a three-form settings page, a contract change through four packages, non-trivial time logic with a cache-safe server render, a section-list migration that depends on TAT-126, and the split's closing docs.
- **TAT-126 timing:** Task 8 waits on TAT-126 Task 7; Tasks 1 to 7 do not. Frequent small rebases keep conflicts small (openapi.yaml, loaders.ts, pages.tsx, styles.css, fixtures).
- **Migration ordering at integration:** if TAT-129 adds a section migration that sorts after `1791790000001`, new studios lose `info` by default; `page_look_columns.spec.ts` (compared with `DEFAULT_SECTIONS`) catches it. Rename ours to sort last.
- **A wrong phone clock** shows a wrong state after hydration (accepted; the server's steady state is right).
- **Making the deposit policy public** changes what existing studios show without them acting; the Payments page sentence and Good to know's own row in Page look let them hide it (the whole section) or clear it.
- **Rollback:** revert the branch's commits; `pnpm migrate:rollback` twice runs Task 8's `down` (removes `info` from every list, old default) and Task 1's `down` (drops both tables and the four columns: hours, closures and texts are lost, nothing else). The storefront tolerates an API without the new fields, so the storefront can be rolled back alone; deploy the platform first.
