import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import {
	readPortfolioSearch,
	readWorkSearch,
} from "../../src/studio/gallery.ts";
import { portfolioHref, workHref } from "../../src/studio/links.ts";
import {
	parsePlainSearch,
	stringifyPlainSearch,
} from "../../src/studio/search.ts";

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
