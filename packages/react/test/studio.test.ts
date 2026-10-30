import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { createTattooClient, isTattooApiError } from "@tattoo-drip/sdk";
import type { Artist, Studio } from "@tattoo-drip/types";
import { tattooKeys, tattooQueries } from "../src/queries.js";

const TENANT = "studio-needle-44";
const STUDIO: Studio = {
	slug: TENANT,
	name: "Studio Needle",
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
	cover: null,
	storefront: {
		theme: "stencil-and-ink",
		branding: {
			logo: null,
			colors: { accent: null, accentDark: null },
			font: "eczar",
		},
		sections: [{ type: "artists" }, { type: "inquiry" }],
	},
};
const ARTIST: Artist = {
	id: "0199f000-0000-7000-8000-000000000044",
	slug: "sita",
	name: "Sita Rai",
	bio: null,
	photo: null,
	acceptingInquiries: true,
	closedMessage: null,
	workPhotos: [],
	styles: [],
	socialLinks: [],
};

/** A client whose fetch answers every call with `status` and `body`. */
function clientAnswering(status: number, body: unknown) {
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
		tenant: TENANT,
		fetch,
	});
	return { calls, client };
}

const noRetries = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("tattooQueries.studio, artists and artist", () => {
	test("their keys start with the tenant, and an artist's sits under the list's", () => {
		const { client } = clientAnswering(200, { data: STUDIO });
		const tenant = ["tattoo-drip", "tenant", TENANT];

		assert.deepEqual(tattooQueries.studio(client).queryKey, [
			...tenant,
			"studio",
		]);
		assert.deepEqual(tattooQueries.artists(client).queryKey, [
			...tenant,
			"artists",
		]);
		assert.deepEqual(tattooQueries.artist(client, "sita").queryKey, [
			...tenant,
			"artists",
			"sita",
		]);
		assert.deepEqual(
			tattooKeys.artist(TENANT, "sita").slice(0, 4),
			tattooKeys.artists(TENANT),
		);
	});

	test("they load through the SDK", async () => {
		const studio = clientAnswering(200, { data: STUDIO });
		const list = clientAnswering(200, { data: [ARTIST] });
		const one = clientAnswering(200, { data: ARTIST });
		const base = `https://api.example.com/api/v1/tenants/${TENANT}`;

		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.studio(studio.client)),
			STUDIO,
		);
		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.artists(list.client)),
			[ARTIST],
		);
		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.artist(one.client, "sita")),
			ARTIST,
		);
		assert.deepEqual(
			[...studio.calls, ...list.calls, ...one.calls],
			[base, `${base}/artists`, `${base}/artists/sita`],
		);
	});

	test("they set no staleTime or retry, so the app's defaults decide", () => {
		const { client } = clientAnswering(200, { data: STUDIO });

		for (const options of [
			tattooQueries.studio(client),
			tattooQueries.artists(client),
			tattooQueries.artist(client, "sita"),
		]) {
			assert.equal(options.staleTime, undefined);
			assert.equal(options.retry, undefined);
		}
	});

	test("an artist that isn't there rejects with the API's not_found", async () => {
		const { client } = clientAnswering(404, {
			error: { code: "not_found", message: "Not found." },
		});

		await assert.rejects(
			noRetries().fetchQuery(tattooQueries.artist(client, "nobody")),
			(error: unknown) =>
				isTattooApiError(error) &&
				error.status === 404 &&
				error.code === "not_found",
		);
	});
});
