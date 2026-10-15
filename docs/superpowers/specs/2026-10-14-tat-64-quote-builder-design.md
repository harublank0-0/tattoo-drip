# Quote builder: fixed or hourly, deposit, expiry, revisions

Date: 2026-10-14
Refs: TAT-64. Its blocker TAT-37 (project models, PR #16) is merged. It also needs `SessionService` from TAT-36 (PR #17, open), so implementation starts after PR #17 merges. Related: TAT-46 (inbox and project board), TAT-65 (deposit page), TAT-52 (message templates), TAT-66 (balance due).

## Goal

Staff can quote a project, revise the quote, and mark it accepted from the dashboard, and the project's status follows: issuing a quote moves the project to `quoted`, the client's acceptance moves it to `deposit_pending`, and an expired quote cancels a project that was never accepted or never paid. After issuing, one tap opens WhatsApp or Viber with the quote prefilled for the client.

This ticket adds the projects module's first services (`QuoteService` and `ProjectService`), an expiry job, three dashboard routes and a bare project page. It has no API, SDK or OpenAPI changes and no migration.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| UI scope | Quote service, plus a bare project page holding the quote form, history and one-tap links. TAT-46 grows the page | There is no project page yet; this gives a usable screen without taking TAT-46's board, inbox and notes |
| What moves `quoted` to `deposit_pending` | Staff tap "Client accepted"; the project moves to `deposit_pending` and `settleBooking` runs | `quoted` keeps meaning "waiting for the client's answer". `architecture.md` said sending moves straight to `deposit_pending`; it is corrected |
| Which projects expiry cancels | `quoted` and `on_hold` unless a non-zero deposit was already paid, and `deposit_pending` whose deposit is not settled. Their scheduled sessions are cancelled too | Matches "a quote's expiry moves an unpaid project to `cancelled`" and frees held artist time. A paid deposit is never cancelled by expiry, including on a `quoted` project that staff revised after the client paid (found in review); a zero deposit after acceptance is spared too, but a zero-deposit quote nobody accepted is cancelled |
| Drafts | None. Saving the form issues the next version; `created_at` is the issue time; no `sent_at` column | Keeps "the current quote is the highest version" true and quotes immutable after insert |
| Revisions | Allowed in `reviewing`, `quoted`, `on_hold`, `deposit_pending`; the project becomes `quoted`, so a revision after acceptance must be accepted again. Locked from `booked` on | Verified payments still count toward the new deposit. Mid-project price changes are TAT-66's balance work |
| Who | Owners, and the artist assigned to the project (their user is linked to the project's artist profile) | The requirements' role table: artists act on projects assigned to them |
| One-tap quote message | Built now: a fixed English text and WhatsApp/Viber links. TAT-52 later folds it into editable templates | The ticket asks for it; a pure function is cheap to move |
| Expiry mechanism | A delayed `ExpireQuoteJob` per issued quote, queued in the issuing transaction | Fits RLS and `TenantJob` without a cross-tenant sweep or schedule registration. A periodic sweep and check-on-read were rejected |

## Module layering

The projects module (`app/modules/projects/`) gets two services, so that no class depends on itself through another module. Today `SessionService` (scheduling) calls `DepositService` (payments); `DepositService` will call `QuoteService`; the lifecycle moves need `SessionService` and `DepositService`.

```text
ProjectService (projects)    -> SessionService, DepositService, QuoteService
SessionService (scheduling)  -> DepositService
DepositService (payments)    -> QuoteService
QuoteService (projects)      -> nothing outside the module
```

- **`QuoteService`** (`services/quote_service.ts`) depends on nothing outside the module. It owns quote rows.
- **`ProjectService`** (`services/project_service.ts`) owns project lookup and the lifecycle moves that belong to quotes. TAT-46 adds its own moves (hold, resume, decline, notes) here.
- Both are `@inject()` services like `SessionService`: every call takes the tenant, every write runs in `withTransaction`, and an unknown, deleted or other-tenant id is E_ROW_NOT_FOUND (a 404).
- Pure helpers (`quoteTotal`, `defaultDeposit`, `expiresAtFor`, `quoteMessage`, `chatLinks`) live in `app/modules/projects/quotes.ts` so they can be unit-tested and shared with the page props.

## `QuoteService`

| Operation | Rule |
|---|---|
| `current(tenant, project)` | The project's highest `version`, or null |
| `history(tenant, project)` | All versions, newest first |
| `create(tenant, project, input)` | Inserts version `max + 1` (1 for the first). The caller holds the project's row lock, so two concurrent saves cannot take the same version; the `(project_id, version)` unique key backs it up |

- **`DepositService.isSettled`** reads the current quote through `QuoteService.current` instead of the `Quote` model (the TAT-36 carry-forward). Behavior is unchanged, including the currency filter.
- **`quoteTotal(quote)`** returns the total in paisa as a `bigint`: the fixed price, or `round(hourly_rate × estimated_minutes / 60)` rounded half away from zero, matching the `quotes_deposit_within_total` check. Bigint because a stored quote's product can exceed 2^53 (see backend conventions). The page formats it from the bigint.

## `ProjectService`

| Operation | Rule |
|---|---|
| `findFor(tenant, member, id)` | Owners see every live project of the tenant. An artist sees a project only when its `artist_id` is a live artist profile whose `user_id` is theirs. Anything else is a 404 |
| `issueQuote(tenant, project, input, baseQuoteId)` | Locks the project. Allowed in `reviewing`, `quoted`, `on_hold`, `deposit_pending`; any other status throws `QuoteRuleError("project_closed")`. `baseQuoteId` is the quote the form showed (null for a first quote): when the current quote is a different one the save is refused (`"quote_changed"`), so a stale form can't resurrect old terms (found in review). The expiry is checked before and again after the lock (`"expired"`). Creates the next version, sets the project to `quoted`, and queues `ExpireQuoteJob` in the same transaction. Returns the quote |
| `acceptQuote(tenant, project, quoteId)` | Locks the project. Requires `quoted` (`QuoteRuleError("not_quoted")`), that `quoteId` is the current quote (`"quote_changed"`: someone revised it since the page loaded), and that the quote has not expired (`"expired"`). Sets `deposit_pending`, then calls `SessionService.settleBooking` in the same transaction, so a settled deposit (or a zero one) with a scheduled tattoo session books at once |
| `expireQuote(tenant, projectId, quoteId)` | Locks the project. Does nothing when the project is missing or deleted, when `quoteId` is not the current quote, or when the quote has not expired. Otherwise cancels the project if it is `quoted` or `on_hold` (unless the quote's deposit is non-zero and `DepositService.isSettled`), or `deposit_pending` with `DepositService.isSettled` false; first it cancels each of the project's `scheduled` sessions through `SessionService.cancel`. Any other status: nothing. Returns whether it cancelled |

- **Expired** means now ≥ `expires_at`.
- **Locking.** Each operation runs `SELECT ... FOR UPDATE` on the project row first, the same order as `SessionService`, whose nested `withTransaction` calls become savepoints that re-lock the row already held.
- **Errors** (`app/modules/projects/errors.ts`): `QuoteRuleError` with a reason (`project_closed`, `not_quoted`, `quote_changed`, `expired`), thrown after the failed savepoint has rolled back. Messages are for developers; the controller writes the flash text.

## Input and validation

A VineJS validator (`app/modules/projects/validators/quote.ts`), in the form's units, converted to the stored units by the controller:

| Field | Rule |
|---|---|
| `kind` | `fixed` or `hourly` |
| `fixedPrice` | Fixed only: whole rupees, 1 to 10,000,000 |
| `hourlyRate` | Hourly only: whole rupees per hour, 1 to 100,000 |
| `estimatedHours` | Hourly only: 0.25 to 100, in steps of 0.25; stored as minutes |
| `depositAmount` | Whole rupees, 0 to the total |
| `expiresOn` | A date from today to one year ahead, in the tenant's timezone |

- The caps keep `rate × minutes` far below 2^53, so the validator's total check can use JavaScript numbers; stored quotes are still totalled in bigint.
- **Currency** is always NPR; USD is V1.
- **`expiresAtFor(date, timezone)`**: the start of the following day in the tenant's timezone, so "expires 28 Oct" is valid through the end of 28 Oct locally.
- **`defaultDeposit(total, percent)`**: the tenant's `default_deposit_percent` of the total, rounded to whole rupees and never above the total; 0 when the percent is null.

## `ExpireQuoteJob`

`app/modules/projects/jobs/expire_quote_job.ts`, a `TenantJob` with payload `{ tenantId, projectId, quoteId }`.

- `issueQuote` queues it with `dispatchInTransaction(ExpireQuoteJob.dispatch(payload).in(delay), trx)`, the delay running to `expires_at`, so a rolled-back save leaves no job. **To verify first in the plan:** that a delayed dispatch passes through `dispatchInTransaction`; if not, use the library's "run at" option the same way.
- `handle()` only calls `ProjectService.expireQuote`. Because that re-checks everything under the lock, superseded quotes, repeats and deleted projects are no-ops; old jobs from revisions are left to run and do nothing.
- Retries are the queue defaults (3, exponential). `failed()` logs `tenantId`, `projectId` and `quoteId` under named keys.

## Routes and access

Inertia dashboard routes in the tenant group (auth, dbContext, tenant middleware) with `middleware.role({ allow: ["owner", "artist"] })`; `ProjectService.findFor` then hides other artists' projects.

| Route | Controller | Does |
|---|---|---|
| `GET /t/:tenant/projects/:project` | `ProjectsController.show` | The project page |
| `POST /t/:tenant/projects/:project/quotes` | `QuotesController.store` | `issueQuote`: first quote or revision |
| `POST /t/:tenant/projects/:project/quotes/accept` | `QuotesController.accept` | `acceptQuote` with the posted `quoteId` |

- Validation errors return as field errors; a `QuoteRuleError` returns as a flash error: `project_closed` "This project can no longer be quoted", `not_quoted` "This project is not waiting for the client's answer", `quote_changed` "The quote changed: check the new version", `expired` "This quote has expired: revise it first".
- Each route gets a case in `tests/isolation/cases.ts`. `node ace codegen` after the route changes; the generated files ship with the change.

## Project page

`inertia/pages/projects/show.tsx`, mobile-first, from the existing shadcn components ([UI conventions](../../../apps/platform/docs/ui.md)). Props come through a transformer in `app/transformers/`.

- **Header:** client name, status badge, assigned artist, brief.
- **Current quote:** version, price (fixed) or "NPR 3,000/hour × about 5 h ≈ NPR 15,000" (hourly), deposit, expiry and issue date. An "Expired" label when `expires_at` has passed, whatever the job has done. A **Client accepted** button when the project is `quoted` and the quote has not expired.
- **One-tap links** when the client has a phone: **WhatsApp** (`https://wa.me/<digits>?text=…`) and **Viber**, prefilled by `quoteMessage`: "Hi {first name}, here is your quote from {studio}: {total}. Deposit: {amount}. Valid until {date}. Reply here to confirm." A zero deposit reads "No deposit needed." **To verify in the plan:** a Viber link that opens the client's chat with the text prefilled; if none is reliable, open the chat without text.
- **Quote form** ("Issue quote", then "Revise quote"), only in statuses that allow quoting: a fixed or hourly toggle; the price, or a rate and estimated hours with a live estimated total; the deposit, prefilled by `defaultDeposit` and editable, with "No deposit step" shown at 0; the expiry date, defaulting to 14 days from today in the studio's timezone.
- **History:** earlier versions with total, deposit, expiry and issue date.
- **Reaching it:** no projects list or navigation (TAT-46's board). A development-only seeder (`database/seeders/`, `node ace db:seed`, refusing to run outside development) gives each tenant with no project a demo client and a `reviewing` project, inside that tenant's database context.

## Tests

- **Unit:** `quoteTotal` (fixed, hourly, half-away rounding, values past 2^53); `defaultDeposit` (rounding, null percent, never above the total); `expiresAtFor` (end of the local day, a non-UTC timezone); `quoteMessage` and `chatLinks` (zero deposit, hourly wording, phone digits); the validator (caps, hourly and fixed fields, deposit above the total, past and far-future dates).
- **`QuoteService`:** versions count up per project; `current` and `history`; another tenant's project sees nothing.
- **`ProjectService`:** `findFor` for an owner, the assigned artist, another artist and another tenant; `issueQuote` in each status (four allowed, the rest refused) and the move to `quoted`, including from `deposit_pending`; the job is queued, and a rolled-back save leaves none; `acceptQuote` refuses outside `quoted`, a superseded `quoteId` and an expired quote, and with a zero deposit and a scheduled tattoo session it books; `expireQuote` for each row of the cancel rule, a settled deposit and a zero deposit after acceptance spared, scheduled sessions cancelled, a superseded or not-yet-expired quote ignored, a second run a no-op, a missing project a no-op.
- **`ExpireQuoteJob`:** runs in its tenant's context and calls `expireQuote`; fails without a `tenantId`.
- **HTTP:** the page's props; field errors; each flash error; accept; an unassigned artist gets a 404.
- **Isolation:** the three routes in `tests/isolation/cases.ts`.
- **Regression:** the deposit and session specs pass with `DepositService` reading through `QuoteService`.
- **Not tested:** the project row lock under real concurrency (the harness shares one connection), as in TAT-36.

## Docs

- `docs/architecture.md` (the deposit flow): staff send the quote (`quoted`); when the client agrees, staff mark it accepted (`deposit_pending`) and the deposit link goes out.
- `docs/requirements.md` (project rules): accepting moves `quoted` to `deposit_pending`; a revision moves the project back to `quoted`; expiry cancels unpaid projects and their scheduled sessions.
- `docs/data-model.md` (Quote row): no drafts, `created_at` is the issue time.
- `apps/platform/docs/backend.md`: a projects paragraph for the two services, the layering and the job; the "no services yet" note narrows to clients and inquiries. The quotes migration's comment about `sent_at` stays (migrations that ran are not edited).

## Carry-forwards

Posted as Linear comments when the PR is ready: TAT-46 (expiry is done; the project page and `ProjectService` are its starting point; `on_hold` and its return to `quoted` are its own), TAT-65 (the deposit link comes after acceptance; `DepositService` reads `QuoteService`), TAT-52 (fold `quoteMessage` into its templates).

## Not in this ticket

The board, inbox, `on_hold`, decline, notes and project navigation (TAT-46); editable message templates (TAT-52); balance due and mid-project price changes (TAT-66); the deposit page (TAT-65); USD (V1); reviving a cancelled project; API, SDK and OpenAPI changes; any migration.

## Assumptions the user can overrule at review

Whole-rupee amounts; the caps in the validator table; quarter-hour estimates; a 14-day default expiry; expiry at the end of the chosen local day; the deposit default rounded to whole rupees; accept posts the `quoteId` it was shown; expiry cancels every scheduled session of the project, consultations included; the message text and its English-only wording; a dev seeder rather than a projects list.

## Verification

`PORT=3402 node ace test` passes, including the isolation cases and the new specs. `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. A browser pass on the seeded project: issue a fixed and an hourly quote, revise, open both chat links, accept, and see an expired quote's label. Then the whole-branch review and the Codex code and security reviews before the PR.
