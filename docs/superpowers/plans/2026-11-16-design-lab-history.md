# Design Lab Generation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owners-only page at `/t/:tenant/design-lab/history` that lists every Design Lab generation attempt in the studio (one row per usage-ledger row), paged and filterable by month, artist and status. A monthly summary on the page uses the allowance's own counting.

**Architecture:** The pure rules (filter parsing, how a ledger row maps to a status, how a person is labelled) live in `#modules/design_lab/history`. `DesignHistoryService` pages `design_usage_records` alone, because every filter is a ledger column. It then batch-loads the generations, the projects (including soft-deleted ones), the assets, the users and the memberships (including soft-deleted ones) for that page. `DesignLabController.history` shapes the rows for the Inertia page `design_lab/history`.

**Tech Stack:** AdonisJS 7, Lucid, Inertia + React, Japa, Luxon.

**Spec:** `docs/superpowers/specs/2026-11-15-design-lab-history-design.md`

## Global Constraints

- Owners only: `"tenant.design_lab.history": OWNERS` in `TENANT_ROUTE_ROLES`. 404 while `designLabEnabled()` is false.
- One row per `design_usage_records` row, ordered `reserved_at desc, id desc`, 25 per page (`HISTORY_PER_PAGE = 25`).
- Status mapping: `settled` → `done`; `reserved` → `in_progress`; `released` with `release_reason` in `MODERATION_CODES` → `blocked`; any other `released` → `failed`.
- Months are UTC calendar months (`monthStart` from `design_usage_service.ts`); times are displayed in `tenant.timezone` as `d LLL yyyy, HH:mm`.
- Counts sum `units`, as `DesignUsageService.monthCounts` does. "Used" = settled.
- Never show provider credits, costs, prompts or concept text.
- Person labels: live member → `fullName ?? email`; removed member → `"<fullName> (former)"`, or `"Former member"` when there's no full name (never the email); null `user_id` → `"Deleted account"`.
- A soft-deleted project shows as `"(deleted project)"` with no link. An archived project links as normal.
- The reference (failed and blocked rows only) is `` `${generationId} · attempt ${attempt}` ``.

## Review Focus

1. A malformed `month`, `artist`, `status` or `page` in the URL (e.g. `month=2026-13`, `artist=x`, `page=0`) → falls back to the default; never a 500. *(Task 1 test.)*
2. An `artist` id from another studio, or one with no attempts in the chosen month → treated as "Everyone"; no other studio's rows are shown. *(Task 2 test.)*
3. A member removed and later re-invited (two membership rows, one soft-deleted) → shown as a current member, not "(former)". *(Task 2 test.)*
4. A generation retried across a month boundary → each attempt appears in its own month, and the counts match `allowance()` for the current month. *(Task 2 test.)*
5. `page` past the last page → an empty list with the summary still correct; no error. *(Task 3 test.)*

---

### Task 1: Pure history rules

**Files:**
- Create: `apps/platform/app/modules/design_lab/history.ts`
- Test: `apps/platform/tests/unit/modules/design_lab/history.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HISTORY_PER_PAGE = 25;
  export const HISTORY_STATUSES = ["done", "in_progress", "failed", "blocked"] as const;
  export type HistoryStatus = (typeof HISTORY_STATUSES)[number];
  export type HistoryFilters = {
    month: string;            // "YYYY-MM", UTC
    artist: string | null;    // user id (uuid) or null for everyone
    status: HistoryStatus | null;
    page: number;             // >= 1
  };
  export function parseHistoryFilters(qs: Record<string, unknown>, now: DateTime): HistoryFilters;
  export function monthRange(month: string): { start: DateTime; end: DateTime }; // UTC, end exclusive
  export function historyStatus(status: string, releaseReason: string | null): HistoryStatus;
  export function personLabel(person: { fullName: string | null; email: string } | null, former: boolean): string;
  ```

- [ ] **Step 1: Write the failing tests** in `history.spec.ts` (`test.group("Design Lab history rules")`):
  - `parseHistoryFilters({}, DateTime.fromISO("2026-11-16T10:00:00Z"))` deep-equals `{ month: "2026-11", artist: null, status: null, page: 1 }`.
  - Valid values pass through: `{ month: "2026-10", artist: "0193a1b2-0000-7000-8000-000000000001", status: "blocked", page: "3" }` → the same values, with `page: 3`.
  - Fallbacks: each of `month: "2026-13"`, `month: "2026-12"` (after `now`'s month), `month: "2019-12"` (before 2020-01), `month: ["2026-10"]`, `artist: "x"`, `status: "moderated"`, `page: "0"` and `page: "abc"` gives that field's default.
  - `monthRange("2026-02")` → start `2026-02-01T00:00:00.000Z`, end `2026-03-01T00:00:00.000Z` (compare `toISO()` in UTC).
  - `historyStatus("settled", null) === "done"`, `("reserved", null) === "in_progress"`, `("released", "content_moderated") === "blocked"`, `("released", "request_moderated") === "blocked"`, `("released", "timed_out") === "failed"`, `("released", null) === "failed"`.
  - `personLabel({ fullName: "Sam Lee", email: "s@x.test" }, false) === "Sam Lee"`, `({ fullName: null, email: "s@x.test" }, false) === "s@x.test"`, `({ fullName: "Sam Lee", email: "s@x.test" }, true) === "Sam Lee (former)"`, `({ fullName: null, email: "s@x.test" }, true) === "Former member"`, `(null, false) === "Deleted account"`.

- [ ] **Step 2: Run them to make sure they fail**

  Run (from `apps/platform`): `timeout -s KILL 120 node ace test unit --files=history.spec.ts`
  Expected: FAIL (cannot import `#modules/design_lab/history`).

- [ ] **Step 3: Implement `history.ts`.** `month` must match `/^\d{4}-(0[1-9]|1[0-2])$/` and fall between `2020-01` and `now`'s UTC month; `artist` must be a uuid (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`); `page` uses the controller's existing `pageNumber` rule (`/^[1-9]\d{0,7}$/`), so move `pageNumber` here, export it, and import it in `design_lab_controller.ts`. `blocked` uses `MODERATION_CODES` from `./rules.js`. `monthRange` builds on `DateTime.fromISO(`${month}-01`, { zone: "utc" })`.

- [ ] **Step 4: Run the tests and make sure they pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/platform/app/modules/design_lab/history.ts apps/platform/tests/unit/modules/design_lab/history.spec.ts apps/platform/app/controllers/design_lab_controller.ts
  git commit -m "feat(platform): Design Lab history filter and status rules"
  ```

---

### Task 2: `DesignHistoryService`

**Files:**
- Create: `apps/platform/app/modules/design_lab/services/design_history_service.ts`
- Test: `apps/platform/tests/functional/design_lab/design_history.spec.ts`

**Interfaces:**
- Consumes: Task 1's `HistoryFilters`, `HISTORY_PER_PAGE`, `monthRange`, `historyStatus`, `personLabel`; `DesignUsageService.allowance(tenant)`.
- Produces:
  ```ts
  export type HistoryEntry = {
    record: DesignUsageRecord;
    status: HistoryStatus;
    generation: DesignGeneration;            // always present (ledger rows reference one)
    project: DesignProject | null;           // null when soft-deleted
    asset: DesignAsset | null;               // only for done rows
    person: string;                          // personLabel(...)
  };
  export type HistoryCounts = { used: number; inProgress: number; failed: number; blocked: number };
  export type HistoryArtist = { id: string; label: string };

  @inject() export default class DesignHistoryService {
    constructor(private usage: DesignUsageService) {}
    artists(tenant: TenantRef, month: string): Promise<HistoryArtist[]>;   // sorted by label
    list(tenant: TenantRef, filters: HistoryFilters): Promise<{ entries: HistoryEntry[]; page: number; lastPage: number }>;
    counts(tenant: TenantRef, filters: Pick<HistoryFilters, "month" | "artist">): Promise<HistoryCounts>;
  }
  ```
  The caller decides whether `filters.artist` is valid: the controller replaces an artist missing from `artists(tenant, month)` with `null` before calling `list` and `counts`.

- [ ] **Step 1: Write the failing tests** in `design_history.spec.ts`. Use `testUtils.db().wrapInGlobalTransaction()`, `studioWithOwner`, `artistIn`, `inTenant` and `seedDesignLab` (each studio gets one failed attempt with `provider_error` and one settled attempt, both by the artist). Add records with a local helper `attempt(tenant, { generationId, attempt, userId, status, releaseReason?, reservedAt })` that creates a `DesignUsageRecord`. Build the service with `await app.container.make(DesignHistoryService)` and call it inside `inTenant(tenant, ...)`. Tests:
  - "lists every attempt of the month, newest first": seed, then add a `released`/`content_moderated` attempt 1 hour later on a new generation → `list` returns 3 entries; the first has status `blocked`, and the statuses are `["blocked", ...]` in `reserved_at desc` order; `lastPage === 1`.
  - "a failure retried into a success keeps both rows": generation G with attempt 1 `released`/`timed_out` and attempt 2 `settled` → both appear, with statuses `failed` and `done`.
  - "each attempt sits in the month it was reserved": G's attempt 1 reserved `2026-10-31T23:30Z`, attempt 2 `2026-11-01T00:10Z` → `list` with `month: "2026-10"` has only attempt 1, and with `"2026-11"` only attempt 2.
  - "counts match the allowance for the current month": with the current month and `artist: null`, `counts.used === (await usage.allowance(tenant)).used` and `counts.inProgress === allowance.reserved`.
  - "filters by artist and status": a second artist's settled attempt → `artist: secondArtist.id` returns only theirs; `status: "failed"` returns only the `provider_error` row; `counts` with the artist counts only theirs.
  - "pages 25 at a time": 30 settled attempts → page 1 has 25 entries, page 2 has 5, `lastPage === 2`.
  - "a deleted project's rows stay, with no project": soft-delete the seeded project (`project.softDelete()` or the model's mixin method) → its entries have `project === null` and still count in `counts`.
  - "people: live, former, re-invited and deleted accounts": a removed member (soft-delete their membership via `MemberService.remove` or `membership.softDelete()`) shows as `"<name> (former)"`; one with no `fullName` as `"Former member"`; a member with a soft-deleted row and a live row shows as a plain name; a record with `userId: null` shows as `"Deleted account"`. `artists(tenant, month)` lists the former member with the same label and doesn't list the null user.
  - "another studio's rows never appear": seed studios A and B; from `inTenant(A)`, `list` and `counts` with `artist: <B's artist id>` return no entries and zero counts; `artists(A, month)` contains none of B's users.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `timeout -s KILL 300 pnpm test functional --files=design_history.spec.ts`
  Expected: FAIL (cannot import the service).

- [ ] **Step 3: Implement the service.**
  - `list`: `DesignUsageRecord.query().where("tenant_id", tenant.id)`, `reserved_at >= start and < end`, plus an optional `user_id`. The status filter: `done` → `status = 'settled'`; `in_progress` → `'reserved'`; `blocked` → `status = 'released' and release_reason in MODERATION_CODES`; `failed` → `status = 'released' and (release_reason is null or release_reason not in MODERATION_CODES)`. Then `.orderBy("reserved_at", "desc").orderBy("id", "desc").paginate(page, HISTORY_PER_PAGE)`.
  - Batch-load for the page's rows, each query with `where("tenant_id", tenant.id)`: `DesignGeneration` by id; `DesignProject.withTrashed()` by the generations' `designProjectId` (set `project` to `null` when `deletedAt` is set); `DesignAsset` by `generation_id` (attach only to `done` entries); `User` by id; `TenantMembership.withTrashed()` by `user_id` (a user is former when none of their rows has `deletedAt === null`).
  - `counts`: one grouped query on the same month and artist filter, `groupBy("status", "release_reason")` and `sum("units")`, folded through `historyStatus`.
  - `artists`: distinct non-null `user_id` from the month's ledger rows, labelled as `list` labels them, sorted by label.

- [ ] **Step 4: Run the tests and make sure they pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/platform/app/modules/design_lab/services/design_history_service.ts apps/platform/tests/functional/design_lab/design_history.spec.ts
  git commit -m "feat(platform): Design Lab history service over the usage ledger"
  ```

---

### Task 3: Route, controller, page, entry link and docs

**Files:**
- Modify: `apps/platform/start/routes.ts` (the Design Lab group, after the `index` route)
- Modify: `apps/platform/app/modules/tenancy/access.ts` (add the entry next to the other `tenant.design_lab.*` entries)
- Modify: `apps/platform/app/controllers/design_lab_controller.ts` (inject `DesignHistoryService`, add `history`)
- Modify: `apps/platform/inertia/components/design_lab.ts` (plain helpers)
- Create: `apps/platform/inertia/pages/design_lab/history.tsx`
- Modify: `apps/platform/inertia/pages/design_lab/index.tsx` (owner-only "History" link)
- Modify: `apps/platform/tests/isolation/cases.ts`
- Modify: `docs/design-lab.md` (new "History" section)
- Regenerate: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/design_lab/design_history_http.spec.ts`, `apps/platform/tests/unit/inertia/design_lab_history_copy.spec.ts`

**Interfaces:**
- Consumes: Task 1's `parseHistoryFilters` and `HistoryStatus`; Task 2's `DesignHistoryService`.
- Produces: the page props.
  ```ts
  type HistoryRow = {
    id: string;                      // ledger record id
    status: HistoryStatus;
    attempt: number | null;          // record.attempt when generation.attempt > 1, else null
    reason: string | null;           // failed/blocked: FAILURE_MESSAGES[release_reason], plus " Flagged for: a, b." for a blocked row whose attempt === generation.attempt and providerMeta.moderationReasons is non-empty
    thumbnailUrl: string | null;     // done rows with an asset: images.urlFor("design_concept", key, tenant, THUMBNAIL_WIDTH)
    person: string;
    project: { id: string; title: string } | null;
    when: string;                    // reserved_at in tenant.timezone, "d LLL yyyy, HH:mm"
    reference: string | null;        // failed/blocked: `${generationId} · attempt ${attempt}`
  };
  props: {
    rows: HistoryRow[];
    filters: { month: string; artist: string | null; status: HistoryStatus | null };
    page: number; lastPage: number;
    months: string[];                         // "YYYY-MM", newest first, from the current UTC month back to the month of the studio's first ledger row (at least the current month)
    artists: { id: string; label: string }[];
    counts: HistoryCounts;
    limit: number | null;                     // allowance.limit when month is current and artist is null, else null
    studio: { used: number; limit: number } | null; // current month with an artist: allowance.used and limit; else null
  }
  ```
  Helpers in `inertia/components/design_lab.ts`:
  ```ts
  export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = { done: "Done", in_progress: "In progress", failed: "Failed", blocked: "Blocked" };
  export function historyCountsText(counts: HistoryCounts, limit: number | null): string;
  export function historyQuery(filters: { month: string; artist: string | null; status: string | null }, page: number, currentMonth: string): string;
  ```
  Declare `HistoryStatus` and `HistoryCounts` locally in this file, because it imports nothing.

- [ ] **Step 1: Write the failing unit test** `design_lab_history_copy.spec.ts`. Import the helpers the way `nav_items.spec.ts` imports from `inertia/components` (a `.js` specifier with the `@ts-expect-error TS6305` line). Cases:
  - `historyCountsText({ used: 23, inProgress: 1, failed: 3, blocked: 1 }, 40) === "23 of 40 used · 1 in progress · 3 failed · 1 blocked"`.
  - With `limit` null: `"23 used · 1 in progress · 3 failed · 1 blocked"`.
  - `historyQuery({ month: "2026-11", artist: null, status: null }, 1, "2026-11") === ""`.
  - `historyQuery({ month: "2026-10", artist: "u1", status: "failed" }, 2, "2026-11") === "?month=2026-10&artist=u1&status=failed&page=2"`.

- [ ] **Step 2: Write the failing HTTP tests** in `design_history_http.spec.ts`. Use the same set-up as `design_lab.spec.ts` (`labStudio` style: `studioWithOwner`, `artistIn`, `seedDesignLab`) and Inertia assertions as in that spec:
  - The owner gets `GET /t/:slug/design-lab/history` → 200, component `design_lab/history`. `rows` has 2 entries (statuses `failed` and `done`). The failed row's `reason` equals `FAILURE_MESSAGES.provider_error` and its `reference` is `` `${designGeneration.id} · attempt 1` ``. The done row has a `thumbnailUrl` and `reference: null`. `limit` equals the allowance limit, and `studio` is null.
  - `?artist=<artist id>` → `limit` null and `studio` non-null with `used: 1`.
  - `?month=2026-13&status=nope&page=0` → 200 with `filters.month` as the current UTC month, `status` null and `page: 1`.
  - `?page=99` → 200, `rows` empty, `counts.used === 1`.
  - The artist gets a 404.
  - With `designProviders.off = true` (restore it in teardown), the owner gets a 404.
  - No row's props contain `credits`, `cost`, `prompt` or `concept` (assert on `JSON.stringify(props)`).

- [ ] **Step 3: Add the isolation case** to `tests/isolation/cases.ts` after the `GET /t/:tenant/design-lab` case:
  ```ts
  { method: "GET", pattern: "/t/:tenant/design-lab/history", actor: "owner", ownStatus: 200, snapshot: designLabState },
  ```
  `role_access.spec.ts` picks it up as owner-only (a 404 for the artist). Don't edit `ARTIST_ROUTES`.

- [ ] **Step 4: Run them to make sure they fail**

  Run: `timeout -s KILL 120 node ace test unit --files=design_lab_history_copy.spec.ts` and `timeout -s KILL 300 pnpm test functional --files=design_history_http.spec.ts`
  Expected: FAIL (missing helpers; route not found).

- [ ] **Step 5: Implement.**
  - Route: `router.get("history", [controllers.DesignLab, "history"]).as("tenant.design_lab.history");` inside the Design Lab group. Access: `"tenant.design_lab.history": OWNERS`.
  - Controller `history(ctx)`:
    - Return 404 unless `designLabEnabled()`.
    - Run `filters = parseHistoryFilters(ctx.request.qs(), DateTime.utc())` and `artists = history.artists(tenant, filters.month)`. If `filters.artist` isn't one of the artists' ids, set it to `null`.
    - Then call `list` and `counts`, and `usage.allowance(tenant)` when the month is current, and shape each `HistoryRow` as the Interfaces block describes.
    - Get `months` from the oldest `reserved_at` in the studio's ledger (add `firstMonth(tenant): Promise<string | null>` to `DesignHistoryService`).
    - Set `Cache-Control: private, no-store`, as `status` does.
  - Page `history.tsx`:
    - `Page` title "Design Lab history"; description "Every generation attempt in your studio, for keeping an eye on usage and failures."
    - A "Back to AI Design Lab" link.
    - A filter form using `method="get"` with three `select`s (month, artist with "Everyone", status with "All"), styled with `selectClass` from the index page.
    - Under the month picker, the hint: "Months follow the allowance's calendar (UTC), so a generation late on a month's last evening can count toward the next month."
    - The `historyCountsText` line, plus `Studio: {used} of {limit} used this month` when `studio` is set.
    - A list of rows: a status `Badge` (`statusVariant` look: done → default, failed/blocked → destructive, in progress → secondary); the thumbnail or the reason; `Attempt N` when set; person; project title as a link, or "(deleted project)"; `when`.
    - For failed and blocked rows, the selectable reference text with `<CopyLinkButton text={reference} label="Copy reference" copiedText="Reference copied." failedText="Couldn't copy: select the reference instead." variant="outline" />`.
    - Empty state: "No generations match these filters."
    - Previous/Next paging as on the index page, built with `historyQuery`.
    - Images are not lazy-loaded (signed URLs last 5 minutes; same reason as the index page's covers).
    - Rows stack as cards below `sm` and form a grid from `sm` up, following `docs/ui.md`.
  - Index page: when `useTenant().role === "owner"`, show a "History" link (`urlFor("tenant.design_lab.history", params)`) in the "Your design projects" section's nav, after "Archived".
  - Docs: add a "## History" section to `docs/design-lab.md` before "## Usage and cost". Summarise it in about six sentences: owners only, one row per ledger attempt, filters, UTC months, the summary matching the allowance, the person labels, deleted projects, the reference for support, and no costs.
  - Run `node ace codegen` from `apps/platform`.

- [ ] **Step 6: Run the tests and make sure they pass**

  Run: the two commands from Step 4, plus `timeout -s KILL 600 pnpm test functional --files=cross_tenant.spec.ts`, `--files=role_access.spec.ts` and `--files=tenant_routes.spec.ts`, then `pnpm typecheck` and (from the repo root) `pnpm check`.
  Expected: all PASS; the isolation case shows up in `cross_tenant` and `role_access`.

- [ ] **Step 7: Check the page in a browser** at 375×812 and 1280×800: sign in as a seeded owner with `pnpm dev`, open the history page, change each filter, copy a reference, and confirm an artist doesn't see the "History" link.

- [ ] **Step 8: Commit**
  ```bash
  git add apps/platform docs/design-lab.md
  git commit -m "feat(platform): Design Lab generation history page for owners"
  ```
