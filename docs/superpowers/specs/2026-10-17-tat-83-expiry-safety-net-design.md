# Expiry safety net for ExpireQuoteJob (TAT-83)

Date: 2026-10-17
Refs: TAT-83 ("Expiry safety net: an early or failed ExpireQuoteJob leaves an expired quote on a quoted project"), found by the TAT-64 review, confirmed by TAT-46. Stacked on TAT-8 (e946104). Designed unattended: every open question is decided in the Rulings below.

## Goal

An expired current quote on a `quoted`, `on_hold` or unpaid `deposit_pending` project gets its project cancelled within about 7 minutes of the expiry, even when its `ExpireQuoteJob` fired early, used up its retries, or was never queued. Expiry rules stay the same: `ProjectService.expireQuote` still makes every decision, under the project lock, in the quote's own tenant.

No route, page, API, SDK or env var change. One migration (a function and an index).

## What the installed packages do

Read from `@boringnode/queue` 0.6.0 and `@adonisjs/queue` 0.6.2, not from memory:

- `Job.schedule(payload).id(id).cron(expr).run()` upserts a row in `queue_schedules` by id (status back to `active`, `next_run_at` recomputed). The worker's every cycle (`processCycle`, so `processQueued()` in tests too) claims due schedules (`FOR UPDATE SKIP LOCKED`, one claim per due time, no catch-up after downtime) and pushes the named job.
- `node ace configure @adonisjs/queue` would add a `start/scheduler.ts` preload for the `web` environment: the web server writes the schedules at boot. `QueueManager.init` runs in the provider's `boot()`, before preloads.
- `queue.fake()` supports schedules (`Schedule.find` reads the fake).
- A job's delay (`.in(ms)`) is relative to the dispatching process's clock.

The app role cannot read other tenants' rows (RLS, `ENABLE`d, not `FORCE`d): the owner role, which owns the tables, bypasses it. Postgres grants `EXECUTE` on a new function to `PUBLIC`. Locally the dev server and the tests share one database (`tattoo_drip`).

## Changes

| File (under `apps/platform`) | Change |
|---|---|
| `app/modules/projects/services/project_service.ts` | `expireQuote`: a run for the current quote before its expiry queues `ExpireQuoteJob` again for the rest of the time (under the lock, in the same transaction) and returns false. A private `queueExpiry` shared with `issueQuote` |
| `database/migrations/1791620000000_create_expired_quote_candidates_function.ts` | New: index `quotes (expires_at)`; SECURITY DEFINER `expired_quote_candidates()`; `REVOKE ALL … FROM PUBLIC`; `GRANT EXECUTE` to the app role (`DB_USER`) |
| `app/modules/projects/jobs/sweep_expired_quotes_job.ts` | New plain `Job`: reads the candidates, queues one `ExpireQuoteJob` per row with that row's `tenantId` |
| `start/scheduler.ts`, `adonisrc.ts` | New preload (`web` only): upserts the `sweep-expired-quotes` schedule, cron `*/5 * * * *` (UTC) |
| `tests/helpers/worker.ts` | `processQueued()` deletes `queue_schedules` rows inside the test's transaction before draining |
| `tests/functional/rls/catalog_guard.spec.ts` | `DEFINER_FUNCTIONS` list: every SECURITY DEFINER function in `public` is listed, pins `search_path`, and `PUBLIC` cannot execute it |
| `tests/unit/jobs/job_classes.spec.ts` | `SweepExpiredQuotesJob` in the allowlist, with its reason |
| Docs | `docs/jobs-and-email.md`, `docs/backend.md`, `docs/testing.md`, `database/README.md`; the index line in `docs/README.md` (repo root) |

The function, exactly:

```sql
create function public.expired_quote_candidates()
returns table (tenant_id uuid, project_id uuid, quote_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select q.tenant_id, q.project_id, q.id
  from public.quotes q
  join public.tattoo_projects p on p.tenant_id = q.tenant_id and p.id = q.project_id
  where q.expires_at <= statement_timestamp() - interval '2 minutes'
    and q.expires_at > statement_timestamp() - interval '24 hours'
    and p.deleted_at is null
    and p.status in ('quoted', 'on_hold', 'deposit_pending')
    and not exists (
      select 1 from public.quotes newer
      where newer.tenant_id = q.tenant_id and newer.project_id = q.project_id
        and newer.version > q.version
    )
  order by q.expires_at, q.id;
end
```

## Rulings

1. **Build both: the re-queue and the sweep.** The re-queue fixes an early run at the exact time; only the sweep covers a job that used up its retries or was never queued (a lost row, a restore, a future path that forgets the job). The acceptance asks for both "even if its job misfired" and an early-run test. Rejected: the re-queue alone (misses failures); the re-queue plus a re-dispatch from `failed()` (misses lost jobs and a `failed()` whose own dispatch fails, repeats a failing job with no bound, and adds a second retry mechanism next to the queue's); the sweep alone (2 to 7 minutes late where the re-queue is exact, and no early-run test).
2. **The re-queue lives in `expireQuote`, not the job.** When `quoteId` is the current quote and it has not expired on this process's clock (luxon `DateTime.now()`, the same clock `isExpired` reads), it queues `ExpireQuoteJob` with the same payload, delayed by the rest of the time, through `dispatchInTransaction` under the project lock, and returns false. It does this whatever the project's status: the run at the expiry decides, as the original would have. `issueQuote` and `expireQuote` share `queueExpiry`. Each re-queue waits the remaining time, so a clock stepped back makes one more job, not a loop. Rejected: re-queueing in the job (a second read outside the lock, or a new return type for `expireQuote` and its 15 or so assertions); re-queueing only in cancellable statuses (more rules to save one no-op job).
3. **Cross-tenant listing is one SECURITY DEFINER function that returns ids only.** `expired_quote_candidates()` takes no arguments, has an SQL-standard body (`begin atomic`: names and operators are bound when it is created, no dynamic SQL), pins `search_path = pg_catalog, pg_temp`, qualifies every table, and returns `(tenant_id, project_id, quote_id)` and nothing else. It runs as the migration owner, so it sees every tenant. The migration revokes `PUBLIC`'s `EXECUTE` and grants it to the app role named by `DB_USER` (quoted as an identifier; a missing role fails the migration). A `DEFINER_FUNCTIONS` list in the catalog guard makes any later definer function a conscious, reasoned edit, like `EXEMPT`. Accepted risk: code running as the app role (an SQL injection included) could list other tenants' project and quote ids; ids give no access by themselves (RLS, tenant from the URL), and UUIDv7 ids reveal their creation time. Rejected: a dedicated sweeper role (role creation is infrastructure: `setup_roles.sql`, a second connection and password, and a managed Postgres may refuse it); a policy that opens on a setting such as `app.system` (the app role can set any setting, so it would bypass RLS on every table); a loop over tenants (listing tenants is just as cross-tenant, plus one transaction per tenant); the grant in `setup_roles.sql` (it runs before migrations, and existing databases would need a rerun).
4. **The function lists, `expireQuote` decides.** A candidate is a project's current quote (highest version) that expired between 24 hours and 2 minutes ago on the database clock (`statement_timestamp()`, so a test's long transaction doesn't skew it), on a live `quoted`, `on_hold` or `deposit_pending` project. Deposits, the worker's clock and the lock are left to `expireQuote`. The 2-minute grace: every quote expires at a studio's local midnight and the cron is aligned to it, so without it the midnight sweep would duplicate that night's jobs while they and their retries (about 35 s) still run. The 24-hour window: paid-deposit projects stay listed but are never cancelled, so it bounds those no-op checks; and it keeps the sweep a backstop that acts near the expiry, as the job would, rather than a standing rule that would cancel a project days later. An index on `quotes (expires_at)` keeps the scan to the window. Rejected: no window (unbounded no-ops); the deposit rule in SQL (a copy of `DepositService`'s rule inside a definer function); a `LIMIT` (permanent no-ops could starve real candidates).
5. **The sweep fans out to `ExpireQuoteJob`.** `SweepExpiredQuotesJob` is a plain `Job` (allowlisted): it reads ids and queues one `ExpireQuoteJob` per row with that row's `tenantId`. It reads and writes no tenant table. Every cancellation still goes through `TenantJob` (tenant context, one transaction, retries) and `expireQuote` (tenant filter, lock, RLS). Accepted cost: a quote whose expiry keeps failing gets a new job every 5 minutes for 24 hours (at most 288 failed rows, each logged by `failed()`): loud and bounded. Rejected: calling `expireQuote` inline in `withDbContext` per row (a job that touches tenant data without being a `TenantJob`, and no per-row retries).
6. **Every 5 minutes, scheduled by the web server.** Cron `*/5 * * * *` in UTC, schedule id `sweep-expired-quotes`, upserted by a `start/scheduler.ts` preload in the `web` environment (the package's own convention; the upsert is by id, so restarts and several servers are harmless). The preload awaits the upsert: a web server that can't write its schedule doesn't start, like the role guard. Worst case: cancelled about 7 minutes after the expiry. Rejected: every 15 minutes (the ticket's suggestion; 17 minutes is not "a few minutes"); upserting in a migration (local tests share `queue_schedules`, so every `processQueued` would run the sweep); in the worker (`queue:work` has no hook); a job that re-queues itself (one failure ends the chain, the very problem).
7. **Tests stay hermetic and use a fixed clock.** `processQueued()` deletes `queue_schedules` rows inside the test's transaction, so a schedule left by a local `pnpm dev` never runs in a test. The function sees every tenant's committed rows, so specs filter its output to their own tenants. The early-run test fixes luxon's `Settings.now` instead of waiting: 10 minutes early is a delay of exactly 600,000 ms, and moving the clock to the expiry makes the same job cancel.
8. **Known limits.** A quote that expired more than 24 hours before any sweep saw it (a project stuck before this ships, or a worker down for a day while the job also failed) is not swept: staff withdraw it by hand. Soft-deleted tenants are swept like their jobs run today. `ExpireQuoteJob.failed()` keeps its log.

## Tests

- Functional `expire_quote_job.spec.ts`: an early run (fixed clock, 10 minutes before the expiry) queues `ExpireQuoteJob` with the same payload and a delay of 600,000 ms and leaves the project `quoted`; the same job at the expiry cancels it. A payload naming studio A with studio B's project and quote changes nothing in B.
- Functional `project_service.spec.ts` ("ignores a quote…" becomes): an unexpired current quote is re-queued for about a day; a revised quote's old job queues nothing.
- Functional `expired_quote_candidates.spec.ts`: lists both studios' expired current quotes as three uuid columns while the app role with no context sees no project; leaves out the unexpired, the 30-second-old, the 2-day-old, a revised quote, a deleted project and the seven other statuses; `PUBLIC` cannot execute it, the app role can, it is SECURITY DEFINER with the pinned `search_path` and no arguments.
- Functional `catalog_guard.spec.ts`: the definer functions in `public` are exactly `DEFINER_FUNCTIONS`, each pinned and not executable by `PUBLIC`.
- Functional `sweep_expired_quotes_job.spec.ts`: run directly with a fake queue, it queues `ExpireQuoteJob` for A's and B's candidates with their own tenant ids, and nothing for a non-candidate; through the real worker it cancels both and spares A's paid `deposit_pending` project.
- Functional `process_queued.spec.ts`: a due schedule in `queue_schedules` doesn't run inside `processQueued()`.
- Unit `scheduler.spec.ts`: the preload schedules `SweepExpiredQuotesJob` with `*/5 * * * *`; `adonisrc.ts` loads it for `web` only. Unit `job_classes.spec.ts`: the allowlist entry.

## Rules for other tickets

- **Any new way to issue a quote (TAT-43 included)** goes through `ProjectService.issueQuote`, which queues the job. The sweep is a backstop with a 2-minute grace, not the mechanism.
- **TAT-65/66 (verification, refunds):** a reversal that unsettles the deposit of a `deposit_pending` project whose quote expired in the last 24 hours gets it cancelled by the next sweep. If staff should keep such a project, revise the quote in the same step.
- **A new cross-tenant read:** a SECURITY DEFINER function built like this one (ids only, `begin atomic`, pinned `search_path`, `PUBLIC` revoked, granted to `DB_USER`), a `DEFINER_FUNCTIONS` entry, and a spec for its security properties.
- **A new recurring job:** one line in `start/scheduler.ts`, with a fixed schedule id.

## Not in this ticket

Fixing projects that were stuck more than 24 hours before this ships; alerting on misfires; a dedicated database role.

## Verification

`PORT=3402 node ace test` passes with 12 new tests; `pnpm check`, `pnpm typecheck` and `pnpm build` are clean; `pnpm migrate` leaves `database/schema.ts` unchanged; `node ace codegen` changes nothing. The user, with `pnpm dev` and `pnpm worker` running: `node ace queue:scheduler:list` shows `sweep-expired-quotes`, and its run count goes up every 5 minutes.
