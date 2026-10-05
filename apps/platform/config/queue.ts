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

	defaultJobOptions: {
		retry: {
			maxRetries: 3,
			backoff: exponentialBackoff({
				baseDelay: "5s",
				maxDelay: "5m",
			}),
		},
		removeOnFail: {
			age: "7d",
		},
	},
	locations: ["./app/jobs/**/*.{ts,js}", "./app/modules/*/jobs/**/*.{ts,js}"],
});
