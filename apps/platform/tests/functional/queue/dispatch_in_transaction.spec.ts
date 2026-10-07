import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { Job } from "@adonisjs/queue";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { dispatchInTransaction } from "#services/queue";

class NoopJob extends Job<{ label: string }> {
	async execute() {}
}

async function jobExists(jobId: string) {
	return Boolean(await db.from("queue_jobs").where("id", jobId).first());
}

test.group("dispatchInTransaction", (group) => {
	// Each test runs in a transaction that is rolled back afterwards, so
	// nothing is left behind in the dev database.
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("keeps the job when the transaction commits", async ({ assert }) => {
		const { jobId } = await db.transaction((trx) =>
			dispatchInTransaction(NoopJob.dispatch({ label: "commit" }), trx),
		);

		assert.isTrue(await jobExists(jobId));
	});

	test("drops the job when the transaction rolls back", async ({ assert }) => {
		let jobId = "";

		await assert.rejects(
			() =>
				db.transaction(async (trx) => {
					({ jobId } = await dispatchInTransaction(
						NoopJob.dispatch({ label: "rollback" }),
						trx,
					));
					throw new Error("roll back");
				}),
			"roll back",
		);

		assert.isNotEmpty(jobId);
		assert.isFalse(await jobExists(jobId));
	});

	test("dispatches normally when the queue isn't the database adapter", async () => {
		const fake = queue.fake();

		await db.transaction((trx) =>
			dispatchInTransaction(NoopJob.dispatch({ label: "fake" }), trx),
		);

		fake.assertPushed(NoopJob);
	});
});
