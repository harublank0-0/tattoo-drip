import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { Job } from "@adonisjs/queue";
import type { JobOptions } from "@adonisjs/queue/types";
import { test } from "@japa/runner";
import PaymentMethod from "#modules/payments/models/payment_method";
import { afterCommit, dbClient } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";
import TenantJob from "#services/tenant_job";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

type Payload = { tenantId: string; label: string; fail?: boolean };

const seen: { tenant: string | null; before: number }[] = [];
const atCommit: boolean[] = [];
const probed: { tenant: string | null; user: string | null }[] = [];

async function queueRowExists(jobId: string) {
	return Boolean(await db.from("queue_jobs").where("id", jobId).first());
}

/**
 * A failed job's row stays in queue_jobs (config/queue.ts keeps it for 7
 * days) with its status and the error message.
 */
async function queueRow(jobId: string) {
	const row = await db.from("queue_jobs").where("id", jobId).first();
	return row as { status: string; error: string | null } | null;
}

class WriteJob extends TenantJob<Payload> {
	// No retries: a failure is final, so draining the queue is deterministic
	// (the global config retries after a 5 s backoff). Two failing jobs stand
	// in for two attempts in the rollback test.
	static options: JobOptions = { retry: { maxRetries: 0 } };

	protected async handle() {
		const { label, tenantId, fail } = this.payload;
		const { rows } = await dbClient().rawQuery(
			"select current_setting('app.tenant_id', true) as tenant_id",
		);
		const before = await PaymentMethod.query()
			.where("label", label)
			.count("* as n");
		seen.push({
			tenant: rows[0].tenant_id || null,
			before: Number(before[0].$extras.n),
		});

		await PaymentMethod.create({
			tenantId,
			kind: "cash",
			label,
			position: 0,
		});
		if (fail) throw new Error("boom");

		const { jobId } = this.context;
		afterCommit(async () => {
			atCommit.push(await queueRowExists(jobId));
		});
	}
}

/**
 * A plain job, outside TenantJob: it records the database settings it runs
 * with, so a test can see what an earlier job left behind.
 */
class ProbeJob extends Job<{ label: string }> {
	static options: JobOptions = { retry: { maxRetries: 0 } };

	async execute() {
		const { rows } = await dbClient().rawQuery(
			"select current_setting('app.tenant_id', true) as tenant_id, current_setting('app.user_id', true) as user_id",
		);
		probed.push({
			tenant: rows[0].tenant_id || null,
			user: rows[0].user_id || null,
		});
	}
}

const trx = () => db.connection() as TransactionClientContract;
const labelCount = (tenant: { id: string }, label: string) =>
	inTenant(tenant, async () => {
		const rows = await PaymentMethod.query()
			.where("label", label)
			.count("* as n");
		return Number(rows[0].$extras.n);
	});

test.group("TenantJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		seen.length = 0;
		atCommit.length = 0;
		probed.length = 0;
		registerJob(WriteJob);
		registerJob(ProbeJob);
	});

	test("runs the handler in the payload's tenant context and commits", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: tenant.id, label: "from job" }),
			trx(),
		);

		await processQueued();

		assert.deepEqual(seen, [{ tenant: tenant.id, before: 0 }]);
		assert.equal(await labelCount(tenant, "from job"), 1);
		assert.isFalse(await queueRowExists(jobId));
	});

	test("a job that writes and then throws leaves nothing behind for the next attempt", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		for (let attempt = 0; attempt < 2; attempt++) {
			await dispatchInTransaction(
				WriteJob.dispatch({ tenantId: tenant.id, label: "doomed", fail: true }),
				trx(),
			);
		}

		await processQueued();

		assert.lengthOf(seen, 2);
		assert.deepEqual(
			seen.map(({ before }) => before),
			[0, 0],
			"the second run did not see the first run's write",
		);
		assert.equal(await labelCount(tenant, "doomed"), 0);
	});

	test("the job is acknowledged only after its writes commit", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: tenant.id, label: "ack order" }),
			trx(),
		);

		await processQueued();

		assert.deepEqual(atCommit, [true], "the queue row still existed at commit");
		assert.isFalse(await queueRowExists(jobId));
	});

	test("context does not leak into the next job", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		// Priority 1 runs before the probe's default 5, whatever the timestamps.
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: tenant.id, label: "one" }).priority(1),
			trx(),
		);
		await dispatchInTransaction(ProbeJob.dispatch({ label: "probe" }), trx());

		await processQueued();

		assert.deepEqual(
			seen.map(({ tenant: seenTenant }) => seenTenant),
			[tenant.id],
			"the tenant job ran in its tenant's context",
		);
		assert.equal(await labelCount(tenant, "one"), 1);
		assert.deepEqual(
			probed,
			[{ tenant: null, user: null }],
			"the next job ran with no tenant and no user",
		);
	});

	test("a malformed tenantId fails the job before the handler runs", async ({
		assert,
	}) => {
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: "not-a-uuid", label: "never" }),
			trx(),
		);

		await processQueued();

		assert.lengthOf(seen, 0);
		const row = await queueRow(jobId);
		assert.equal(row?.status, "failed");
		assert.match(row?.error ?? "", /needs a valid tenantId/);
	});

	test("a payload without a tenantId fails the job before the handler runs", async ({
		assert,
	}) => {
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ label: "never" } as unknown as Payload),
			trx(),
		);

		await processQueued();

		assert.lengthOf(seen, 0);
		const row = await queueRow(jobId);
		assert.equal(row?.status, "failed");
		assert.match(row?.error ?? "", /needs a valid tenantId/);
	});
});
