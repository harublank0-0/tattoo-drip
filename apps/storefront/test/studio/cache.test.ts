import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pageCacheHeaders } from "../../src/studio/cache.ts";

describe("pageCacheHeaders", () => {
	test("a page is kept a minute at the CDN and served stale while it refreshes", () => {
		assert.deepEqual(pageCacheHeaders("success"), {
			"Cache-Control":
				"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		});
	});

	test("a not-found is kept a minute, like TAT-12's", () => {
		assert.deepEqual(pageCacheHeaders("notFound"), {
			"Cache-Control": "public, max-age=0, s-maxage=60",
		});
	});

	test("an error is never stored", () => {
		for (const status of ["error", "pending", "redirected", "anything"]) {
			assert.deepEqual(
				pageCacheHeaders(status),
				{ "Cache-Control": "no-store" },
				status,
			);
		}
	});
});
