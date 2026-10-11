import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import vine from "@vinejs/vine";
import PaymentMethod from "#modules/payments/models/payment_method";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * In a test, a request's transaction is a savepoint on the test's one
 * connection, so a query that bypasses it (db.from, db.rawQuery,
 * db.transaction, Vine's unique and exists rules) would see the request's
 * tenant settings here. In production it takes a second pooled connection
 * with no settings, sees nothing and needs two pool slots per request. The
 * tripwire in tests/bootstrap.ts makes such a call fail the test run.
 */
const ESCAPED = /db\.connection\(\) called inside a request\/job transaction/;

test.group("Queries that escape the request transaction", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("db.rawQuery inside a context throws", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await assert.rejects(
			() => inTenant(tenant, () => db.rawQuery("select 1")),
			ESCAPED,
		);
	});

	test("db.from inside a context throws", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await assert.rejects(
			() => inTenant(tenant, async () => db.from("payment_methods")),
			ESCAPED,
		);
	});

	test("db.transaction inside a context throws", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await assert.rejects(
			() => inTenant(tenant, () => db.transaction(async () => undefined)),
			ESCAPED,
		);
	});

	test("Vine's exists and unique rules inside a context throw", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const exists = vine.create({
			slug: vine.string().exists({ table: "tenants", column: "slug" }),
		});
		const unique = vine.create({
			slug: vine.string().unique({ table: "tenants", column: "slug" }),
		});

		for (const validator of [exists, unique]) {
			await assert.rejects(
				() =>
					inTenant(tenant, () => validator.validate({ slug: "black-needle" })),
				ESCAPED,
			);
		}
	});

	test("a handler that uses the db service fails the request", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client.get("/__test/db/escaped").loginAs(owner);

		response.assertStatus(500);
	});

	test("models, dbClient() and withTransaction still work inside a context", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			await PaymentMethod.create({
				tenantId: tenant.id,
				kind: "cash",
				label: "Cash",
				position: 0,
			});
			const { rows } = await dbClient().rawQuery(
				"select count(*)::int as n from payment_methods",
			);
			assert.equal(rows[0].n, 1);
			const viaTransaction = await withTransaction((trx) =>
				trx.from("payment_methods").count("* as n"),
			);
			assert.equal(Number(viaTransaction[0].n), 1);
			assert.lengthOf(await PaymentMethod.query(), 1);
		});
	});

	test("the owner connection and calls outside any context are untouched", async ({
		assert,
	}) => {
		const owned = await db.connection("owner").rawQuery("select 1 as one");
		assert.equal(owned.rows[0].one, 1);

		const outside = await db.rawQuery("select 1 as one");
		assert.equal(outside.rows[0].one, 1);

		await inTenant({ id: "00000000-0000-0000-0000-000000000000" }, async () => {
			const stillOwner = await db
				.connection("owner")
				.rawQuery("select 2 as two");
			assert.equal(stillOwner.rows[0].two, 2);
		});
	});
});
