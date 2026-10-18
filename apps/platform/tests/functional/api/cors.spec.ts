import { test } from "@japa/runner";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";

const ORIGIN = "https://api-needle-32.tattoodrip.com";

test.group("Public API: CORS", () => {
	test("a read from any origin is allowed, without credentials", async ({
		client,
		assert,
	}) => {
		const response = await client
			.get("/api/v1/__test/ok")
			.header("origin", ORIGIN);

		response.assertStatus(200);
		response.assertHeader("access-control-allow-origin", "*");
		assert.isUndefined(response.header("access-control-allow-credentials"));
	});

	test("an error is readable cross-origin, and a 429 exposes Retry-After", async ({
		client,
	}) => {
		const response = await client
			.get("/api/v1/__test/throttled")
			.header("origin", ORIGIN);

		assertApiError(response, 429, "rate_limited");
		response.assertHeader("access-control-expose-headers", "retry-after");
	});

	test("a JSON write's preflight is allowed for 10 minutes, without credentials", async ({
		client,
		assert,
	}) => {
		const response = await client
			.options("/api/v1/__test/echo")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type");

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", "*");
		response.assertHeader("access-control-allow-methods", "GET,HEAD,POST");
		response.assertHeader(
			"access-control-allow-headers",
			"accept,content-type,x-challenge-token",
		);
		response.assertHeader("access-control-max-age", "600");
		assert.isUndefined(response.header("access-control-allow-credentials"));
		assertNoCookies(response);
	});

	test("a write's preflight may name the bot-challenge token header (TAT-55)", async ({
		client,
		assert,
	}) => {
		const response = await client
			.options("/api/v1/__test/echo")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header(
				"access-control-request-headers",
				"content-type,x-challenge-token",
			);

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", "*");
		response.assertHeader(
			"access-control-allow-headers",
			"accept,content-type,x-challenge-token",
		);
		assert.isUndefined(response.header("access-control-allow-credentials"));
		assertNoCookies(response);
	});

	test("a preflight for another method or for Authorization is refused", async ({
		client,
		assert,
	}) => {
		for (const [method, headers] of [
			["PUT", "content-type"],
			["POST", "authorization"],
		]) {
			const response = await client
				.options("/api/v1/__test/echo")
				.header("origin", ORIGIN)
				.header("access-control-request-method", method)
				.header("access-control-request-headers", headers);

			response.assertStatus(204);
			assert.isUndefined(
				response.header("access-control-allow-origin"),
				`${method} ${headers}`,
			);
		}
	});

	test("the dashboard answers no cross-origin request", async ({
		client,
		assert,
	}) => {
		const page = await client.get("/login").header("origin", ORIGIN);
		assert.isUndefined(page.header("access-control-allow-origin"));

		const preflight = await client
			.options("/login")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST");
		assert.isUndefined(preflight.header("access-control-allow-origin"));
		assert.isUndefined(preflight.header("access-control-allow-credentials"));
	});
});
