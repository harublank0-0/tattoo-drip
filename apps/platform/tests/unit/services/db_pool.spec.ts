import { test } from "@japa/runner";
import { http } from "#config/app";
import dbConfig from "#config/database";
import { LIMITER_POOL, pgPoolFor } from "#services/db_pool";

test.group("Database pools (TAT-38)", () => {
	test("the web server's pool is explicit, with a short wait; ace's is smaller", ({
		assert,
	}) => {
		assert.deepEqual(pgPoolFor("web"), {
			min: 2,
			max: 10,
			acquireTimeoutMillis: 10_000,
		});
		assert.deepEqual(pgPoolFor("test"), pgPoolFor("web"));
		// The worker (an ace command) runs 5 jobs at once (config/queue.ts).
		assert.deepEqual(pgPoolFor("console"), {
			min: 0,
			max: 6,
			acquireTimeoutMillis: 10_000,
		});
	});

	test("config/database.ts uses them, and the limiter waits less", ({
		assert,
	}) => {
		assert.deepEqual(dbConfig.connections.pg.pool, pgPoolFor("test"));
		assert.deepEqual(dbConfig.connections.limiter.pool, LIMITER_POOL);
		assert.deepEqual(LIMITER_POOL, {
			min: 0,
			max: 4,
			acquireTimeoutMillis: 5_000,
		});
	});

	test("Node's own request timeout is the backstop: 120 s", ({ assert }) => {
		assert.equal(http.requestTimeout, 120_000);
	});
});
