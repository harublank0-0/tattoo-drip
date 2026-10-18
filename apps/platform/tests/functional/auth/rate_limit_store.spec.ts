import { randomUUID } from "node:crypto";
import { errors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import { dbClient } from "#services/db_context";

/**
 * The Postgres store that development and production use (the test run
 * defaults to the memory store, config/limiter.ts). No global transaction
 * here: the store keeps the database client it was created with, and a
 * test's transaction is gone after that test. The key is unique to this run
 * and removed afterwards.
 */
test.group("Rate limit store", (group) => {
	const key = `store_spec_${randomUUID()}`;
	const store = () =>
		limiter.use("database", { requests: 2, duration: "1 minute" });
	group.teardown(async () => {
		await store().delete(key);
	});

	test("counts, refuses and resets a key in rate_limits as the app role", async ({
		assert,
	}) => {
		await store().consume(key);
		await store().consume(key);
		await assert.rejects(
			() => store().consume(key),
			errors.E_TOO_MANY_REQUESTS,
		);

		const rows = await dbClient()
			.from("rate_limits")
			.where("key", "like", `%${key}`);
		assert.lengthOf(rows, 1);
		const state = await store().get(key);
		assert.equal(state?.remaining, 0);
		assert.isAbove(state?.availableIn ?? 0, 0);
		assert.isAtMost(state?.availableIn ?? 0, 60);

		await store().delete(key);
		assert.isNull(await store().get(key));
		await store().consume(key);
	});

	test("counts while every connection of the request pool is held, as a public request's limiter does", async ({
		assert,
	}) => {
		// A public deposit request holds a pool connection in its transaction
		// when depositThrottle consumes. If the store drew from that same pool,
		// enough concurrent requests would each wait for a second connection
		// that never frees up (until the 60 s acquire timeout).
		const { pool } = db.connection().getWriteClient().client;
		const held = await Promise.all(
			Array.from({ length: pool.max }, () => db.transaction()),
		);
		let timer: NodeJS.Timeout | undefined;
		try {
			const outcome = await Promise.race([
				store()
					.consume(key)
					.then(() => "counted"),
				new Promise<string>((resolve) => {
					timer = setTimeout(() => resolve("waited for a connection"), 3000);
				}),
			]);
			assert.equal(outcome, "counted");
		} finally {
			clearTimeout(timer);
			await Promise.all(held.map((trx) => trx.rollback()));
		}
	});

	test("the limiter has a connection of its own: the app role, a small bounded pool", ({
		assert,
	}) => {
		const own = db.manager.get("limiter")?.config;
		const main = db.manager.get(db.primaryConnectionName)?.config;

		assert.exists(own, "config/database.ts registers a `limiter` connection");
		assert.deepEqual(own?.connection, main?.connection);
		const pool = own?.pool;
		assert.isAtLeast(pool?.max ?? 0, 2);
		assert.isAtMost(pool?.max ?? 99, 5);
		assert.equal(pool?.min, 0);
	});
});
