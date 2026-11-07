import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	canonicalUrl,
	DEFAULT_TITLE,
	headTags,
	indexable,
	NOINDEX,
	pageMeta,
	robotsTxt,
	sitemapEntries,
	sitemapXml,
} from "../src/lib/seo.ts";

const OFF = { siteUrl: "https://tattoodrip.app", indexing: false };
const ON = { ...OFF, indexing: true };
const robots = (meta: Record<string, string>[]) =>
	meta.find((tag) => tag.name === "robots");

describe("Discover SEO foundation", () => {
	test("indexing off: every page says noindex; on: only listed pages, and never one that opts out", () => {
		assert.deepEqual(robots(headTags(OFF, "/").meta), {
			name: "robots",
			content: NOINDEX,
		});
		assert.equal(robots(headTags(ON, "/").meta), undefined);
		// D06: the Studio OS page is finished; pricing waits for published prices.
		assert.equal(robots(headTags(ON, "/for-studios").meta), undefined);
		assert.deepEqual(robots(headTags(ON, "/pricing").meta), {
			name: "robots",
			content: NOINDEX,
		});
		// Not in INDEXABLE_PATHS: noindex even with indexing on and no opt-out.
		assert.deepEqual(robots(headTags(ON, "/explore/tattoos").meta), {
			name: "robots",
			content: NOINDEX,
		});
		// D07: the directories' bare pages may be indexed; a filtered one opts out.
		assert.equal(robots(headTags(ON, "/explore/studios").meta), undefined);
		assert.equal(robots(headTags(ON, "/explore/artists").meta), undefined);
		assert.ok(robots(headTags(ON, "/explore/studios", { noindex: true }).meta));
		assert.deepEqual(robots(headTags(ON, "/", { noindex: true }).meta), {
			name: "robots",
			content: NOINDEX,
		});
		assert.deepEqual(robots(headTags(ON, "/pricing", { noindex: true }).meta), {
			name: "robots",
			content: NOINDEX,
		});
	});

	test("the default title and description, and the canonical URL on Discover's own origin", () => {
		const { meta, links } = headTags(OFF, "/explore/studios");
		assert.deepEqual(meta[0], { title: DEFAULT_TITLE });
		assert.ok(
			meta.some((tag) => tag.name === "description" && tag.content.length > 40),
		);
		assert.deepEqual(links, [
			{ rel: "canonical", href: "https://tattoodrip.app/explore/studios" },
		]);
		assert.ok(
			meta.some(
				(tag) =>
					tag.property === "og:url" &&
					tag.content === "https://tattoodrip.app/explore/studios",
			),
		);
		assert.equal(canonicalUrl(OFF, ""), "https://tattoodrip.app/");
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
		])
			assert.equal(indexable(ON, path), false, path);
	});

	test("a page's own title, description and noindex", () => {
		assert.deepEqual(pageMeta({ title: "Pricing", noindex: true }), [
			{ title: "Pricing | Tattoo Drip" },
			{ property: "og:title", content: "Pricing | Tattoo Drip" },
			{ name: "robots", content: NOINDEX },
		]);
		assert.deepEqual(pageMeta({}), []);
	});

	test("a profile's social card picture (D08)", () => {
		assert.deepEqual(
			pageMeta({
				title: "Black Needle",
				image: "https://media.test/cover.jpg",
				imageAlt: "Black Needle's studio",
			}),
			[
				{ title: "Black Needle | Tattoo Drip" },
				{ property: "og:title", content: "Black Needle | Tattoo Drip" },
				{ property: "og:image", content: "https://media.test/cover.jpg" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ property: "og:image:alt", content: "Black Needle's studio" },
			],
		);
	});

	test("robots.txt disallows everything while off; allows and names the sitemap when on", () => {
		assert.equal(robotsTxt(OFF), "User-agent: *\nDisallow: /\n");
		assert.equal(
			robotsTxt(ON),
			"User-agent: *\nAllow: /\n\nSitemap: https://tattoodrip.app/sitemap.xml\n",
		);
	});

	test("no sitemap entry while indexing is off", () => {
		assert.deepEqual(sitemapEntries(OFF), []);
		assert.deepEqual(sitemapEntries(ON), [
			"https://tattoodrip.app/",
			"https://tattoodrip.app/for-studios",
			"https://tattoodrip.app/explore/studios",
			"https://tattoodrip.app/explore/artists",
		]);
		assert.match(
			sitemapXml(["https://x.test/?a=1&b=2"]),
			/<loc>https:\/\/x\.test\/\?a=1&amp;b=2<\/loc>/,
		);
	});
});
