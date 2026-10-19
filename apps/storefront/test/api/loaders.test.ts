import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dehydrate, environmentManager, hydrate } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { tattooKeys } from "@tattoo-drip/react";
import { type Studio, TattooApiError } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	dehydrateApi,
	hydrateApi,
	seedStudio,
} from "../../src/api/context.ts";
import { loadStudio, rethrowAsNotFound } from "../../src/api/loaders.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

const API = "http://api.test";
const STUDIO: Studio = { slug: "studio-a", name: "Studio A" };

function serverApi(fetch: typeof globalThis.fetch) {
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl: API }, studio: STUDIO, fetch });
	return api;
}

describe("loadStudio", () => {
	test("asks the API once, then answers from the cache", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${API}/api/v1/tenants/studio-a`],
		);
	});

	test("never asks for a studio the tenant middleware already brought", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);
		seedStudio(api, STUDIO);

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.equal(calls.length, 0);
	});

	test("answers from the cache even when its data is stale", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);
		api.queryClient.setQueryData(tattooKeys.studio("studio-a"), STUDIO, {
			updatedAt: Date.now() - 10 * 60_000,
		});

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.equal(calls.length, 0);
	});

	test("the API's not_found is the router's not-found", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		await assert.rejects(loadStudio(serverApi(fetch)), (error: unknown) =>
			isNotFound(error),
		);
	});

	test("any other failure stays the API's error, asked once on the server", async () => {
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		]) {
			const { calls, fetch } = fakeFetch(respond);

			await assert.rejects(
				loadStudio(serverApi(fetch)),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
			assert.equal(calls.length, 1);
		}
	});
});

describe("loadStudio in the browser", () => {
	test("keeps the studio the server sent for as long as the page lives", async (t) => {
		// As in a browser, where an unused query is dropped after 5 minutes.
		environmentManager.setIsServer(() => false);
		t.after(() => environmentManager.setIsServer(() => true));
		t.mock.timers.enable({ apis: ["setTimeout"] });

		const server = fakeFetch(() => json(200, { data: STUDIO }));
		const serverSide = serverApi(server.fetch);
		seedStudio(serverSide, STUDIO);
		const page = JSON.parse(
			JSON.stringify({
				router: dehydrateApi(serverSide),
				queries: dehydrate(serverSide.queryClient),
			}),
		);
		const browser = fakeFetch(() => json(200, { data: STUDIO }));
		const browserSide = createApiContext("browser");
		hydrateApi(browserSide, page.router, { fetch: browser.fetch });
		hydrate(browserSide.queryClient, page.queries);

		t.mock.timers.tick(30 * 60_000);

		assert.deepEqual(await loadStudio(browserSide), STUDIO);
		assert.equal(browser.calls.length, 0);
	});
});

describe("rethrowAsNotFound", () => {
	test("rethrows anything else as it is", () => {
		const bug = new TypeError("x is undefined");
		assert.throws(
			() => rethrowAsNotFound(bug),
			(error: unknown) => error === bug,
		);

		const conflict = new TattooApiError(409, {
			code: "deposit_changed",
			message: "Changed.",
		});
		assert.throws(
			() => rethrowAsNotFound(conflict),
			(error: unknown) => error === conflict,
		);
	});
});
