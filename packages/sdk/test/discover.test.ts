import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createDiscoverClient,
	createTattooClient,
	isTattooApiError,
	TattooApiError,
} from "../src/index.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

function json(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

const ROOT = "https://api.example.com/api/v1/discover";

function client(
	fetch: typeof globalThis.fetch,
	options: { baseUrl?: string; key?: string; timeoutMs?: number } = {},
) {
	return createDiscoverClient({
		baseUrl: "https://api.example.com",
		fetch,
		...options,
	});
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("Expected the promise to reject");
}

describe("createDiscoverClient", () => {
	test("every read is under /api/v1/discover, with no tenant and no cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));
		const discover = client(fetch);
		await discover.styles.list();
		await discover.locations.list();
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${ROOT}/styles`, `${ROOT}/locations`],
		);
		for (const call of calls) {
			assert.equal(call.init.credentials, "omit");
			assert.equal(call.init.method ?? "GET", "GET");
			assert.ok(!call.url.includes("/tenants/"));
		}
	});

	test("trims the base URL's trailing slashes", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));
		await client(fetch, { baseUrl: "https://api.example.com//" }).styles.list();
		assert.equal(calls[0].url, `${ROOT}/styles`);
	});

	test("lists return the whole page, data and nextCursor", async () => {
		const page = { data: [{ id: "a" }], nextCursor: "abc" };
		const { fetch } = fakeFetch(() => json(200, page));
		const discover = client(fetch);
		assert.deepEqual(await discover.studios.list(), page);
		assert.deepEqual(await discover.artists.list(), page);
		assert.deepEqual(await discover.tattoos.list(), page);
	});

	test("a list with no query has no question mark", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: [], nextCursor: null }),
		);
		const discover = client(fetch);
		await discover.studios.list();
		await discover.artists.list({});
		await discover.tattoos.list({ style: undefined });
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${ROOT}/studios`, `${ROOT}/artists`, `${ROOT}/tattoos`],
		);
	});

	test("studios.list sends query as q and the other filters as given", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: [], nextCursor: null }),
		);
		await client(fetch).studios.list({
			query: "ink & co",
			country: "NP",
			city: "kathmandu",
			style: "fine-line",
			sort: "name",
			cursor: "c1",
			limit: 12,
		});
		const url = new URL(calls[0].url);
		assert.equal(url.pathname, "/api/v1/discover/studios");
		assert.deepEqual(Object.fromEntries(url.searchParams), {
			country: "NP",
			city: "kathmandu",
			style: "fine-line",
			sort: "name",
			cursor: "c1",
			limit: "12",
			q: "ink & co",
		});
		assert.ok(!url.searchParams.has("query"));
	});

	test("artists.list sends independent and studio, and drops an undefined query", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: [], nextCursor: null }),
		);
		await client(fetch).artists.list({
			query: undefined,
			independent: true,
			studio: "needle-house",
		});
		const url = new URL(calls[0].url);
		assert.deepEqual(Object.fromEntries(url.searchParams), {
			independent: "true",
			studio: "needle-house",
		});
	});

	test("tattoos.list sends artist, healed and the cursor", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: [], nextCursor: null }),
		);
		await client(fetch).tattoos.list({
			artist: "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50",
			healed: false,
			cursor: "next",
		});
		const url = new URL(calls[0].url);
		assert.deepEqual(Object.fromEntries(url.searchParams), {
			artist: "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50",
			healed: "false",
			cursor: "next",
		});
	});

	test("reads of one resource encode their path segments and unwrap { data }", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: { id: "x" } }));
		const discover = client(fetch);
		assert.deepEqual(await discover.studios.get("a/b"), { id: "x" });
		await discover.studios.artists("needle house");
		await discover.studios.artist("needle-house", "../admin");
		await discover.artists.independent("solo?x=1");
		await discover.tattoos.get("id#1");
		assert.deepEqual(
			calls.map((call) => call.url),
			[
				`${ROOT}/studios/a%2Fb`,
				`${ROOT}/studios/needle%20house/artists`,
				`${ROOT}/studios/needle-house/artists/..%2Fadmin`,
				`${ROOT}/artists/solo%3Fx%3D1`,
				`${ROOT}/tattoos/id%231`,
			],
		);
	});

	test("a resource Discover doesn't show is a 404 TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);
		const error = await rejection(client(fetch).studios.get("hidden"));
		assert.ok(isTattooApiError(error));
		assert.equal((error as TattooApiError).status, 404);
		assert.equal((error as TattooApiError).code, "not_found");
	});

	test("a bad filter is a 422 with its fields", async () => {
		const { fetch } = fakeFetch(() =>
			json(422, {
				error: {
					code: "validation_failed",
					message: "Invalid.",
					fields: { cursor: ["This cursor is not valid."] },
				},
			}),
		);
		const error = (await rejection(
			client(fetch).tattoos.list({ cursor: "tampered" }),
		)) as TattooApiError;
		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "validation_failed");
		assert.deepEqual(error.fields, { cursor: ["This cursor is not valid."] });
	});

	test("a list answer without data is an invalid_response", async () => {
		const { fetch } = fakeFetch(() => json(200, { nextCursor: null }));
		const error = (await rejection(
			client(fetch).studios.list(),
		)) as TattooApiError;
		assert.equal(error.code, "invalid_response");
	});

	test("forwards the caller's signal; a cancelled call rejects with the AbortError", {
		timeout: 2000,
	}, async () => {
		const { calls, fetch } = fakeFetch(({ init }) => {
			const signal = init.signal as AbortSignal;
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		});
		const controller = new AbortController();
		const pending = client(fetch).tattoos.list(
			{},
			{ signal: controller.signal },
		);
		controller.abort();
		const error = (await rejection(pending)) as Error;
		assert.equal(error.name, "AbortError");
		assert.ok(calls[0].init.signal);
	});

	test("a call that takes too long is a timeout", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(({ init }) => {
			const signal = init.signal as AbortSignal;
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		});
		const error = (await rejection(
			client(fetch, { timeoutMs: 20 }).styles.list(),
		)) as TattooApiError;
		assert.equal(error.code, "timeout");
	});

	test("on a server the key goes as a bearer token; in a browser a key is refused", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));
		await client(fetch, { key: "server-key" }).styles.list();
		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			"Bearer server-key",
		);
		const had = Object.hasOwn(globalThis, "document");
		Object.defineProperty(globalThis, "document", {
			value: {},
			configurable: true,
			writable: true,
		});
		try {
			assert.throws(() => client(fetch, { key: "server-key" }));
			assert.doesNotThrow(() => client(fetch));
		} finally {
			if (!had) delete (globalThis as { document?: unknown }).document;
		}
	});

	test("the studio client is unchanged: it still needs its tenant", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: {} }));
		await createTattooClient({
			baseUrl: "https://api.example.com",
			tenant: "needle-house",
			fetch,
		}).studio.get();
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/needle-house",
		);
	});

	test("the studio client's inquiries.create sends Discover's referral as a form field", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(201, { data: { id: "i1", reference: "ABC234" } }),
		);
		await createTattooClient({
			baseUrl: "https://api.example.com",
			tenant: "needle-house",
			fetch,
		}).inquiries.create({
			idea: "A peony",
			placement: "Forearm",
			approximateSize: "10 cm",
			preferredDates: "Any",
			sourceChannel: "instagram",
			contactName: "Maya",
			contactPhone: "9812345678",
			referral: "payload.signature",
		});
		const form = calls[0].init.body as FormData;
		assert.equal(form.get("referral"), "payload.signature");
		assert.equal(form.get("sourceChannel"), "instagram");
	});
});
