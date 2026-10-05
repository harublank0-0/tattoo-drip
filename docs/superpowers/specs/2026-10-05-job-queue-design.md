# Job queue, worker, and email through the queue

Date: 2026-10-05
Refs: TAT-7

## Goal

Run background work in a separate worker process, backed by the platform's own Postgres, and send every email through it instead of inside the request. Jobs can also be queued inside a database transaction, so they commit or roll back with the data that caused them.

## Decisions

- `@adonisjs/queue` with its `database` driver. No Redis, no SQS, no pg-boss. A feasibility check on 2026-10-05 against Postgres 18 and Mailpit confirmed each point below.
- Transactional dispatch works by passing `.with(knex(trx.knexClient))` to a dispatcher. It needs `@boringnode/queue` as a direct dependency, pinned to the same version `@adonisjs/queue` installs, so there is only one copy.
- `database` is the driver in development, tests and production. `sync` stays configured as a fallback but is not the default anywhere.
- Tenant context for jobs moves to TAT-28. TAT-7 only sets the rule that tenant-scoped jobs carry `tenantId` in their payload.
- Shared queue plumbing lives in `app/jobs/`. Domain jobs live in `app/modules/<module>/jobs/`.
- App code sends email with `mail.sendLater`. `mail.send` is only for code that already runs inside a job.
- The transactional dispatch helper is built now, with tests, before any domain job needs it.

## Feasibility findings (2026-10-05)

| Requirement | Result |
|---|---|
| Queue a job in a transaction | A commit kept both the job and the data; a rollback kept neither |
| Retries, failed jobs visible | A failing job was retried twice, then marked `failed`, with its error kept in `queue_jobs` when `removeOnFail` is not `true` |
| Concurrency | Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several workers are safe |
| Worker | `node ace queue:work` |
| `mail.sendLater` through the queue | `VerifyEmailMail` reached Mailpit with "Hi Ada Ink,". The `User` in the view data serialized to `{email, fullName}`, without the password |
| Tenant context hook | `config/queue.ts` is passed whole to `QueueManager.init`, so an `executionWrapper` there runs around every job |

Risk: `@adonisjs/queue` is 0.6.2 and `@boringnode/queue` 0.6.0, so breaking changes are likely before 1.0. Both are pinned exactly.

## Section 1: local Postgres, queue setup, worker

### Local Postgres fix (done first)

`podman-compose` 1.3.0 resolves `${VAR}` inside a service from that service's own `environment:` when the service defines `VAR`. Because the compose file has `POSTGRES_USER: ${POSTGRES_USER:-postgres}`, Postgres receives the literal text `${POSTGRES_USER:-postgres}` and crash-loops on `initdb`.

Fix: the `postgres` service uses literal values that match `.env.example`:

- `POSTGRES_USER: postgres`
- `POSTGRES_PASSWORD: postgres`
- `POSTGRES_DB: tattoo_drip`
- healthcheck `pg_isready -U postgres -d tattoo_drip`

`POSTGRES_DB: tattoo_drip` creates the dev database on first start, so the README's `createdb` step goes away. The ports keep their `${…:-…}` form, which resolves correctly.

### Packages and configuration

- Add `@adonisjs/queue@0.6.2` and `@boringnode/queue@0.6.0`, exact versions.
- Run `node ace configure @adonisjs/queue` and choose `database`. It registers the provider and commands, adds `QUEUE_DRIVER` to `.env`, `.env.example` and `start/env.ts`, and creates `config/queue.ts`, `start/scheduler.ts` and the migration for `queue_jobs` and `queue_schedules`.
- Then:
  - remove `start/scheduler.ts` and its preload, since nothing is scheduled yet
  - set `drivers.database({ connectionName: "pg" })`
  - set `locations` to `./app/jobs/**/*.{ts,js}` and `./app/modules/*/jobs/**/*.{ts,js}`
  - set the default job options to `retry: { maxRetries: 3, backoff: exponentialBackoff({ baseDelay: "5s", maxDelay: "5m" }) }` and `removeOnFail: { age: "7d" }`. Jobs can override both.

### Worker

- Add `"worker": "node ace queue:work"` to `apps/platform/package.json`.
- Development: run `pnpm worker` in a second terminal next to `pnpm dev`. The worker does not reload on code changes, so restart it after editing a job.
- Production: a second container running the same command, as `docs/architecture.md` already describes.

## Section 2: email through the queue

### `SendMailJob` (`app/jobs/send_mail_job.ts`)

- Payload `{ mailerName, mailMessage, sendConfig }`: what `@adonisjs/mail` passes to a messenger.
- `execute()` calls `mail.use(mailerName).sendCompiled(mailMessage, sendConfig)`. Templates are rendered in the worker at send time.
- Uses the default retries (3, exponential backoff from 5s to 5m), which ride out short SMTP outages.
- `failed()` logs the job id, recipient and subject, never the body.

### Messenger (`start/mail.ts`, a new preload)

```ts
mail.setMessenger((mailer) => ({
  queue: (mailMessage, sendConfig) =>
    SendMailJob.dispatch({ mailerName: mailer.name, mailMessage, sendConfig }).run(),
}))
```

Every `mail.sendLater(...)` becomes a `queue_jobs` row.

### Rules

- Request handlers and services use `mail.sendLater(...)`. `mail.send(...)` is only used inside jobs.
- An email that must only go out if a transaction commits is sent by a domain job, queued with the Section 3 helper. That job calls `mail.send`.
- Template data goes through JSON. Templates only see serialized fields: `user.fullName` works, but model getters and methods are gone by the time the worker renders. Pass plain values for anything computed.
- Completed jobs are deleted immediately (the library default). Failed jobs, including recipient and template data, are kept for 7 days, then pruned.

## Section 3: transactional dispatch, tests, docs

### `dispatchInTransaction` (`app/services/queue.ts`)

- `dispatchInTransaction(dispatcher, trx)` takes a dispatcher, so callers keep the library's chaining:
  `await dispatchInTransaction(AlertStaffJob.dispatch(payload).toQueue("alerts"), trx)`.
- With the `database` driver it adds `.with(knex(trx.knexClient))` and runs the dispatcher, so the job row commits or rolls back with `trx`.
- With the `sync` driver, or when the queue is faked in tests, it dispatches normally. How to detect a faked queue is checked against the installed package before writing it.
- It lives outside `app/jobs/` so the job loader never tries to load it as a job.

### Tenant rule

Jobs that touch tenant-owned data put `tenantId` in their payload. TAT-28 adds the `executionWrapper` that runs each such job in tenant context. TAT-7 only documents the rule.

### Tests

These are the first tests that use the database. They run against the dev database, and each test is wrapped in a transaction that is rolled back afterwards (`testUtils.db().withGlobalTransaction()`). CI already migrates before running tests.

- `dispatchInTransaction`: a job queued in a committed transaction exists; a job queued in a rolled-back transaction doesn't; with the `sync` driver it falls back to a normal dispatch.
- Messenger: with the queue faked, `mail.sendLater(new VerifyEmailMail(...))` queues one `SendMailJob` addressed to the user.
- `SendMailJob`: with `mail.fake()`, executing the job sends the message.
- CI's existing schema check covers the regenerated `database/schema.ts`.

### Docs

- `apps/platform/AGENTS.md`:
  - a new Jobs section: where jobs live, `pnpm worker`, retries and failed-job retention, when to use `dispatchInTransaction`, and the `tenantId` rule
  - the Emails section: the `sendLater` rule, the JSON note, and that `pnpm worker` must run for mail to reach Mailpit
  - `pnpm worker` under Commands
- `docs/architecture.md`: the queue is `@adonisjs/queue` with the database driver.
- `README.md`: the Postgres step without `createdb`, plus `pnpm worker`.

### Linear

- TAT-7: the tenant-context checkbox becomes "jobs that touch tenant data carry `tenantId` (documented)".
- TAT-28: add "run each job in tenant context through the queue `executionWrapper`".

## How the work is done

The user writes the code. The plan is a step-by-step guide: what to write in which file, why, and the commands that verify each step. After each step, the user's code is reviewed against the plan before moving on.

## Out of scope

- Tenant context and row-level security for jobs (TAT-28).
- Domain jobs such as the inquiry staff alert, and image processing jobs.
- Scheduled jobs (`start/scheduler.ts`).
- Wiring `VerifyEmailMail` to a signup flow (TAT-18).
- Production deployment of the worker container.
- A separate test database.
