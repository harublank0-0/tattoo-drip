import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	canonicalUrl,
	DEFAULT_TITLE,
	headTags,
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
		// Not in INDEXABLE_PATHS: noindex even with indexing on and no opt-out.
		assert.deepEqual(robots(headTags(ON, "/explore/studios").meta), {
			name: "robots",
			content: NOINDEX,
		});
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

	test("a page's own title, description and noindex", () => {
		assert.deepEqual(pageMeta({ title: "Pricing", noindex: true }), [
			{ title: "Pricing | Tattoo Drip" },
			{ property: "og:title", content: "Pricing | Tattoo Drip" },
			{ name: "robots", content: NOINDEX },
		]);
		assert.deepEqual(pageMeta({}), []);
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
		assert.deepEqual(sitemapEntries(ON), ["https://tattoodrip.app/"]);
		assert.match(
			sitemapXml(["https://x.test/?a=1&b=2"]),
			/<loc>https:\/\/x\.test\/\?a=1&amp;b=2<\/loc>/,
		);
	});
});
