import { randomUUID } from "node:crypto";
import { errors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
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
});
