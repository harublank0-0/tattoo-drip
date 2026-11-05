import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import {
	artistsDirectory,
	readArtistsSearch,
} from "../../src/studio/artists.ts";
import { artistsHref } from "../../src/studio/links.ts";
import {
	type ArtistsPageData,
	artistsPageData,
	loadArtistsPage,
} from "../../src/studio/loaders.ts";
import { THEMES, ThemedArtistsPage } from "../../src/studio/theme/registry.tsx";
import { artistViewModels } from "../../src/studio/view-model.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	ORIGIN,
	SITA,
	STUDIO,
	sitaWithWork,
	workPhotos,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * The artists directory (`/artists`): every visible artist, filtered by one
 * style from the address, in Ink Noir an editorial page. These pin that it
 * shows only the studio's own artists and photos, each linking to their page,
 * that the filter is exact and costs the API nothing, and that one artist, no
 * artist and a filter that keeps nobody each read as intended.
 */

const FINE = { slug: "fine-line", name: "Fine line" };
const BLACK = { slug: "blackwork", name: "Blackwork" };
const BINA: Artist = {
	...SITA,
	id: "0199f000-0000-7000-8000-000000000050",
	slug: "bina",
	name: "Bina Gurung",
	bio: "Blackwork and geometric pieces.",
	styles: [BLACK, FINE],
	workPhotos: workPhotos(4).map((photo) => ({
		...photo,
		url: photo.url.replace("/w", "/bina-w"),
		variants: photo.variants.map((variant) => ({
			...variant,
			url: variant.url.replace("/w", "/bina-w"),
		})),
	})),
};
const SITA_WORK = sitaWithWork(5);

const inkNoir = (studio: Studio = STUDIO): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme: "ink-noir" }, studio);

function data(
	artists: Artist[],
	search: { style?: string } = {},
	studio: Studio = inkNoir(),
): ArtistsPageData {
	return artistsPageData(studio, artists, search, ORIGIN, IMAGE_ORIGIN);
}
const html = (page: ArtistsPageData) =>
	renderToStaticMarkup(createElement(ThemedArtistsPage, { data: page }));
const mainOf = (page: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(page);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (page: string) =>
	Array.from(page.matchAll(/ id="([^"]*)"/g), (match) => match[1]);

describe("artistsDirectory: the directory, filtered", () => {
	const views = artistViewModels([SITA_WORK, BINA, ARJUN], IMAGE_ORIGIN);

	test("offers each style an artist lists, by name, with how many list it", () => {
		const directory = artistsDirectory([SITA_WORK, BINA, ARJUN], views, {});
		assert.deepEqual(directory.styles, [
			{ slug: "blackwork", name: "Blackwork", count: 1 },
			{ slug: "fine-line", name: "Fine line", count: 2 },
		]);
		assert.equal(directory.filterable, true);
		assert.equal(directory.selected, null);
		assert.deepEqual(
			directory.shown.map((artist) => artist.slug),
			["sita", "bina", "arjun"],
		);
	});

	test("keeps the artists who list the style, in the API's order", () => {
		const directory = artistsDirectory([SITA_WORK, BINA, ARJUN], views, {
			style: "fine-line",
		});
		assert.deepEqual(directory.selected, {
			slug: "fine-line",
			name: "Fine line",
		});
		assert.deepEqual(
			directory.shown.map((artist) => artist.slug),
			["sita", "bina"],
		);
	});

	test("a style nobody lists keeps nobody, and has no name to show", () => {
		const directory = artistsDirectory([SITA_WORK, BINA], views, {
			style: "realism",
		});
		assert.deepEqual(directory.selected, { slug: "realism", name: null });
		assert.deepEqual(directory.shown, []);
	});

	test("does not offer a filter that can narrow nothing", () => {
		const one = artistViewModels([SITA], IMAGE_ORIGIN);
		assert.equal(artistsDirectory([SITA], one, {}).filterable, false);
		const same = { ...BINA, styles: [FINE] };
		const both = artistViewModels([SITA, same], IMAGE_ORIGIN);
		assert.equal(artistsDirectory([SITA, same], both, {}).filterable, false);
	});

	test("reads the address strictly, and builds it back", () => {
		assert.deepEqual(readArtistsSearch({ style: "fine-line" }), {
			style: "fine-line",
		});
		for (const style of ["Fine Line", "../x", "", 1, null]) {
			assert.deepEqual(readArtistsSearch({ style }), {}, String(style));
		}
		assert.deepEqual(readArtistsSearch({ artist: "sita" }), {});
		assert.equal(artistsHref({}), "/artists");
		assert.equal(
			artistsHref({ style: "fine-line" }),
			"/artists?style=fine-line",
		);
	});
});

describe("loadArtistsPage", () => {
	test("reads the artist list once: a new filter asks the API nothing", async () => {
		const { calls, fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(200, { data: [SITA_WORK, BINA] })
				: json(404, { error: { code: "not_found", message: "Not found." } }),
		);
		const api = createApiContext("server");
		connectServer(api, {
			config: { apiUrl: "http://api.test", mediaUrl: IMAGE_ORIGIN },
			studio: STUDIO,
			fetch,
		});
		seedStudio(api, STUDIO);
		const site = new SiteRef();
		site.connect(ORIGIN);
		const context = { ...api, site };

		const all = await loadArtistsPage(context, {});
		const fine = await loadArtistsPage(context, { style: "blackwork" });
		assert.deepEqual(
			calls.map((call) => call.url),
			[`http://api.test/api/v1/tenants/${STUDIO.slug}/artists`],
		);
		assert.equal(all.directory.shown.length, 2);
		assert.deepEqual(
			fine.directory.shown.map((artist) => artist.slug),
			["bina"],
		);
	});
});

describe("the artists directory in Ink Noir", () => {
	test("holds to every rule of a studio page, whatever it shows", () => {
		for (const page of [
			html(data([SITA_WORK, BINA, ARJUN])),
			html(data([SITA_WORK, BINA, ARJUN], { style: "blackwork" })),
			html(data([SITA_WORK, BINA], { style: "realism" })),
			html(data([SITA_WORK])),
			html(data([])),
			html(data([SITA, ARJUN], {}, inkNoir(CLOSED_STUDIO))),
		]) {
			assertSafePage(page, { brandImages: true });
			const seen = ids(page);
			assert.deepEqual(seen, [...new Set(seen)], "every id once");
			assert.doesNotMatch(
				page,
				/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /,
				"no link inside a link",
			);
		}
	});

	test("is Ink Noir's own page; Stencil & Ink lists its roster", () => {
		assert.notEqual(
			THEMES["ink-noir"].ArtistsPage,
			THEMES["stencil-and-ink"].ArtistsPage,
		);
		const stencil = html(
			artistsPageData(
				withStorefront(DEFAULT_STOREFRONT),
				[SITA, ARJUN],
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			),
		);
		assertSafePage(stencil, { brandImages: true });
		assert.match(
			stencil,
			/<h1 id="artists-title" class="section-title">Artists<\/h1>/,
		);
		assert.doesNotMatch(stencil, /ink-dir/);
	});

	test("opens on the headline, the page's one h1", () => {
		const page = html(data([SITA_WORK, BINA]));
		assert.match(
			page,
			/<h1 class="ink-dir-title"><span class="ink-line">The hands <\/span><span class="ink-line">behind the art\.<\/span><\/h1>/,
		);
		assert.match(html(data([SITA_WORK])), />The hand <\/span>/);
	});

	test("links each artist to their page with one link, the name", () => {
		const page = mainOf(html(data([SITA_WORK, BINA, ARJUN])));
		for (const [slug, name] of [
			["sita", "Sita Rai"],
			["bina", "Bina Gurung"],
			["arjun", "अर्जुन थापा"],
		]) {
			assert.match(
				page,
				new RegExp(
					`<a class="ink-dir-link" href="/artists/${slug}">${name}</a>`,
				),
			);
		}
		// No portrait: a letter of the name, hidden from screen readers; never a stand-in photo.
		assert.match(
			page,
			/<span class="ink-dir-initial" aria-hidden="true">अ<\/span>/,
		);
	});

	test("previews each artist's own newest work, three at most, and none for an artist without", () => {
		const page = mainOf(html(data([SITA_WORK, BINA, ARJUN])));
		const strips = Array.from(
			page.matchAll(
				/<div class="ink-dir-work" aria-hidden="true">([\s\S]*?)<\/div>/g,
			),
			(match) =>
				Array.from(match[1].matchAll(/ src="([^"]*)"/g), (src) => src[1]),
		);
		assert.equal(strips.length, 2, "Arjun has no work photos");
		assert.equal(strips[0].length, 3);
		assert.ok(
			strips[0].every((src) => src.includes("/w") && !src.includes("bina-")),
		);
		assert.ok(strips[1].every((src) => src.includes("/bina-w")));
	});

	test("filters by style: the current one marked beyond colour, and a status line that counts", () => {
		const page = html(data([SITA_WORK, BINA, ARJUN], { style: "blackwork" }));
		assert.match(
			page,
			/<nav class="ink-filter-bar" aria-label="Filter artists by style">/,
		);
		assert.match(
			page,
			/<a class="ink-filter" aria-current="page" href="\/artists\?style=blackwork">/,
		);
		assert.match(page, /<a class="ink-filter" href="\/artists">/);
		assert.match(
			page,
			/<p class="ink-filter-status" role="status"><bdi>Blackwork<\/bdi>: <bdi>1<\/bdi> of <bdi>3<\/bdi> artists<\/p>/,
		);
		assert.doesNotMatch(page, /href="\/artists\/sita"/);
		assert.match(page, /href="\/artists\/bina"/);
	});

	test("a filter that keeps nobody says so and offers the whole directory", () => {
		const page = html(data([SITA_WORK, BINA], { style: "realism" }));
		assert.match(page, /No artists list this style\./);
		assert.match(
			page,
			/<a class="ink-link" href="\/artists">Show all artists<\/a>/,
		);
		assert.doesNotMatch(page, /class="ink-dir-card"/);
	});

	test("one artist is a feature with their portfolio, and the close asks for them by name", () => {
		const page = html(data([SITA_WORK]));
		assert.match(page, /<article class="ink-dir-feature"/);
		assert.doesNotMatch(page, /class="ink-dir-grid|class="ink-filter-bar/);
		assert.match(
			page,
			/<a class="action ink-action-quiet" href="\/artists\/sita">View portfolio<\/a>/,
		);
		assert.match(page, /href="\/book\?artist=sita"/);
		assert.match(page, /Found your <\/span><span class="ink-line">artist\?/);
		// The feature's portrait is the page's main image.
		assert.match(
			page,
			/<figure class="ink-dir-portrait"><img [^>]*loading="eager"/,
		);
	});

	test("with nobody to show it says so, and invents no one", () => {
		const page = mainOf(html(data([])));
		assert.match(page, /No artists to show here yet\./);
		assert.doesNotMatch(
			page,
			/ink-dir-card|ink-dir-feature|ink-filter-bar|<img /,
		);
		assert.doesNotMatch(page, /Found your/);
	});

	test("never offers a session nobody takes", () => {
		const closed = mainOf(html(data([ARJUN], {}, inkNoir(CLOSED_STUDIO))));
		assert.doesNotMatch(closed, /href="\/book/);
		// The invitation's words are the studio's, as on its home page.
		assert.match(
			closed,
			/<bdi>Black Needle<\/bdi> isn&#x27;t taking new inquiries right now\./,
		);
	});

	test("has no featured-artist section: the data marks no one as featured", () => {
		assert.doesNotMatch(html(data([SITA_WORK, BINA, ARJUN])), /featured/i);
	});

	test("its head names the studio, one address for every filter", () => {
		const all = data([SITA_WORK, BINA]).seo;
		const fine = data([SITA_WORK, BINA], { style: "fine-line" }).seo;
		assert.equal(all.canonical, `${ORIGIN}/artists`);
		assert.equal(fine.canonical, `${ORIGIN}/artists`);
		assert.equal(all.title, "Artists at Black Needle");
		assert.match(all.description, /Blackwork, Fine line/);
		assert.equal(data([SITA_WORK]).seo.title, "The artist at Black Needle");
	});

	test("the navigation's Artists is this page, and current on it", () => {
		const page = html(data([SITA_WORK, BINA]));
		assert.match(page, /<a aria-current="page" href="\/artists">Artists<\/a>/);
	});
});

describe("the closing invitation and the page's outline (review fixes)", () => {
	const SITA_CLOSED: Artist = { ...SITA_WORK, acceptingInquiries: false };
	const stencil = (studio: Studio, artists: Artist[]) =>
		html(
			artistsPageData(
				withStorefront(DEFAULT_STOREFRONT, studio),
				artists,
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			),
		);

	test("Ink Noir: an open studio whose lone artist is closed still invites, to the studio", () => {
		const page = mainOf(html(data([SITA_CLOSED])));
		assert.match(
			page,
			/<a class="action action-primary ink-cta" href="\/book">Request a session<\/a>/,
		);
		// The close invites; only the artist's own card says she is closed.
		assert.doesNotMatch(page, /Not taking new inquiries/);
		assert.match(page, /Not taking new work right now/);
	});

	test("Ink Noir: a closed studio whose lone artist is open invites, to that artist", () => {
		const page = mainOf(html(data([SITA_WORK], {}, inkNoir(CLOSED_STUDIO))));
		assert.match(page, /href="\/book\?artist=sita"/);
		assert.doesNotMatch(page, /href="\/book"/);
	});

	test("Stencil & Ink: the invitation is the studio's, never a link to a refusal", () => {
		// Open studio, closed lone artist: it invites to the studio's form.
		assert.match(
			stencil(STUDIO, [SITA_CLOSED]),
			/Got an idea\?[\s\S]*href="\/book">Send your idea</,
		);
		// Closed studio, open lone artist: no general link; the roster asks for her.
		const closed = mainOf(stencil(CLOSED_STUDIO, [SITA_WORK]));
		assert.doesNotMatch(closed, /href="\/book"/);
		assert.match(closed, /href="\/book\?artist=sita"/);
	});

	test("Stencil & Ink: the entries are h2 under the page's h1", () => {
		const outline = Array.from(
			mainOf(stencil(STUDIO, [SITA, ARJUN])).matchAll(/<(h[1-6])[^>]*>/g),
			(match) => match[1],
		);
		assert.deepEqual(outline, ["h1", "h2", "h2", "h2"]);
	});

	test("a card names exactly the styles the filter reads, so it names the one that kept it", () => {
		const messy = {
			...SITA_WORK,
			styles: [
				{ slug: "Fine Line", name: "Realism" },
				FINE,
				FINE,
				{ slug: "c", name: "C" },
			],
		} as Artist;
		const page = mainOf(html(data([messy, BINA], { style: "c" })));
		assert.match(page, /<p class="ink-dir-styles">Fine line, C<\/p>/);
		assert.doesNotMatch(page, /Realism/);
	});
});

describe("artists.css", () => {
	const css = readFileSync(
		new URL("../../src/studio/theme/ink-noir/artists.css", import.meta.url),
		"utf8",
	);

	test("loads nothing and takes its colours from the theme's tokens", () => {
		assert.doesNotMatch(css, /url\(|@import/);
		assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
	});

	test("stops its hover motion for people who asked for less", () => {
		const reduced = css.slice(
			css.indexOf("@media (prefers-reduced-motion: reduce)"),
		);
		assert.match(reduced, /\.ink-dir-portrait img/);
		assert.match(reduced, /\.ink-dir-arrow/);
	});
});
