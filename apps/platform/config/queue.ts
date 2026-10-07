import { defineConfig, drivers, exponentialBackoff } from "@adonisjs/queue";

export default defineConfig({
	/**
	 * The only driver: jobs are rows in queue_jobs in the app's own
	 * Postgres, run by the worker. (No sync driver: it would run jobs
	 * inside the request, before a transaction commits and without the
	 * JSON round trip the worker does.)
	 */
	default: "database",

	adapters: {
		database: drivers.database({
			connectionName: "pg",
		}),
	},

	worker: {
		concurrency: 5,
		idleDelay: "2s",
	},

	/**
	 * Every job retries 3 times, waiting 5s, 10s, 20s… up to 5 minutes.
	 * This must be the top-level `retry`: the queue ignores a `retry`
	 * inside defaultJobOptions. tests/unit/jobs/queue_config.spec.ts pins it.
	 */
	retry: {
		maxRetries: 3,
		backoff: exponentialBackoff({
			baseDelay: "5s",
			maxDelay: "5m",
		}),
	},

	/**
	 * Failed jobs stay in queue_jobs for 7 days with their error; completed
	 * jobs are deleted. Jobs can override this in their static options.
	 */
	defaultJobOptions: {
		removeOnFail: {
			age: "7d",
		},
	},
	locations: ["./app/jobs/**/*.{ts,js}", "./app/modules/*/jobs/**/*.{ts,js}"],
});
