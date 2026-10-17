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
