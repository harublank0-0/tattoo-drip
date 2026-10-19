import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StorefrontConfig } from "../../src/tenancy/config.ts";
import {
	handleTenantRequest,
	type TenantDeps,
	type TenantOutcome,
} from "../../src/tenancy/handle.ts";
import { fakeFetch, hangUntilAborted, json } from "./helpers.ts";

const CONFIG: StorefrontConfig = {
	apiUrl: "http://api.test",
	protocol: "https:",
	baseHost: "tattoodrip.com",
	port: "",
};
const SHORT = "public, max-age=0, s-maxage=60";
const TENANTS = "http://api.test/api/v1/tenants/";
const KEY = "test-server-key-0123456789abcdefghijklmnop";

/**
 * A request whose URL host differs from its Host header, to prove that only
 * the header names the studio and the URL gives only the path and query.
 */
function request(
	host: string | null,
	path = "/",
	init: {
		method?: string;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	} = {},
): Request {
	const headers = new Headers(init.headers);
	if (host !== null) headers.set("host", host);
	return new Request(`http://internal.invalid${path}`, {
		method: init.method,
		headers,
		signal: init.signal,
	});
}

/** The API knows blackneedle, and old-ink as Ink House's old slug. */
function api() {
	return fakeFetch(({ url }) => {
		const slug = url.slice(TENANTS.length);
		if (slug === "blackneedle") {
			return json(200, { data: { slug: "blackneedle", name: "Black Needle" } });
		}
		if (slug === "old-ink") {
			return json(200, { data: { slug: "inkhouse", name: "Ink House" } });
		}
		return json(404, { error: { code: "not_found", message: "Not found." } });
	});
}

function deps(
	fetch: typeof globalThis.fetch,
	extra: Partial<TenantDeps> = {},
): TenantDeps {
	return { config: CONFIG, fetch, log: () => undefined, ...extra };
}

function responseOf(outcome: TenantOutcome): Response {
	assert.ok(
		outcome.type === "respond",
		`expected a response, got ${outcome.type}`,
	);
	return outcome.response;
}

describe("handleTenantRequest", () => {
	test("the lookup carries the configured server key", async () => {
		const { calls, fetch } = api();

		await handleTenantRequest(
			request("blackneedle.tattoodrip.com"),
			deps(fetch, { config: { ...CONFIG, serverKey: KEY } }),
		);

		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			`Bearer ${KEY}`,
		);
	});

	test("the base domain's front page is the landing page, without asking the API", async () => {
		const { calls, fetch } = api();
		for (const host of ["tattoodrip.com", "www.tattoodrip.com"]) {
			const response = responseOf(
				await handleTenantRequest(request(host), deps(fetch)),
			);
			assert.equal(response.status, 200, host);
			assert.equal(response.headers.get("cache-control"), SHORT, host);
		}
		assert.equal(calls.length, 0);
	});

	test("other paths on the base domain are the 404 page", async () => {
		const { calls, fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("tattoodrip.com", "/flash"),
				deps(fetch),
			),
		);
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});

	test("a studio's current slug goes on with the studio", async () => {
		const { calls, fetch } = api();
		const outcome = await handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/flash"),
			deps(fetch),
		);
		assert.deepEqual(outcome, {
			type: "studio",
			studio: { slug: "blackneedle", name: "Black Needle" },
		});
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${TENANTS}blackneedle`],
		);
	});

	test("the host is case-insensitive and its port is ignored", async () => {
		const { calls, fetch } = api();
		const outcome = await handleTenantRequest(
			request("BlackNeedle.TattooDrip.com:443"),
			deps(fetch),
		);
		assert.equal(outcome.type, "studio");
		assert.equal(calls[0].url, `${TENANTS}blackneedle`);
	});

	test("an old slug redirects to the current slug, same path and query", async () => {
		const { fetch } = api();
		for (const method of ["GET", "HEAD"]) {
			const response = responseOf(
				await handleTenantRequest(
					request("old-ink.tattoodrip.com", "/flash?style=fine-line", {
						method,
					}),
					deps(fetch),
				),
			);
			assert.equal(response.status, 302, method);
			assert.equal(
				response.headers.get("location"),
				"https://inkhouse.tattoodrip.com/flash?style=fine-line",
				method,
			);
			assert.equal(response.headers.get("cache-control"), "no-store", method);
		}
	});

	test("other methods under an old slug get the 404 page", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("old-ink.tattoodrip.com", "/_serverFn/x", { method: "POST" }),
				deps(fetch),
			),
		);
		assert.equal(response.status, 404);
	});

	test("the redirect never uses the incoming Host or X-Forwarded-Host", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("OLD-INK.TattooDrip.com:8443", "/about", {
					headers: { "x-forwarded-host": "evil.test" },
				}),
				deps(fetch),
			),
		);
		assert.equal(
			response.headers.get("location"),
			"https://inkhouse.tattoodrip.com/about",
		);
	});

	test("X-Forwarded-Host never picks the studio", async () => {
		const forwarded = {
			headers: { "x-forwarded-host": "blackneedle.tattoodrip.com" },
		};

		const landing = api();
		const atBase = responseOf(
			await handleTenantRequest(
				request("tattoodrip.com", "/", forwarded),
				deps(landing.fetch),
			),
		);
		assert.equal(atBase.status, 200);
		assert.equal(landing.calls.length, 0);

		const unknown = api();
		const atUnknown = responseOf(
			await handleTenantRequest(
				request("no-such-studio.tattoodrip.com", "/", forwarded),
				deps(unknown.fetch),
			),
		);
		assert.equal(atUnknown.status, 404);
		assert.deepEqual(
			unknown.calls.map((call) => call.url),
			[`${TENANTS}no-such-studio`],
		);
	});

	test("an unknown studio gets the 404 page, which doesn't name it", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("no-such-studio.tattoodrip.com"),
				deps(fetch),
			),
		);
		assert.equal(response.status, 404);
		assert.equal(response.headers.get("cache-control"), SHORT);
		assert.ok(!(await response.text()).includes("no-such-studio"));
	});

	test("hosts that can't be a studio get the 404 page without asking the API", async () => {
		const { calls, fetch } = api();
		for (const host of [
			"ab.tattoodrip.com",
			"a.b.tattoodrip.com",
			"black_needle.tattoodrip.com",
			"203.0.113.7",
			"[2001:db8::1]:443",
			"blackneedle.example.com",
			"",
			null,
		]) {
			const response = responseOf(
				await handleTenantRequest(request(host), deps(fetch)),
			);
			assert.equal(response.status, 404, String(host));
		}
		assert.equal(calls.length, 0);
	});

	test("an API failure is a 503 page and one log line", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "Boom." } }),
		);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch, { log: (...entry) => logged.push(entry) }),
			),
		);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("retry-after"), "30");
		assert.deepEqual(logged, [
			[
				"Studio lookup failed",
				{ slug: "blackneedle", status: 500, code: "internal_error" },
			],
		]);
	});

	test("an API that doesn't answer in time is a 503 page", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(hangUntilAborted);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch, { timeoutMs: 20, log: (...entry) => logged.push(entry) }),
			),
		);
		assert.equal(response.status, 503);
		assert.deepEqual(logged, [
			[
				"Studio lookup failed",
				{ slug: "blackneedle", status: 0, code: "timeout" },
			],
		]);
	});

	test("a 200 whose JSON is a bare string is a 503 page and one log line without the API's text", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(
			() =>
				new Response('"secret upstream text"', {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch, { log: (...entry) => logged.push(entry) }),
			),
		);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("retry-after"), "30");
		assert.ok(!(await response.text()).includes("secret upstream text"));
		assert.equal(logged.length, 1);
		const [message, details] = logged[0] as [
			string,
			{ slug: string; status: number; code: string },
		];
		assert.equal(message, "Studio lookup failed");
		assert.deepEqual(Object.keys(details).sort(), ["code", "slug", "status"]);
		assert.equal(details.slug, "blackneedle");
		assert.equal(details.code, "invalid_response");
		assert.ok(!JSON.stringify(logged).includes("secret upstream text"));
	});

	test("an API_URL that points at another server is a 503, not a missing studio", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch),
			),
		);
		assert.equal(response.status, 503);
	});

	test("a cancelled request rejects and logs nothing", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();
		const handled = handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/", { signal: controller.signal }),
			deps(fetch, { log: (...entry) => logged.push(entry) }),
		);
		controller.abort();

		await assert.rejects(handled, { name: "AbortError" });
		assert.deepEqual(logged, []);
	});
});
