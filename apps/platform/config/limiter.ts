import app from "@adonisjs/core/services/app";
import { defineConfig, stores } from "@adonisjs/limiter";

/**
 * Rate-limit counters (TAT-8). Development and production keep them in
 * Postgres (`rate_limits`), shared by every web process; no Redis in V1.
 * The store writes as the app role on the `limiter` connection
 * (config/database.ts), a small pool of its own and outside the request
 * transaction, so a failed login still counts after the request rolls
 * back. The public deposit routes count inside a request that already
 * holds a `pg` connection (TAT-65): on the same pool, concurrent requests
 * could each wait for a second connection and stall the app. Tests use the
 * memory store, which tests/bootstrap.ts empties before each test.
 */
const limiterConfig = defineConfig({
	default: app.inTest ? "memory" : "database",
	stores: {
		database: stores.database({
			connectionName: "limiter",
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
