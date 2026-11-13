import { test } from "@japa/runner";
import env from "#start/env";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";

/**
 * The allowed browser origins (Discover D01, config/cors.ts), from
 * .env.test: every studio page under STOREFRONT_URL
 * (http://{tenant}.localhost:3000), Discover (DISCOVER_URL) and the dashboard
 * (APP_URL). Everything else gets no allow-origin header.
 */
const STUDIO_PAGE = "http://api-needle-32.localhost:3000";
const DISCOVER = "http://discover.localhost:3002";

const REFUSED = [
	"https://evil.example",
	// The studio pages' apex is not a studio's page. (www has a slug's shape:
	// it is the storefront's own landing page, a host we serve, so it passes.)
	"http://localhost:3000",
	// A studio host on another scheme, port or level.
	"https://api-needle-32.localhost:3000",
	"http://api-needle-32.localhost:3001",
	"http://api-needle-32.localhost",
	"http://x.api-needle-32.localhost:3000",
	// Not a stored slug's shape; browsers send hosts in lower case.
	"http://a.localhost:3000",
	"http://-needle.localhost:3000",
	"http://API-NEEDLE-32.localhost:3000",
	// Lookalikes of the allowed origins.
	"http://api-needle-32.localhost:3000.evil.example",
	"http://discover.localhost:3002.evil.example",
	"http://evil-discover.localhost:3002",
	// Sandboxed frames, file: pages and data: URLs.
	"null",
];

test.group("Public API: CORS", () => {
	test("a read from a studio's page is allowed, without credentials", async ({
		client,
		assert,
	}) => {
		const response = await client
			.get("/api/v1/__test/ok")
			.header("origin", STUDIO_PAGE);

		response.assertStatus(200);
		response.assertHeader("access-control-allow-origin", STUDIO_PAGE);
		response.assertHeader("vary", "Origin");
		assert.isUndefined(response.header("access-control-allow-credentials"));
	});

	test("Discover and the dashboard are allowed origins too", async ({
		client,
	}) => {
		const dashboard = new URL(env.get("APP_URL")).origin;
		for (const origin of [DISCOVER, dashboard]) {
			const response = await client
				.get("/api/v1/__test/ok")
				.header("origin", origin);

			response.assertStatus(200);
			response.assertHeader("access-control-allow-origin", origin);
		}
	});

	test("any other origin gets no allow-origin header, never a wildcard", async ({
		client,
		assert,
	}) => {
		for (const origin of REFUSED) {
			const response = await client
				.get("/api/v1/__test/ok")
				.header("origin", origin);

			// CORS only decides what a browser may read: the answer itself is the same.
			response.assertStatus(200);
			assert.isUndefined(
				response.header("access-control-allow-origin"),
				origin,
			);
			assert.isUndefined(
				response.header("access-control-allow-credentials"),
				origin,
			);
			response.assertHeader("vary", "Origin");
		}
	});

	test("a server-side call (no Origin) needs no CORS and gets no allow-origin header", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/api/v1/__test/ok");

		response.assertStatus(200);
		assert.isUndefined(response.header("access-control-allow-origin"));
		response.assertHeader("vary", "Origin");
	});

	test("an error is readable cross-origin, and a 429 exposes Retry-After", async ({
		client,
	}) => {
		const response = await client
			.get("/api/v1/__test/throttled")
			.header("origin", STUDIO_PAGE);

		assertApiError(response, 429, "rate_limited");
		response.assertHeader("access-control-allow-origin", STUDIO_PAGE);
		response.assertHeader("access-control-expose-headers", "retry-after");
	});

	test("a JSON write's preflight is allowed for 10 minutes, without credentials", async ({
		client,
		assert,
	}) => {
		const response = await client
			.options("/api/v1/__test/echo")
			.header("origin", STUDIO_PAGE)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type");

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", STUDIO_PAGE);
		response.assertHeader(
			"access-control-allow-methods",
			"GET,HEAD,POST,PUT,DELETE",
		);
		response.assertHeader(
			"access-control-allow-headers",
			"accept,content-type,x-challenge-token,x-review-token",
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
			.header("origin", STUDIO_PAGE)
			.header("access-control-request-method", "POST")
			.header(
				"access-control-request-headers",
				"content-type,x-challenge-token",
			);

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", STUDIO_PAGE);
		response.assertHeader(
			"access-control-allow-headers",
			"accept,content-type,x-challenge-token,x-review-token",
		);
		assert.isUndefined(response.header("access-control-allow-credentials"));
		assertNoCookies(response);
	});

	test("a preflight from any other origin is refused", async ({
		client,
		assert,
	}) => {
		for (const origin of REFUSED) {
			const response = await client
				.options("/api/v1/__test/echo")
				.header("origin", origin)
				.header("access-control-request-method", "POST")
				.header(
					"access-control-request-headers",
					"content-type,x-challenge-token",
				);

			response.assertStatus(204);
			assert.isUndefined(
				response.header("access-control-allow-origin"),
				origin,
			);
			assert.isUndefined(
				response.header("access-control-allow-methods"),
				origin,
			);
			assertNoCookies(response);
		}
	});

	test("a preflight for another method or for Authorization is refused", async ({
		client,
		assert,
	}) => {
		// PUT and DELETE are the review page's (Reviews and Fresh ink); PATCH
		// stays refused.
		for (const [method, headers] of [
			["PATCH", "content-type"],
			["POST", "authorization"],
			["POST", "cookie"],
		]) {
			const response = await client
				.options("/api/v1/__test/echo")
				.header("origin", STUDIO_PAGE)
				.header("access-control-request-method", method)
				.header("access-control-request-headers", headers);

			response.assertStatus(204);
			assert.isUndefined(
				response.header("access-control-allow-origin"),
				`${method} ${headers}`,
			);
		}
	});

	test("the dashboard answers no cross-origin request, even from an allowed origin", async ({
		client,
		assert,
	}) => {
		for (const origin of [STUDIO_PAGE, DISCOVER]) {
			const page = await client.get("/login").header("origin", origin);
			assert.isUndefined(page.header("access-control-allow-origin"), origin);

			const preflight = await client
				.options("/login")
				.header("origin", origin)
				.header("access-control-request-method", "POST");
			assert.isUndefined(
				preflight.header("access-control-allow-origin"),
				origin,
			);
			assert.isUndefined(
				preflight.header("access-control-allow-credentials"),
				origin,
			);
		}
	});
});
