import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { createDiscoverClient, createTattooClient } from "@tattoo-drip/sdk";
import { discoverKeys, discoverQueries } from "../src/discover_queries.js";
import { tattooKeys, tattooQueries } from "../src/queries.js";

type Call = { url: string; signal: AbortSignal | null | undefined };

/** A Discover client whose fetch answers every call with `body`. */
function discoverAnswering(body: unknown) {
	const calls: Call[] = [];
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		calls.push({ url: String(input), signal: init.signal });
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	const client = createDiscoverClient({
		baseUrl: "https://api.example.com",
		fetch,
	});
	return { calls, client };
}

const ROOT = ["tattoo-drip", "discover"];
const noRetries = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("discoverKeys", () => {
	test("every key starts with tattoo-drip/discover and is stable", () => {
		const { client } = discoverAnswering({ data: [] });
		const keys = [
			discoverQueries.studios(client).queryKey,
			discoverQueries.studio(client, "s").queryKey,
			discoverQueries.studioArtists(client, "s").queryKey,
			discoverQueries.studioArtist(client, "s", "a").queryKey,
			discoverQueries.artists(client).queryKey,
			discoverQueries.independentArtist(client, "s").queryKey,
			discoverQueries.tattoos(client).queryKey,
			discoverQueries.tattoo(client, "t").queryKey,
			discoverQueries.styles(client).queryKey,
			discoverQueries.locations(client).queryKey,
		];
		for (const key of keys) assert.deepEqual(key.slice(0, 2), ROOT);
		assert.deepEqual(
			discoverQueries.studios(client, { style: "blackwork" }).queryKey,
			discoverKeys.studios({ style: "blackwork" }),
		);
		assert.deepEqual(discoverKeys.studio("s"), [...ROOT, "studio", "s"]);
		assert.deepEqual(discoverKeys.studioArtist("s", "a"), [
			...ROOT,
			"studio",
			"s",
			"artist",
			"a",
		]);
		const hashes = new Set(keys.map((key) => JSON.stringify(key)));
		assert.equal(hashes.size, keys.length, "no two resources share a key");
	});

	test("filters, sorts and cursors are separate cache entries; key order isn't", () => {
		const queryClient = noRetries();
		const hash = (key: readonly unknown[]) =>
			queryClient.getQueryCache().build(queryClient, { queryKey: key })
				.queryHash;
		const entries = [
			discoverKeys.studios(),
			discoverKeys.studios({ style: "blackwork" }),
			discoverKeys.studios({ style: "fine-line" }),
			discoverKeys.studios({ style: "blackwork", sort: "name" }),
			discoverKeys.studios({ style: "blackwork", cursor: "c2" }),
			discoverKeys.studios({ country: "NP", city: "pokhara" }),
			discoverKeys.artists({ style: "blackwork" }),
			discoverKeys.tattoos({ style: "blackwork" }),
		].map(hash);
		assert.equal(new Set(entries).size, entries.length);
		assert.equal(
			hash(discoverKeys.studios({ sort: "name", style: "blackwork" })),
			hash(discoverKeys.studios({ style: "blackwork", sort: "name" })),
		);
	});

	test("never collide with a studio's keys or the studio client's styles", () => {
		const tattoo = createTattooClient({
			baseUrl: "https://api.example.com",
			tenant: "discover",
		});
		const { client } = discoverAnswering({ data: [] });
		const studioKeys = [
			tattooQueries.studio(tattoo).queryKey,
			tattooQueries.artists(tattoo).queryKey,
			tattooQueries.styles(tattoo).queryKey,
			tattooKeys.tenant("discover"),
		].map((key) => JSON.stringify(key));
		const discover = [
			discoverQueries.studio(client, "discover").queryKey,
			discoverQueries.studioArtists(client, "discover").queryKey,
			discoverQueries.styles(client).queryKey,
		].map((key) => JSON.stringify(key));
		for (const key of discover) assert.ok(!studioKeys.includes(key));
		assert.notDeepEqual(discoverKeys.styles(), tattooKeys.styles());
	});
});

describe("discoverQueries", () => {
	test("styles never go stale; the rest leave staleTime to the app", () => {
		const { client } = discoverAnswering({ data: [] });
		assert.equal(
			discoverQueries.styles(client).staleTime,
			Number.POSITIVE_INFINITY,
		);
		assert.equal(discoverQueries.studios(client).staleTime, undefined);
		assert.equal(discoverQueries.tattoo(client, "t").retry, undefined);
	});

	test("lists load the whole page through the SDK with their query", async () => {
		const page = { data: [{ id: "s1" }], nextCursor: "next" };
		const { calls, client } = discoverAnswering(page);
		const queryClient = noRetries();
		const data = await queryClient.fetchQuery(
			discoverQueries.studios(client, { query: "ink", style: "blackwork" }),
		);
		assert.deepEqual(data, page);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/discover/studios?style=blackwork&q=ink",
		);
	});

	test("details unwrap { data } and forward TanStack Query's signal", async () => {
		const { calls, client } = discoverAnswering({ data: { id: "x" } });
		const queryClient = noRetries();
		assert.deepEqual(
			await queryClient.fetchQuery(
				discoverQueries.studioArtist(client, "needle", "sita"),
			),
			{ id: "x" },
		);
		await queryClient.fetchQuery(discoverQueries.tattoo(client, "t1"));
		await queryClient.fetchQuery(
			discoverQueries.independentArtist(client, "solo"),
		);
		assert.deepEqual(
			calls.map((call) => call.url),
			[
				"https://api.example.com/api/v1/discover/studios/needle/artists/sita",
				"https://api.example.com/api/v1/discover/tattoos/t1",
				"https://api.example.com/api/v1/discover/artists/solo",
			],
		);
		for (const call of calls) assert.ok(call.signal instanceof AbortSignal);
	});

	test("a cancelled query aborts its request", async () => {
		let seen: AbortSignal | undefined;
		const fetch = ((_input: RequestInfo | URL, init: RequestInit = {}) => {
			seen = init.signal as AbortSignal;
			return new Promise<Response>((_, reject) => {
				seen?.addEventListener("abort", () => reject(seen?.reason), {
					once: true,
				});
			});
		}) as typeof globalThis.fetch;
		const client = createDiscoverClient({
			baseUrl: "https://api.example.com",
			fetch,
		});
		const queryClient = noRetries();
		const options = discoverQueries.tattoos(client);
		const pending = queryClient.fetchQuery(options).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await queryClient.cancelQueries({ queryKey: options.queryKey });
		await pending;
		assert.equal(seen?.aborted, true);
	});
});
