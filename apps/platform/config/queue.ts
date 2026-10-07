import { defineConfig, drivers, exponentialBackoff } from "@adonisjs/queue";
import env from "#start/env";

export default defineConfig({
	default: env.get("QUEUE_DRIVER", "database"),

	adapters: {
		database: drivers.database({
			connectionName: "pg",
		}),
		sync: drivers.sync(),
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
