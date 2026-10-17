import { test } from "@japa/runner";
import { assertApiError } from "#tests/helpers/api";

test.group("Public API: errors", () => {
	test("an unknown API path is not_found in the envelope", async ({
		client,
		assert,
	}) => {
		for (const url of [
			"/api",
			"/api/v1",
			"/api/v1/nope",
			"/api/v2/tenants/api-needle-32",
		]) {
			const response = await client.get(url);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(
				response.body(),
				{ error: { code: "not_found", message: "Not found." } },
				url,
			);
		}
	});

	test("a dashboard URL still gets the dashboard's 404, not the envelope", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/no-such-page");

		response.assertStatus(404);
		assert.isUndefined(response.header("access-control-allow-origin"));
		assert.notDeepInclude(response.body() ?? {}, {
			error: { code: "not_found", message: "Not found." },
		});
	});
});
