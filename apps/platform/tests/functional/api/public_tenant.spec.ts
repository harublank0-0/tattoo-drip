import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import {
	assertApiData,
	assertApiError,
	assertNoCookies,
} from "#tests/helpers/api";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const tenancy = new TenancyService();

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

/** What the db echo route answers when the request runs as `tenant`. */
function runsAs(tenant: { id: string }, slug: string) {
	return {
		user_id: "",
		tenant_id: tenant.id,
		visible_tenant_ids: [tenant.id],
		tenantSlug: slug,
	};
}

test.group("Public API: the tenant from the path", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("runs the request as the tenant of the current slug, with no user", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");

		const response = await client.get(
			"/api/v1/tenants/api-needle-32/__test/db",
		);

		assertApiData(response, runsAs(tenant, "api-needle-32"));
	});

	test("a signed-in owner of another studio still runs as no one, and sees only the path's tenant", async ({
		client,
	}) => {
		const a = await studioWithOwner("api-studio-a-32", "Studio A");
		const b = await studioWithOwner("api-studio-b-32", "Studio B");

		const response = await client
			.get("/api/v1/tenants/api-studio-a-32/__test/db")
			.loginAs(b.owner);

		assertApiData(response, runsAs(a.tenant, "api-studio-a-32"));
		assertNoCookies(response);
	});

	test("grandfathered slugs that the new rules refuse still resolve", async ({
		client,
		assert,
	}) => {
		// The registry's unique index is platform-wide and shared with the dev
		// database, so these slugs have the shapes TAT-24 ruling 4 keeps (digits
		// only, a double hyphen, punycode) under names only this test uses. The
		// reserved word has no such variant: it must be www itself, so the test
		// stops with a clear message if a committed studio already holds it.
		const taken = await sql({}, "select public.tenant_for_slug('www') as id");
		assert.isNull(
			taken.rows[0].id,
			"a committed dev studio holds the slug www; rename it to run this test",
		);

		for (const [index, slug] of [
			"32032",
			"api--legacy-32",
			"xn--api-legacy-32",
			"www",
		].entries()) {
			const { tenant } = await studioWithOwner(`api-legacy-32-${index}`);
			// Old data has such slugs (TAT-24 ruling 4); the trigger registers it.
			await inTenant(tenant, () =>
				dbClient().rawQuery("update tenants set slug = ? where id = ?", [
					slug,
					tenant.id,
				]),
			);

			assertApiData(
				await client.get(`/api/v1/tenants/${slug}/__test/db`),
				runsAs(tenant, slug),
			);
		}
	});

	test("an old slug serves reads as the same tenant, GET and HEAD", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");

		assertApiData(
			await client.get("/api/v1/tenants/api-needle-32/__test/db"),
			runsAs(tenant, "api-red-32"),
		);
		const head = await client.head("/api/v1/tenants/api-needle-32/__test/db");
		head.assertStatus(200);
	});

	test("a write under the current slug runs; under an old slug it is a 404, even with a body that fails validation", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");

		assertApiData(
			await client
				.post("/api/v1/tenants/api-red-32/__test/echo")
				.json({ label: "Hi" }),
			{
				slug: "api-red-32",
				label: "Hi",
			},
		);
		for (const body of [{ label: "Hi" }, { label: "" }]) {
			const response = await client
				.post("/api/v1/tenants/api-needle-32/__test/echo")
				.json(body);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), {
				error: { code: "not_found", message: "Not found." },
			});
		}
	});

	test("an unreadable body is the same 400 under an old, an unknown or a shapeless slug: the parser runs before the tenant check", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");

		// Body parsing happens before publicTenant (the bodyparser is in
		// router.use), so a body that cannot be read is a 400 whatever the
		// slug. That is not an oracle: the old slug and an unknown one answer
		// alike. The alias 404 comes before validators, handlers and writes.
		for (const unreadable of ['{"label":', '"just a string"']) {
			const bodies = [];
			for (const slug of [
				"api-red-32",
				"api-needle-32",
				"no-such-studio-td32",
				"Api-Needle-32",
			]) {
				const response = await client
					.post(`/api/v1/tenants/${slug}/__test/echo`)
					.unsafeJson(unreadable);
				assertApiError(response, 400, "bad_request");
				bodies.push(response.body());
			}
			for (const body of bodies) assert.deepEqual(body, bodies[0], unreadable);
		}
	});

	test("unknown, other-case, shapeless, too long and deleted slugs are the same 404", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-needle-32");
		const gone = await studioWithOwner("api-gone-32", "Gone Ink");
		await changeSlug(gone.tenant, "api-gone-32-b");
		await inTenant(gone.tenant, () => gone.tenant.softDelete());

		for (const slug of [
			"no-such-studio-td32",
			"Api-Needle-32",
			"API-NEEDLE-32",
			"api_needle_32",
			"-api-needle-32",
			"ab",
			"a".repeat(64),
			"x".repeat(10_000),
			"%E2%84%AAat",
			"api-gone-32",
			"api-gone-32-b",
		]) {
			const response = await client.get(`/api/v1/tenants/${slug}/__test/db`);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(
				response.body(),
				{ error: { code: "not_found", message: "Not found." } },
				slug.slice(0, 40),
			);
		}
	});

	test("publicTenantContext fails loudly outside the tenant group", async ({
		assert,
	}) => {
		const ctx = await testUtils.createHttpContext();

		assert.throws(() => publicTenantContext(ctx), /api\/v1\/tenants/);
	});
});
