import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import { THEME_KEYS } from "../../src/studio/theme/config.ts";
import {
	THEMES,
	ThemedArtistPage,
	ThemedStudioPage,
	themeFor,
} from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage, type SafePageOptions } from "./safety.ts";
import { firstDifference, SNAPSHOT_FILE } from "./snapshot.ts";
import {
	BRANDED,
	COVER,
	COVER_ALT,
	HOSTILE,
	IMAGE_ORIGIN,
	LOGO,
	withStorefront,
} from "./theme-fixtures.ts";

const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Record<
	string,
	string
>;

function studioHtml(
	studio: Studio = STUDIO,
	artists: Artist[] = [SITA, ARJUN],
) {
	return renderToStaticMarkup(
		createElement(ThemedStudioPage, {
			data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN),
		}),
	);
}

function artistHtml(slug: string, studio: Studio = STUDIO) {
	const data = artistPageData(
		studio,
		[SITA, ARJUN],
		slug,
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data, slug);
	return renderToStaticMarkup(createElement(ThemedArtistPage, { data }));
}

function assertSame(actual: string, name: string) {
	assert.ok(
		actual === SNAPSHOT[name],
		`${name}: ${firstDifference(actual, SNAPSHOT[name])}`,
	);
}

/** A branded page holds to every rule of an ordinary one; its logo and cover may be decoration. */
const BRAND_PAGE: SafePageOptions = { brandImages: true };

const sections = (...types: string[]) =>
	types.map((type) => ({ type, props: {} }));
const headings = (html: string) =>
	Array.from(html.matchAll(/<h([1-6])[\s>]/g), (match) => Number(match[1]));
const hrefs = (html: string) =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) =>
		match[1].replaceAll("&amp;", "&"),
	);
const ids = (html: string) =>
	Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1]);

describe("the theme registry (TAT-54)", () => {
	test("has a theme for every key, and Stencil & Ink is today's page", () => {
		assert.deepEqual(Object.keys(THEMES), [...THEME_KEYS]);
		assert.equal(THEMES["stencil-and-ink"].StudioPage, StudioPage);
		assert.equal(THEMES["stencil-and-ink"].ArtistPage, ArtistPage);
	});

	test("an unknown key is the default theme", () => {
		for (const key of ["classic", "", "__proto__", "constructor", "toString"]) {
			assert.equal(themeFor(key), THEMES["stencil-and-ink"], key);
		}
	});
});

describe("the default theme (TAT-54)", () => {
	test("renders exactly what the pages rendered before themes", () => {
		assertSame(studioHtml(), "studio");
		assertSame(studioHtml(EMPTY_STUDIO, []), "empty");
		assertSame(studioHtml(CLOSED_STUDIO, [ARJUN]), "closed");
		assertSame(artistHtml("sita"), "artist-sita");
		assertSame(artistHtml("arjun"), "artist-arjun");
	});

	test("a config whose every value is hostile renders the default theme's markup, byte for byte", () => {
		assertSame(studioHtml(withStorefront(HOSTILE)), "studio");
		assertSame(artistHtml("sita", withStorefront(HOSTILE)), "artist-sita");
	});
});

describe("the studio page's sections (TAT-54)", () => {
	test("follow the config's order", () => {
		const html = studioHtml(
			withStorefront({ sections: sections("inquiry", "artists") }),
		);
		assert.ok(html.indexOf(' id="inquiry"') < html.indexOf(' id="artists"'));
		// h1; the strip; the inquiry and its panel; Artists and its two artists.
		assert.deepEqual(headings(html), [1, 2, 2, 2, 2, 3, 3]);
	});

	test("a hidden roster is gone; the hero, the inquiry and the footer stay", () => {
		const html = studioHtml(withStorefront({ sections: sections("inquiry") }));
		assert.doesNotMatch(html, / id="artists"|Ask for/);
		assert.deepEqual(headings(html), [1, 2, 2, 2]);
		assert.match(
			html,
			/<h1 class="profile-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(html, /<section id="inquiry"/);
		assert.match(html, /Studio page by Tattoo Drip/);
	});

	test("the inquiry section can't be hidden, so no link points at nothing", () => {
		for (const config of [
			sections(),
			sections("artists"),
			sections("inquiry"),
			sections("hero", "portfolio"),
			sections("inquiry", "artists"),
		]) {
			const html = studioHtml(withStorefront({ sections: config }));
			assert.equal(html.match(/ id="inquiry"/g)?.length, 1);
			for (const href of hrefs(html).filter((href) => href.startsWith("#"))) {
				assert.ok(ids(html).includes(href.slice(1)), href);
			}
		}
	});
});

describe("a studio's logo and cover (TAT-54)", () => {
	test("the logo sits above the name, the cover above the hero, both from the API's origin", () => {
		const html = studioHtml(withStorefront(BRANDED));
		assertSafePage(html, BRAND_PAGE);
		assert.ok(
			html.includes(
				`<div class="profile-heading"><img class="profile-logo" src="${LOGO.url}" width="600" height="200" alt="" decoding="async" fetchPriority="low"/><h1 class="profile-name" dir="auto">Black Needle</h1>`,
			),
		);
		assert.ok(
			html.includes(
				`<main class="page"><div class="profile-cover"><img src="${COVER.url}" width="2048" height="1024" alt="" loading="eager" decoding="async" fetchPriority="high"/></div><header class="profile">`,
			),
		);
	});

	test("the cover says what it shows when the API described it; the logo stays decoration", () => {
		const branding = {
			...BRANDED.branding,
			logo: { ...LOGO, alt: "Black Needle logo" },
			heroImage: { ...COVER, alt: COVER_ALT },
		};
		const html = studioHtml(withStorefront({ ...BRANDED, branding }));
		assertSafePage(html, BRAND_PAGE);
		assert.ok(
			html.includes(
				`<img src="${COVER.url}" width="2048" height="1024" alt="${COVER_ALT}" loading="eager"`,
			),
		);
		assert.ok(
			html.includes(`src="${LOGO.url}" width="600" height="200" alt=""`),
		);
		assert.doesNotMatch(html, /Black Needle logo/);
	});

	test("a hostile description is text in an attribute, nothing else", () => {
		const html = studioHtml(
			withStorefront({
				...BRANDED,
				branding: {
					...BRANDED.branding,
					heroImage: { ...COVER, alt: '"><script>alert(1)</script>' },
				},
			}),
		);
		assertSafePage(html, BRAND_PAGE);
		assert.doesNotMatch(html, /<script/);
		assert.match(
			html,
			/alt="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/,
		);
	});

	test("the artist page shows the logo beside the studio's name in its bar, and no cover", () => {
		const html = artistHtml("sita", withStorefront(BRANDED));
		assertSafePage(html, BRAND_PAGE);
		assert.ok(
			html.includes(
				`<header class="site-bar"><a href="/" dir="auto"><img class="site-bar-logo" src="${LOGO.url}" width="600" height="200" alt="" decoding="async" fetchPriority="low"/><span>Black Needle</span></a></header>`,
			),
		);
		assert.doesNotMatch(html, /profile-cover/);
	});

	test("the logo is never preloaded; the cover, the page's first image, still is", () => {
		const preloads = (html: string) =>
			html.match(/<link [^>]*rel="preload"[^>]*>/g) ?? [];
		const studio = preloads(studioHtml(withStorefront(BRANDED)));
		assert.ok(
			studio.some((link) => link.includes(COVER.url)),
			`the cover: ${studio.join()}`,
		);
		assert.ok(
			!studio.some((link) => link.includes(LOGO.url)),
			`the logo: ${studio.join()}`,
		);
		const artist = preloads(artistHtml("sita", withStorefront(BRANDED)));
		assert.ok(
			!artist.some((link) => link.includes(LOGO.url)),
			`the logo on the artist page: ${artist.join()}`,
		);
	});

	test("the shared safety check holds a branded page to every rule of an ordinary one", () => {
		const studio = studioHtml(withStorefront(BRANDED));
		const artist = artistHtml("sita", withStorefront(BRANDED));
		assertSafePage(studio, BRAND_PAGE);
		assertSafePage(artist, BRAND_PAGE);
		const broken: Record<string, string> = {
			"an https link without rel": studio.replace(
				' rel="noopener noreferrer"',
				"",
			),
			"a target": studio.replace("<a ", '<a target="_blank" '),
			"text beside an element in a link": artist.replace(
				'dir="auto"><img class="site-bar-logo"',
				'dir="auto">Home <img class="site-bar-logo"',
			),
			"a logo with a description": artist.replace(
				/(class="site-bar-logo"[^>]*) alt=""/,
				'$1 alt="logo"',
			),
			"an image without a size": studio.replace(
				/(<img class="profile-logo"[^>]*) width="\d+"/,
				"$1",
			),
			"a style attribute": studio.replace("<h1 ", '<h1 style="x:y" '),
		};
		const original = [studio, studio, artist, artist, studio, studio];
		for (const [index, [name, html]] of Object.entries(broken).entries()) {
			assert.notEqual(html, original[index], `${name}: the page was changed`);
			assert.throws(
				() => assertSafePage(html, BRAND_PAGE),
				assert.AssertionError,
				name,
			);
		}
	});

	test("an empty alt is allowed on the logo and the cover, only when asked for", () => {
		const html = studioHtml(withStorefront(BRANDED));
		assert.throws(
			() => assertSafePage(html),
			"without the option: no empty alt",
		);
		const photo = html.replace(
			/(<figure class="artist-photo"><img [^>]*?) alt="[^"]+"/,
			'$1 alt=""',
		);
		assert.notEqual(photo, html, "an artist's photo was found");
		assert.throws(
			() => assertSafePage(photo, BRAND_PAGE),
			"a photograph still needs its alt",
		);
	});

	test("a logo or cover from anywhere else is not shown", () => {
		const html = studioHtml(
			withStorefront({
				branding: {
					logo: { ...LOGO, url: "https://evil.example/logo.png" },
					heroImage: { ...COVER, url: "http://api.example.com/cover.jpg" },
				},
			}),
		);
		assertSame(html, "studio");
	});
});
