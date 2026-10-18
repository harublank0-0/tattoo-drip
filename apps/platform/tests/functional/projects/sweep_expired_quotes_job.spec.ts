import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
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
type ExpirePayload = { tenantId: string; projectId: string; quoteId: string };

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

/** A sweep job as the worker hands it out, without the queue. */
function hydratedSweep() {
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
	return job;
}

/** Runs the sweep the way the worker does, without the queue. */
const runSweep = () => hydratedSweep().execute();

test.group("SweepExpiredQuotesJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
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
			const quote = await makeQuote(a.tenant, project, {
				expiresAt: hourAgo(),
			});
			await makePayment(a.tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return { project, quote };
		});
		// A studio outside the test: its missed expiries are candidates too, the
		// way the dev database's rows are, and must not run here.
		const c = await studioWithOwner("studio-c", "Studio C");
		const foreign = await projectWithQuote(c.tenant, "quoted");

		// The sweep lists every committed candidate, the dev database's included,
		// and the worker would run a job for each (and stop after 100 cycles).
		// So run the sweep against the fake queue, keep the jobs of this test's
		// studios, and send only those through the worker.
		const fake = queue.fake();
		await runSweep();
		const mine = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === ExpireQuoteJob.name)
			.map(({ payload }) => payload as ExpirePayload)
			.filter(({ tenantId }) => [a.tenant.id, b.tenant.id].includes(tenantId));
		queue.restore();
		assert.sameDeepMembers(mine, [
			payloadOf(a.tenant, missedA),
			payloadOf(b.tenant, missedB),
			payloadOf(a.tenant, paid),
		]);

		for (const payload of mine) {
			await dispatchInTransaction(ExpireQuoteJob.dispatch(payload), trx());
		}
		await processQueued();

		assert.equal(await statusIn(a.tenant, missedA.project), "cancelled");
		assert.equal(await statusIn(b.tenant, missedB.project), "cancelled");
		assert.equal(await statusIn(a.tenant, paid.project), "deposit_pending");
		assert.equal(await statusIn(c.tenant, foreign.project), "quoted");
	});

	test("through the worker, spares a waiting screenshot and a deposit reversed after the expiry", async ({
		assert,
	}) => {
		const a = await studioWithOwner("sweep-late-66", "Late");
		const waiting = await projectWithQuote(a.tenant, "deposit_pending");
		const reversed = await projectWithQuote(a.tenant, "deposit_pending");
		const unpaid = await projectWithQuote(a.tenant, "deposit_pending");
		await inTenant(a.tenant, async () => {
			await makePayment(a.tenant, waiting.project);
			const deposit = await makePayment(a.tenant, reversed.project, {
				status: "verified",
				verifiedAt: DateTime.utc().minus({ hours: 2 }),
			});
			await makePayment(a.tenant, reversed.project, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: deposit.id,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		});

		const fake = queue.fake();
		await runSweep();
		const mine = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === ExpireQuoteJob.name)
			.map(({ payload }) => payload as ExpirePayload)
			.filter(({ tenantId }) => tenantId === a.tenant.id);
		queue.restore();
		assert.sameDeepMembers(mine, [
			payloadOf(a.tenant, waiting),
			payloadOf(a.tenant, reversed),
			payloadOf(a.tenant, unpaid),
		]);

		for (const payload of mine) {
			await dispatchInTransaction(ExpireQuoteJob.dispatch(payload), trx());
		}
		await processQueued();

		assert.equal(await statusIn(a.tenant, waiting.project), "deposit_pending");
		assert.equal(await statusIn(a.tenant, reversed.project), "deposit_pending");
		assert.equal(await statusIn(a.tenant, unpaid.project), "cancelled");
	});

	test("logs when it has used up its retries", async ({ assert }) => {
		const logged = mock.method(logger, "error", () => {});
		try {
			const error = new Error(
				"permission denied for function expired_quote_candidates",
			);

			await hydratedSweep().failed(error);

			assert.equal(logged.mock.callCount(), 1);
			assert.deepEqual(logged.mock.calls[0].arguments, [
				{ err: error, jobId: "sweep-spec" },
				"Sweeping expired quotes failed.",
			]);
		} finally {
			logged.mock.restore();
		}
	});
});
