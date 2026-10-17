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
