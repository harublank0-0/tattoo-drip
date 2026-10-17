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

		fake.assertPushed(ExpireQuoteJob, {
			payload: payloadOf(a.tenant, missedA),
		});
		fake.assertPushed(ExpireQuoteJob, {
			payload: payloadOf(b.tenant, missedB),
		});
		fake.assertNotPushed(ExpireQuoteJob, {
			payload: payloadOf(b.tenant, valid),
		});
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
