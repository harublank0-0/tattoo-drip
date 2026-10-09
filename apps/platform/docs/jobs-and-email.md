# Jobs and email conventions

Read before changing workers, queued jobs, delivery or mail templates. For jobs that change tenant-owned data, also read the relevant [backend](backend.md) section; for new tests consult [testing](testing.md).

## Emails

- Emails are Edge templates with inline styles and table layout: no `<style>` blocks, CSS inliner or MJML.
- Shared parts are components in `resources/views/components/email/`. Wrap every email in `@email.layout({ title, preheader })` and use `@!email.button({ href, text })` for calls to action.
- Each email is a `BaseMail` class in `app/modules/<module>/emails/`, next to an HTML template and a `_text` template. HTML templates print with `{{ }}`; text templates print with `{{{ }}}` so URLs keep their `&`. Guard optional values: Edge prints `undefined` and `null` literally.
- Mail classes never set `from`; `config/mail.ts` always sends from the platform's domain.
- A module with templates needs one `edge.mount("<module>", …)` line in `start/view.ts`; its templates are then `<module>::emails/<name>`. `metaFiles` in `adonisrc.ts` copies `app/modules/**/*.edge` into the build.
- Send with `mail.sendLater(...)`: the messenger in `start/mail.ts` queues a `SendMailJob` that the worker sends. Use `mail.send(...)` only inside a job. An email that must go out only if a transaction commits is sent from a domain job queued with `dispatchInTransaction`.
- Template data is stored as JSON until the worker renders it: templates see serialized fields only (`user.fullName` works; getters and methods don't, and dates become strings). Pass plain values for anything computed.
- Queued mail can't carry `Buffer` or stream attachments; they don't survive JSON. Attach by file `path` or URL, or build the email inside a job and use `mail.send`.
- In development, run `pnpm worker` next to `pnpm dev`, or queued emails never reach Mailpit.

## Jobs

- `@adonisjs/queue` with the `database` driver: jobs are rows in `queue_jobs` in the app's own Postgres, run by a separate worker (`pnpm worker`, i.e. `node ace queue:work`). It doesn't reload on code changes; restart it after editing a job.
- Shared plumbing such as `SendMailJob` lives in `app/jobs/` (`#jobs/*`). Domain jobs live in `app/modules/<module>/jobs/`. The worker loads every file in those folders as a job, so put nothing else there.
- Defaults in `config/queue.ts`: 3 retries with exponential backoff (5s up to 5m); completed jobs are deleted, failed jobs stay 7 days with their error. Retries must be the top-level `retry` key: a `retry` inside `defaultJobOptions` is silently ignored (`tests/unit/jobs/queue_config.spec.ts` pins this). `SendMailJob` keeps failed rows for 1 day only, because its payload holds links that work like passwords. Delivery is at-least-once: a worker stopped mid-job reruns it, so make jobs safe to repeat. A job's `failed()` hook runs once retries are used up; log identifying fields under named keys (`err` for the error), never whole objects or secrets.
- Queue a job that belongs to a database write with `dispatchInTransaction(Job.dispatch(payload), trx)` from `#services/queue`, so it commits or rolls back with the data. Don't call `.with()` on that dispatcher; the helper picks the adapter, and it throws if two copies of `@boringnode/queue` are installed.
- Jobs that touch tenant-owned data carry `tenantId` in their payload. TAT-28 runs them in tenant context.
- `@adonisjs/queue` (0.6.2) and `@boringnode/queue` (0.6.0) are pinned to exact versions, and `overrides` in `pnpm-workspace.yaml` forces a single copy of `@boringnode/queue`. Upgrade all three together, then check `pnpm why @boringnode/queue` shows one version.
- The only driver is `database`; there is no `sync` driver, because it would run jobs inside the request, before a transaction commits and without the JSON round trip.
- Tests: fake the queue with `queue.fake()` and assert with `fake.assertPushed(Job, { payload })`; run a job directly with `new Job()`, `$hydrate(payload, context)` and `execute()`. Restore fakes in `group.each.teardown`.
