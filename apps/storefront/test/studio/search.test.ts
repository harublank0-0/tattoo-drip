import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import type { WorkPage as WorkPageBody } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import { ArtistPage, WorkPage } from "../../src/studio/components/pages.tsx";
import {
	type PortfolioSearch,
	readPortfolioSearch,
	readWorkSearch,
	type WorkSearch,
} from "../../src/studio/gallery.ts";
import { portfolioHref, workHref } from "../../src/studio/links.ts";
import { loadArtistPage, loadWorkPage } from "../../src/studio/loaders.ts";
import {
	parsePlainSearch,
	stringifyPlainSearch,
} from "../../src/studio/search.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	galleryPage,
	ORIGIN,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { IMAGE_ORIGIN } from "./theme-fixtures.ts";

/*
 * The router reads and writes the address's search as plain strings (TAT-126
 * fix round 2). Its default reads each value as JSON and writes strings that
 * would parse back in quotes, so an artist whose slug is `true`, `false`,
 * `null`, `1e2` or `2025` (all valid slugs) arrived as a boolean, null or a
 * number, or as another number altogether (`1e2` is 100).
 */

describe("parsePlainSearch", () => {
	test("every value is the string in the address", () => {
		const search = parsePlainSearch(
			"?a=true&b=false&c=null&d=1e2&e=2025&f=1&g=&h=%7B%7D&i=sita-rai",
		);

		assert.deepEqual(
			{ ...search },
			{
				a: "true",
				b: "false",
				c: "null",
				d: "1e2",
				e: "2025",
				f: "1",
				g: "",
				h: "{}",
				i: "sita-rai",
			},
		);
	});

	test("with or without the leading ?, and none is empty", () => {
		assert.deepEqual({ ...parsePlainSearch("a=1") }, { a: "1" });
		assert.deepEqual({ ...parsePlainSearch("?a=1") }, { a: "1" });
		assert.deepEqual({ ...parsePlainSearch("") }, {});
		assert.deepEqual({ ...parsePlainSearch("?") }, {});
	});

	test("a repeated key is its first value, and a key like __proto__ is only a key", () => {
		const search = parsePlainSearch("a=1&a=2&__proto__=x&toString=y");

		assert.equal(search.a, "1");
		assert.equal(Object.getPrototypeOf(search), null);
		assert.equal(Object.keys(search).includes("__proto__"), true);
		assert.equal(search.toString, "y");
	});
});

describe("stringifyPlainSearch", () => {
	test("strings as they are, true as 1, in key order", () => {
		assert.equal(
			stringifyPlainSearch({
				artist: "true",
				style: "fine-line",
				healed: true,
				cursor: "c2_-",
			}),
			"?artist=true&style=fine-line&healed=1&cursor=c2_-",
		);
		// No quotes around anything that looks like JSON.
		assert.equal(stringifyPlainSearch({ artist: "2025" }), "?artist=2025");
		assert.equal(stringifyPlainSearch({ artist: "1e2" }), "?artist=1e2");
	});

	test("nothing to write is an empty string, and absent, null and false are left out", () => {
		assert.equal(stringifyPlainSearch({}), "");
		assert.equal(
			stringifyPlainSearch({ a: undefined, b: null, c: false, d: {}, e: [] }),
			"",
		);
		assert.equal(stringifyPlainSearch({ a: 3, b: Number.NaN }), "?a=3");
	});

	test("keys and values are percent-encoded", () => {
		assert.equal(stringifyPlainSearch({ "a b": "c&d=e" }), "?a%20b=c%26d%3De");
		assert.deepEqual(
			{ ...parsePlainSearch(stringifyPlainSearch({ "a b": "c&d=e+f" })) },
			{ "a b": "c&d=e+f" },
		);
	});

	test("its spelling of a search is the one workHref and portfolioHref write", () => {
		const searches = [
			{ artist: "sita", healed: true as const },
			{
				artist: "sita",
				style: "fine-line",
				healed: true as const,
				cursor: "c2_-",
			},
			{ artist: "true", style: "japanese" },
			{ cursor: "abcDEF012" },
			{ healed: true as const },
			{},
		];
		for (const search of searches) {
			assert.equal(
				workHref(search),
				`/work${stringifyPlainSearch(search)}`,
				JSON.stringify(search),
			);
		}
		const { healed, cursor } = searches[1];
		assert.equal(
			portfolioHref("sita", { healed, cursor }),
			`/artists/sita${stringifyPlainSearch({ healed, cursor })}#work`,
		);
	});
});

describe("the router is given them", () => {
	test("src/router.tsx reads and writes the search with parsePlainSearch and stringifyPlainSearch", () => {
		// A source pin, as the real router needs a Start request to build.
		const router = readFileSync(
			new URL("../../src/router.tsx", import.meta.url),
			"utf8",
		);

		assert.match(
			router,
			/import \{ parsePlainSearch, stringifyPlainSearch \} from "\.\/studio\/search\.ts";/,
		);
		assert.match(router, /parseSearch:\s*parsePlainSearch,/);
		assert.match(router, /stringifySearch:\s*stringifyPlainSearch,/);
		assert.doesNotMatch(router, /defaultStringifySearch|healedAsOne/);
	});
});

/**
 * A router with the app's search options and the real readers, as the page
 * routes wire them (validateSearch and loaderDeps), loaded on the server's
 * path. It returns what the loader was given, the route's params, whether
 * the address would be redirected to a different spelling of itself (the
 * server's check: the address against the router's own spelling of the
 * validated search), and the search.
 */
async function visit(url: string) {
	const seen: { work?: unknown; artist?: unknown; params?: unknown } = {};
	const root = createRootRoute();
	const index = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => null,
	});
	const work = createRoute({
		getParentRoute: () => root,
		path: "/work",
		validateSearch: readWorkSearch,
		loaderDeps: ({ search }) => ({ search }),
		loader: ({ deps }) => {
			seen.work = deps.search;
		},
		component: () => null,
	});
	const artist = createRoute({
		getParentRoute: () => root,
		path: "/artists/$slug",
		validateSearch: readPortfolioSearch,
		loaderDeps: ({ search }) => ({ search }),
		loader: ({ deps, params }) => {
			seen.artist = deps.search;
			seen.params = params;
		},
		component: () => null,
	});
	const deposit = createRoute({
		getParentRoute: () => root,
		path: "/deposit",
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([index, work, artist, deposit]),
		history: createMemoryHistory({ initialEntries: [url] }),
		isServer: true,
		parseSearch: parsePlainSearch,
		stringifySearch: stringifyPlainSearch,
	});
	await router.load();
	router.updateLatestLocation();
	const own = router.buildLocation({
		to: router.latestLocation.pathname,
		search: true,
		params: true,
		hash: true,
		state: true,
		_includeValidateSearch: true,
	} as Parameters<typeof router.buildLocation>[0]);
	return {
		...seen,
		loaded: router.state.matches.length,
		redirectedTo:
			own.publicHref === router.latestLocation.publicHref
				? null
				: own.publicHref,
		search: { ...router.latestLocation.search },
	};
}

describe("a full round trip through the router: parse, validate, write", () => {
	const SLUGS = ["true", "false", "null", "1e2", "2025", "sita-rai"];

	for (const slug of SLUGS) {
		test(`/work?artist=${slug} reaches the loader as that slug and is not redirected`, async () => {
			const result = await visit(`/work?artist=${slug}`);

			assert.deepEqual(result.work, { artist: slug });
			assert.equal(result.redirectedTo, null);
			assert.equal(result.loaded > 0, true);
		});
	}

	test("/work with every filter, healed=1 included, is the same address back", async () => {
		const url = "/work?artist=1e2&style=fine-line&healed=1&cursor=c2_-";
		const result = await visit(url);

		assert.deepEqual(result.work, {
			artist: "1e2",
			style: "fine-line",
			healed: true,
			cursor: "c2_-",
		});
		assert.equal(result.redirectedTo, null);
		// And the validated search is written the way the page's own links write it.
		assert.equal(url, workHref(result.work as never));
	});

	test("an artist's page with healed=1 and a cursor, for a slug that looks like JSON", async () => {
		for (const slug of SLUGS) {
			const result = await visit(`/artists/${slug}?healed=1&cursor=c2`);

			assert.deepEqual(result.artist, { healed: true, cursor: "c2" }, slug);
			assert.deepEqual({ ...(result.params as object) }, { slug }, slug);
			assert.equal(result.redirectedTo, null, slug);
		}
	});

	test("a page with no search, and one that carries search no reader knows, is not redirected", async () => {
		for (const url of ["/", "/work", "/artists/sita", "/?ref=true&x=1e2"]) {
			const result = await visit(url);

			assert.equal(result.redirectedTo, null, url);
			assert.equal(result.loaded > 0, true, url);
		}
	});

	test("the deposit token stays in the fragment, never in the search", async () => {
		const token = "A".repeat(43);
		const result = await visit(`/deposit#${token}`);

		assert.deepEqual(result.search, {});
		assert.equal(result.redirectedTo, null);
		assert.equal(result.loaded > 0, true);
	});

	test("a path no page matches is still the root's not-found, not an error", async () => {
		const result = await visit("/flash?artist=true");

		assert.equal(result.redirectedTo, null);
		assert.equal(result.loaded > 0, true);
	});
});

/*
 * Fix round 3. The router merges what a reader dropped back into the search
 * the loaders get, as the strings typed, so `?healed=false` arrives as the
 * truthy string "false" even though readHealed refused it. Everything that
 * decides "healed is on" has to mean what the reader means (exactly `true`,
 * only `healed=1`): the API read, the control on the page and every link.
 */
describe("a healed value the reader rejects is no filter anywhere", () => {
	// The API's origin is the photos' (the gallery keeps no photo from another).
	const API = IMAGE_ORIGIN;
	const WORK = `${API}/api/v1/tenants/${STUDIO.slug}/work`;

	/** A server render's context against a stand-in API that records its calls. */
	function context(body: WorkPageBody) {
		const { calls, fetch } = fakeFetch(({ url }) => {
			if (url.endsWith("/artists")) {
				return json(200, { data: [sitaWithWork(2), ARJUN] });
			}
			if (url.includes("/work?")) return json(200, body);
			return json(404, { error: { code: "not_found", message: "No." } });
		});
		const api = createApiContext("server");
		connectServer(api, { config: { apiUrl: API }, studio: STUDIO, fetch });
		seedStudio(api, STUDIO);
		const site = new SiteRef();
		site.connect(ORIGIN);
		return {
			context: { ...api, site },
			workReads: () =>
				calls.map((call) => call.url).filter((url) => url.includes("/work?")),
		};
	}

	/** A page with a next page, so the "Show more" link is there to check. */
	const page = () => galleryPage(3, { nextCursor: "c2" });
	const hrefsOf = (html: string) =>
		[...html.matchAll(/href="([^"]*)"/g)].map((match) =>
			match[1].replaceAll("&amp;", "&"),
		);
	const checkboxOf = (html: string) =>
		html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";

	const OFF = ["false", "0", "true", "yes"];

	for (const value of OFF) {
		test(`/work?healed=${value} asks the API for no healed filter and shows the box unticked`, async () => {
			const { context: ctx, workReads } = context(page());
			const { work } = await visit(`/work?healed=${value}`);
			const data = await loadWorkPage(ctx, work as WorkSearch);
			const html = renderToStaticMarkup(createElement(WorkPage, { data }));

			assert.deepEqual(workReads(), [`${WORK}?limit=24`]);
			assert.match(checkboxOf(html), /name="healed"/, "the box is there");
			assert.doesNotMatch(checkboxOf(html), /checked/, "and unticked");
			assert.equal(
				hrefsOf(html).filter((href) => href.includes("healed")).length,
				0,
				"no link carries healed",
			);
			assert.ok(hrefsOf(html).includes("/work?cursor=c2"), "Show more");
		});

		test(`/artists/sita?healed=${value} asks for no healed filter and shows All`, async () => {
			const { context: ctx, workReads } = context(page());
			const { artist } = await visit(`/artists/sita?healed=${value}`);
			const data = await loadArtistPage(ctx, "sita", artist as PortfolioSearch);
			const html = renderToStaticMarkup(createElement(ArtistPage, { data }));
			const nav = html.match(
				/<nav class="work-filter-nav"[\s\S]*?<\/nav>/,
			)?.[0];

			assert.deepEqual(workReads(), [`${WORK}?artist=sita&limit=24`]);
			assert.match(
				nav ?? "",
				/<a href="\/artists\/sita#work" aria-current="page">All<\/a>/,
			);
			assert.match(
				nav ?? "",
				/<a href="\/artists\/sita\?healed=1#work">Healed<\/a>/,
			);
			assert.ok(
				hrefsOf(html).includes("/artists/sita?cursor=c2#work"),
				"Show more keeps no healed",
			);
		});
	}

	test("/work?healed=1 asks for healed photos and says so: the box ticked, the links keep it", async () => {
		const { context: ctx, workReads } = context(page());
		const { work } = await visit("/work?healed=1");
		const data = await loadWorkPage(ctx, work as WorkSearch);
		const html = renderToStaticMarkup(createElement(WorkPage, { data }));

		assert.deepEqual(workReads(), [`${WORK}?healed=true&limit=24`]);
		assert.match(checkboxOf(html), /name="healed"[^>]* checked=""/);
		assert.ok(hrefsOf(html).includes("/work?healed=1&cursor=c2"), "Show more");
	});

	test("/artists/sita?healed=1 asks for healed photos and marks Healed", async () => {
		const { context: ctx, workReads } = context(page());
		const { artist } = await visit("/artists/sita?healed=1");
		const data = await loadArtistPage(ctx, "sita", artist as PortfolioSearch);
		const html = renderToStaticMarkup(createElement(ArtistPage, { data }));
		const nav = html.match(/<nav class="work-filter-nav"[\s\S]*?<\/nav>/)?.[0];

		assert.deepEqual(workReads(), [`${WORK}?artist=sita&healed=true&limit=24`]);
		assert.match(
			nav ?? "",
			/<a href="\/artists\/sita\?healed=1#work" aria-current="page">Healed<\/a>/,
		);
		assert.ok(
			hrefsOf(html).includes("/artists/sita?healed=1&cursor=c2#work"),
			"Show more",
		);
	});

	test("a malformed cursor still goes to the API as typed, so it is still the not-found page", async () => {
		const { context: ctx, workReads } = context(page());
		const { work } = await visit("/work?cursor=bogus&healed=false");
		await loadWorkPage(ctx, work as WorkSearch);

		assert.deepEqual(workReads(), [`${WORK}?cursor=bogus&limit=24`]);
	});

	test("a stray style in an artist page's address is not part of the portfolio read: the whole portfolio shows", async () => {
		const { context: ctx, workReads } = context(page());
		const { artist } = await visit("/artists/sita?style=fine-line");
		const data = await loadArtistPage(ctx, "sita", artist as PortfolioSearch);
		const html = renderToStaticMarkup(createElement(ArtistPage, { data }));
		const nav = html.match(/<nav class="work-filter-nav"[\s\S]*?<\/nav>/)?.[0];

		assert.deepEqual(workReads(), [`${WORK}?artist=sita&limit=24`]);
		assert.equal(data.portfolio.gallery.photos.length, 3);
		assert.equal(
			[...html.matchAll(/class="work-open"/g)].length,
			3,
			"all three photos are on the page",
		);
		assert.match(
			nav ?? "",
			/<a href="\/artists\/sita#work" aria-current="page">All<\/a>/,
		);
		assert.ok(
			hrefsOf(html).every((href) => !href.includes("style")),
			"no link carries style",
		);
	});

	test("a stray style with healed=1 reads the healed portfolio and no style", async () => {
		const { context: ctx, workReads } = context(page());
		const { artist } = await visit("/artists/sita?style=fine-line&healed=1");
		await loadArtistPage(ctx, "sita", artist as PortfolioSearch);

		assert.deepEqual(workReads(), [`${WORK}?artist=sita&healed=true&limit=24`]);
	});

	test("a stray style and artist beside a cursor: only the cursor is passed on", async () => {
		const { context: ctx, workReads } = context(page());
		const { artist } = await visit(
			"/artists/sita?style=japanese&artist=bina&cursor=bogus",
		);
		await loadArtistPage(ctx, "sita", artist as PortfolioSearch);

		assert.deepEqual(workReads(), [
			`${WORK}?artist=sita&cursor=bogus&limit=24`,
		]);
	});

	test("an artist= in an artist page's address does not change whose photos it shows", async () => {
		const { context: ctx, workReads } = context(page());
		const { artist } = await visit("/artists/sita?artist=bina&style=japanese");
		await loadArtistPage(ctx, "sita", artist as PortfolioSearch);

		assert.equal(workReads().length, 1);
		assert.match(workReads()[0], /\/work\?artist=sita(&|$)/);
	});
});
