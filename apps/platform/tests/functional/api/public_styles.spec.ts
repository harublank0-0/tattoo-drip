import { test } from "@japa/runner";
import { TATTOO_STYLES } from "#modules/artists/styles";
import {
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";

const CACHED = "public, max-age=60, stale-while-revalidate=600";

test.group("GET /api/v1/styles (listStyles)", () => {
	test("lists the 18 styles in the list's order as slug and name, cacheable, under no studio", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/api/v1/styles");

		response.assertStatus(200);
		assertApiHeaders(response);
		response.assertHeader("cache-control", CACHED);
		const { data } = response.body();
		assert.lengthOf(data, 18);
		assert.deepEqual(data[0], { slug: "blackwork", name: "Blackwork" });
		assert.deepEqual(
			data,
			TATTOO_STYLES.map(({ slug, name }) => ({ slug, name })),
		);
		for (const style of data) {
			assert.deepEqual(Object.keys(style).sort(), ["name", "slug"]);
		}
		assert.deepEqual(Object.keys(response.body()), ["data"]);
	});

	test("has an ETag and answers a matching If-None-Match with a 304; HEAD the same", async ({
		client,
		assert,
	}) => {
		const first = await client.get("/api/v1/styles");
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client
			.get("/api/v1/styles")
			.header("if-none-match", etag);
		again.assertStatus(304);
		assertNoCookies(again);
		const head = await client.head("/api/v1/styles");
		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
	});

	test("a POST is a 405 with Allow, no-store", async ({ client }) => {
		const post = await client.post("/api/v1/styles").json({});

		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
