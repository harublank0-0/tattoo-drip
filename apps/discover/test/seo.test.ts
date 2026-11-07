import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BRAND_IMAGE,
	canonicalUrl,
	DEFAULT_TITLE,
	fitTitle,
	headTags,
	indexable,
	NOINDEX,
	NOINDEX_FOLLOW,
	pageMeta,
	pageState,
	robotsTxt,
	robotsValue,
} from "../src/lib/seo.ts";

const OFF = { siteUrl: "https://tattoodrip.app", indexing: false };
const ON = { ...OFF, indexing: true };
const robots = (meta: Record<string, string>[]) =>
	meta.find((tag) => tag.name === "robots");
const tag = (meta: Record<string, string>[], key: string) =>
	meta.filter((each) => each.name === key || each.property === key);

describe("Discover SEO foundation", () => {
	test("indexing off: every page says noindex, nofollow; on: only listed pages, others noindex, follow", () => {
		assert.deepEqual(robots(headTags(OFF, "/").meta), {
			name: "robots",
			content: NOINDEX,
		});
		assert.equal(robots(headTags(ON, "/").meta), undefined);
		// D06: the Studio OS page is finished.
		assert.equal(robots(headTags(ON, "/for-studios").meta), undefined);
		// Not in INDEXABLE_PATHS (D09: a 301 to /tattoos): noindex even with indexing on.
		assert.deepEqual(robots(headTags(ON, "/explore/tattoos").meta), {
			name: "robots",
			content: NOINDEX_FOLLOW,
		});
		// D09: the bare gallery and an artwork at its canonical slug may be
		// indexed; another spelling (a 301) or a filtered gallery never.
		assert.equal(robots(headTags(ON, "/tattoos").meta), undefined);
		assert.equal(
			robots(
				headTags(ON, "/tattoos/0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50").meta,
			),
			undefined,
		);
		for (const path of [
			"/tattoos/0B6F8E2C-6A4A-4F1E-9A51-1B0C2D3E4F50",
			"/tattoos/koi-0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50",
			"/tattoos/nope",
		])
			assert.equal(robots(headTags(ON, path).meta)?.content, NOINDEX_FOLLOW);
		assert.equal(
			robots(headTags(ON, "/tattoos", { noindex: true }).meta)?.content,
			NOINDEX_FOLLOW,
		);
		assert.equal(
			robots(
				headTags(OFF, "/tattoos/0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50").meta,
			)?.content,
			NOINDEX,
		);
		// D07: the directories' bare pages may be indexed; a filtered one opts out.
		assert.equal(robots(headTags(ON, "/explore/studios").meta), undefined);
		assert.equal(robots(headTags(ON, "/explore/artists").meta), undefined);
		assert.equal(
			robotsValue(ON, "/explore/studios", { noindex: true }),
			NOINDEX_FOLLOW,
		);
		assert.equal(robotsValue(OFF, "/explore/studios"), NOINDEX);
		assert.equal(robotsValue(ON, "/pricing"), NOINDEX_FOLLOW);
	});

	test("the canonical URL: DISCOVER_URL's origin, the path alone, no trailing slash but the root's", () => {
		const { meta, links } = headTags(OFF, "/explore/studios");
		assert.deepEqual(meta[0], { title: DEFAULT_TITLE });
		assert.equal(tag(meta, "description").length, 1);
		assert.deepEqual(links, [
			{ rel: "canonical", href: "https://tattoodrip.app/explore/studios" },
		]);
		assert.deepEqual(tag(meta, "og:url"), [
			{ property: "og:url", content: "https://tattoodrip.app/explore/studios" },
		]);
		assert.equal(canonicalUrl(OFF, ""), "https://tattoodrip.app/");
		assert.equal(canonicalUrl(OFF, "/"), "https://tattoodrip.app/");
		assert.equal(
			canonicalUrl(OFF, "/locations/nepal/"),
			"https://tattoodrip.app/locations/nepal",
		);
		// Never the query or a fragment, and the path's own encoding kept.
		assert.equal(
			canonicalUrl(OFF, "/explore/studios?country=IN#x"),
			"https://tattoodrip.app/explore/studios",
		);
		assert.equal(
			canonicalUrl(OFF, "/locations/india/new%20delhi"),
			"https://tattoodrip.app/locations/india/new%20delhi",
		);
		// A 404 or an error page has no canonical address.
		const missing = headTags(ON, "/nope", { canonical: false, noindex: true });
		assert.deepEqual(missing.links, []);
		assert.deepEqual(tag(missing.meta, "og:url"), []);
		// The production origin, never the request's host.

		assert.equal(
			canonicalUrl({ siteUrl: "https://tattoodrip.app" }, "/styles/blackwork"),
			"https://tattoodrip.app/styles/blackwork",
		);
	});

	test("style, location (D07) and profile (D08) pages may be indexed by shape; nothing else dynamic", () => {
		for (const path of [
			"/styles/blackwork",
			"/styles/fine-line",
			"/locations/nepal",
			"/locations/nepal/kathmandu",
			"/locations/united-states/new-york",
			"/studios/black-needle",
			"/studios/black-needle/artists/maya",
			"/artists/maya-tattoo",
		]) {
			assert.equal(indexable(ON, path), true, path);
			assert.equal(indexable(OFF, path), false, path);
			assert.equal(indexable(ON, path, { noindex: true }), false, path);
		}
		for (const path of [
			"/styles",
			"/styles/Blackwork",
			"/styles/a/b",
			"/locations",
			"/locations/nepal/kathmandu/x",
			"/locations/nepal/",
			"/studios/Black-Needle",
			"/studios/x/artists",
			"/studios/x/artists/y/z",
			"/studios/x/other/y",
			"/artists/x/y",
			"/tattoos/x",
			"/sitemaps/studios.xml",
		])
			assert.equal(indexable(ON, path), false, path);
	});

	test("pageState: one robots decision from every match (404, error, any query, opt-outs)", () => {
		const root = {
			routeId: "__root__",
			status: "success",
			pathname: "/",
			search: { country: undefined },
		};
		const page = (over: Record<string, unknown> = {}) => [
			root,
			{
				routeId: "/locations/$country/",
				status: "success",
				pathname: "/locations/nepal/",
				search: { country: undefined },
				...over,
			},
		];
		assert.deepEqual(pageState(page()), {
			pathname: "/locations/nepal",
			notFound: false,
			error: false,
			noindex: false,
		});
		assert.equal(
			pageState(page({ loaderData: { noindex: true } })).noindex,
			true,
		);
		assert.equal(
			pageState(page({ loaderData: { noindex: false } })).noindex,
			false,
		);
		assert.equal(
			pageState(page({ staticData: { noindex: true } })).noindex,
			true,
		);
		// Any query is a variant of the bare path: `?country=`, filters, cursors, tracking.
		assert.equal(pageState(page({ search: { country: "IN" } })).noindex, true);
		assert.equal(pageState(page({ search: { cursor: "abc" } })).noindex, true);
		assert.equal(
			pageState(page({ search: { utm_source: "x" } })).noindex,
			true,
		);
		assert.equal(pageState(page({ status: "error" })).error, true);
		assert.equal(pageState(page({ status: "error" })).noindex, true);
		assert.equal(pageState(page({ status: "notFound" })).notFound, true);
		assert.equal(pageState([root]).notFound, true);
	});

	test("Open Graph and Twitter: the brand mark by default (a small card), a page's own picture as a large one", () => {
		const { meta } = headTags(ON, "/");
		for (const key of [
			"og:site_name",
			"og:type",
			"og:title",
			"og:description",
			"og:url",
			"og:image",
			"og:image:width",
			"og:image:height",
			"og:image:alt",
			"twitter:card",
		])
			assert.equal(tag(meta, key).length, 1, key);
		assert.equal(
			tag(meta, "og:image")[0]?.content,
			`https://tattoodrip.app${BRAND_IMAGE.path}`,
		);
		assert.equal(tag(meta, "twitter:card")[0]?.content, "summary");
		assert.deepEqual(
			pageMeta({
				title: "Black Needle",
				image: {
					url: "https://media.test/cover.jpg",
					width: 1600,
					height: 900,
					alt: "Black Needle's studio",
				},
			}),
			[
				{ title: "Black Needle | Tattoo Drip" },
				{ property: "og:title", content: "Black Needle | Tattoo Drip" },
				{ property: "og:image", content: "https://media.test/cover.jpg" },
				{ property: "og:image:width", content: "1600" },
				{ property: "og:image:height", content: "900" },
				{ property: "og:image:alt", content: "Black Needle's studio" },
				{ name: "twitter:card", content: "summary_large_image" },
			],
		);
		// A page never sets robots itself (the root decides).
		assert.deepEqual(pageMeta({}), []);
	});

	test("titles keep whole parts: the name always, then what fits", () => {
		assert.equal(
			fitTitle(["Black Needle", " — Tattoo studio in Kathmandu", ", Nepal"]),
			"Black Needle — Tattoo studio in Kathmandu, Nepal",
		);
		assert.equal(
			fitTitle([
				"The Extraordinarily Long Named Tattoo Collective",
				" — Tattoo studio in Kathmandu",
				", Nepal",
			]),
			"The Extraordinarily Long Named Tattoo Collective",
		);
		assert.equal(fitTitle(["A", " b", " c"], 3), "A b");
	});

	test("robots.txt disallows everything while off; allows everything and names the sitemap index when on", () => {
		assert.equal(robotsTxt(OFF), "User-agent: *\nDisallow: /\n");
		assert.equal(
			robotsTxt(ON),
			"User-agent: *\nAllow: /\n\nSitemap: https://tattoodrip.app/sitemap.xml\n",
		);
		assert.doesNotMatch(robotsTxt(ON), /Disallow/);
	});
});
