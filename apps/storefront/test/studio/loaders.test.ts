import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isNotFound } from "@tanstack/react-router";
import { type Artist, type Studio, TattooApiError } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import {
	artistPageData,
	loadArtistPage,
	loadStudioPage,
	studioPageData,
} from "../../src/studio/loaders.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import { ARJUN, CLOSED_STUDIO, ORIGIN, SITA, STUDIO } from "./fixtures.ts";

const API = "http://api.test";
const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const notFound = (error: unknown) => isNotFound(error);

/** A server render's context, as getRouter() builds it: studio seeded, origin set. */
function pageContext(fetch: typeof globalThis.fetch, studio: Studio = STUDIO) {
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl: API }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN);
	return { ...api, site };
}

/** An API that lists `artists` and knows nothing else. */
function listing(artists: Artist[] = [SITA, ARJUN]) {
	return fakeFetch(({ url }) =>
		url.endsWith("/artists")
			? json(200, { data: artists })
			: json(404, NOT_FOUND),
	);
}

describe("loadStudioPage", () => {
	test("reads the artists once and the studio from the cache", async () => {
		const { calls, fetch } = listing();
		const context = pageContext(fetch);

		assert.deepEqual(
			await loadStudioPage(context),
			studioPageData(STUDIO, [SITA, ARJUN], ORIGIN),
		);
		await loadStudioPage(context);
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${API}/api/v1/tenants/${STUDIO.slug}/artists`],
		);
	});

	test("a closed studio's page takes no inquiry", async () => {
		const { fetch } = listing([ARJUN]);
		const data = await loadStudioPage(pageContext(fetch, CLOSED_STUDIO));

		assert.equal(data.studio.accepting, false);
		assert.equal(data.inquiry.kind, "studio-closed");
	});

	test("the API failing is an error, not a not-found", async () => {
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() =>
				new Response("<h1>Bad gateway</h1>", {
					status: 502,
					headers: { "content-type": "text/html" },
				}),
		]) {
			const { fetch } = fakeFetch(respond);
			await assert.rejects(
				loadStudioPage(pageContext(fetch)),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
		}
	});

	test("the list's own not_found (the studio went away) is a not-found", async () => {
		const { fetch } = fakeFetch(() => json(404, NOT_FOUND));
		await assert.rejects(loadStudioPage(pageContext(fetch)), notFound);
	});
});

describe("loadArtistPage", () => {
	test("finds a visible artist by exact slug", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "sita");

		assert.deepEqual(
			data,
			artistPageData(STUDIO, [SITA, ARJUN], "sita", ORIGIN),
		);
		assert.equal(data.artist.name, "Sita Rai");
		assert.equal(data.seo.canonical, `${ORIGIN}/artists/sita`);
		assert.equal(data.inquiry.kind, "open");
	});

	test("an unknown, hidden or renamed artist is a not-found", async () => {
		// Hidden and deleted artists, and old slugs, aren't in the list the API sends.
		const { fetch } = listing();
		for (const slug of ["nobody", "mira", "sita-old"]) {
			await assert.rejects(
				loadArtistPage(pageContext(fetch), slug),
				notFound,
				slug,
			);
		}
	});

	test("a slug that can't be an artist's is a not-found without asking the API", async () => {
		const { calls, fetch } = listing();
		for (const slug of [
			"Sita",
			"sita ",
			"../admin",
			"sita/",
			"s",
			"-sita",
			"x".repeat(64),
			"",
		]) {
			await assert.rejects(
				loadArtistPage(pageContext(fetch), slug),
				notFound,
				JSON.stringify(slug),
			);
		}
		assert.equal(calls.length, 0);
	});

	test("a closed artist's page points to the studio", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "arjun");

		assert.deepEqual(data.inquiry, {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: true,
		});
	});
});
