import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dehydrate } from "@tanstack/react-query";
import { TattooApiError } from "@tattoo-drip/sdk";
import {
	createStorefrontQueryClient,
	MAX_RETRIES,
	retryDelay,
	STALE_TIME_MS,
	shouldRetry,
} from "../../src/api/query-client.ts";

function apiError(status: number, code: string, retryAfter?: number) {
	return new TattooApiError(status, { code, message: "No." }, { retryAfter });
}

describe("shouldRetry", () => {
	test("retries a timeout, a network error or a 5xx twice", () => {
		for (const error of [
			apiError(0, "timeout"),
			apiError(0, "network_error"),
			apiError(500, "internal_error"),
			apiError(503, "unknown_error"),
		]) {
			assert.equal(shouldRetry(0, error), true, error.code);
			assert.equal(shouldRetry(MAX_RETRIES - 1, error), true, error.code);
			assert.equal(shouldRetry(MAX_RETRIES, error), false, error.code);
		}
		assert.equal(MAX_RETRIES, 2);
	});

	test("never retries a 4xx or an odd 2xx: asking again gets the same answer", () => {
		for (const error of [
			apiError(400, "bad_request"),
			apiError(404, "not_found"),
			apiError(409, "deposit_changed"),
			apiError(422, "validation_failed"),
			apiError(200, "invalid_response"),
		]) {
			assert.equal(shouldRetry(0, error), false, error.code);
		}
	});

	test("retries a 429 once, only after a short Retry-After", () => {
		assert.equal(shouldRetry(0, apiError(429, "rate_limited", 5)), true);
		assert.equal(shouldRetry(1, apiError(429, "rate_limited", 5)), false);
		assert.equal(shouldRetry(0, apiError(429, "rate_limited", 11)), false);
		assert.equal(shouldRetry(0, apiError(429, "rate_limited")), false);
	});

	test("doesn't wait out a long Retry-After on a 5xx either", () => {
		assert.equal(shouldRetry(0, apiError(503, "unknown_error", 10)), true);
		assert.equal(shouldRetry(0, apiError(503, "unknown_error", 30)), false);
	});

	test("never retries what isn't an API error: a bug or a cancellation", () => {
		assert.equal(shouldRetry(0, new TypeError("x is undefined")), false);
		assert.equal(
			shouldRetry(0, new DOMException("Aborted", "AbortError")),
			false,
		);
	});
});

describe("retryDelay", () => {
	test("waits 1 s, then 2 s, never more than 8 s", () => {
		const offline = apiError(0, "network_error");
		assert.equal(retryDelay(0, offline), 1_000);
		assert.equal(retryDelay(1, offline), 2_000);
		assert.equal(retryDelay(5, offline), 8_000);
	});

	test("waits the Retry-After the API sent", () => {
		assert.equal(retryDelay(0, apiError(429, "rate_limited", 3)), 3_000);
	});
});

describe("createStorefrontQueryClient", () => {
	test("keeps data fresh for the API's max-age, on both sides", () => {
		assert.equal(STALE_TIME_MS, 60_000);
		for (const environment of ["server", "browser"] as const) {
			const queries =
				createStorefrontQueryClient(environment).getDefaultOptions().queries;
			assert.equal(queries?.staleTime, STALE_TIME_MS, environment);
		}
	});

	test("retries in the browser only", () => {
		assert.equal(
			createStorefrontQueryClient("server").getDefaultOptions().queries?.retry,
			false,
		);
		const browser =
			createStorefrontQueryClient("browser").getDefaultOptions().queries;
		assert.equal(browser?.retry, shouldRetry);
		assert.equal(browser?.retryDelay, retryDelay);
	});

	test("is a new client each time", () => {
		assert.notEqual(
			createStorefrontQueryClient("server"),
			createStorefrontQueryClient("server"),
		);
	});
});

describe("what a page carries", () => {
	test("successful and pending queries, never a failed one", async () => {
		const queryClient = createStorefrontQueryClient("server");
		queryClient.setQueryData(["done"], { ok: true });
		await queryClient
			.query({
				queryKey: ["failed"],
				queryFn: () => Promise.reject(apiError(500, "internal_error")),
			})
			.catch(() => undefined);
		void queryClient.query({
			queryKey: ["waiting"],
			queryFn: () => new Promise(() => undefined),
		});

		assert.deepEqual(
			dehydrate(queryClient).queries.map((query) => query.queryKey),
			[["done"], ["waiting"]],
		);
	});

	test("a pending query that fails later sends no error message", async (t) => {
		// Query's development build logs that it redacted the error: expected.
		t.mock.method(console, "error", () => undefined);
		const queryClient = createStorefrontQueryClient("server");
		let fail: (error: unknown) => void = () => undefined;
		void queryClient
			.query({
				queryKey: ["late"],
				queryFn: () =>
					new Promise((_, reject) => {
						fail = reject;
					}),
			})
			.catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const [late] = dehydrate(queryClient).queries;
		fail(apiError(500, "internal_error"));

		assert.ok(late?.promise);
		await assert.rejects(late.promise, { message: "redacted" });
	});
});
