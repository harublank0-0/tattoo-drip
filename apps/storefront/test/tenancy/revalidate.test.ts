import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withRevalidation } from "../../src/tenancy/revalidate.ts";
import { fakeFetch, json } from "./helpers.ts";

const cacheControl = (init: RequestInit) =>
	new Headers(init.headers).get("cache-control");

describe("withRevalidation (TAT-128)", () => {
	test("a read asks every cache on the way for a fresh answer, and keeps its other headers", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: {} }));
		const fresh = withRevalidation(fetch);

		await fresh("http://api.test/a", {
			headers: { Authorization: "Bearer k" },
		});
		await fresh("http://api.test/b", { method: "HEAD" });
		await fresh("http://api.test/c", { method: "get" });

		for (const call of calls) assert.equal(cacheControl(call.init), "no-cache");
		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			"Bearer k",
		);
	});

	test("a write is left alone", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: {} }));
		const fresh = withRevalidation(fetch);

		await fresh("http://api.test/a", {
			method: "POST",
			headers: { "X-Test": "1" },
		});

		assert.equal(cacheControl(calls[0].init), null);
		assert.equal(new Headers(calls[0].init.headers).get("x-test"), "1");
	});

	test("uses the global fetch when none is given", async () => {
		const original = globalThis.fetch;
		const seen: RequestInit[] = [];
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			seen.push(init ?? {});
			return json(200, { data: {} });
		}) as typeof fetch;
		try {
			await withRevalidation(undefined)("http://api.test/a");
		} finally {
			globalThis.fetch = original;
		}

		assert.equal(cacheControl(seen[0]), "no-cache");
	});
});
