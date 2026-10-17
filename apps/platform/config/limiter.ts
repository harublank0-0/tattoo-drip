import app from "@adonisjs/core/services/app";
import { defineConfig, stores } from "@adonisjs/limiter";

/**
 * Rate-limit counters (TAT-8). Development and production keep them in
 * Postgres (`rate_limits`), shared by every web process; no Redis in V1.
 * The store writes on its own pooled connection as the app role, outside
 * the request transaction, so a failed login still counts after the
 * request rolls back. Tests use the memory store, which tests/bootstrap.ts
 * empties before each test.
 */
const limiterConfig = defineConfig({
	default: app.inTest ? "memory" : "database",
	stores: {
		database: stores.database({
			connectionName: "pg",
			tableName: "rate_limits",
			// Every 5 minutes, delete rows that expired over an hour ago.
			clearExpiredByTimeout: true,
		}),
		memory: stores.memory({}),
	},
});

export default limiterConfig;

declare module "@adonisjs/limiter/types" {
	export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
