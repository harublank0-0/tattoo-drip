import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import { sql } from "#tests/helpers/sql";
import { inTenant, twoStudios } from "#tests/helpers/tenants";

async function liveIds() {
	const { rows } = await sql({}, "select tenant_id from public.live_tenants()");
	return rows.map((r: { tenant_id: string }) => r.tenant_id);
}

test.group("live_tenants()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every live studio's id to the app role, which sees no tenant row itself", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const { rows: seen } = await sql(
			{},
			"select count(*)::int as n from tenants",
		);
		assert.equal(seen[0].n, 0);
		assert.includeMembers(await liveIds(), [a.tenant.id, b.tenant.id]);
	});

	test("leaves out a deleted studio", async ({ assert }) => {
		const { a, b } = await twoStudios();
		await inTenant(b.tenant, async () =>
			(await Tenant.findOrFail(b.tenant.id)).softDelete(),
		);
		const ids = await liveIds();
		assert.include(ids, a.tenant.id);
		assert.notInclude(ids, b.tenant.id);
	});
});
