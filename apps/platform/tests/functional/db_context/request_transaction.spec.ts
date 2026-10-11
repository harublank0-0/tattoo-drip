import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { studioWithOwner } from "#tests/helpers/tenants";
import { hooks } from "#tests/support/test_routes";

test.group("Request transaction", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		hooks.length = 0;
	});

	test("a successful request commits and fires afterCommit", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/ok")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(204);
		assert.isNotNull(await User.findBy("email", "route-ok@example.com"));
		assert.deepEqual(hooks, ["commit"]);
	});

	test("an application error rolls back, fires afterRollback and still renders", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/throws")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(500);
		assert.isNull(await User.findBy("email", "route-throws@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("an uncaught SQL error rolls back and the error page still renders", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/sql-error")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(500);
		assert.isNull(await User.findBy("email", "route-sql-error@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("a validation error after a write rolls the write back", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		await client
			.post("/__test/db/invalid")
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assert.isNull(await User.findBy("email", "route-invalid@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("the request sees the user's id and no tenant on a non-tenant route", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client.get("/__test/db/settings").loginAs(owner);

		response.assertStatus(200);
		assert.equal(response.body().user_id, owner.id);
		assert.notOk(response.body().tenant_id);
	});

	test("a tenant route sees both the user's id and the tenant's id", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.get("/t/black-needle/__test/db/settings")
			.loginAs(owner);

		response.assertStatus(200);
		assert.equal(response.body().user_id, owner.id);
		assert.equal(response.body().tenant_id, tenant.id);
	});

	test("a tenant page sets the tenant, and the next request does not inherit it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client.get("/t/black-needle").loginAs(owner);
		const response = await client.get("/__test/db/settings").loginAs(owner);

		assert.equal(response.body().user_id, owner.id);
		assert.notEqual(response.body().tenant_id, tenant.id);
		assert.notOk(response.body().tenant_id);
	});
});
