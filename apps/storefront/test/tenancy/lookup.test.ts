import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lookUpTenant } from "../../src/tenancy/lookup.ts";
import { fakeFetch, hangUntilAborted, json } from "./helpers.ts";

const API = "http://api.test";
const studio = { slug: "blackneedle", name: "Black Needle" };
const notFound = { error: { code: "not_found", message: "Not found." } };

describe("lookUpTenant", () => {
	test("asks getStudio for the slug, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: studio }));

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
			{
				type: "found",
				studio,
			},
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, "http://api.test/api/v1/tenants/blackneedle");
		assert.equal(calls[0].init.method, undefined);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("a different slug in the body means the studio moved", async () => {
		const { fetch } = fakeFetch(() =>
			json(200, { data: { slug: "inkhouse", name: "Ink House" } }),
		);

		assert.deepEqual(await lookUpTenant("old-ink", { apiUrl: API, fetch }), {
			type: "moved",
			slug: "inkhouse",
		});
	});

	test("the API's not_found is no such studio", async () => {
		const { fetch } = fakeFetch(() => json(404, notFound));

		assert.deepEqual(await lookUpTenant("nobody", { apiUrl: API, fetch }), {
			type: "missing",
		});
	});

	test("a 404 that isn't the API's own is unavailable, not missing", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		);

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
			{
				type: "unavailable",
				status: 404,
				code: "unknown_error",
			},
		);
	});

	test("server errors and rate limits are unavailable", async () => {
		for (const [status, code] of [
			[500, "internal_error"],
			[429, "rate_limited"],
		] as const) {
			const { fetch } = fakeFetch(() =>
				json(status, { error: { code, message: "No." } }),
			);
			assert.deepEqual(
				await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
				{ type: "unavailable", status, code },
			);
		}
	});

	test("a body without data is unavailable", async () => {
		const { fetch } = fakeFetch(() => json(200, { studio }));

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
			{
				type: "unavailable",
				status: 200,
				code: "invalid_response",
			},
		);
	});

	test("a current slug that isn't a stored slug is unavailable", async () => {
		for (const data of [
			{ slug: "evil.test/x", name: "X" },
			{ slug: "Inkhouse", name: "X" },
			{ slug: "", name: "X" },
			{ slug: 42, name: "X" },
			{ name: "X" },
			null,
		]) {
			const { fetch } = fakeFetch(() => json(200, { data }));
			assert.deepEqual(
				await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
				{ type: "unavailable", status: 200, code: "invalid_slug" },
				JSON.stringify(data),
			);
		}
	});

	test("a 200 whose JSON is a bare string, number or boolean is unavailable, never a throw", async () => {
		for (const raw of ['"text"', "5", "true"]) {
			const { fetch } = fakeFetch(
				() =>
					new Response(raw, {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			);

			const lookup = await lookUpTenant("blackneedle", { apiUrl: API, fetch });

			assert.equal(lookup.type, "unavailable", raw);
			assert.equal(
				lookup.type === "unavailable" && lookup.code,
				"invalid_response",
				raw,
			);
		}
	});

	test("an error that isn't the SDK's is unavailable and its message stays out of the result", async () => {
		const response = {
			headers: new Headers({ "content-type": "application/json" }),
			text: async () => "{}",
			get ok(): boolean {
				throw new Error("upstream said: secret text");
			},
		};
		const { fetch } = fakeFetch(() => response as unknown as Response);

		const lookup = await lookUpTenant("blackneedle", { apiUrl: API, fetch });

		assert.deepEqual(lookup, {
			type: "unavailable",
			status: 0,
			code: "invalid_response",
		});
	});

	test("the API's error code is kept only as a short lowercase token", async () => {
		for (const [sent, kept] of [
			["internal_error", "internal_error"],
			["a".repeat(64), "a".repeat(64)],
			["a".repeat(65), "unknown_error"],
			["Has Space", "unknown_error"],
			["UPPER", "unknown_error"],
			["line\nbreak", "unknown_error"],
			["", "unknown_error"],
			[5, "unknown_error"],
		] as const) {
			const { fetch } = fakeFetch(() =>
				json(503, { error: { code: sent, message: "No." } }),
			);

			assert.deepEqual(
				await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
				{ type: "unavailable", status: 503, code: kept },
				JSON.stringify(sent),
			);
		}
	});

	test("an API that doesn't answer in time is unavailable", async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch, timeoutMs: 20 }),
			{ type: "unavailable", status: 0, code: "timeout" },
		);
	});

	test("an API that can't be reached is unavailable", async () => {
		const { fetch } = fakeFetch(() => {
			throw new TypeError("fetch failed");
		});

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
			{
				type: "unavailable",
				status: 0,
				code: "network_error",
			},
		);
	});

	test("a cancelled request rejects with its AbortError", async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const lookup = lookUpTenant("blackneedle", {
			apiUrl: API,
			fetch,
			signal: controller.signal,
		});
		controller.abort();

		await assert.rejects(lookup, { name: "AbortError" });
	});
});
