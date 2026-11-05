import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Studio } from "@tattoo-drip/sdk";
import {
	robotsTxt,
	sitemapPaths,
	sitemapXml,
} from "../../src/studio/sitemap.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	EMPTY_STUDIO,
	GOOD_TO_KNOW_STUDIO,
	ORIGIN,
	SITA,
} from "./fixtures.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/** Prompt 8: the sitemap lists the pages that exist for this studio, and only those. */
const studio = (base: Studio, sections?: string[]) =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, ...(sections ? { sections } : {}) },
		base,
	);

describe("the studio's sitemap", () => {
	test("lists its pages, its visible artists and the informational pages with content", () => {
		assert.deepEqual(
			sitemapPaths(studio(GOOD_TO_KNOW_STUDIO), [SITA, ARJUN], IMAGE_ORIGIN),
			[
				"/",
				"/artists",
				"/artists/sita",
				"/artists/arjun",
				"/gallery",
				"/flash",
				"/book",
				"/about",
				"/services",
				"/faq",
				"/contact",
				"/policies",
				"/aftercare",
			],
		);
	});

	test("leaves out what isn't there: no artists, no flash section, a closed studio, empty pages", () => {
		const paths = sitemapPaths(
			studio({ ...EMPTY_STUDIO, acceptingInquiries: false }, ["work"]),
			[],
			IMAGE_ORIGIN,
		);
		assert.deepEqual(paths, ["/", "/gallery", "/faq"]);
		assert.ok(
			!sitemapPaths(studio(CLOSED_STUDIO), [ARJUN], IMAGE_ORIGIN).includes(
				"/book",
			),
		);
		// A hidden roster is not advertised (review fix).
		const hidden = sitemapPaths(
			studio(GOOD_TO_KNOW_STUDIO, ["work", "flash", "info", "inquiry"]),
			[SITA, ARJUN],
			IMAGE_ORIGIN,
		);
		assert.ok(!hidden.some((path) => path.startsWith("/artists")));
	});

	test("is valid XML on the studio's own origin, every URL escaped; robots.txt points to it", () => {
		const xml = sitemapXml(ORIGIN, ["/", "/gallery?style=a&b"]);
		assert.match(
			xml,
			/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
		);
		assert.match(
			xml,
			new RegExp(
				`<loc>${ORIGIN.replaceAll(".", "\\.")}/gallery\\?style=a&amp;b</loc>`,
			),
		);
		assert.equal(
			robotsTxt(ORIGIN),
			`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
		);
	});
});
