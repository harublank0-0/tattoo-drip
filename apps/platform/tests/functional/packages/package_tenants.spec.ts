import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { dbClient } from "#services/db_context";
import { seedBilling } from "#tests/helpers/online_payments";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * `package_tenants()` (studio packages, the admin Billing page): the ids of
 * every live studio, read across tenants by a SECURITY DEFINER function, so
 * its properties are pinned here (database/README.md). It sees every
 * tenant's committed rows, and locally the tests share the dev database, so
 * only the test's own studios are asserted.
 */
test.group("package_tenants()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every live studio, with or without billing, and leaves out deleted ones", async ({
		assert,
	}) => {
		const live = await studioWithOwner("pkg-ten-live", "Pkg Live");
		const other = await studioWithOwner("pkg-ten-other", "Pkg Other");
		const gone = await studioWithOwner("pkg-ten-gone", "Pkg Gone");
		// One billing customer; the others never subscribed.
		await seedBilling(live.tenant);
		await inTenant(gone.tenant, () =>
			dbClient().rawQuery(
				"update tenants set deleted_at = now() where id = ?",
				[gone.tenant.id],
			),
		);

		// The app role alone, with no studio context, sees no tenant.
		const visible = await sql({}, "select count(*)::int as n from tenants");
		assert.equal(visible.rows[0].n, 0);

		const { rows } = await sql({}, "select * from public.package_tenants()");
		const ours = new Set([live.tenant.id, other.tenant.id, gone.tenant.id]);
		assert.sameMembers(
			(rows as { tenant_id: string }[])
				.map(({ tenant_id }) => tenant_id)
				.filter((id) => ours.has(id)),
			[live.tenant.id, other.tenant.id],
		);
	});

	test("only the app role may call it, and it runs as its owner with a pinned search_path, no arguments and ids only", async ({
		assert,
	}) => {
		const { rows } = await sql(
			{},
			`select p.prosecdef as definer,
			        p.proconfig,
			        pg_get_function_arguments(p.oid) as args,
			        pg_get_function_result(p.oid) as result,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run,
			        has_function_privilege(current_user, p.oid, 'execute') as app_can_run,
			        pg_get_userbyid(p.proowner) <> current_user as owned_by_another_role
			 from pg_proc p
			 where p.oid = 'public.package_tenants()'::regprocedure`,
		);

		assert.deepEqual(rows, [
			{
				definer: true,
				proconfig: ["search_path=pg_catalog, pg_temp"],
				args: "",
				result: "TABLE(tenant_id uuid)",
				public_can_run: false,
				app_can_run: true,
				owned_by_another_role: true,
			},
		]);
	});
});
