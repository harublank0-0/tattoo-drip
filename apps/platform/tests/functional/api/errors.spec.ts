import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
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

test.group("Public API: each error class over HTTP", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("invalid fields are validation_failed with fields", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "owner@example.com",
			password: "secret-password",
		});
		const response = await client
			.post("/api/v1/__test/echo")
			.json({ label: "" })
			.loginAs(user);

		assertApiError(response, 422, "validation_failed");
		assert.properties(response.body().error.fields, ["label"]);
	});

	test("a body that isn't JSON, or a JSON string, is bad_request", async ({
		client,
	}) => {
		assertApiError(
			await client.post("/api/v1/__test/echo").unsafeJson('{"label":'),
			400,
			"bad_request",
		);
		assertApiError(
			await client.post("/api/v1/__test/echo").unsafeJson('"just a string"'),
			400,
			"bad_request",
		);
	});

	test("a body over the limit is payload_too_large", async ({ client }) => {
		const response = await client
			.post("/api/v1/__test/echo")
			.json({ label: "x".repeat(1_100_000) });

		assertApiError(response, 413, "payload_too_large");
	});

	test("another method on a known path is method_not_allowed with Allow", async ({
		client,
	}) => {
		const put = await client.put("/api/v1/__test/ok");
		assertApiError(put, 405, "method_not_allowed");
		put.assertHeader("allow", "GET, HEAD");

		const remove = await client.delete("/api/v1/__test/echo");
		assertApiError(remove, 405, "method_not_allowed");
		remove.assertHeader("allow", "POST");
	});

	test("a rate limit is rate_limited with Retry-After", async ({ client }) => {
		const response = await client.get("/api/v1/__test/throttled");

		assertApiError(response, 429, "rate_limited");
		response.assertHeader("retry-after", "42");
	});

	test("a server error is internal_error with no message, stack or detail", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "owner@example.com",
			password: "secret-password",
		});
		const response = await client.get("/api/v1/__test/throws").loginAs(user);

		assertApiError(response, 500, "internal_error");
		assert.deepEqual(response.body(), {
			error: {
				code: "internal_error",
				message: "Something went wrong. Try again later.",
			},
		});
		assert.notInclude(response.text(), "10.0.0.5");
	});
});
