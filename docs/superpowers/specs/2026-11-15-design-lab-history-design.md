# AI Design Lab: generation history (design)

Date: 2026-11-15. Area: `apps/platform`. Background: [docs/design-lab.md](../../design-lab.md).

## Why

Studio owners want one place to keep an eye on the Design Lab: how much of the month's allowance the studio has used, and what went wrong. They **read and report**. When something looks off, they tell TattooDrip support. Today the only view is each design project's page, one project at a time, and an attempt that failed and was then retried successfully leaves no trace there.

## Goals

- One owners-only page listing every generation **attempt** in the studio across all design projects, newest first, 25 per page.
- Filters: month, artist and status. Every filter is in the query string, so a view can be bookmarked or shared.
- A summary for the chosen month whose "used" figure is the allowance's own figure, calculated the same way.
- Failed and blocked rows show the reason in plain words and a reference ID the owner can copy and send to support.

## Non-goals

- No actions on the page: no retry, rename, select or download. Those stay on the project page.
- No access for artists or customers.
- No money or provider credits. TattooDrip pays the provider, and its costs are never shown as the studio's (docs/design-lab.md, "Usage and cost").
- No per-artist breakdown, no export and no charts.
- No prompts or concept text in the rows. The project page already shows how a design was made.

## Anti-goals (failure even if it works)

- The summary disagreeing with the allowance on the generate form, for example "23 used" here and "22 used" there.
- A failure disappearing from the history because a later retry succeeded.
- Another studio's rows, or another studio's members in the artist filter, reaching the page.

## Approaches considered

- **A. One row per generation, showing its final status** (from `design_generations`). Rejected: a failure retried into a success disappears, and a retry made in a later month stays under the original month, so the summary can't match the allowance.
- **B. One row per attempt, from the usage ledger `design_usage_records`.** **Chosen.** The ledger already has one row per attempt (`generation_id`, `attempt`, `user_id`, `status`, `release_reason`, `reserved_at`). The allowance counts these rows by `reserved_at` in the UTC calendar month (`DesignUsageService.monthCounts`). Using the same rows makes the summary agree with the allowance by construction, and every failed attempt stays visible.
- **C. A new activity log table.** Rejected: the ledger already is that log.
- **A JSON API with infinite scroll.** Rejected: the studio dashboard is built from server-rendered Inertia pages with paging; follow that.

## Decided

**Route and access**
- `GET /t/:tenant/design-lab/history`, named `tenant.design_lab.history`, `OWNERS` in `TENANT_ROUTE_ROLES` (`app/modules/tenancy/access.ts`). An artist gets the role middleware's normal refusal.
- A 404 when the Design Lab is off (`designLabEnabled()`), like every other Design Lab route.
- The entry point is a "History" link on the Design Lab index page header, shown only to owners. There is no new top-level nav item.

**Rows (one per ledger row)**, ordered by `reserved_at desc, id desc`:

| Column | Source |
|---|---|
| Status | `settled` → **Done**; `reserved` → **In progress**; `released` with `release_reason` in `MODERATION_CODES` → **Blocked**; any other `released` → **Failed** |
| What happened | Done: a thumbnail of the generation's stored asset (a 5-minute signed URL, as on the project page). Failed or blocked: the failure reason in plain words from `FAILURE_MESSAGES` (`app/modules/design_lab/rules.ts`), keyed by `release_reason`, which always holds a `FailureCode` (`GenerationRunner.finish` is the only caller of `release`). Blocked rows also show the provider's moderation categories (e.g. "Violence") from the generation's `provider_meta`. A moderated generation can't be retried, so its latest `provider_meta` belongs to that attempt. |
| Attempt | "Attempt 2" when the generation has more than one attempt; nothing otherwise |
| Artist | The ledger's `user_id`, shown by the member's display name. A removed member (soft-deleted `tenant_memberships` row) keeps their name with "(former)", e.g. "Sam (former)"; if they have no full name, "Former member" is shown, never their email. A row whose `user_id` is null (account deleted, `ON DELETE SET NULL`) shows "Deleted account". |
| Project | The design project's title, linked to its page. Archived projects are linked as normal. A soft-deleted project shows "(deleted project)" with no link. |
| When | `reserved_at` shown in the studio's time zone |
| Reference | Failed and blocked rows only: the generation id and attempt (e.g. `0193…e4c1 · attempt 2`) with a copy button that copies the full value |

**Filters (query string)**
- `month=YYYY-MM`, defaulting to the current UTC month. Months are UTC calendar months to match the allowance. Times are shown in local time, so an attempt made late on a month's last evening, local time, can sit in the next month; the page says so in a short hint under the month picker.
- `artist=<user id>`: options are "Everyone" plus everyone with at least one attempt in the selected month, current and former members alike (former ones labelled as in the Artist column). Rows with no user are not a filter option; they appear under "Everyone". The id is accepted only if it appears in this studio's ledger, so another studio's member never matches.
- `status=done|in_progress|failed|blocked`, or absent for all.
- `page=N`, 25 rows per page, using the existing `pageNumber` helper and the index page's paging pattern.
- An unknown or malformed value falls back to the default rather than causing an error.

**Summary line** for the chosen month and artist filter, ignoring the status filter: "N used · N in progress · N failed · N blocked". "Used" counts settled rows, as the allowance does. For the **current** month with no artist filter, it reads "N of LIMIT used", with the limit from the allowance. With an artist filter, the line shows that artist's counts only, with no limit, and the current month adds a separate studio-wide line ("Studio: N of LIMIT used this month") so one artist's count never reads as the studio's remaining allowance *(builder check; my call)*. Past months show no limit, because the limit setting isn't stored per month.

**Data and isolation**
- No migration. The ledger has an index on `(tenant_id, reserved_at)`.
- The query joins the ledger to `design_generations`, `design_projects` (including soft-deleted rows: `withTrashed()`), `design_assets` and members, each filtered by `tenant_id` and run under the tenant's database context (RLS). Member and user lookups are outer joins that include soft-deleted memberships, so no ledger row is ever dropped and the counts always match the allowance.
- Add an isolation case to `tests/isolation/cases.ts`.

**Docs**
- Add a "History" section to `docs/design-lab.md`.

## Left to the builder

- Where the query lives: a method on `DesignUsageService` or `DesignLabService`. It must not repeat the allowance's month boundaries and status mapping by hand; reuse `monthStart` and the ledger statuses.
- The exact page layout and components, following `docs/ui.md` and the existing Design Lab pages, including the mobile layout (rows may become cards).
- Route ordering, so `history` isn't captured by the `:id` route.
- Labels for the failure reasons, if the project page doesn't already expose them in a shared place.
- Tests. At minimum: owners see every artist's attempts; an artist is refused; another studio's rows never appear; each filter works; the "used" count equals `DesignUsageService.allowance().used` for the current month; a deleted project's rows appear without a link; a removed member's rows show "(former)" and a deleted account's rows show "Deleted account", and both still count; a failed attempt that was retried into a success still appears; the page 404s when the lab is off.
- `node ace codegen` after the route, page and controller changes.
