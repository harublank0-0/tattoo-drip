import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dehydrate, hydrate, QueryObserver } from "@tanstack/react-query";
import { tattooKeys, tattooQueries } from "@tattoo-drip/react";
import type { Studio } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	dehydrateApi,
	hydrateApi,
	parseConnection,
	seedStudio,
	TattooClientRef,
} from "../../src/api/context.ts";
import { fakeFetch, json, studioOf } from "../tenancy/helpers.ts";

const API = "http://api.test";
const KEY = "test-server-key-0123456789abcdefghijklmnop";
const STUDIO_A: Studio = studioOf("studio-a", "Studio A");
const STUDIO_B: Studio = studioOf("studio-b", "Studio B");
const CONFIG = { apiUrl: API, serverKey: KEY };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const authorization = (init: RequestInit) =>
	new Headers(init.headers).get("authorization");

/** A server render's API state for `studio`, connected as getRouter() does, not seeded. */
function serverApi(
	studio: Studio,
	fetch: typeof globalThis.fetch,
	config: { apiUrl: string; serverKey?: string } = CONFIG,
) {
	const api = createApiContext("server");
	connectServer(api, { config, studio, fetch });
	return api;
}

describe("the server's client", () => {
	test("asks for the confirmed studio with the server key, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);

		assert.deepEqual(await api.tattoo.client.studio.get(), STUDIO_A);
		assert.equal(calls[0].url, `${API}/api/v1/tenants/studio-a`);
		assert.equal(authorization(calls[0].init), `Bearer ${KEY}`);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("sends the visitor's address with the key, and never without it", async () => {
		for (const [config, expected] of [
			[CONFIG, "203.0.113.7"],
			[{ apiUrl: API }, null],
		] as const) {
			const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
			const api = createApiContext("server");
			connectServer(api, {
				config,
				studio: STUDIO_A,
				fetch,
				visitorAddress: "203.0.113.7",
			});
			await api.tattoo.client.studio.get();
			assert.equal(
				new Headers(calls[0].init.headers).get("x-visitor-ip"),
				expected,
			);
		}
	});

	// TAT-128: the page's reads ask every cache on the way for a fresh answer
	// (see tenancy/lookup.ts); the browser's client never does, because its
	// requests are cross-origin and the API allows only a few request headers.
	test("the server's reads ask for a fresh answer, the browser's don't", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		await serverApi(STUDIO_A, fetch).tattoo.client.studio.get();
		await serverApi(STUDIO_A, fetch, {
			apiUrl: API,
		}).tattoo.client.studio.get();

		const browser = createApiContext("browser");
		hydrateApi(
			browser,
			{ tattoo: { apiUrl: API, tenant: "studio-a" } },
			{ fetch },
		);
		await browser.tattoo.client.studio.get();

		const cacheControl = (init: RequestInit) =>
			new Headers(init.headers).get("cache-control");
		assert.deepEqual(
			calls.map((call) => cacheControl(call.init)),
			["no-cache", "no-cache", null],
		);
	});

	test("sends no Authorization when no key is set", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch, { apiUrl: API });

		await api.tattoo.client.studio.get();
		assert.equal(authorization(calls[0].init), null);
	});

	test("seeding puts the middleware's studio in the cache under its tenant", () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);
		seedStudio(api, STUDIO_A);

		assert.deepEqual(
			api.queryClient.getQueryData(tattooKeys.studio("studio-a")),
			STUDIO_A,
		);
		assert.equal(calls.length, 0);
	});
});

describe("TattooClientRef", () => {
	test("has no client or connection until it is connected", () => {
		const ref = new TattooClientRef();
		assert.throws(() => ref.client, /not connected yet/);
		assert.throws(() => ref.connection, /not connected yet/);
	});

	test("connects once, to a client of the connection's tenant", () => {
		const { fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);
		assert.throws(
			() =>
				api.tattoo.connect(
					{ apiUrl: API, tenant: "studio-a" },
					api.tattoo.client,
				),
			/already connected/,
		);

		const other = createApiContext("server");
		assert.throws(
			() =>
				other.tattoo.connect(
					{ apiUrl: API, tenant: "studio-b" },
					api.tattoo.client,
				),
			/tenant must be the connection's tenant/,
		);
	});
});

describe("what the browser gets", () => {
	test("only the API's origin and the studio's slug", () => {
		const { fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		assert.deepEqual(dehydrateApi(serverApi(STUDIO_A, fetch)), {
			tattoo: { apiUrl: API, tenant: "studio-a" },
		});
	});

	test("nothing the page carries holds the server key", async () => {
		const { fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(500, {
						error: { code: "internal_error", message: "Something broke." },
					})
				: json(200, { data: STUDIO_A }),
		);
		const api = serverApi(STUDIO_A, fetch);
		seedStudio(api, STUDIO_A);
		const failure = await api.queryClient
			.query(tattooQueries.artists(api.tattoo.client))
			.catch((error: unknown) => error);

		const queries = dehydrate(api.queryClient);
		const carried = JSON.stringify({ router: dehydrateApi(api), queries });
		assert.ok(!carried.includes(KEY));
		// The failed read stays on the server: only the studio goes.
		assert.deepEqual(
			queries.queries.map((query) => query.queryKey),
			[tattooKeys.studio("studio-a")],
		);
		// Neither the ref, the client nor the error exposes the key.
		assert.equal(JSON.stringify(api.tattoo), "{}");
		assert.ok(!JSON.stringify(api.tattoo.client).includes(KEY));
		assert.ok(failure instanceof Error);
		assert.ok(!failure.message.includes(KEY));
	});

	test("parseConnection accepts an origin and a stored slug, nothing else", () => {
		assert.deepEqual(parseConnection({ apiUrl: API, tenant: "studio-a" }), {
			apiUrl: API,
			tenant: "studio-a",
		});
		assert.deepEqual(
			parseConnection({
				apiUrl: "https://api.tattoodrip.app",
				tenant: "studio-a",
				extra: 1,
			}),
			{ apiUrl: "https://api.tattoodrip.app", tenant: "studio-a" },
		);
		for (const value of [
			undefined,
			null,
			"studio-a",
			{ tenant: "studio-a" },
			{ apiUrl: API },
			{ apiUrl: `${API}/api`, tenant: "studio-a" },
			{ apiUrl: `${API}/`, tenant: "studio-a" },
			{ apiUrl: "javascript:alert(1)", tenant: "studio-a" },
			{ apiUrl: "ftp://api.test", tenant: "studio-a" },
			{ apiUrl: API, tenant: "Studio-A" },
			{ apiUrl: API, tenant: "a.b" },
			{ apiUrl: API, tenant: 42 },
		]) {
			assert.throws(
				() => parseConnection(value),
				/API connection is missing or invalid/,
				JSON.stringify(value),
			);
		}
	});

	test("the browser's client has no key and sends no cookies", async () => {
		const browser = createApiContext("browser");
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		hydrateApi(
			browser,
			{ tattoo: { apiUrl: API, tenant: "studio-a" } },
			{ fetch },
		);

		await browser.tattoo.client.studio.get();
		assert.equal(calls[0].url, `${API}/api/v1/tenants/studio-a`);
		assert.equal(authorization(calls[0].init), null);
		assert.equal(new Headers(calls[0].init.headers).get("x-visitor-ip"), null);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("a page without a valid connection can't hydrate", () => {
		for (const dehydrated of [undefined, {}, { tattoo: { apiUrl: API } }]) {
			assert.throws(
				() => hydrateApi(createApiContext("browser"), dehydrated),
				/API connection is missing or invalid/,
			);
		}
	});
});

describe("hydration", () => {
	test("the browser shows the server's studio without asking the API again", async () => {
		const server = fakeFetch(() => json(200, { data: STUDIO_A }));
		const serverSide = serverApi(STUDIO_A, server.fetch);
		seedStudio(serverSide, STUDIO_A);
		// What the page carries, through JSON as the HTML does.
		const page = JSON.parse(
			JSON.stringify({
				router: dehydrateApi(serverSide),
				queries: dehydrate(serverSide.queryClient),
			}),
		);

		const browser = fakeFetch(() => json(200, { data: STUDIO_A }));
		const browserSide = createApiContext("browser");
		hydrateApi(browserSide, page.router, { fetch: browser.fetch });
		hydrate(browserSide.queryClient, page.queries);

		const observer = new QueryObserver(
			browserSide.queryClient,
			tattooQueries.studio(browserSide.tattoo.client),
		);
		const unsubscribe = observer.subscribe(() => undefined);
		await tick();
		unsubscribe();
		assert.deepEqual(observer.getCurrentResult().data, STUDIO_A);
		assert.equal(browser.calls.length, 0);
		assert.equal(server.calls.length, 0);

		// Control: the same query, stale at once, is fetched on mount, so the
		// 60 s default is what saved the call.
		const stale = new QueryObserver(browserSide.queryClient, {
			...tattooQueries.studio(browserSide.tattoo.client),
			staleTime: 0,
		});
		const unsubscribeStale = stale.subscribe(() => undefined);
		await tick();
		unsubscribeStale();
		assert.equal(browser.calls.length, 1);
	});
});

describe("what the browser keeps", () => {
	/** A server render that read the studio and its artists, as the studio page does. */
	async function pageWithArtists() {
		const server = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(200, { data: [] })
				: json(200, { data: STUDIO_A }),
		);
		const serverSide = serverApi(STUDIO_A, server.fetch);
		seedStudio(serverSide, STUDIO_A);
		await serverSide.queryClient.query({
			...tattooQueries.artists(serverSide.tattoo.client),
			staleTime: "static",
		});
		return JSON.parse(
			JSON.stringify({
				router: dehydrateApi(serverSide),
				queries: dehydrate(serverSide.queryClient),
			}),
		);
	}

	test("the studio, artists and work queries live as long as the page, other tenants' do not", () => {
		const browser = createApiContext("browser");
		hydrateApi(browser, { tattoo: { apiUrl: API, tenant: "studio-a" } });
		const defaults = (key: readonly unknown[]) =>
			browser.queryClient.getQueryDefaults(key).gcTime;

		assert.equal(defaults(tattooKeys.studio("studio-a")), Infinity);
		assert.equal(defaults(tattooKeys.artists("studio-a")), Infinity);
		// An artist's own query sits under the artists key.
		assert.equal(defaults(tattooKeys.artist("studio-a", "sita")), Infinity);
		// Every gallery read (TAT-126) sits under the work key, whatever its filters.
		assert.equal(defaults(tattooKeys.work("studio-a")), Infinity);
		assert.equal(
			defaults(tattooKeys.work("studio-a", { artist: "sita", limit: 24 })),
			Infinity,
		);
		assert.equal(defaults(tattooKeys.work("studio-b")), undefined);
		assert.equal(defaults(tattooKeys.artists("studio-b")), undefined);
		assert.equal(defaults(tattooKeys.services("studio-a")), undefined);
	});

	test("a page left open for hours still answers a repeat navigation from the cache", async (t) => {
		// Nothing observes the loaders' queries, and a browser drops such a
		// query after 5 minutes. Node looks like a server (never drops), so
		// the browser's default is set here; timers are mocked before anything
		// is hydrated, so the drop timers are the mocked ones.
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const page = await pageWithArtists();
		const browser = fakeFetch(() => json(200, { data: [] }));
		const browserSide = createApiContext("browser");
		const defaultOptions = browserSide.queryClient.getDefaultOptions();
		browserSide.queryClient.setDefaultOptions({
			...defaultOptions,
			queries: { ...defaultOptions.queries, gcTime: 5 * 60_000 },
		});
		hydrateApi(browserSide, page.router, { fetch: browser.fetch });
		hydrate(browserSide.queryClient, page.queries);

		t.mock.timers.tick(60 * 60_000);

		const client = browserSide.tattoo.client;
		const studio = await browserSide.queryClient.query({
			...tattooQueries.studio(client),
			staleTime: "static",
		});
		const artists = await browserSide.queryClient.query({
			...tattooQueries.artists(client),
			staleTime: "static",
		});
		assert.deepEqual(studio, STUDIO_A);
		assert.deepEqual(artists, []);
		assert.deepEqual(
			browser.calls.map((call) => call.url),
			[],
		);
	});
});

describe("two requests at once", () => {
	test("never share a QueryClient, a client or cached data", async () => {
		let releaseA: () => void = () => undefined;
		const aMayAnswer = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		const answered: string[] = [];
		const { calls, fetch } = fakeFetch(async ({ url }) => {
			const studio = url.endsWith("/studio-a") ? STUDIO_A : STUDIO_B;
			if (studio === STUDIO_A) await aMayAnswer;
			answered.push(studio.slug);
			return json(200, { data: studio });
		});
		const a = serverApi(STUDIO_A, fetch);
		const b = serverApi(STUDIO_B, fetch);

		const loadA = a.queryClient.query(tattooQueries.studio(a.tattoo.client));
		const loadB = b.queryClient.query(tattooQueries.studio(b.tattoo.client));
		assert.deepEqual(await loadB, STUDIO_B);
		releaseA();
		assert.deepEqual(await loadA, STUDIO_A);

		// B was answered while A still waited.
		assert.deepEqual(answered, ["studio-b", "studio-a"]);
		assert.notEqual(a.queryClient, b.queryClient);
		assert.notEqual(a.tattoo.client, b.tattoo.client);
		assert.deepEqual(
			a.queryClient
				.getQueryCache()
				.getAll()
				.map((query) => query.queryKey),
			[tattooKeys.studio("studio-a")],
		);
		assert.deepEqual(
			b.queryClient
				.getQueryCache()
				.getAll()
				.map((query) => query.queryKey),
			[tattooKeys.studio("studio-b")],
		);
		assert.deepEqual(
			calls.map((call) => authorization(call.init)),
			[`Bearer ${KEY}`, `Bearer ${KEY}`],
		);
	});
});
