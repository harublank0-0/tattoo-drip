import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { Job } from "@adonisjs/queue";
import queue from "@adonisjs/queue/services/main";
import type { JobOptions } from "@adonisjs/queue/types";
import { KnexAdapter } from "@boringnode/queue/drivers/knex_adapter";
import { test } from "@japa/runner";
import { dispatchInTransaction } from "#services/queue";
import { processQueued, registerJob } from "#tests/helpers/worker";

class NoopJob extends Job<{ label: string }> {
	static options: JobOptions = { retry: { maxRetries: 0 } };

	async execute() {}
}

/**
 * processQueued re-initializes the process-wide QueueManager and puts the
 * app's own state back. The restore must not tie the app's queue adapter
 * to the test that called the helper: its global transaction ends with the
 * test, and every later test in the process uses the same adapter. The two
 * tests below must stay in this order in one group.
 */
test.group("processQueued restores the app's queue", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(NoopJob));

	test("a test runs the worker", async ({ assert }) => {
		const { jobId } = await dispatchInTransaction(
			NoopJob.dispatch({ label: "first" }),
			db.connection() as never,
		);

		await processQueued();

		const row = await db.from("queue_jobs").where("id", jobId).first();
		assert.isFalse(Boolean(row), "the worker ran and acknowledged it");
	});

	test("the next test, in its own transaction, can still use the default adapter", async ({
		assert,
	}) => {
		const adapter = queue.use();

		assert.instanceOf(adapter, KnexAdapter);
		// A read-only call: it throws "Transaction query already complete" when
		// the adapter is still bound to the previous test's transaction.
		assert.equal(await adapter.sizeOf("restore-check"), 0);
	});
});

class LoopJob extends Job<{ label: string }> {
	static options: JobOptions = { retry: { maxRetries: 0 } };

	async execute() {
		await dispatchInTransaction(
			LoopJob.dispatch({ label: "again" }),
			db.connection() as never,
		);
	}
}

test.group("processQueued gives up instead of hanging", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(LoopJob));

	test("throws the worker's own error instead of polling forever", async ({
		assert,
	}) => {
		// A failed statement leaves the test's transaction aborted, so the
		// worker's next poll fails. The worker reports that as an error cycle.
		await assert.rejects(() => db.rawQuery("select 1/0"), /division by zero/);

		await assert.rejects(() => processQueued(), /transaction is aborted/);
	});

	test("throws when the queue never drains", async ({ assert }) => {
		await dispatchInTransaction(
			LoopJob.dispatch({ label: "first" }),
			db.connection() as never,
		);

		await assert.rejects(() => processQueued(), /still busy after \d+ cycles/);
	});
});

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
