import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discoverKeys, discoverQueries } from "@tattoo-drip/react";
import { createDiscoverClient, TattooApiError } from "@tattoo-drip/sdk";
import type { PublicSettings } from "../src/lib/config.ts";
import {
	connectServer,
	createContext,
	DiscoverRef,
	dehydrateContext,
	hydrateContext,
	parsePreference,
	parseSettings,
} from "../src/lib/context.ts";
import {
	MAX_RETRIES,
	STALE_TIME_MS,
	shouldRetry,
} from "../src/lib/query-client.ts";

const SETTINGS: PublicSettings = {
	apiUrl: "https://api.tattoodrip.app",
	mediaUrl: "https://media.tattoodrip.app",
	siteUrl: "https://tattoodrip.app",
	studioOsUrl: "https://app.tattoodrip.app",
	indexing: false,
	markets: ["NP", "IN"],
	defaultCountry: "NP",
};
const PREFERENCE = { country: "IN", source: "geo" } as const;

function recordingFetch() {
	const calls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return new Response(JSON.stringify({ data: [], nextCursor: null }), {
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	return { calls, fetch };
}

describe("Discover's per-request context", () => {
	test("each router gets its own QueryClient: nothing one request caches reaches another", () => {
		const first = createContext("server");
		const second = createContext("server");
		assert.notEqual(first.queryClient, second.queryClient);
		first.queryClient.setQueryData(discoverKeys.studios(), {
			data: ["cached"],
		});
		assert.equal(
			second.queryClient.getQueryData(discoverKeys.studios()),
			undefined,
		);
	});

	test("public data stays fresh for the API's max-age; the server never retries, the browser retries transient errors", () => {
		const server =
			createContext("server").queryClient.getDefaultOptions().queries;
		const browser =
			createContext("browser").queryClient.getDefaultOptions().queries;
		assert.equal(server?.staleTime, STALE_TIME_MS);
		assert.equal(server?.retry, false);
		assert.equal(browser?.retry, shouldRetry);
		assert.equal(
			shouldRetry(
				0,
				new TattooApiError(503, { code: "unavailable", message: "x" }),
			),
			true,
		);
		assert.equal(
			shouldRetry(
				MAX_RETRIES,
				new TattooApiError(503, { code: "unavailable", message: "x" }),
			),
			false,
		);
		assert.equal(
			shouldRetry(
				0,
				new TattooApiError(404, { code: "not_found", message: "x" }),
			),
			false,
		);
		assert.equal(shouldRetry(0, new Error("bug")), false);
	});

	test("the server's client calls the configured API origin, with the D03 query options", async () => {
		const context = createContext("server");
		const { calls, fetch } = recordingFetch();
		connectServer(context, SETTINGS, PREFERENCE, { fetch });
		await context.queryClient.fetchQuery(
			discoverQueries.studios(context.discover.client, { query: "ink" }),
		);
		assert.deepEqual(calls, [
			"https://api.tattoodrip.app/api/v1/discover/studios?q=ink",
		]);
	});

	test("the browser is connected from the dehydrated settings only, and checks them", async () => {
		const server = createContext("server");
		connectServer(server, SETTINGS, PREFERENCE);
		const dehydrated = dehydrateContext(server);
		assert.deepEqual(Object.keys(dehydrated), ["settings", "country"]);
		assert.deepEqual(JSON.parse(JSON.stringify(dehydrated)), {
			settings: SETTINGS,
			country: PREFERENCE,
		});

		const browser = createContext("browser");
		const { calls, fetch } = recordingFetch();
		hydrateContext(browser, JSON.parse(JSON.stringify(dehydrated)), { fetch });
		assert.deepEqual(browser.preference.current, PREFERENCE);
		await browser.discover.client.studios.list();
		assert.deepEqual(calls, [
			"https://api.tattoodrip.app/api/v1/discover/studios",
		]);

		assert.throws(
			() => parseSettings({ ...SETTINGS, apiUrl: "javascript:alert(1)" }),
			/invalid/,
		);
		assert.throws(
			() => parseSettings({ ...SETTINGS, indexing: "yes" }),
			/invalid/,
		);
		assert.throws(() => parseSettings(undefined), /invalid/);
		for (const markets of [[], ["np"], ["XX"], "NP"]) {
			assert.throws(() => parseSettings({ ...SETTINGS, markets }), /invalid/);
		}
		assert.throws(
			() => parseSettings({ ...SETTINGS, defaultCountry: "US" }),
			/invalid/,
		);
	});

	test("the country preference is checked: a market code and a known source only", () => {
		for (const country of [
			{ country: "US", source: "cookie" },
			{ country: "IN", source: "url" },
			{ country: "IN" },
			"IN",
			undefined,
		]) {
			const browser = createContext("browser");
			assert.throws(
				() => hydrateContext(browser, { settings: SETTINGS, country }),
				/invalid/,
				JSON.stringify(country),
			);
		}
		const context = createContext("server");
		assert.throws(() => context.preference.current, /not connected/);
		assert.deepEqual(
			parsePreference({ country: "NP", source: "fallback" }, SETTINGS),
			{
				country: "NP",
				source: "fallback",
			},
		);
		assert.equal(JSON.stringify(context.preference), "{}");
	});

	test("each country is its own cache entry: a late answer for one never fills another", () => {
		assert.notDeepEqual(
			discoverKeys.studios({ country: "NP" }),
			discoverKeys.studios({ country: "IN" }),
		);
		assert.notDeepEqual(
			discoverKeys.artists({ country: "NP" }),
			discoverKeys.artists({ country: "IN" }),
		);
		assert.notDeepEqual(
			discoverKeys.tattoos({ country: "NP", limit: 24 }),
			discoverKeys.tattoos({ country: "IN", limit: 24 }),
		);
	});

	test("a context connects once, and its ref serialises to nothing", () => {
		const ref = new DiscoverRef();
		assert.throws(() => ref.client, /not connected/);
		const client = createDiscoverClient({ baseUrl: SETTINGS.apiUrl });
		ref.connect(SETTINGS, client);
		assert.equal(ref.client, client);
		assert.throws(() => ref.connect(SETTINGS, client), /already connected/);
		assert.equal(JSON.stringify(ref), "{}");
	});
});
