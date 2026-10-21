import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { createTattooClient } from "@tattoo-drip/sdk";
import type { Studio } from "@tattoo-drip/types";
import { tattooKeys, tattooQueries } from "../src/queries.js";

const TENANT = "lists-needle-11";
const STUDIO: Studio = {
	slug: TENANT,
	name: "Studio Needle",
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
};

/** A client whose fetch answers every call with `status` and `body`. */
function clientAnswering(
	status: number,
	body: unknown,
	tenant: string = TENANT,
) {
	const calls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	const client = createTattooClient({
		baseUrl: "https://api.example.com",
		tenant,
		fetch,
	});
	return { calls, client };
}

const noRetries = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("tattooQueries.services, portfolio and availability", () => {
	test("their keys start with the tenant", () => {
		const { client } = clientAnswering(200, { data: [] });
		const tenant = ["tattoo-drip", "tenant", TENANT];

		assert.deepEqual(tattooQueries.services(client).queryKey, [
			...tenant,
			"services",
			{},
		]);
		assert.deepEqual(
			tattooQueries.services(client, { artistId: "a1" }).queryKey,
			[...tenant, "services", { artistId: "a1" }],
		);
		assert.deepEqual(tattooQueries.portfolio(client).queryKey, [
			...tenant,
			"portfolio",
			{},
		]);
		assert.deepEqual(
			tattooQueries.portfolio(client, { artistId: "a1" }).queryKey,
			[...tenant, "portfolio", { artistId: "a1" }],
		);
		assert.deepEqual(
			tattooQueries.availability(client, { artistId: "a1", serviceId: "s1" })
				.queryKey,
			[...tenant, "availability", { artistId: "a1", serviceId: "s1" }],
		);
		assert.deepEqual(tattooQueries.availability(client, null).queryKey, [
			...tenant,
			"availability",
			null,
		]);
	});

	test("styles and placements keys have no tenant: they are platform-wide", () => {
		const { client } = clientAnswering(200, { data: [] });
		const styles = tattooQueries.styles(client);
		const placements = tattooQueries.placements(client);

		assert.deepEqual(styles.queryKey, ["tattoo-drip", "styles"]);
		assert.deepEqual(placements.queryKey, ["tattoo-drip", "placements"]);
		assert.equal(styles.staleTime, Number.POSITIVE_INFINITY);
		assert.equal(placements.staleTime, Number.POSITIVE_INFINITY);
	});

	test("availability without a query is skipped", () => {
		const { client } = clientAnswering(200, { data: [] });

		assert.equal(tattooQueries.availability(client, null).queryFn, skipToken);
		const withQuery = tattooQueries.availability(client, {
			artistId: "a1",
			serviceId: "s1",
		});
		assert.equal(withQuery.staleTime, 30_000);
		assert.equal(typeof withQuery.queryFn, "function");
	});

	test("they load through the SDK with the query", async () => {
		const services = clientAnswering(200, { data: [] });
		const portfolio = clientAnswering(200, {
			data: [],
			nextCursor: null,
		});
		const availability = clientAnswering(200, {
			data: [
				{
					startsAt: "2026-11-02T04:00:00Z",
					endsAt: "2026-11-02T05:30:00Z",
				},
			],
		});
		const queryClient = noRetries();
		const base = `https://api.example.com/api/v1/tenants/${TENANT}`;

		assert.deepEqual(
			await queryClient.fetchQuery(
				tattooQueries.services(services.client, { artistId: "a1" }),
			),
			[],
		);
		assert.equal(services.calls.length, 1);
		assert.equal(services.calls[0], `${base}/services?artistId=a1`);

		assert.deepEqual(
			await queryClient.fetchQuery(
				tattooQueries.portfolio(portfolio.client, { style: "fine line" }),
			),
			{ data: [], nextCursor: null },
		);
		assert.equal(portfolio.calls.length, 1);
		assert.equal(portfolio.calls[0], `${base}/portfolio?style=fine+line`);

		assert.deepEqual(
			await queryClient.fetchQuery(
				tattooQueries.availability(availability.client, {
					artistId: "a1",
					serviceId: "s1",
				}),
			),
			[
				{
					startsAt: "2026-11-02T04:00:00Z",
					endsAt: "2026-11-02T05:30:00Z",
				},
			],
		);
		assert.equal(availability.calls.length, 1);
		assert.equal(
			availability.calls[0],
			`${base}/availability?artistId=a1&serviceId=s1`,
		);
	});

	test("one QueryClient never serves one tenant's data for another", async () => {
		const a = clientAnswering(
			200,
			{ data: { ...STUDIO, slug: "lists-a-11", name: "Studio A" } },
			"lists-a-11",
		);
		const b = clientAnswering(
			200,
			{ data: { ...STUDIO, slug: "lists-b-11", name: "Studio B" } },
			"lists-b-11",
		);
		const queryClient = noRetries();
		// An answer that never goes stale: with the default staleTime of 0,
		// fetchQuery would call the second client again even if both tenants
		// shared one key, and this test could not fail. Now a shared key would
		// hand tenant B the cached answer of tenant A.
		const fresh = (client: typeof a.client) => ({
			...tattooQueries.studio(client),
			staleTime: Number.POSITIVE_INFINITY,
		});

		const first = await queryClient.fetchQuery(fresh(a.client));
		const second = await queryClient.fetchQuery(fresh(b.client));

		assert.equal(first.name, "Studio A");
		assert.equal(second.name, "Studio B");
		assert.equal(a.calls.length, 1);
		assert.equal(b.calls.length, 1);
		assert.equal(queryClient.getQueryCache().getAll().length, 2);
		assert.equal(
			queryClient.getQueryData<Studio>(tattooKeys.studio("lists-a-11"))?.name,
			"Studio A",
		);
		assert.equal(
			queryClient.getQueryData<Studio>(tattooKeys.studio("lists-b-11"))?.name,
			"Studio B",
		);
	});
});
