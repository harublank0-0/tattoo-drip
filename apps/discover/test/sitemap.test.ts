import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	mapLimit,
	SITEMAP_PAGE,
	sitemapIndexUrls,
	sitemapIndexXml,
	sitemapUrl,
	sitemapUrls,
	urlsetXml,
	xmlText,
} from "../src/lib/sitemap.ts";

const SETTINGS = {
	siteUrl: "https://tattoodrip.app",
	indexing: true,
	markets: ["NP", "IN"],
	defaultCountry: "NP",
};
const id = (n: number) =>
	`00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/** A fake Discover client: the sitemap lists page by `size`, and every call is recorded. */
function fakeClient(size = 2) {
	const calls: string[] = [];
	const paged =
		<T>(name: string, rows: (T & { key: string })[]) =>
		async (query?: { cursor?: string; limit?: number }) => {
			calls.push(`${name} ${JSON.stringify(query ?? {})}`);
			const after = rows.filter(
				(row) => !query?.cursor || row.key > query.cursor,
			);
			const page = after.slice(0, size);
			return {
				data: page.map(({ key: _key, ...row }) => row),
				nextCursor: after.length > size ? (page.at(-1)?.key ?? null) : null,
			};
		};
	const client = {
		sitemap: {
			studios: paged("studios", [
				{ key: id(1), slug: "black-needle" },
				{ key: id(2), slug: "lotus-ink" },
				{ key: id(3), slug: "a&b<ink>" },
			]),
			artists: paged("artists", [
				{
					key: id(4),
					slug: "sita",
					studio: { slug: "black-needle", type: "studio" },
				},
				{
					key: id(5),
					slug: "asha",
					studio: { slug: "asha-solo", type: "independent" },
				},
			]),
			tattoos: paged("tattoos", [{ key: id(6), id: id(6).toUpperCase() }]),
		},
		styles: {
			list: async () => [
				{ slug: "blackwork", name: "Blackwork" },
				{ slug: "realism", name: "Realism" },
			],
		},
		artists: {
			list: async (query: { style?: string; country?: string }) => {
				calls.push(`artists.list ${JSON.stringify(query)}`);
				const listed =
					(query.style === "blackwork" || !query.style) &&
					query.country === "NP";
				return { data: listed ? [{}] : [], nextCursor: null };
			},
		},
		studios: {
			list: async (query: { country?: string }) => ({
				data: query.country === "NP" ? [{}] : [],
				nextCursor: null,
			}),
		},
		locations: {
			list: async () => [
				{ country: "NP", slug: "kathmandu", name: "Kathmandu", region: null },
				{ country: "IN", slug: "new-delhi", name: "New Delhi", region: null },
				{ country: "US", slug: "austin", name: "Austin", region: null },
			],
		},
	};
	return { client: client as never, calls };
}

describe("sitemaps (D10)", () => {
	test("XML: escaped, well-formed urlset and index, no lastmod", () => {
		assert.equal(xmlText(`a&b<c>"d'`), "a&amp;b&lt;c&gt;&quot;d&apos;");
		const set = urlsetXml(["https://x.test/?a=1&b=2"]);
		assert.match(
			set,
			/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
		);
		assert.match(set, /<loc>https:\/\/x\.test\/\?a=1&amp;b=2<\/loc>/);
		assert.doesNotMatch(set, /lastmod/);
		assert.match(
			sitemapIndexXml(["https://x.test/a.xml"]),
			/<sitemapindex [^>]+>\n {2}<sitemap><loc>https:\/\/x\.test\/a\.xml<\/loc><\/sitemap>\n<\/sitemapindex>\n$/,
		);
		assert.equal(
			sitemapUrl(SETTINGS, "tattoos", id(9)),
			`https://tattoodrip.app/sitemaps/tattoos.xml?after=${id(9)}`,
		);
	});

	test("the index names the small children, then every page of each list (walked by cursor)", async () => {
		const { client, calls } = fakeClient(2);
		assert.deepEqual(await sitemapIndexUrls(client, SETTINGS), [
			"https://tattoodrip.app/sitemaps/static.xml",
			"https://tattoodrip.app/sitemaps/styles.xml",
			"https://tattoodrip.app/sitemaps/locations.xml",
			"https://tattoodrip.app/sitemaps/studios.xml",
			`https://tattoodrip.app/sitemaps/studios.xml?after=${id(2)}`,
			"https://tattoodrip.app/sitemaps/artists.xml",
			"https://tattoodrip.app/sitemaps/tattoos.xml",
		]);
		const listCalls = calls.filter((call) =>
			/^(studios|artists|tattoos) /.test(call),
		);
		assert.equal(listCalls.length, 4);
		for (const call of listCalls)
			assert.match(call, new RegExp(`"limit":${SITEMAP_PAGE}`));
	});

	test("children: canonical addresses on DISCOVER_URL, one API page each", async () => {
		const { client } = fakeClient(2);
		const urls = (kind: string, after: string | null = null) =>
			sitemapUrls(client, SETTINGS, kind, after);
		assert.deepEqual(await urls("static"), [
			"https://tattoodrip.app/",
			"https://tattoodrip.app/for-studios",
			"https://tattoodrip.app/explore/studios",
			"https://tattoodrip.app/explore/artists",
			"https://tattoodrip.app/tattoos",
		]);
		// Only styles listed in the default country (an empty style page is noindex).
		assert.deepEqual(await urls("styles"), [
			"https://tattoodrip.app/styles/blackwork",
		]);
		// Only populated markets and their cities; never a non-market's place.
		assert.deepEqual(await urls("locations"), [
			"https://tattoodrip.app/locations/nepal",
			"https://tattoodrip.app/locations/nepal/kathmandu",
		]);
		assert.deepEqual(await urls("studios"), [
			"https://tattoodrip.app/studios/black-needle",
			"https://tattoodrip.app/studios/lotus-ink",
		]);
		assert.deepEqual(await urls("studios", id(2)), [
			"https://tattoodrip.app/studios/a%26b%3Cink%3E",
		]);
		assert.deepEqual(await urls("artists"), [
			"https://tattoodrip.app/studios/black-needle/artists/sita",
			"https://tattoodrip.app/artists/asha-solo",
		]);
		// Lower case, the artwork page's canonical slug.
		assert.deepEqual(await urls("tattoos"), [
			`https://tattoodrip.app/tattoos/${id(6)}`,
		]);
		// No such sitemap: an unknown kind, a page of a child that isn't paged, a bad cursor.
		assert.equal(await urls("profiles"), null);
		assert.equal(await urls("static", id(1)), null);
		assert.equal(await urls("tattoos", "nope"), null);
	});

	test("bounded concurrency keeps the order", async () => {
		let running = 0;
		let peak = 0;
		const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running--;
			return n * 2;
		});
		assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
		assert.equal(peak, 2);
	});
});
