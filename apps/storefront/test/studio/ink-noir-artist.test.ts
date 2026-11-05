import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type ArtistPageData,
	artistPageData,
} from "../../src/studio/loaders.ts";
import { ThemedArtistPage } from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	flashPage,
	galleryPage,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Ink Noir's artist page (`/artists/$slug`): one visible artist as a
 * portfolio feature. These pin that it shows only that artist's own data,
 * links to pages that exist, books only someone who takes new work, and that
 * an artist with little data still reads as intended.
 */

const inkNoir = (studio: Studio = STUDIO): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme: "ink-noir" }, studio);

function data(
	slug: string,
	{
		artists = [SITA, ARJUN],
		studio = inkNoir(),
		photos = 4,
		healed = false,
		flash = 0,
	}: {
		artists?: Artist[];
		studio?: Studio;
		photos?: number;
		healed?: boolean;
		flash?: number;
	} = {},
): ArtistPageData {
	const page = artistPageData(
		studio,
		artists,
		slug,
		ORIGIN,
		IMAGE_ORIGIN,
		{
			page: photos > 0 ? galleryPage(photos) : galleryPage(0),
			search: healed ? { healed: true } : {},
		},
		flash > 0 ? flashPage(flash) : null,
	);
	assert.ok(page, slug);
	return page;
}
const html = (page: ArtistPageData) =>
	renderToStaticMarkup(createElement(ThemedArtistPage, { data: page }));
const mainOf = (page: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(page);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (page: string) =>
	Array.from(page.matchAll(/ id="([^"]*)"/g), (match) => match[1]);

describe("Ink Noir's artist page", () => {
	test("holds to every rule of a studio page, whatever the artist filled in", () => {
		for (const page of [
			html(data("sita")),
			html(data("sita", { flash: 3 })),
			html(data("sita", { healed: true })),
			html(data("arjun", { photos: 0 })),
			html(data("sita", { studio: inkNoir(CLOSED_STUDIO) })),
			html(
				data("sita", {
					artists: [SITA],
					studio: inkNoir({ ...STUDIO, type: "independent" }),
				}),
			),
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

	test("names the artist in its one h1, under a breadcrumb back to the directory", () => {
		const page = html(data("sita"));
		assert.match(
			page,
			/<h1 class="ink-artist-hero-name" dir="auto">Sita Rai<\/h1>/,
		);
		assert.match(page, /<nav class="ink-breadcrumb" aria-label="Breadcrumb">/);
		assert.match(page, /<a href="\/artists">Artists<\/a>/);
		assert.match(page, /<span aria-current="page" dir="auto">Sita Rai<\/span>/);
	});

	test("leads with the artist's own first style, their studio and their links", () => {
		const page = mainOf(html(data("sita")));
		assert.match(page, /<p class="ink-label">Fine line<\/p>/);
		assert.match(page, /<dt>Studio<\/dt><dd dir="auto">Black Needle<\/dd>/);
		assert.match(
			page,
			/href="https:\/\/instagram\.com\/sita\.ink" rel="noopener noreferrer">Instagram</,
		);
		// No style: a plain line, never an invented specialty.
		assert.match(
			mainOf(html(data("arjun"))),
			/<p class="ink-label">Tattoo artist<\/p>/,
		);
	});

	test("books the artist only while they take new work, and says so otherwise in their words", () => {
		const open = mainOf(html(data("sita")));
		assert.match(
			open,
			/<a class="action action-primary ink-cta" href="\/request\?artist=sita">Book a session<\/a>/,
		);
		const closed = mainOf(html(data("arjun")));
		assert.doesNotMatch(
			closed,
			/Book a session|href="\/request\?artist=arjun"/,
		);
		assert.match(closed, /Books open in March\./);
	});

	test("shows the portfolio as the shared paged gallery, uncropped, with the full gallery a link away", () => {
		const page = mainOf(html(data("sita")));
		assert.match(page, /<section id="work" class="ink-section ink-portfolio"/);
		assert.match(page, /<ul class="work-grid" role="list">/);
		assert.match(page, / sizes="\(min-width: 74\.5rem\) 23\.5rem, /);
		assert.match(
			page,
			/<a class="ink-link" href="\/work\?artist=sita">See it in the full gallery<\/a>/,
		);
		assert.match(
			page,
			/<a class="action ink-action-quiet" href="#work">Explore the work<\/a>/,
		);
	});

	test("with no photos says there are none to show, and claims nothing more", () => {
		const page = mainOf(html(data("sita", { photos: 0 })));
		assert.match(page, /No photos to show here yet\./);
		assert.doesNotMatch(page, /hasn&#x27;t|Explore the work|work-grid/);
		assert.match(page, /See the latest on Instagram/);
	});

	test("links each style to the gallery filtered by it and this artist", () => {
		const page = mainOf(html(data("sita")));
		assert.match(
			page,
			/<a class="ink-style-link" aria-label="See Fine line work by Sita Rai" href="\/work\?artist=sita&amp;style=fine-line">Fine line<\/a>/,
		);
		assert.doesNotMatch(mainOf(html(data("arjun"))), /id="styles"/);
	});

	test("invites to book the artist, the studio while the artist is closed, or nobody", () => {
		const open = mainOf(html(data("sita")));
		assert.match(open, /<section id="inquiry" class="ink-section ink-close"/);
		assert.match(open, /<bdi>Sita Rai<\/bdi> is taking new work\./);
		assert.match(
			open,
			/<a class="action action-primary ink-cta" href="\/request\?artist=sita"><span>Request <bdi>Sita Rai<\/bdi><\/span><\/a>/,
		);

		const artistClosed = mainOf(html(data("arjun")));
		assert.match(
			artistClosed,
			/You can still send <bdi>Black Needle<\/bdi> a general inquiry\./,
		);
		assert.match(artistClosed, /href="\/request">Request a session</);

		const nobody = mainOf(
			html(data("arjun", { studio: inkNoir(CLOSED_STUDIO) })),
		);
		assert.doesNotMatch(nobody, /href="\/request/);
		assert.doesNotMatch(nobody, /class="ink-steps"/);
	});

	test("offers the artists either side in the directory's order, and none for a lone artist", () => {
		const first = mainOf(html(data("sita")));
		assert.match(
			first,
			/<a class="ink-neighbour ink-neighbour-next" rel="next" href="\/artists\/arjun">/,
		);
		assert.doesNotMatch(first, /ink-neighbour-previous/);
		const last = mainOf(html(data("arjun")));
		assert.match(
			last,
			/<a class="ink-neighbour ink-neighbour-previous" rel="prev" href="\/artists\/sita">/,
		);
		assert.doesNotMatch(
			mainOf(html(data("sita", { artists: [SITA] }))),
			/ink-neighbours/,
		);
	});

	test("keeps the artist's flash, and the old #inquiry and #work links landing", () => {
		const page = html(data("sita", { flash: 2 }));
		assert.match(page, /<section id="flash" class="section"/);
		for (const id of ["work", "inquiry"]) assert.ok(ids(page).includes(id), id);
	});

	test("never shows another studio's artist: one not in the studio's list is a not-found", () => {
		assert.equal(
			artistPageData(inkNoir(), [SITA], "arjun", ORIGIN, IMAGE_ORIGIN),
			null,
		);
	});

	test("labels hold the visible text exactly, whatever the names contain (review fix)", () => {
		const odd = {
			...SITA,
			name: "Ana $& Lee",
			styles: [{ slug: "neo-trad", name: "Neo {name} $' trad" }],
		} as Artist;
		const page = mainOf(html(data("sita", { artists: [odd] })));
		assert.match(page, /aria-label="Ana \$&amp; Lee elsewhere"/);
		assert.match(
			page,
			/aria-label="See Neo \{name\} \$&#x27; trad work by Ana \$&amp; Lee"/,
		);
	});

	test("invents nothing: no experience, awards, quote or availability", () => {
		const page = mainOf(html(data("sita")));
		assert.doesNotMatch(
			page,
			/years|award|certified|quote|available on|next opening/i,
		);
	});
});

describe("artist.css", () => {
	const css = readFileSync(
		new URL("../../src/studio/theme/ink-noir/artist.css", import.meta.url),
		"utf8",
	);

	test("loads nothing and takes its colours from the theme's tokens", () => {
		assert.doesNotMatch(css, /url\(|@import/);
		assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
	});

	test("keeps photos whole and stops its motion for people who asked for less", () => {
		const rule =
			/\.ink-artist-page \.work-photo \{([^}]*)\}/.exec(css)?.[1] ?? "";
		assert.match(rule, /object-fit: contain/);
		// The 1:1 box is styles.css's: overriding aspect-ratio here left unloaded photos 0 px tall (review fix).
		assert.doesNotMatch(rule, /aspect-ratio|block-size/);
		assert.doesNotMatch(
			css,
			/(?<![-\w])columns:/,
			"no multi-column masonry: Show more must not reshuffle",
		);
		const reduced = css.slice(
			css.indexOf("@media (prefers-reduced-motion: reduce)"),
		);
		assert.match(reduced, /\.ink-artist-page \.work-photo/);
	});
});
