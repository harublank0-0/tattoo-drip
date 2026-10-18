import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ArtistPage,
	ErrorPage,
	NotFoundPage,
	StudioPage,
} from "../../src/studio/components/pages.tsx";
import { isAllowedHref } from "../../src/studio/links.ts";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";

function studioHtml(
	studio: Studio = STUDIO,
	artists: Artist[] = [SITA, ARJUN],
) {
	return renderToStaticMarkup(
		createElement(StudioPage, {
			data: studioPageData(studio, artists, ORIGIN),
		}),
	);
}

function artistHtml(slug: string) {
	const data = artistPageData(STUDIO, [SITA, ARJUN], slug, ORIGIN);
	assert.ok(data, slug);
	return renderToStaticMarkup(createElement(ArtistPage, { data }));
}

const count = (html: string, pattern: RegExp) =>
	html.match(pattern)?.length ?? 0;
const decodeAttribute = (value: string) =>
	value
		.replaceAll("&amp;", "&")
		.replaceAll("&#x27;", "'")
		.replaceAll("&quot;", '"');
const hrefs = (html: string) =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) =>
		decodeAttribute(match[1]),
	);
const headings = (html: string) =>
	Array.from(html.matchAll(/<h([1-6])[\s>]/g), (match) => Number(match[1]));
const images = (html: string) => html.match(/<img [^>]*>/g) ?? [];

/** What every page holds to, whatever its data. */
function assertSafePage(html: string) {
	assert.equal(count(html, /<h1[\s>]/g), 1, "exactly one h1");
	for (const href of hrefs(html)) assert.ok(isAllowedHref(href), href);
	for (const anchor of html.match(/<a [^>]*>/g) ?? []) {
		if (/ href="https?:/.test(anchor)) {
			assert.match(anchor, / rel="noopener noreferrer"/, anchor);
		}
	}
	assert.doesNotMatch(html, / target=/);
	assert.doesNotMatch(html, / style=/);
	assert.doesNotMatch(html, /javascript:/i);
	for (const image of images(html)) {
		assert.match(image, / width="\d+"/, image);
		assert.match(image, / height="\d+"/, image);
		assert.match(image, / alt="[^"]+"/, image);
	}
}

describe("the studio page", () => {
	test("has its landmarks, headings and sections in order", () => {
		const html = studioHtml();

		assertSafePage(html);
		assert.equal(count(html, /<main[\s>]/g), 1);
		assert.equal(count(html, /<footer[\s>]/g), 1);
		assert.deepEqual(headings(html), [1, 2, 3, 3, 2]);
		assert.equal(count(html, / id="inquiry"/g), 1);
		assert.match(
			html,
			/<h1 class="profile-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(html, /Studio page by Tattoo Drip/);
	});

	test("links to the inquiry, each open artist and every contact", () => {
		const links = hrefs(studioHtml());

		assert.ok(links.includes("#inquiry"));
		assert.ok(links.includes("/artists/sita#inquiry"));
		assert.ok(
			!links.includes("/artists/arjun#inquiry"),
			"no Ask link for a closed artist",
		);
		for (const href of [
			"https://instagram.com/blackneedle",
			"https://wa.me/9779812345678",
			"viber://chat?number=%2B9779812345678",
			"tel:+9779812345678",
			"mailto:hello@black-needle.example",
		]) {
			assert.ok(links.includes(href), href);
		}
		assert.ok(
			links.some((href) =>
				href.startsWith("https://wa.me/9779812345678?text="),
			),
			"the prefilled inquiry",
		);
	});

	test("loads roster photos lazily, at their stored size", () => {
		const [image] = images(studioHtml());

		assert.ok(image);
		assert.match(image, / width="1200" height="1500"/);
		assert.match(image, / alt="Photo of Sita Rai"/);
		assert.match(image, / loading="lazy"/);
	});

	test("shows a closed artist's own words", () => {
		assert.match(
			studioHtml(),
			/<p class="note user-text measure" dir="auto">Books open in March\.<\/p>/,
		);
	});

	test("leaves out what an empty studio hasn't set", () => {
		const html = studioHtml(EMPTY_STUDIO, []);

		assertSafePage(html);
		assert.doesNotMatch(html, /<address/);
		assert.doesNotMatch(html, / id="artists"/);
		assert.deepEqual(headings(html), [1, 2]);
		assert.match(
			html,
			/Black Needle<\/bdi> hasn(&#x27;|')t added contact details yet\./,
		);
	});

	test("a studio not taking inquiries says so instead of offering them", () => {
		const html = studioHtml(CLOSED_STUDIO, [ARJUN]);

		assertSafePage(html);
		assert.ok(!hrefs(html).includes("#inquiry"));
		assert.match(html, /Not taking new inquiries right now/);
		assert.match(html, /isn(&#x27;|')t taking new inquiries right now\./);
		assert.match(
			html,
			/<h2 id="artists-title" class="section-title">Artist<\/h2>/,
		);
	});

	test("hostile text stays text and hostile links never render", () => {
		const html = studioHtml(
			{
				...STUDIO,
				name: "</h1><script>alert(1)</script>",
				intro: "<img src=x onerror=alert(1)>",
				socialLinks: [{ platform: "instagram", url: "javascript:alert(1)" }],
			},
			[
				{
					...SITA,
					bio: "<b>bold</b>",
					photo: { url: "javascript:alert(1)", width: 10, height: 10 },
				},
			],
		);

		assertSafePage(html);
		assert.doesNotMatch(html, /<script/);
		assert.doesNotMatch(html, /<img /);
		assert.doesNotMatch(html, /<b>/);
		assert.match(html, /&lt;\/h1&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	});
});

describe("the artist page", () => {
	test("is the artist's own page, with the way back and the studio's contacts", () => {
		const html = artistHtml("sita");
		const links = hrefs(html);

		assertSafePage(html);
		assert.deepEqual(headings(html), [1, 2, 2]);
		assert.match(
			html,
			/<h1 id="artist-title" class="artist-title" dir="auto">Sita Rai<\/h1>/,
		);
		assert.match(html, /Tattoo artist at <bdi>Black Needle<\/bdi>/);
		assert.ok(links.includes("/"));
		assert.ok(links.includes("#inquiry"));
		assert.ok(
			links.some(
				(href) =>
					href.startsWith("https://wa.me/9779812345678?text=") &&
					href.includes("Sita%20Rai"),
			),
			"the prefilled inquiry names the artist",
		);
	});

	test("loads its photo first", () => {
		const [image] = images(artistHtml("sita"));

		assert.ok(image);
		assert.match(image, / loading="eager"/);
		assert.match(image, / fetchpriority="high"/i);
	});

	test("a closed artist's page offers the studio instead", () => {
		const html = artistHtml("arjun");
		const links = hrefs(html);

		assertSafePage(html);
		assert.ok(links.includes("/#inquiry"));
		assert.ok(!links.includes("#inquiry"));
		assert.match(html, /Books open in March\./);
	});
});

describe("the status pages", () => {
	test("a not-found page leads back to the studio page", () => {
		const html = renderToStaticMarkup(createElement(NotFoundPage));

		assertSafePage(html);
		assert.match(html, /<h1[^>]*>Page not found<\/h1>/);
		assert.deepEqual(hrefs(html), ["/"]);
	});

	test("an error page offers the same address again", () => {
		const html = renderToStaticMarkup(
			createElement(ErrorPage, { retryHref: "/artists/sita" }),
		);

		assertSafePage(html);
		assert.match(
			html,
			/<h1[^>]*>This page can(&#x27;|')t load right now<\/h1>/,
		);
		assert.deepEqual(hrefs(html), ["/artists/sita"]);
	});

	test("an address that isn't one of the page's own paths is not offered", () => {
		for (const retryHref of ["//evil.example", "https://evil.example", ""]) {
			const html = renderToStaticMarkup(
				createElement(ErrorPage, { retryHref }),
			);
			assert.deepEqual(hrefs(html), ["/"], retryHref);
		}
	});
});
