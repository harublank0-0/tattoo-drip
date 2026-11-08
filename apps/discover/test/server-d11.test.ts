import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	visitorAddress,
	withFailureLog,
	withServerKey,
} from "../src/lib/server-fetch.ts";
import { SERVER_KEY, skip, startDiscover } from "./built-server.ts";
import { type StubApi, stubApi } from "./stub-api.ts";

/**
 * D11 on the built server: every server-side API read carries Discover's
 * server key and the visitor's address (nginx's X-Forwarded-For), the key
 * never reaches the browser, and the health route reads nothing.
 */

type Discover = Awaited<ReturnType<typeof startDiscover>>;

describe("visitorAddress and withServerKey", () => {
	test("the visitor is the first X-Forwarded-For literal, else none", () => {
		for (const [value, expected] of [
			["203.0.113.9", "203.0.113.9"],
			[" 203.0.113.9 , 10.0.0.1", "203.0.113.9"],
			["2001:db8::1", "2001:db8::1"],
			["not-an-ip", undefined],
			["", undefined],
			[null, undefined],
		] as const) {
			const headers = new Headers();
			if (value !== null) headers.set("x-forwarded-for", value);
			assert.equal(visitorAddress(headers), expected, String(value));
		}
	});

	test("the key and the visitor go on every call; nothing changes without a key", async () => {
		const seen: Headers[] = [];
		const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			seen.push(new Headers(init?.headers));
			return new Response("{}");
		}) as typeof fetch;
		await withServerKey(
			base,
			"k".repeat(32),
			"203.0.113.9",
		)?.("http://x/", {
			headers: { accept: "application/json" },
		});
		assert.equal(seen[0]?.get("authorization"), `Bearer ${"k".repeat(32)}`);
		assert.equal(seen[0]?.get("x-visitor-ip"), "203.0.113.9");
		assert.equal(seen[0]?.get("accept"), "application/json");
		await withServerKey(base, "k".repeat(32), undefined)?.("http://x/");
		assert.equal(seen[1]?.get("x-visitor-ip"), null);
		assert.equal(withServerKey(base, null, "203.0.113.9"), base);
	});
});

describe("withFailureLog", () => {
	test("a 5xx, a 429 or no answer is logged on one line with the path only; anything else is not", async () => {
		const lines: string[] = [];
		const answer = (status: number) =>
			(async () => new Response("{}", { status })) as typeof fetch;
		for (const status of [200, 404, 422]) {
			await withFailureLog(answer(status), (line) => lines.push(line))(
				"http://api.test/api/v1/discover/studios?q=secret+search",
			);
		}
		assert.equal(lines.length, 0);
		await withFailureLog(answer(503), (line) => lines.push(line))(
			"http://api.test/api/v1/discover/studios?q=secret+search",
		);
		await withFailureLog(answer(429), (line) => lines.push(line))(
			"http://api.test/api/v1/discover/tattoos",
		);
		const refused = (async () => {
			throw new TypeError("fetch failed", {
				cause: { code: "ECONNREFUSED" },
			});
		}) as typeof fetch;
		await assert.rejects(
			withFailureLog(refused, (line) => lines.push(line))(
				"http://api.test/api/v1/discover/styles",
				{ headers: { authorization: "Bearer k" } },
			),
		);
		const timedOut = (async () => {
			throw new DOMException("timed out", "TimeoutError");
		}) as typeof fetch;
		await assert.rejects(
			withFailureLog(timedOut, (line) => lines.push(line))(
				"http://api.test/api/v1/discover/locations",
			),
		);
		assert.equal(lines.length, 4);
		assert.match(
			lines[0] ?? "",
			/^Discover API read failed: GET \/api\/v1\/discover\/studios answered 503 \(\d+ ms\)$/,
		);
		assert.match(lines[1] ?? "", /tattoos answered 429/);
		assert.match(lines[2] ?? "", /styles: ECONNREFUSED/);
		assert.match(lines[3] ?? "", /locations: no answer in time/);
		assert.doesNotMatch(lines.join("\n"), /secret|Bearer|api\.test/);
	});
});

describe("D11: Discover's server key on the built server", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, {
			DISCOVER_INDEXING: "on",
			DISCOVER_SITEMAP_CACHE_SECONDS: "0",
		});
	});
	beforeEach(() => {
		api.callers.length = 0;
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("every server read of a page carries the key and the visitor; the page never shows the key", async () => {
		for (const path of [
			"/",
			"/explore/studios",
			"/tattoos",
			"/studios/stub-studio-1",
		]) {
			api.callers.length = 0;
			const response = await discover.get(path, {
				headers: { "x-forwarded-for": "203.0.113.9" },
			});
			assert.equal(response.status, 200, path);
			assert.doesNotMatch(await response.text(), new RegExp(SERVER_KEY));
			assert.ok(api.callers.length > 0, path);
			for (const caller of api.callers)
				assert.deepEqual(
					caller,
					{ authorization: `Bearer ${SERVER_KEY}`, visitor: "203.0.113.9" },
					path,
				);
		}
	});

	test("without a usable forwarded address the key is still sent, with no visitor", async () => {
		await discover.get("/explore/artists", {
			headers: { "x-forwarded-for": "nonsense" },
		});
		assert.ok(api.callers.length > 0);
		for (const caller of api.callers)
			assert.deepEqual(caller, {
				authorization: `Bearer ${SERVER_KEY}`,
				visitor: null,
			});
	});

	test("sitemap reads carry the key and the visitor of the request that built them", async () => {
		const response = await discover.get("/sitemaps/studios.xml", {
			headers: { "x-forwarded-for": "198.51.100.4" },
		});
		assert.equal(response.status, 200);
		assert.ok(api.callers.length > 0);
		for (const caller of api.callers)
			assert.deepEqual(caller, {
				authorization: `Bearer ${SERVER_KEY}`,
				visitor: "198.51.100.4",
			});
	});

	test("/healthz answers ok without reading the API; never cached or indexed", async () => {
		api.requests.length = 0;
		const response = await discover.get("/healthz");
		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok\n");
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("x-robots-tag"), "noindex");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.deepEqual(api.requests, []);
	});

	test("the built browser assets hold no server key", async () => {
		const page = await (await discover.get("/")).text();
		const scripts = [...page.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(
			(match) => match[1] as string,
		);
		assert.ok(scripts.length > 0);
		for (const script of scripts)
			assert.doesNotMatch(
				await (await discover.get(script)).text(),
				new RegExp(SERVER_KEY),
				script,
			);
	});
});

describe("D11: production refuses to start without a server key", {
	skip,
}, () => {
	test("NODE_ENV=production and no DISCOVER_SERVER_KEY: the server reports the setting, not a value", async () => {
		const api = await stubApi(1);
		try {
			await assert.rejects(
				startDiscover(api.url, { DISCOVER_SERVER_KEY: "" }),
				/did not start/,
			);
		} finally {
			api.close();
		}
	});
});
