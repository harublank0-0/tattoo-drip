# Expiry safety net for ExpireQuoteJob (TAT-83) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An expired current quote on a `quoted`, `on_hold` or unpaid `deposit_pending` project gets its project cancelled within about 7 minutes of the expiry, even when its `ExpireQuoteJob` fired early, used up its retries, or was never queued.

**Architecture:** `ProjectService.expireQuote` queues the job again when it runs before the expiry (under the project lock, in the job's transaction). A SECURITY DEFINER function `expired_quote_candidates()` lists the ids of expired current quotes across tenants; `SweepExpiredQuotesJob` (a plain job, every 5 minutes, scheduled by a `web`-only preload) queues one `ExpireQuoteJob` per row in that row's tenant, so `expireQuote` still makes every decision.

**Tech Stack:** AdonisJS 7, `@adonisjs/queue` 0.6.2 / `@boringnode/queue` 0.6.0 (database driver, `queue_schedules`), Lucid 22 / PostgreSQL 18, luxon, Japa.

**Spec:** `docs/superpowers/specs/2026-10-17-tat-83-expiry-safety-net-design.md`

## Global Constraints

- Function: `public.expired_quote_candidates()`, no arguments, `returns table (tenant_id uuid, project_id uuid, quote_id uuid)`, `language sql stable security definer`, `set search_path = pg_catalog, pg_temp`, SQL-standard body (`begin atomic … end`), every table schema-qualified. `revoke all … from public`; `grant execute … to` the app role named by `DB_USER`.
- Candidate: the project's current quote (highest `version`) with `expires_at <= statement_timestamp() - interval '2 minutes'` and `expires_at > statement_timestamp() - interval '24 hours'`, on a project with `deleted_at is null` and `status in ('quoted', 'on_hold', 'deposit_pending')`. Nothing else is decided in SQL.
- Migration file: `apps/platform/database/migrations/1791620000000_create_expired_quote_candidates_function.ts`; it also creates index `quotes_expires_at_index` on `quotes (expires_at)`.
- Sweep: `SweepExpiredQuotesJob` in `apps/platform/app/modules/projects/jobs/sweep_expired_quotes_job.ts`, schedule id `sweep-expired-quotes`, cron `*/5 * * * *`, timezone UTC (the default). It queues `ExpireQuoteJob` with payload `{ tenantId, projectId, quoteId }` from each row and touches no tenant table.
- The early-run re-queue uses luxon `DateTime.now()` (the clock `isExpired` reads) and the same payload, through `dispatchInTransaction` inside `expireQuote`'s transaction.
- No route, page, controller, OpenAPI, SDK or env var change. `node ace codegen` must change nothing; `pnpm migrate` must leave `database/schema.ts` unchanged.
- Commands run from `apps/platform` unless stated. Tests use `PORT=3402`. A spec that imports a missing module hangs Japa after the error, so RED steps run as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts > <log> 2>&1; echo "exit $?"`, with logs in `/tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/`. Exit 124 plus "Cannot find module" in the log is the expected RED for a missing module. Don't wrap commands in `sh -c`, and don't read `.env`. `pnpm typecheck` is the authority over editor diagnostics.
- Locally the dev server and the tests share the `tattoo_drip` database. The definer function sees every tenant's committed rows, so specs filter its output to their own tenants and assert pushed jobs by payload, never by total count of a sweep.
- Biome formats (tabs, double quotes, trailing commas, sorted imports). The pre-commit hook may rewrite staged files, so re-Read a file before the next Edit.
- Commits are Conventional Commits with the `platform` scope. Each ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line from the builder's session reminder). Never push or open a PR (run brief).

## Review Focus

1. A clock stepped back further than the remaining time, so the re-queued job is early again. Expected: it queues once more for what's left, never a tight loop. (Task 1 early-run test, second early run.)
2. A payload naming studio A with studio B's project and quote. Expected: nothing in B changes. (Task 1, forged-payload test.)
3. The database clock ahead of the worker's by more than the 2-minute grace, so the sweep queues a job for a quote the worker still sees as valid. Expected: that job re-queues, it doesn't cancel early. (The sweep queues the plain `ExpireQuoteJob`; Task 1's early-run test covers exactly that run.)
4. A paid-deposit project with an expired quote, which every sweep lists for 24 hours. Expected: never cancelled. (Task 3 worker test.)
5. A schedule the local dev server left in the shared database. Expected: it never runs inside a test. (Task 4 test.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-83-expiry-safety-net-an-early-or-failed-expirequotejob-leaves` (stacked on TAT-8 at e946104, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Postgres is up and migrated. Baseline: `PORT=3402 timeout 180 pnpm test functional --files=expire_quote_job.spec.ts --files=project_service.spec.ts --files=catalog_guard.spec.ts --files=process_queued.spec.ts`. Expected: PASS. The full suite was 753 passing on e946104.

---

### Task 1: An early run queues the job again

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts` (`issueQuote`, `expireQuote` and its doc comment, new module function `queueExpiry`)
- Modify: `apps/platform/app/modules/projects/jobs/expire_quote_job.ts` (doc comment)
- Test: `apps/platform/tests/functional/projects/expire_quote_job.spec.ts` (rewrite: keeps the existing test, adds 2)
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts` (the "ignores a quote that has not expired…" test, plus a queue teardown in its group)

**Interfaces:**
- Produces: `expireQuote(tenant, projectId, quoteId): Promise<boolean>` keeps its signature. When `quoteId` is the current quote and `isExpired(quote)` is false, it queues `ExpireQuoteJob` with `{ tenantId: tenant.id, projectId: quote.projectId, quoteId: quote.id }` delayed by `max(0, expiresAt - DateTime.now())` ms, and returns false. Module function `queueExpiry(trx, tenant, quote)` in `project_service.ts` (not exported).

- [ ] **Step 1: Write the failing job tests**

Replace the whole of `apps/platform/tests/functional/projects/expire_quote_job.spec.ts` with:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime, Settings } from "luxon";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import TattooProject from "#modules/projects/models/tattoo_project";
import { dispatchInTransaction } from "#services/queue";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

type TenantRef = { id: string };
type Payload = { tenantId: string; projectId: string; quoteId: string };

/** The test's global transaction, which the test worker reads. */
const trx = () => db.connection() as TransactionClientContract;

/** A `quoted` project in `tenant` whose only quote expires at `expiresAt`. */
function quotedProject(tenant: TenantRef, expiresAt: DateTime) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "quoted",
		});
		const quote = await makeQuote(tenant, project, { expiresAt });
		return { project, quote };
	});
}

/** The project's status, read in its own tenant. */
const statusIn = (tenant: TenantRef, project: TattooProject) =>
	inTenant(
		tenant,
		async () => (await TattooProject.findOrFail(project.id)).status,
	);

/** Runs the job the way the worker does, without the queue. */
async function runJob(payload: Payload) {
	const job = new ExpireQuoteJob();
	job.$hydrate(payload, {
		jobId: "expire-quote-spec",
		name: "ExpireQuoteJob",
		attempt: 1,
		queue: "default",
		priority: 0,
		acquiredAt: new Date(),
		stalledCount: 0,
	});
	await job.execute();
}

test.group("ExpireQuoteJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ExpireQuoteJob));

	test("cancels the project in the payload's tenant once its quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, quote } = await quotedProject(
			tenant,
			DateTime.utc().minus({ minutes: 1 }),
		);

		await dispatchInTransaction(
			ExpireQuoteJob.dispatch({
				tenantId: tenant.id,
				projectId: project.id,
				quoteId: quote.id,
			}),
			trx(),
		);
		await processQueued();

		assert.equal(await statusIn(tenant, project), "cancelled");
	});

	test("a payload naming another tenant's project changes nothing there", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		const { project, quote } = await quotedProject(
			b.tenant,
			DateTime.utc().minus({ hours: 1 }),
		);

		await dispatchInTransaction(
			ExpireQuoteJob.dispatch({
				tenantId: a.tenant.id,
				projectId: project.id,
				quoteId: quote.id,
			}),
			trx(),
		);
		await processQueued();

		assert.equal(await statusIn(b.tenant, project), "quoted");
	});
});

test.group("ExpireQuoteJob, an early run", (group) => {
	const realNow = Settings.now;
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		Settings.now = realNow;
		queue.restore();
	});

	test("queues itself again for the rest of the time, then cancels at the expiry", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();
		const start = DateTime.utc();
		const { project, quote } = await quotedProject(
			tenant,
			start.plus({ minutes: 10 }),
		);
		const payload = {
			tenantId: tenant.id,
			projectId: project.id,
			quoteId: quote.id,
		};

		// The worker's clock reads ten minutes before the expiry.
		Settings.now = () => start.toMillis();
		await runJob(payload);
		assert.equal(await statusIn(tenant, project), "quoted");
		fake.assertPushed(ExpireQuoteJob, {
			payload,
			delay: (delay) => delay === 10 * 60_000,
		});

		// Still early (a clock stepped back further): once more, for what's left.
		Settings.now = () => start.plus({ minutes: 4 }).toMillis();
		await runJob(payload);
		assert.equal(await statusIn(tenant, project), "quoted");
		fake.assertPushed(ExpireQuoteJob, {
			payload,
			delay: (delay) => delay === 6 * 60_000,
		});

		// The queued run, once the clock reaches the expiry.
		Settings.now = () => quote.expiresAt.toMillis();
		await runJob(payload);
		assert.equal(await statusIn(tenant, project), "cancelled");
		fake.assertPushedCount(2);
	});
});
```

- [ ] **Step 2: Update the service test**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, in `test.group("ProjectService.expireQuote", (group) => {`, add a teardown under the existing setup line:

```ts
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());
```

Then replace the whole test `"ignores a quote that has not expired or is no longer current"` with:

```ts
	test("queues an early run again, and ignores a quote that is no longer current", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const live = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().plus({ days: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, project.id, live.id));
			const expected = live.expiresAt.toMillis() - Date.now();
			fake.assertPushed(ExpireQuoteJob, {
				payload: {
					tenantId: tenant.id,
					projectId: project.id,
					quoteId: live.id,
				},
				delay: (delay) =>
					delay !== undefined && Math.abs(delay - expected) < 60_000,
			});

			// v1's job runs after v2 replaced it; v2 has expired too, but v2's own
			// job decides that. Nothing is queued for v1.
			const revised = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const v1 = await makeQuote(tenant, revised, {
				version: 1,
				expiresAt: DateTime.utc().minus({ days: 2 }),
			});
			await makeQuote(tenant, revised, {
				version: 2,
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, revised.id, v1.id));
			fake.assertPushedCount(1);

			assert.equal(await statusOf(project), "quoted");
			assert.equal(await statusOf(revised), "quoted");
		});
	});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm test functional --files=expire_quote_job.spec.ts --files=project_service.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat83-t1-red.log 2>&1; echo "exit $?"`
Expected: exit 1. Exactly 2 failures, both "Expected job to be pushed for "ExpireQuoteJob" with matching payload…": the early-run test and "queues an early run again…". The forged-payload test and every other test pass (the forged-payload test pins existing isolation the sweep relies on).

- [ ] **Step 4: Implement the re-queue**

In `apps/platform/app/modules/projects/services/project_service.ts`:

In `issueQuote`, replace

```ts
			await setStatus(live, "quoted");
			await dispatchInTransaction(
				ExpireQuoteJob.dispatch({
					tenantId: tenant.id,
					projectId: live.id,
					quoteId: quote.id,
				}).in(Math.max(0, quote.expiresAt.toMillis() - Date.now())),
				trx,
			);
			return quote;
```

with

```ts
			await setStatus(live, "quoted");
			await queueExpiry(trx, tenant, quote);
			return quote;
```

In `expireQuote`, replace

```ts
			const quote = await this.quotes.current(tenant, project);
			if (!quote || quote.id !== quoteId || !isExpired(quote)) return false;
			if (!(await this.expiryCancels(tenant, project, quote))) return false;
```

with

```ts
			const quote = await this.quotes.current(tenant, project);
			if (!quote || quote.id !== quoteId) return false;
			if (!isExpired(quote)) {
				// Early: this clock is behind the one that queued the job (skew
				// between hosts, or a clock stepped back). Run again at the expiry
				// instead of finishing.
				await queueExpiry(trx, tenant, quote);
				return false;
			}
			if (!(await this.expiryCancels(tenant, project, quote))) return false;
```

In `expireQuote`'s doc comment, replace

```ts
	 * is free. Anything else, a missing or deleted project included, changes
	 * nothing: the job is safe to repeat, and the jobs of revised quotes do
	 * nothing. Returns whether it cancelled.
```

with

```ts
	 * is free. A run before the current quote's expiry (this process's clock
	 * behind the one that queued the job) queues the job again for the rest
	 * of the time. Anything else, a missing or deleted project included,
	 * changes nothing: the job is safe to repeat, and the jobs of revised
	 * quotes do nothing. Returns whether it cancelled.
```

Add this function right after `async function setStatus(…) { … }` near the end of the file:

```ts
/**
 * Queues ExpireQuoteJob in `trx` for the moment `quote` expires on this
 * process's clock (the one isExpired reads), so the job exists only if the
 * transaction commits.
 */
function queueExpiry(
	trx: TransactionClientContract,
	tenant: TenantRef,
	quote: Quote,
) {
	return dispatchInTransaction(
		ExpireQuoteJob.dispatch({
			tenantId: tenant.id,
			projectId: quote.projectId,
			quoteId: quote.id,
		}).in(Math.max(0, quote.expiresAt.toMillis() - DateTime.now().toMillis())),
		trx,
	);
}
```

(`Quote`, `DateTime`, `TransactionClientContract`, `ExpireQuoteJob` and `dispatchInTransaction` are already imported.)

In `apps/platform/app/modules/projects/jobs/expire_quote_job.ts`, replace the class doc comment with:

```ts
/**
 * Runs once a quote's expiry passes: ProjectService.issueQuote queues it in
 * the issuing transaction, delayed until `expires_at`. ProjectService
 * .expireQuote re-checks everything under the project lock, so the old jobs
 * of revised quotes, a repeat run and a deleted project all do nothing. A
 * run that comes early (this worker's clock behind the issuer's) queues the
 * job again for the rest of the time.
 */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm test functional --files=expire_quote_job.spec.ts --files=project_service.spec.ts`
Expected: PASS (including "queues ExpireQuoteJob to run when the quote expires", which now goes through `queueExpiry`).

Run: `pnpm typecheck`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/modules/projects/services/project_service.ts app/modules/projects/jobs/expire_quote_job.ts tests/functional/projects/expire_quote_job.spec.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): queue an early quote expiry again for the remaining time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The cross-tenant candidates function

**Files:**
- Create: `apps/platform/database/migrations/1791620000000_create_expired_quote_candidates_function.ts`
- Regenerated: `apps/platform/database/schema.ts` (by `pnpm migrate`; expected unchanged, never edit)
- Test: `apps/platform/tests/functional/projects/expired_quote_candidates.spec.ts` (create, 4 tests)
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`DEFINER_FUNCTIONS` and 1 test)

**Interfaces:**
- Produces: SQL `select tenant_id, project_id, quote_id from public.expired_quote_candidates()`, executable by the app role only, rows as `{ tenant_id: string; project_id: string; quote_id: string }`.

- [ ] **Step 1: Write the failing function spec**

Create `apps/platform/tests/functional/projects/expired_quote_candidates.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

type TenantRef = { id: string };
type Candidate = { tenant_id: string; project_id: string; quote_id: string };

/**
 * The function's rows for these tenants only. It sees every tenant's
 * committed rows, and locally the tests share the dev database.
 */
async function candidatesOf(...tenants: TenantRef[]) {
	const ids = new Set(tenants.map(({ id }) => id));
	const { rows } = await sql(
		{},
		"select * from public.expired_quote_candidates()",
	);
	return (rows as Candidate[]).filter(({ tenant_id }) => ids.has(tenant_id));
}

/** A project in `status` whose only quote expires at `expiresAt`. */
function projectWithQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	expiresAt: DateTime,
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		const quote = await makeQuote(tenant, project, { expiresAt });
		return { project, quote };
	});
}

const hourAgo = () => DateTime.utc().minus({ hours: 1 });

const rowOf = (
	tenant: TenantRef,
	{ project, quote }: { project: { id: string }; quote: { id: string } },
): Candidate => ({
	tenant_id: tenant.id,
	project_id: project.id,
	quote_id: quote.id,
});

test.group("expired_quote_candidates()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every tenant's expired current quotes as ids, though the app role alone sees no project", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		const quoted = await projectWithQuote(a.tenant, "quoted", hourAgo());
		const pending = await projectWithQuote(
			b.tenant,
			"deposit_pending",
			hourAgo(),
		);
		const held = await projectWithQuote(b.tenant, "on_hold", hourAgo());

		const { rows } = await sql(
			{},
			"select count(*)::int as n from tattoo_projects",
		);
		assert.equal(rows[0].n, 0);

		assert.sameDeepMembers(await candidatesOf(a.tenant, b.tenant), [
			rowOf(a.tenant, quoted),
			rowOf(b.tenant, pending),
			rowOf(b.tenant, held),
		]);
	});

	test("lists a quote only between 2 minutes and 24 hours after its expiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await projectWithQuote(tenant, "quoted", DateTime.utc().plus({ hours: 1 }));
		await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ seconds: 30 }),
		);
		await projectWithQuote(tenant, "quoted", DateTime.utc().minus({ days: 2 }));
		const inside = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 23 }),
		);

		assert.deepEqual(await candidatesOf(tenant), [rowOf(tenant, inside)]);
	});

	test("leaves out revised quotes, deleted projects and statuses expiry never cancels", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		// Revised: v1 expired, v2 is current and still valid.
		const revised = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 2 }),
		);
		await inTenant(tenant, () =>
			makeQuote(tenant, revised.project, {
				version: 2,
				expiresAt: DateTime.utc().plus({ days: 7 }),
			}),
		);

		// Both versions expired: only v2 is current.
		const twice = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 3 }),
		);
		const v2 = await inTenant(tenant, () =>
			makeQuote(tenant, twice.project, { version: 2, expiresAt: hourAgo() }),
		);

		await inTenant(tenant, async () => {
			const gone = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await makeQuote(tenant, gone, { expiresAt: hourAgo() });
			await gone.softDelete();
		});

		for (const status of [
			"reviewing",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
			"declined",
			"cancelled",
		] as const) {
			await projectWithQuote(tenant, status, hourAgo());
		}

		assert.deepEqual(await candidatesOf(tenant), [
			rowOf(tenant, { project: twice.project, quote: v2 }),
		]);
	});

	test("only the app role may call it, and it runs as its owner with a pinned search_path and no arguments", async ({
		assert,
	}) => {
		const { rows } = await sql(
			{},
			`select p.prosecdef as definer,
			        p.proconfig,
			        pg_get_function_arguments(p.oid) as args,
			        pg_get_function_result(p.oid) as result,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run,
			        has_function_privilege(current_user, p.oid, 'execute') as app_can_run,
			        pg_get_userbyid(p.proowner) <> current_user as owned_by_another_role
			 from pg_proc p
			 where p.oid = 'public.expired_quote_candidates()'::regprocedure`,
		);

		assert.deepEqual(rows, [
			{
				definer: true,
				proconfig: ["search_path=pg_catalog, pg_temp"],
				args: "",
				result: "TABLE(tenant_id uuid, project_id uuid, quote_id uuid)",
				public_can_run: false,
				app_can_run: true,
				owned_by_another_role: true,
			},
		]);
	});
});
```

- [ ] **Step 2: Add the catalog guard rule**

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, add after the `EXPECTED_POLICIES` constant:

```ts
/**
 * SECURITY DEFINER functions, and why. They run as their owner, which
 * bypasses row-level security, so each one is a conscious edit: ids only,
 * a pinned search_path and no EXECUTE for PUBLIC (database/README.md).
 */
const DEFINER_FUNCTIONS: Record<string, string> = {
	expired_quote_candidates:
		"lists (tenant_id, project_id, quote_id) of expired current quotes for the expiry sweep (TAT-83)",
};
```

and add this test at the end of the `"Catalog guard"` group:

```ts
	test("every SECURITY DEFINER function is listed, pins search_path and is closed to PUBLIC", async ({
		assert,
	}) => {
		const definers = await rows<{
			proname: string;
			proconfig: string[] | null;
			public_can_run: boolean;
		}>(
			`select p.proname, p.proconfig,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run
			 from pg_proc p
			 where p.pronamespace = 'public'::regnamespace and p.prosecdef
			   and not exists (
			     select 1 from pg_depend d
			     where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
			   )
			 order by p.proname`,
		);

		assert.deepEqual(
			definers,
			Object.keys(DEFINER_FUNCTIONS)
				.sort()
				.map((proname) => ({
					proname,
					proconfig: ["search_path=pg_catalog, pg_temp"],
					public_can_run: false,
				})),
		);
	});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm test functional --files=expired_quote_candidates.spec.ts --files=catalog_guard.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat83-t2-red.log 2>&1; echo "exit $?"`
Expected: exit 1 (not 124). The 4 function tests fail with `function public.expired_quote_candidates() does not exist`; the new catalog test fails (`[]` against one expected function); the other catalog tests pass.

- [ ] **Step 4: Write the migration**

Create `apps/platform/database/migrations/1791620000000_create_expired_quote_candidates_function.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The expiry sweep's cross-tenant read (TAT-83). The app role can't see
 * other tenants' rows, so SweepExpiredQuotesJob lists expired current
 * quotes through this SECURITY DEFINER function, which runs as the owner
 * (it bypasses RLS) and returns ids only; ProjectService.expireQuote then
 * decides each one in its own tenant. Hardened as database/README.md asks:
 * no arguments, an SQL-standard body (bound when created, no dynamic SQL),
 * a pinned search_path, schema-qualified tables, and EXECUTE for the app
 * role only (Postgres grants it to PUBLIC by default). The index keeps the
 * sweep's scan to its 24-hour window.
 */
export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL
		// identifier. A role that doesn't exist fails the migration.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			"create index quotes_expires_at_index on quotes (expires_at)",
			`create function public.expired_quote_candidates()
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
end`,
			"revoke all on function public.expired_quote_candidates() from public",
			`grant execute on function public.expired_quote_candidates() to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.expired_quote_candidates()");
		this.schema.raw("drop index quotes_expires_at_index");
	}
}
```

Keep `?` out of these statements: knex reads it as a binding. If Postgres rejects the `begin atomic` body, an `as $$ … $$` body with the same select is acceptable (search_path pinned, every name qualified): record it as a deviation in the ledger.

- [ ] **Step 5: Migrate**

Run: `pnpm migrate`. Expected: the new migration runs as the owner; `git status --short database/schema.ts` prints nothing.

Check `down()`: `pnpm migrate:rollback` (rolls back this batch only), then `pnpm migrate` again. Expected: both succeed.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm test functional --files=expired_quote_candidates.spec.ts --files=catalog_guard.spec.ts --files=project_service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/1791620000000_create_expired_quote_candidates_function.ts tests/functional/projects/expired_quote_candidates.spec.ts tests/functional/rls/catalog_guard.spec.ts
git commit -m "feat(platform): list expired current quotes across tenants for the sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `database/schema.ts` only if `pnpm migrate` changed it; it should not.)

---

### Task 3: The sweep job

**Files:**
- Create: `apps/platform/app/modules/projects/jobs/sweep_expired_quotes_job.ts`
- Modify: `apps/platform/app/modules/projects/jobs/expire_quote_job.ts` (doc comment)
- Modify: `apps/platform/tests/unit/jobs/job_classes.spec.ts` (`ALLOWLIST`)
- Test: `apps/platform/tests/functional/projects/sweep_expired_quotes_job.spec.ts` (create, 2 tests)

**Interfaces:**
- Consumes: `public.expired_quote_candidates()` (Task 2); `ExpireQuoteJob` payload `{ tenantId, projectId, quoteId }`.
- Produces: `SweepExpiredQuotesJob extends Job<Record<string, never>>` (default export), with `static readonly scheduleId = "sweep-expired-quotes"` and `static readonly cron = "*/5 * * * *"` (Task 5 reads both).

- [ ] **Step 1: Write the failing sweep spec**

Create `apps/platform/tests/functional/projects/sweep_expired_quotes_job.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import SweepExpiredQuotesJob from "#modules/projects/jobs/sweep_expired_quotes_job";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { dispatchInTransaction } from "#services/queue";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

type TenantRef = { id: string };

/** The test's global transaction, which the test worker reads. */
const trx = () => db.connection() as TransactionClientContract;

const hourAgo = () => DateTime.utc().minus({ hours: 1 });

/** A project in `status` whose only quote expires at `expiresAt`. */
function projectWithQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	expiresAt = hourAgo(),
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		const quote = await makeQuote(tenant, project, { expiresAt });
		return { project, quote };
	});
}

const payloadOf = (
	tenant: TenantRef,
	{ project, quote }: { project: { id: string }; quote: { id: string } },
) => ({ tenantId: tenant.id, projectId: project.id, quoteId: quote.id });

const statusIn = (tenant: TenantRef, project: TattooProject) =>
	inTenant(
		tenant,
		async () => (await TattooProject.findOrFail(project.id)).status,
	);

/** Runs the sweep the way the worker does, without the queue. */
async function runSweep() {
	const job = new SweepExpiredQuotesJob();
	job.$hydrate(
		{},
		{
			jobId: "sweep-spec",
			name: "SweepExpiredQuotesJob",
			attempt: 1,
			queue: "default",
			priority: 0,
			acquiredAt: new Date(),
			stalledCount: 0,
		},
	);
	await job.execute();
}

test.group("SweepExpiredQuotesJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(SweepExpiredQuotesJob));
	group.each.setup(() => registerJob(ExpireQuoteJob));
	group.each.teardown(() => queue.restore());

	test("queues ExpireQuoteJob for each tenant's missed expiry, in that tenant", async () => {
		const fake = queue.fake();
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		const missedA = await projectWithQuote(a.tenant, "quoted");
		const missedB = await projectWithQuote(b.tenant, "deposit_pending");
		const valid = await projectWithQuote(
			b.tenant,
			"quoted",
			DateTime.utc().plus({ days: 1 }),
		);

		await runSweep();

		fake.assertPushed(ExpireQuoteJob, { payload: payloadOf(a.tenant, missedA) });
		fake.assertPushed(ExpireQuoteJob, { payload: payloadOf(b.tenant, missedB) });
		fake.assertNotPushed(ExpireQuoteJob, { payload: payloadOf(b.tenant, valid) });
		fake.assertNotPushed(ExpireQuoteJob, {
			payload: payloadOf(b.tenant, missedA),
		});
	});

	test("through the worker, cancels both tenants' missed expiries and spares a paid deposit", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		const missedA = await projectWithQuote(a.tenant, "quoted");
		const missedB = await projectWithQuote(b.tenant, "on_hold");
		const paid = await inTenant(a.tenant, async () => {
			const project = await makeProject(a.tenant, await makeClient(a.tenant), {
				status: "deposit_pending",
			});
			await makeQuote(a.tenant, project, { expiresAt: hourAgo() });
			await makePayment(a.tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return project;
		});

		await dispatchInTransaction(SweepExpiredQuotesJob.dispatch({}), trx());
		await processQueued();

		assert.equal(await statusIn(a.tenant, missedA.project), "cancelled");
		assert.equal(await statusIn(b.tenant, missedB.project), "cancelled");
		assert.equal(await statusIn(a.tenant, paid), "deposit_pending");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=sweep_expired_quotes_job.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat83-t3-red.log 2>&1; echo "exit $?"`
Expected: `exit 124`, and the log contains `Cannot find module` for `sweep_expired_quotes_job`.

- [ ] **Step 3: Write the job**

Create `apps/platform/app/modules/projects/jobs/sweep_expired_quotes_job.ts`:

```ts
import { Job } from "@adonisjs/queue";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import { dbClient } from "#services/db_context";

type Candidate = { tenant_id: string; project_id: string; quote_id: string };

/**
 * The expiry safety net (TAT-83). ExpireQuoteJob runs once per quote, at its
 * expiry; one that used up its retries or was never queued would leave its
 * project with an expired quote. Every 5 minutes (start/scheduler.ts) this
 * lists the current quotes that expired between 24 hours and 2 minutes ago
 * on `quoted`, `on_hold` or `deposit_pending` projects, across tenants,
 * through expired_quote_candidates() (ids only: the app role can't read
 * other tenants' rows), and queues an ExpireQuoteJob for each, in that row's
 * tenant. It reads and writes no tenant table: ProjectService.expireQuote
 * re-checks every rule under the project lock, so a quote listed again, or
 * one whose deposit was paid, changes nothing.
 */
export default class SweepExpiredQuotesJob extends Job<Record<string, never>> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-expired-quotes";

	/** Every 5 minutes, UTC. */
	static readonly cron = "*/5 * * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, project_id, quote_id from public.expired_quote_candidates()",
		);
		for (const row of rows as Candidate[]) {
			await ExpireQuoteJob.dispatch({
				tenantId: row.tenant_id,
				projectId: row.project_id,
				quoteId: row.quote_id,
			}).run();
		}
	}
}
```

In `apps/platform/app/modules/projects/jobs/expire_quote_job.ts`, replace the last sentence of the class doc comment

```ts
 * of revised quotes, a repeat run and a deleted project all do nothing. A
 * run that comes early (this worker's clock behind the issuer's) queues the
 * job again for the rest of the time.
 */
```

with

```ts
 * of revised quotes, a repeat run and a deleted project all do nothing. A
 * run that comes early (this worker's clock behind the issuer's) queues the
 * job again for the rest of the time; one that used up its retries or never
 * ran is queued again by SweepExpiredQuotesJob.
 */
```

- [ ] **Step 4: Run the sweep spec to verify it passes**

Run: `PORT=3402 timeout 180 pnpm test functional --files=sweep_expired_quotes_job.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the job-class guard to verify it flags the new job**

Run: `PORT=3402 timeout 90 pnpm test unit --files=job_classes.spec.ts`
Expected: FAIL, "every job extends TenantJob or is allowlisted" lists `["SweepExpiredQuotesJob"]`.

- [ ] **Step 6: Allowlist it**

In `apps/platform/tests/unit/jobs/job_classes.spec.ts`, replace

```ts
const ALLOWLIST = {
	SendMailJob: "sends one email; reads and writes no tenant table",
};
```

with

```ts
const ALLOWLIST = {
	SendMailJob: "sends one email; reads and writes no tenant table",
	SweepExpiredQuotesJob:
		"reads only ids from expired_quote_candidates() and queues one ExpireQuoteJob (a TenantJob) per row; reads and writes no tenant table itself",
};
```

Run: `PORT=3402 timeout 90 pnpm test unit --files=job_classes.spec.ts`. Expected: PASS. Then `pnpm typecheck`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/jobs/sweep_expired_quotes_job.ts app/modules/projects/jobs/expire_quote_job.ts tests/functional/projects/sweep_expired_quotes_job.spec.ts tests/unit/jobs/job_classes.spec.ts
git commit -m "feat(platform): sweep missed quote expiries into ExpireQuoteJob

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: processQueued ignores persisted schedules

**Files:**
- Modify: `apps/platform/tests/helpers/worker.ts` (`processQueued`)
- Test: `apps/platform/tests/functional/queue/process_queued.spec.ts` (1 new group)

**Interfaces:**
- Produces: `processQueued()` keeps its signature; before draining it deletes every `queue_schedules` row inside the test's global transaction.

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/functional/queue/process_queued.spec.ts`:

```ts
class ScheduledJob extends Job<Record<string, never>> {
	static options: JobOptions = { retry: { maxRetries: 0 } };
	static runs = 0;

	async execute() {
		ScheduledJob.runs += 1;
	}
}

/**
 * Locally the dev server and the tests share one database, and the dev
 * server writes its schedules there (start/scheduler.ts). The worker claims
 * due schedules on every cycle, so without care a test would run them.
 */
test.group("processQueued ignores persisted schedules", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ScheduledJob));

	test("a due schedule in queue_schedules does not run", async ({ assert }) => {
		await db.table("queue_schedules").insert({
			id: "process-queued-spec",
			name: "ScheduledJob",
			payload: "{}",
			every_ms: 60_000,
			timezone: "UTC",
			status: "active",
			run_count: 0,
			next_run_at: new Date(Date.now() - 60_000),
			created_at: new Date(),
		});

		await processQueued();

		assert.equal(ScheduledJob.runs, 0);
	});
});
```

(`Job`, `JobOptions`, `db`, `testUtils`, `processQueued` and `registerJob` are already imported in that file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=process_queued.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat83-t4-red.log 2>&1; echo "exit $?"`
Expected: exit 1, the new test fails with `expected 1 to equal +0` (the worker claimed the schedule and ran the job); the other tests pass.

- [ ] **Step 3: Delete schedules inside the test's transaction**

In `apps/platform/tests/helpers/worker.ts`, in `processQueued`, right after the `if (!client.isTransaction) { … }` block, add:

```ts
	// Locally the tests share the dev database, where the dev server keeps
	// its schedules (start/scheduler.ts), and the worker claims due ones on
	// every cycle. A test runs only what it queued. Deleted inside the test's
	// transaction, so the rows are back once it rolls back.
	await client.from("queue_schedules").delete();
```

and add this paragraph to the end of `processQueued`'s doc comment:

```ts
 *
 * Persisted schedules never run here: they are deleted inside the test's
 * transaction first.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm test functional --files=process_queued.spec.ts --files=tenant_job.spec.ts --files=expire_quote_job.spec.ts --files=sweep_expired_quotes_job.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/worker.ts tests/functional/queue/process_queued.spec.ts
git commit -m "test(platform): keep persisted schedules out of processQueued

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Schedule the sweep every 5 minutes

**Files:**
- Create: `apps/platform/start/scheduler.ts`
- Modify: `apps/platform/adonisrc.ts` (`preloads`)
- Test: `apps/platform/tests/unit/jobs/scheduler.spec.ts` (create, 2 tests)

**Interfaces:**
- Consumes: `SweepExpiredQuotesJob.scheduleId`, `SweepExpiredQuotesJob.cron` (Task 3).
- Produces: a `queue_schedules` row with id `sweep-expired-quotes`, name `SweepExpiredQuotesJob`, cron `*/5 * * * *`, timezone UTC, upserted at every web server boot.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/jobs/scheduler.spec.ts`:

```ts
import app from "@adonisjs/core/services/app";
import { Schedule } from "@adonisjs/queue";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";

test.group("Scheduler", (group) => {
	group.each.teardown(() => queue.restore());

	test("schedules the expiry sweep every 5 minutes", async ({ assert }) => {
		queue.fake();
		await import("#start/scheduler");

		const schedule = await Schedule.find("sweep-expired-quotes");
		assert.equal(schedule?.name, "SweepExpiredQuotesJob");
		assert.equal(schedule?.cronExpression, "*/5 * * * *");
		assert.equal(schedule?.timezone, "UTC");
		assert.equal(schedule?.status, "active");
	});

	test("only the web server loads it", ({ assert }) => {
		const preloads = app.rcFile.preloads.filter(({ file }) =>
			String(file).includes("#start/scheduler"),
		);
		assert.deepEqual(
			preloads.map(({ environment }) => environment),
			[["web"]],
		);
	});
});
```

(`Schedule` in 0.6.0 has `name`, `cronExpression`, `timezone` and `status` getters.) If `String(file)` doesn't show the import specifier under the test runner, replace the second test's check with a read of `adonisrc.ts` (`readFile(app.makePath("adonisrc.ts"))` contains `import("#start/scheduler")` followed by `environment: ["web"]`), and say so in the ledger.

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=scheduler.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat83-t5-red.log 2>&1; echo "exit $?"`
Expected: both tests fail: the first with `Cannot find module` for `start/scheduler` (exit 1; if the runner hangs instead, exit 124 with that message is also the expected RED), the second with `[]` against `[["web"]]`.

- [ ] **Step 3: Write the preload and register it**

Create `apps/platform/start/scheduler.ts`:

```ts
/*
|--------------------------------------------------------------------------
| Scheduler
|--------------------------------------------------------------------------
|
| Recurring jobs. adonisrc.ts loads this file in the web server only: at
| boot it upserts each schedule into queue_schedules by its id (a restart
| or a second server changes nothing), and the worker claims the due ones
| and runs them. Awaited, so a web server that can't write its schedules
| doesn't start.
|
*/

import SweepExpiredQuotesJob from "#modules/projects/jobs/sweep_expired_quotes_job";

await SweepExpiredQuotesJob.schedule({})
	.id(SweepExpiredQuotesJob.scheduleId)
	.cron(SweepExpiredQuotesJob.cron)
	.run();
```

In `apps/platform/adonisrc.ts`, in `preloads`, replace

```ts
		() => import("#start/mail"),
	],
```

with

```ts
		() => import("#start/mail"),
		{
			file: () => import("#start/scheduler"),
			environment: ["web"],
		},
	],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 90 pnpm test unit --files=scheduler.spec.ts --files=job_classes.spec.ts`
Expected: PASS. Then `pnpm typecheck` and `node ace codegen`; `git status --short` shows only this task's files (if codegen touched `.adonisjs/` because of `adonisrc.ts`, keep those changes in this commit).

- [ ] **Step 5: Optional smoke check of the boot**

Start the dev server in the background on the free port: `PORT=3401 node ace serve` (Bash `run_in_background`). Once it logs that it started, run `node ace queue:scheduler:list`. Expected: a row `sweep-expired-quotes`, `SweepExpiredQuotesJob`, `*/5 * * * *`, `active`. Stop the server by PID (`pgrep -af "ace serve"` and `pgrep -af "bin/server"`, then `kill <pid>`; never `pkill -f`). The schedule row stays in the dev database, which is intended (Task 4 keeps it out of tests). If the server can't start for an unrelated reason, skip this step and record it in the ledger.

- [ ] **Step 6: Commit**

```bash
git add start/scheduler.ts adonisrc.ts tests/unit/jobs/scheduler.spec.ts
git commit -m "feat(platform): schedule the expiry sweep every 5 minutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `apps/platform/docs/jobs-and-email.md`
- Modify: `apps/platform/docs/backend.md`
- Modify: `apps/platform/docs/testing.md`
- Modify: `apps/platform/database/README.md`
- Modify: `docs/README.md` (repo root)

- [ ] **Step 1: Jobs and email**

In `apps/platform/docs/jobs-and-email.md`, in the `TenantJob` bullet, replace

```md
Jobs that touch no tenant data (`SendMailJob`) extend `Job` and are listed in the allowlist in `tests/unit/jobs/job_classes.spec.ts`.
```

with

```md
Jobs that touch no tenant data (`SendMailJob`; `SweepExpiredQuotesJob`, which reads only ids) extend `Job` and are listed in the allowlist in `tests/unit/jobs/job_classes.spec.ts`.
```

Insert these two bullets right after that `TenantJob` bullet:

```md
- Recurring jobs: `start/scheduler.ts`, a preload for the `web` environment only, upserts each schedule into `queue_schedules` by a fixed id when the web server boots (`Job.schedule(payload).id(…).cron(…).run()`; a restart or a second server changes nothing). The worker claims due schedules on every cycle, once per due time with no catch-up after downtime, and runs the job. `node ace queue:scheduler:list` shows them. A new recurring job is one more line there.
- Quote expiry (TAT-64, TAT-83): `ExpireQuoteJob` runs at a quote's `expires_at`. A run that comes early (the worker's clock behind the issuer's) is queued again for the rest of the time by `ProjectService.expireQuote`. `SweepExpiredQuotesJob` runs every 5 minutes as the safety net for a job that used up its retries or was never queued: it lists the current quotes that expired between 24 hours and 2 minutes ago on `quoted`, `on_hold` or `deposit_pending` projects through the SECURITY DEFINER function `expired_quote_candidates()` (ids only, see [database conventions](../database/README.md#row-level-security)) and queues one `ExpireQuoteJob` per row with that row's `tenantId`; `expireQuote` decides each under the project lock. A project is therefore cancelled at most about 7 minutes after its quote expired. A quote whose expiry keeps failing gets a new job every sweep for 24 hours (at most 288 failed rows, each logged by `failed()`); a project stuck longer than that is withdrawn by hand.
```

In the `Tests:` bullet, replace

```md
To run queued jobs through the real worker, see `processQueued()` in [testing](testing.md#tenant-isolation-tests).
```

with

```md
To run queued jobs through the real worker, see `processQueued()` in [testing](testing.md#tenant-isolation-tests); it never runs persisted schedules.
```

- [ ] **Step 2: Backend conventions**

In `apps/platform/docs/backend.md`, in the "Projects and quotes (TAT-64)" bullet, replace

```md
and `expireQuote` (what the job runs: cancels `quoted`, `on_hold` and unsettled `deposit_pending` projects and their scheduled sessions, but never one whose non-zero deposit was paid; anything else, including a revised quote's old job, is a no-op).
```

with

```md
and `expireQuote` (what the job runs: cancels `quoted`, `on_hold` and unsettled `deposit_pending` projects and their scheduled sessions, but never one whose non-zero deposit was paid; anything else, including a revised quote's old job, is a no-op; a run before the expiry queues the job again for the rest of the time, and `SweepExpiredQuotesJob` catches a job that failed or never ran, see [jobs and email](jobs-and-email.md#jobs)).
```

Insert this bullet right after the "Database context" bullet (the one ending `Details: [database conventions](../database/README.md#row-level-security).`):

```md
- Cross-tenant reads: the app role sees one tenant at a time, and nothing in a request ever needs more. A system task that must look across tenants (only the expiry sweep, TAT-83) reads ids through a SECURITY DEFINER function, then acts on each row through a `TenantJob` in that row's tenant, never directly. Rules for such functions: [database conventions](../database/README.md#row-level-security).
```

- [ ] **Step 3: Database conventions**

In `apps/platform/database/README.md`, insert this bullet right after the "**`ENABLE`, not `FORCE`.**" bullet:

```md
- **SECURITY DEFINER functions** are the only way across tenants. There is one: `expired_quote_candidates()` (TAT-83, the expiry sweep). Such a function runs as its owner, which bypasses RLS, so it returns ids only, takes no arguments, has an SQL-standard body (`begin atomic … end`: names are bound when it is created, no dynamic SQL), pins `set search_path = pg_catalog, pg_temp` and schema-qualifies every table. Postgres grants `EXECUTE` on a new function to `PUBLIC`, so its migration runs `revoke all on function … from public` and grants `EXECUTE` to the app role named by `DB_USER` (quoted as an identifier). Callers act on the rows only through tenant-scoped code (a `TenantJob`). `tests/functional/rls/catalog_guard.spec.ts` fails for a definer function missing from `DEFINER_FUNCTIONS`, without the pinned `search_path`, or executable by `PUBLIC`; a new one also needs a spec of its properties, like `expired_quote_candidates.spec.ts`. The body depends on the columns it reads: a migration that drops or retypes `quotes.expires_at`, `quotes.version`, `tattoo_projects.status` or `tattoo_projects.deleted_at` must replace the function in the same migration.
```

- [ ] **Step 4: Testing**

In `apps/platform/docs/testing.md`, replace

```md
- Tests that drive the queue use `processQueued()` from `#tests/helpers/worker` (the real worker). Jobs that touch tenant data extend `TenantJob`.
```

with

```md
- Tests that drive the queue use `processQueued()` from `#tests/helpers/worker` (the real worker). Jobs that touch tenant data extend `TenantJob`. Locally the tests share the dev database, where `pnpm dev` keeps its schedules, so `processQueued()` deletes `queue_schedules` rows inside the test's transaction before draining: a test runs only what it queued.
- A SECURITY DEFINER function such as `expired_quote_candidates()` sees every tenant's committed rows, the dev database's included: filter its output to the test's own tenants, and assert a sweep's queued jobs by payload, never by count.
```

- [ ] **Step 5: Documentation index**

In `docs/README.md` (repo root), replace

```md
| Queue dispatch, worker, retries, email templates | [Jobs and email](../apps/platform/docs/jobs-and-email.md) |
```

with

```md
| Queue dispatch, worker, retries, scheduled jobs, email templates | [Jobs and email](../apps/platform/docs/jobs-and-email.md) |
```

- [ ] **Step 6: Commit**

From the repo root:

```bash
git add apps/platform/docs/jobs-and-email.md apps/platform/docs/backend.md apps/platform/docs/testing.md apps/platform/database/README.md docs/README.md
git commit -m "docs(platform): document the expiry safety net

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`, run `PORT=3402 node ace test` in the background and wait for the notification. Expected: all suites pass, with 12 new tests (2 unit, 10 functional) over the 753 baseline: 765.

From the root: `pnpm typecheck`, `pnpm check`, `pnpm build`. Expected: clean (`pnpm check` has 2 known warnings in `inertia/ssr.tsx` and `inertia/types.ts`).

From `apps/platform`: `node ace codegen`, then `git status --short`. Expected: no changes. If the dev server regenerated `pages.d.ts`, run `git checkout -- <file>`.

- [ ] **Step 2: Reviews**

The run's review phase (whole-branch review, then `codex-review` on the stack base e946104) checks the branch, the definer function's hardening and grants above all. Fix confirmed findings test-first and commit. Nothing is pushed and no PR is opened (run brief).

- [ ] **Step 3: Manual pass (the user, before merge)**

Record it as pending in the ledger and the PR text:

1. Pull, run `pnpm migrate` in `apps/platform` (new migration; no `.env` change).
2. With `pnpm dev` and `pnpm worker` running: `node ace queue:scheduler:list` shows `sweep-expired-quotes`, cron `*/5 * * * *`; after 5 minutes its run count has gone up.
3. As the owner (`psql`), `select * from expired_quote_candidates();` lists only ids. As the app role, `\df+ expired_quote_candidates` shows `security definer` and access only for the app role.
