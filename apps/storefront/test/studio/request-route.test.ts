import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import {
	type ApiContext,
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { loadStudio } from "../../src/api/loaders.ts";
import { Route as RequestRoute } from "../../src/routes/request.tsx";
import { type SiteContext, SiteRef } from "../../src/site/context.ts";
import type { PageContext, RequestPageData } from "../../src/studio/loaders.ts";
import {
	parsePlainSearch,
	stringifyPlainSearch,
} from "../../src/studio/search.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	flashId,
	flashPage,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";

/*
 * /request through a real router (TAT-127). The router merges the raw search
 * under what validateSearch returned, so a stray key (an ad's `fbclid`, `utm_*`,
 * a second `artist`, a slug the reader refused) reaches `loaderDeps`. The route
 * under test is the app's own: its options are mounted on a test router with the
 * app's search parser, and the loader reads the studio and artists through a
 * fake API.
 */

/** The route's own loader (its options type it as a function or an object). */
const loader = RequestRoute.options.loader as (args: {
	context: PageContext;
	deps: unknown;
}) => Promise<RequestPageData>;

const API = "http://api.test";
const TENANT = `${API}/api/v1/tenants/${STUDIO.slug}`;

function context(studio = STUDIO) {
	const { calls, fetch } = fakeFetch(({ url }) => {
		if (url.endsWith("/artists")) return json(200, { data: [SITA, ARJUN] });
		if (url.endsWith(`/flash/${flashId(1)}`)) {
			// The picture is on the API's own origin, as the loader requires.
			return json(200, {
				data: JSON.parse(
					JSON.stringify(flashPage(1).data[0]).replaceAll(
						"https://api.example.com",
						API,
					),
				),
			});
		}
		return json(404, { error: { code: "not_found", message: "No." } });
	});
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl: API }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN);
	return { calls, context: { ...api, site } satisfies PageContext };
}

/** What the loader was given and what it returned, for a visit to `url`. */
async function visit(url: string, studio = STUDIO) {
	const { calls, context: routerContext } = context(studio);
	const seen: { deps?: unknown; data?: RequestPageData } = {};
	// The app's own root, as __root.tsx builds it (that file loads CSS, which tests can't).
	const root = createRootRouteWithContext<ApiContext & SiteContext>()({
		loader: ({ context }) => loadStudio(context),
	});
	const request = createRoute({
		getParentRoute: () => root,
		path: "/request",
		validateSearch: RequestRoute.options.validateSearch,
		loaderDeps: RequestRoute.options.loaderDeps,
		loader: async (args) => {
			seen.deps = args.deps;
			seen.data = await loader({
				context: args.context as unknown as PageContext,
				deps: args.deps,
			});
			return seen.data;
		},
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([request]),
		history: createMemoryHistory({ initialEntries: [url] }),
		isServer: true,
		context: routerContext,
		parseSearch: parsePlainSearch,
		stringifySearch: stringifyPlainSearch,
	});
	await router.load();
	return { calls, ...seen, status: router.state.matches.at(-1)?.status };
}

/** The artist the form is for, null for the general form, "closed" when there is no form. */
const picked = (data: RequestPageData | undefined) =>
	data?.inquiry.kind === "open"
		? (data.inquiry.preferredArtist?.name ?? null)
		: "closed";

describe("/request through the router", () => {
	test("answers the pages' cache headers", () => {
		const headers = RequestRoute.options.headers as (args: {
			match: { status: string };
		}) => Record<string, string>;

		assert.deepEqual(headers({ match: { status: "success" } }), {
			"Cache-Control":
				"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		});
	});

	test("?artist=sita picks Sita, and reads the artists and nothing else", async () => {
		const result = await visit("/request?artist=sita");

		assert.deepEqual(result.deps, { artist: "sita" });
		assert.equal(picked(result.data), "Sita Rai");
		assert.deepEqual(
			result.calls.map((call) => call.url),
			[`${TENANT}/artists`],
		);
	});

	test("stray keys (fbclid, utm_*, anything) never reach the loader or change the artist", async () => {
		for (const url of [
			"/request?fbclid=IwAR0abc&artist=sita",
			"/request?artist=sita&utm_source=ig&utm_medium=bio&ref=x",
			"/request?utm_source=ig",
			"/request?fbclid=IwAR0abc",
			"/request?__proto__=x&constructor=y&artist=sita",
		]) {
			const result = await visit(url);
			const wanted = url.includes("artist=sita") ? "Sita Rai" : null;

			assert.deepEqual(result.deps, wanted ? { artist: "sita" } : {}, url);
			assert.equal(picked(result.data), wanted, url);
			assert.equal(result.status, "success", url);
		}
	});

	test("a second artist never changes which is picked", async () => {
		const first = await visit("/request?artist=sita&artist=arjun");
		assert.deepEqual(first.deps, { artist: "sita" });
		assert.equal(picked(first.data), "Sita Rai");

		// The first value is not a slug, so the second is not reached for either.
		const bad = await visit("/request?artist=a&artist=sita");
		assert.deepEqual(bad.deps, {});
		assert.equal(picked(bad.data), null);
	});

	test("a malformed, renamed or number-like artist is the general form, never a not-found or an error", async () => {
		for (const artist of [
			"Sita",
			"12",
			"2025",
			"true",
			"null",
			"sita-old",
			"nobody",
			"-sita",
			"sita%20",
			"..%2Fadmin",
			"",
		]) {
			const result = await visit(`/request?artist=${artist}`);

			assert.equal(result.status, "success", artist);
			assert.equal(picked(result.data), null, artist);
			assert.equal(result.data?.seo.canonical, `${ORIGIN}/request`, artist);
		}
	});

	test("an open artist's address serves the working form while the studio as a whole is closed", async () => {
		const result = await visit("/request?artist=sita", CLOSED_STUDIO);

		assert.equal(result.status, "success");
		assert.equal(picked(result.data), "Sita Rai");
		assert.ok(result.data?.channels.whatsapp);
		// And the general address says the studio is closed, still a page.
		const general = await visit("/request", CLOSED_STUDIO);
		assert.equal(general.status, "success");
		assert.equal(general.data?.inquiry.kind, "studio-closed");
	});

	test("?flash=<id>&fbclid=x reaches the loader as { flash }, and ?flash=<id>&artist=sita too", async () => {
		const ID = flashId(1);
		for (const url of [
			`/request?flash=${ID}&fbclid=x`,
			`/request?flash=${ID}&artist=sita`,
			`/request?artist=arjun&flash=${ID}`,
		]) {
			const result = await visit(url);

			assert.deepEqual(result.deps, { flash: ID }, url);
			assert.equal(result.data?.flash?.kind, "requestable", url);
			assert.deepEqual(
				result.calls.map((call) => call.url).sort(),
				[`${TENANT}/artists`, `${TENANT}/flash/${ID}`],
				url,
			);
			assert.equal(result.status, "success", url);
		}
	});

	test("a malformed flash id is the general form and makes no design read", async () => {
		for (const flash of [flashId(1).toUpperCase(), "moth", "12", ""]) {
			const result = await visit(`/request?flash=${flash}`);

			assert.deepEqual(result.deps, {}, flash);
			assert.equal(result.data?.flash, null, flash);
			assert.deepEqual(
				result.calls.map((call) => call.url),
				[`${TENANT}/artists`],
				flash,
			);
			assert.equal(result.status, "success", flash);
		}
	});
});
