import app from "@adonisjs/core/services/app";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { AdapterFactory, QueueConfig } from "@adonisjs/queue/types";
import { Locator, QueueManager, Worker } from "@boringnode/queue";
import { knex } from "@boringnode/queue/drivers/knex_adapter";

/**
 * Same as @adonisjs/queue's resolveAdapters, which the package does not
 * export: config entries are factories or objects with a resolver.
 */
async function resolveAdapters(config: QueueConfig) {
	const adapters: Record<string, AdapterFactory> = {};
	for (const [name, adapter] of Object.entries(config.adapters)) {
		adapters[name] =
			typeof adapter === "function" ? adapter : await adapter.resolver(app);
	}
	return adapters;
}

/**
 * Makes a job class defined in a test findable by the worker.
 */
export function registerJob(JobClass: {
	name: string;
	options?: { name?: string };
}) {
	Locator.register(JobClass.options?.name ?? JobClass.name, JobClass as never);
}

/**
 * Runs the real queue Worker until the queue is idle, so a test sees what
 * production does: the worker catches a job's error, retries, and
 * acknowledges the job only after execute() returns.
 *
 * The worker reads and acknowledges rows on the test's own transaction, so
 * it sees jobs the test queued inside it. Starting a worker re-initializes
 * the process-wide QueueManager, so the app's own queue state is put back
 * afterwards for the tests that follow.
 */
export async function processQueued(queues: string[] = ["default"]) {
	const config = app.config.get<QueueConfig>("queue");
	const client = db.connection();
	if (!client.isTransaction) {
		throw new Error(
			"processQueued needs the test's global transaction: call testUtils.db().wrapInGlobalTransaction() in a setup hook",
		);
	}
	const logger = await app.container.make("logger");
	const base = {
		...config,
		autoLoadJobs: false,
		jobFactory: (jobClass: new () => unknown) => app.container.make(jobClass),
		logger: config.logger ?? logger,
	};
	const worker = new Worker({
		...base,
		// One job at a time and no signal handlers: a test drains the queue and
		// must not leave process listeners behind.
		worker: { ...config.worker, concurrency: 1, gracefulShutdown: false },
		adapters: {
			database: knex((client as TransactionClientContract).knexClient),
		},
	} as never);

	try {
		let cycle = await worker.processCycle(queues);
		while (cycle && cycle.type !== "idle") {
			cycle = await worker.processCycle(queues);
		}
		await worker.stop();
	} finally {
		await QueueManager.init({
			...base,
			adapters: await resolveAdapters(config),
		} as never);
	}
}
