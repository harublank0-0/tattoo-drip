import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const tenancy = new TenancyService();

/**
 * What the function answers for `slug`, as the app role with no context.
 * It sees every tenant's committed rows (the dev database's too), so the
 * "unknown" slugs below are ones no dev studio has.
 */
async function lookup(slug: string | null) {
	// A bound null isn't a typed binding value, so null is written inline.
	const { rows } =
		slug === null
			? await sql({}, "select public.tenant_for_slug(null) as id")
			: await sql({}, "select public.tenant_for_slug(?) as id", [slug]);
	return rows[0].id as string | null;
}

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("tenant_for_slug()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the tenant of its current slug, though the app role alone sees no tenant", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");

		const { rows } = await sql({}, "select count(*)::int as n from tenants");
		assert.equal(rows[0].n, 0);
		assert.equal(await lookup("api-needle-32"), tenant.id);
	});

	test("gives the same tenant for each of its old slugs", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-first-32");
		await changeSlug(tenant, "api-second-32");
		await changeSlug(tenant, "api-third-32");

		for (const slug of ["api-first-32", "api-second-32", "api-third-32"]) {
			assert.equal(await lookup(slug), tenant.id, slug);
		}
	});

	test("resolves a grandfathered slug that the new rules refuse", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-legacy-32");
		// Old data has such slugs (TAT-24 ruling 4); the trigger registers it.
		// A double hyphen, with a name only this test uses: the unique index is
		// platform-wide and the dev database may hold a studio called a--b.
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set slug = 'api--legacy-32' where id = ?",
				[tenant.id],
			),
		);

		assert.equal(await lookup("api--legacy-32"), tenant.id);
	});

	test("gives null for an unknown slug, another case, a pattern, an empty string or null", async ({
		assert,
	}) => {
		await studioWithOwner("api-needle-32");

		for (const slug of [
			"no-such-studio-td32",
			"Api-Needle-32",
			"API-NEEDLE-32",
			"api-needle-3%",
			"api_needle_32",
			"api-needle-3_",
			"%",
			"",
			" api-needle-32",
			null,
		]) {
			assert.isNull(await lookup(slug), String(slug));
		}
	});

	test("gives null for a deleted tenant's current and old slugs", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");
		await inTenant(tenant, () => tenant.softDelete());

		assert.isNull(await lookup("api-red-32"));
		assert.isNull(await lookup("api-needle-32"));
	});

	test("only the app role may call it, with one text argument, as its owner with a pinned search_path", async ({
		assert,
	}) => {
		const { rows } = await sql(
			{},
			`select p.prosecdef as definer,
			        p.proisstrict as strict,
			        p.provolatile as volatility,
			        p.proretset as returns_set,
			        p.proconfig,
			        pg_get_function_identity_arguments(p.oid) as args,
			        pg_get_function_result(p.oid) as result,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run,
			        has_function_privilege(current_user, p.oid, 'execute') as app_can_run,
			        pg_get_userbyid(p.proowner) <> current_user as owned_by_another_role
			 from pg_proc p
			 where p.oid = 'public.tenant_for_slug(text)'::regprocedure`,
		);

		assert.deepEqual(rows, [
			{
				definer: true,
				strict: true,
				volatility: "s",
				returns_set: false,
				proconfig: ["search_path=pg_catalog, pg_temp"],
				args: "requested_slug text",
				result: "uuid",
				public_can_run: false,
				app_can_run: true,
				owned_by_another_role: true,
			},
		]);
	});
});
