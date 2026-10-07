import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import SendMailJob from "#jobs/send_mail_job";

/**
 * These settings are easy to put under the wrong key in config/queue.ts
 * and the queue then silently falls back to its own defaults (0 retries,
 * failed jobs deleted), so pin what the jobs actually get.
 */
test.group("Queue config", () => {
	test("retries a job 3 times with backoff", ({ assert }) => {
		const { maxRetries, backoff } = queue
			.getConfigResolver()
			.resolveRetryConfig("default", SendMailJob.options);

		assert.equal(maxRetries, 3);
		assert.exists(backoff);
	});

	test("keeps failed mail jobs for one day, not the default seven", ({
		assert,
	}) => {
		const { removeOnFail } = queue
			.getConfigResolver()
			.resolveJobOptions("default", SendMailJob.options);

		assert.deepEqual(removeOnFail, { age: "1d" });
	});
});
