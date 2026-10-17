import type { HttpContext } from "@adonisjs/core/http";
import { test } from "@japa/runner";
import { isApiRequest, publicCacheControl } from "#services/public_api";

/** Just what isApiRequest reads: the URL, and the matched route if any. */
function ctxFor(url: string, pattern?: string) {
	return {
		request: { url: () => url },
		route: pattern ? { pattern } : undefined,
	} as unknown as HttpContext;
}

test.group("isApiRequest", () => {
	test("a URL under /api is the API until a route matched", ({ assert }) => {
		assert.isTrue(isApiRequest(ctxFor("/api")));
		assert.isTrue(isApiRequest(ctxFor("/api/v1/nope")));
		assert.isTrue(
			isApiRequest(ctxFor("/api/v1/tenants/x", "/api/v1/tenants/:tenant")),
		);
	});

	test("URLs that only look like the API are not", ({ assert }) => {
		for (const url of ["/apiary", "/API/v1", "/t/api", "/", "/login"]) {
			assert.isFalse(isApiRequest(ctxFor(url)), url);
		}
	});

	test("once a route matched, its pattern decides, not the URL", ({
		assert,
	}) => {
		assert.isFalse(
			isApiRequest(ctxFor("/api/../t/api-needle-32", "/t/:tenant")),
		);
	});
});

test.group("publicCacheControl", () => {
	test("defaults to a minute fresh and ten minutes stale-while-revalidate", ({
		assert,
	}) => {
		assert.equal(
			publicCacheControl(),
			"public, max-age=60, stale-while-revalidate=600",
		);
	});

	test("takes other seconds", ({ assert }) => {
		assert.equal(
			publicCacheControl({ maxAge: 15, staleWhileRevalidate: 30 }),
			"public, max-age=15, stale-while-revalidate=30",
		);
	});
});
