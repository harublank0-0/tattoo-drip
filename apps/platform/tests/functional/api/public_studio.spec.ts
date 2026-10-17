import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const tenancy = new TenancyService();

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("GET /api/v1/tenants/:tenant (getStudio)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers exactly the contract's minimal Studio", async ({ client }) => {
		await studioWithOwner("api-needle-32", "Black Needle");

		const response = await client.get("/api/v1/tenants/api-needle-32");

		assertApiData(response, { slug: "api-needle-32", name: "Black Needle" });
		assertApiHeaders(response);
	});

	test("under an old slug, answers with the current slug", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		await changeSlug(tenant, "api-red-32");

		assertApiData(await client.get("/api/v1/tenants/api-needle-32"), {
			slug: "api-red-32",
			name: "Black Needle",
		});
	});

	test("is cacheable: public, stale-while-revalidate, an ETag, and a 304 for a matching If-None-Match", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-needle-32");

		const first = await client.get("/api/v1/tenants/api-needle-32");
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", etag);
		again.assertStatus(304);
		again.assertHeader("cache-control", CACHED);
		again.assertHeader("etag", etag);
		assertNoCookies(again);
	});

	test("a changed studio gets a new ETag, and the old tag a full answer", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		const before =
			(await client.get("/api/v1/tenants/api-needle-32")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set name = 'Red Needle' where id = ?",
				[tenant.id],
			),
		);
		const after = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", before);

		assertApiData(after, { slug: "api-needle-32", name: "Red Needle" });
		assert.notEqual(after.header("etag"), before);
	});

	test("HEAD has the same cache headers and no body", async ({ client }) => {
		await studioWithOwner("api-needle-32");
		const etag = (await client.get("/api/v1/tenants/api-needle-32")).header(
			"etag",
		);

		const head = await client.head("/api/v1/tenants/api-needle-32");

		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
		assertNoCookies(head);
	});

	test("an unknown tenant is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-needle-32");

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td32"),
			404,
			"not_found",
		);
		const post = await client.post("/api/v1/tenants/api-needle-32").json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
