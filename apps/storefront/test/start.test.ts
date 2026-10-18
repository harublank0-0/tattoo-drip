import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { startInstance } from "../src/start.ts";
import { tenantMiddleware } from "../src/tenancy/middleware.ts";

type Handler = {
	options: {
		server: (context: {
			request: Request;
			handlerType: "router" | "serverFn";
			pathname: string;
			context: object;
			next: () => Promise<unknown>;
		}) => Promise<unknown>;
	};
};

/**
 * Runs the first request middleware the way Start's handler does and says what
 * it did: "next" when it let the request through, else the response status.
 */
async function csrfOutcome(
	handlerType: "router" | "serverFn",
	headers: Record<string, string>,
): Promise<"next" | number> {
	const { requestMiddleware } = await startInstance.getOptions();
	assert.ok(requestMiddleware, "request middleware is registered");
	const first = requestMiddleware[0] as unknown as Handler;
	const result = await first.options.server({
		request: new Request("https://blackneedle.tattoodrip.com/_serverFn/x", {
			method: "POST",
			headers,
		}),
		handlerType,
		pathname: "/_serverFn/x",
		context: {},
		next: async () => "next",
	});
	return result instanceof Response ? result.status : "next";
}

describe("startInstance", () => {
	// Declaring a global request middleware replaces Start's default CSRF check
	// on server functions, so start.ts adds it back, and first: a cross-site
	// call is refused before any API request is made. The tests call the
	// middleware instead of looking for Start's dev-only marker on it, so they
	// give the same answer under any NODE_ENV and see a wrong `filter`.
	test("registers the CSRF check, then the studio middleware", async () => {
		const { requestMiddleware } = await startInstance.getOptions();

		assert.ok(requestMiddleware, "request middleware is registered");
		assert.equal(requestMiddleware.length, 2);
		assert.equal(requestMiddleware[1], tenantMiddleware);
	});

	test("refuses a cross-site server function call", async () => {
		assert.equal(
			await csrfOutcome("serverFn", { "sec-fetch-site": "cross-site" }),
			403,
		);
	});

	test("refuses a server function call from another studio's subdomain", async () => {
		assert.equal(
			await csrfOutcome("serverFn", { "sec-fetch-site": "same-site" }),
			403,
		);
	});

	test("refuses a server function call whose Origin is another site's, without Sec-Fetch-Site", async () => {
		assert.equal(
			await csrfOutcome("serverFn", { origin: "https://evil.example" }),
			403,
		);
	});

	test("lets a same-origin server function call through", async () => {
		assert.equal(
			await csrfOutcome("serverFn", { "sec-fetch-site": "same-origin" }),
			"next",
		);
	});

	test("checks only server functions: a link from another site still opens a page", async () => {
		const requests: Record<string, string>[] = [
			{ "sec-fetch-site": "cross-site" },
			{ origin: "https://evil.example" },
			{},
		];
		for (const headers of requests) {
			assert.equal(
				await csrfOutcome("router", headers),
				"next",
				JSON.stringify(headers),
			);
		}
	});
});
