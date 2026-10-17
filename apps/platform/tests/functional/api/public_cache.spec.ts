import { test } from "@japa/runner";
import { assertApiData, assertApiError } from "#tests/helpers/api";

const CACHED = "public, max-age=60, stale-while-revalidate=600";

test.group("Public API: publicCache", () => {
	test("a 200 read is cacheable, JSON, with an ETag", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/api/v1/__test/cached/ok");

		assertApiData(response, { ok: true });
		response.assertHeader("cache-control", CACHED);
		assert.match(response.header("etag") ?? "", /^(W\/)?"[^"]+"$/);
		assert.match(response.header("content-type") ?? "", /^application\/json/);
	});

	test("a bigint is serialized as a string, as the framework does, and stays cacheable", async ({
		client,
	}) => {
		const response = await client.get("/api/v1/__test/cached/bigint");

		assertApiData(response, { amount: "10" });
		response.assertHeader("cache-control", CACHED);
	});

	test("a body that cannot be serialized is a no-store internal_error, never a cacheable 500", async ({
		client,
		assert,
	}) => {
		for (const path of ["cached/getter", "cached/circular"]) {
			const response = await client.get(`/api/v1/__test/${path}`);

			assertApiError(response, 500, "internal_error");
			assert.deepEqual(
				response.body(),
				{
					error: {
						code: "internal_error",
						message: "Something went wrong. Try again later.",
					},
				},
				path,
			);
			assert.isUndefined(response.header("etag"), path);
			assert.notInclude(response.text(), "10.0.0.5", path);
			assert.match(
				response.header("content-type") ?? "",
				/^application\/json/,
				path,
			);
		}
	});
});
