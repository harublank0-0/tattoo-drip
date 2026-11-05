import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { studioPageData } from "../../src/studio/loaders.ts";
import {
	FEATURED_COUNT,
	featuredTiles,
	homeSections,
	inkNoirHome,
} from "../../src/studio/theme/ink-noir/home/home-view.ts";
import { ThemedStudioPage } from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	EMPTY_STUDIO,
	GOOD_TO_KNOW_STUDIO,
	galleryPage,
	ORIGIN,
	SITA,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import {
	API_COVER,
	IMAGE_ORIGIN,
	withCover,
	withStorefront,
} from "./theme-fixtures.ts";

/**
 * Ink Noir's home page (src/studio/theme/ink-noir/home/): the studio page's
 * data laid out as an editorial portfolio. These pin what it may show (only
 * the studio's own data), where its links go (routes that exist), the ids old
 * links land on, and that the studio's Page look still orders and hides its
 * sections.
 */

const css = readFileSync(
	new URL("../../src/studio/theme/ink-noir/home.css", import.meta.url),
	"utf8",
);

type Sections = readonly string[];
const ALL: Sections = ["work", "artists", "flash", "info", "inquiry"];

const inkNoir = (studio: Studio = STUDIO, sections: Sections = ALL): Studio =>
	withStorefront(
		{
			...DEFAULT_STOREFRONT,
			theme: "ink-noir",
			sections: sections.map((type) => ({ type })),
		},
		studio,
	);

function data(studio: Studio, artists: Artist[] = [SITA, ARJUN], work = 0) {
	return studioPageData(
		studio,
		artists,
		ORIGIN,
		IMAGE_ORIGIN,
		work > 0 ? galleryPage(work) : null,
	);
}

const html = (studio: Studio, artists?: Artist[], work?: number) =>
	renderToStaticMarkup(
		createElement(ThemedStudioPage, { data: data(studio, artists, work) }),
	);

const mainOf = (page: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(page);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (page: string) =>
	Array.from(page.matchAll(/ id="([^"]*)"/g), (match) => match[1]);
const hrefs = (page: string) =>
	Array.from(page.matchAll(/ href="([^"]*)"/g), (match) =>
		match[1].replaceAll("&amp;", "&"),
	);
/** The ids of <main>'s top-level sections, in order. */
const sectionIds = (page: string) =>
	Array.from(
		mainOf(page).matchAll(/<section id="([^"]*)" class="ink-section/g),
		(match) => match[1],
	);

describe("Ink Noir's home page", () => {
	test("holds to every rule of a studio page, whatever the studio filled in", () => {
		for (const page of [
			html(
				inkNoir(withCover(GOOD_TO_KNOW_STUDIO)),
				[sitaWithWork(6), ARJUN],
				9,
			),
			html(inkNoir(), [SITA, ARJUN], 3),
			html(inkNoir({ ...STUDIO, type: "independent" }), [SITA], 1),
			html(inkNoir(EMPTY_STUDIO), []),
			html(inkNoir(CLOSED_STUDIO)),
			html(inkNoir(STUDIO, ["inquiry"])),
		]) {
			assertSafePage(page, { brandImages: true });
			const seen = ids(page);
			assert.deepEqual(seen, [...new Set(seen)], "every id once");
		}
	});

	test("is the studio's own page inside Ink Noir's shell; Stencil & Ink's home is untouched", () => {
		const page = html(inkNoir(), [SITA, ARJUN], 3);
		assert.match(page, /<main id="main" tabindex="-1" class="ink-home">/);
		assert.match(page, /<header class="ink-header">/);
		assert.match(page, /<footer class="ink-footer">/);
		const stencil = html(withStorefront(DEFAULT_STOREFRONT), [SITA, ARJUN], 3);
		assert.doesNotMatch(stencil, /ink-home|ink-hero|ink-section/);
	});

	test("its one h1 names the studio, then the headline", () => {
		const page = html(inkNoir());
		assert.match(
			page,
			/<h1 id="hero-title" class="ink-hero-title"><span class="ink-hero-name" dir="auto">Black Needle<\/span> <span class="ink-hero-line"><span class="ink-line">Art is <\/span><span class="ink-line">permanent\.<\/span><\/span><\/h1>/,
		);
	});

	test("keeps the ids old links and the header's Artists link land on", () => {
		const seen = ids(html(inkNoir(GOOD_TO_KNOW_STUDIO), [SITA, ARJUN], 3));
		for (const id of [
			"studio",
			"recent-work",
			"artists",
			"styles",
			"good-to-know",
			"inquiry",
		]) {
			assert.ok(seen.includes(id), id);
		}
	});

	test("every link goes to a page or a section that exists", () => {
		const page = html(
			inkNoir(GOOD_TO_KNOW_STUDIO),
			[sitaWithWork(3), ARJUN],
			9,
		);
		const seen = new Set(ids(page));
		for (const href of hrefs(mainOf(page))) {
			if (href.startsWith("#")) {
				assert.ok(seen.has(href.slice(1)), `${href} lands on nothing`);
			} else if (href.startsWith("/")) {
				assert.match(
					href,
					/^\/(request(\?artist=[a-z0-9-]+)?|work(\?style=[a-z0-9-]+)?|artists\/[a-z0-9-]+(#work)?|flash)$/,
					href,
				);
			}
		}
	});
});

describe("the first screen", () => {
	test("shows the studio's cover first: eager, high priority, its own description", () => {
		const page = html(inkNoir(withCover()), [SITA, ARJUN], 3);
		const image =
			/<div class="ink-hero-media">(<img [^>]*>)/.exec(page)?.[1] ?? "";
		assert.match(image, new RegExp(` src="${API_COVER.url}"`));
		assert.match(image, / loading="eager"/);
		assert.match(image, / fetchpriority="high"/i);
		assert.match(image, / sizes="\(min-width: 60rem\) calc\(100vw \* /);
		assert.match(page, /class="ink-hero ink-hero-photo"/);
	});

	test("without a cover, a large portfolio photo, which the featured work then leaves out", () => {
		const view = inkNoirHome(data(inkNoir(), [SITA], 4));
		assert.equal(view.hero?.source, "portfolio");
		assert.equal(view.featured.length, 3);
		assert.ok(!view.featured.some((photo) => photo.src === view.hero?.src));
	});

	test("without any photo it is set in type alone, never a stand-in image", () => {
		const page = html(inkNoir(), [SITA, ARJUN]);
		assert.doesNotMatch(page, /ink-hero-media/);
		assert.match(
			page,
			/<section class="ink-hero" aria-labelledby="hero-title">/,
		);
	});

	test("books through the header's request link, and says so once when the studio is closed", () => {
		const open = mainOf(html(inkNoir()));
		assert.match(
			open,
			/<a class="action action-primary ink-cta" href="\/request">Request a session<\/a>/,
		);
		assert.match(
			open,
			/<a class="action ink-action-quiet" href="\/work">Explore the work<\/a>/,
		);
		const closed = mainOf(html(inkNoir(CLOSED_STUDIO)));
		assert.ok(!hrefs(closed).includes("/request"), "no general request link");
		assert.equal(
			closed.match(/Not taking new inquiries right now/g)?.length,
			1,
		);
		assert.doesNotMatch(closed, /<dt>Bookings<\/dt>/);
	});
});

describe("the featured work", () => {
	test("shows at most six of the newest photos, each opening the gallery's own viewer", () => {
		const page = html(inkNoir(), [SITA, ARJUN], 9);
		const tiles =
			page.match(/<button type="button" class="ink-tile-open"/g) ?? [];
		assert.equal(tiles.length, FEATURED_COUNT);
		for (const match of page.matchAll(
			/class="ink-tile-open" id="[^"]*" aria-haspopup="dialog" aria-controls="([^"]*)"/g,
		)) {
			assert.match(
				page,
				new RegExp(`<dialog id="${match[1]}" class="work-dialog"`),
			);
		}
		assert.match(
			page,
			/<a class="ink-link" href="\/work">View full gallery<\/a>/,
		);
	});

	test("with no photos says there are none to show, and shows nobody else's work", () => {
		const page = html(inkNoir(), [SITA, ARJUN]);
		assert.match(page, /No photos to show here yet\./);
		// A failed gallery read reaches the page as no photos too: claim nothing about the studio.
		assert.doesNotMatch(page, /hasn&#x27;t published|hasn't published/);
		assert.doesNotMatch(page, /class="ink-tile/);
		assert.doesNotMatch(page, /View full gallery/);
		assert.match(page, /href="https:\/\/instagram\.com\/blackneedle"/);
	});

	test("is gone when the studio hides its work", () => {
		const page = html(
			inkNoir(STUDIO, ["artists", "inquiry"]),
			[SITA, ARJUN],
			3,
		);
		assert.doesNotMatch(page, /id="recent-work"/);
	});

	test("fills the mosaic's rows exactly for any count", () => {
		for (let count = 1; count <= FEATURED_COUNT; count++) {
			const tiles = featuredTiles(count);
			assert.equal(tiles.length, count);
			const area = tiles.reduce((sum, tile) => sum + tile.cols * tile.rows, 0);
			assert.equal(area % 12, 0, `${count} photos leave a hole`);
			const mobile = tiles.reduce(
				(sum, tile) => sum + tile.mobileCols * tile.mobileRows,
				0,
			);
			assert.equal(mobile % 2, 0, `${count} photos leave a hole on a phone`);
		}
		assert.deepEqual(featuredTiles(0), []);
		assert.equal(featuredTiles(12).length, FEATURED_COUNT);
	});
});

describe("the artists", () => {
	test("link each artist to their own page; the name is the link", () => {
		const page = html(inkNoir(), [SITA, ARJUN]);
		assert.match(
			page,
			/<h3 id="artist-sita" class="ink-artist-name" dir="auto"><a class="ink-artist-link" href="\/artists\/sita">Sita Rai<\/a><\/h3>/,
		);
		assert.match(
			page,
			/<a class="ink-artist-link" href="\/artists\/arjun">अर्जुन थापा<\/a>/,
		);
		// No portrait: a letter of the name, hidden from screen readers, and no image.
		assert.match(
			page,
			/<span class="ink-artist-initial" aria-hidden="true">अ<\/span>/,
		);
		assert.match(page, /Books open in March\./);
	});

	test("a lone artist's portrait is shown once: in the artists section, not beside the introduction", () => {
		const solo = { ...STUDIO, type: "independent" as const };
		const page = html(inkNoir(solo), [SITA]);
		assert.equal(page.split(` src="${SITA.photo?.url}"`).length - 1, 1);
		assert.equal(inkNoirHome(data(inkNoir(solo), [SITA])).introPhoto, null);
		// With the artists hidden, the introduction may show it instead.
		const hidden = inkNoirHome(
			data(inkNoir(solo, ["work", "inquiry"]), [SITA]),
		);
		assert.equal(hidden.introPhoto?.src, SITA.photo?.url);
		// And a newest photo nobody else shows comes first.
		const withWork = inkNoirHome(data(inkNoir(solo), [SITA], 9));
		assert.notEqual(withWork.introPhoto?.src, SITA.photo?.url);
	});

	test("give one artist the whole width, with their portfolio", () => {
		const page = html(inkNoir({ ...STUDIO, type: "independent" }), [SITA]);
		assert.match(page, /<article class="ink-artist ink-artist-feature"/);
		assert.match(
			page,
			/<a class="action ink-action-quiet" href="\/artists\/sita">View portfolio<\/a>/,
		);
		assert.match(page, />Meet the artist</);
		// In an open studio "Request a session" already asks for its one artist.
		assert.doesNotMatch(page, /href="\/request\?artist=sita"/);
	});

	test("offer each open artist's own request while the studio is closed", () => {
		const page = mainOf(html(inkNoir(CLOSED_STUDIO), [SITA, ARJUN]));
		assert.match(page, /href="\/request\?artist=sita"/);
		assert.doesNotMatch(page, /href="\/request\?artist=arjun"/);
	});

	test("are gone when the studio hides them, and nothing points at them", () => {
		const page = html(inkNoir(STUDIO, ["work", "inquiry"]), [SITA, ARJUN], 3);
		assert.doesNotMatch(mainOf(page), /id="artists"|href="#artists"/);
		assert.match(
			page,
			/<a class="action ink-action-quiet" href="\/work">Explore the work<\/a><\/div><\/div><\/div><\/section>/,
		);
	});
});

describe("the styles index", () => {
	test("links a style the photos carry to the filtered gallery; one only an artist lists is text", () => {
		const blackwork = {
			...SITA,
			slug: "bina",
			name: "Bina",
			styles: [{ slug: "blackwork", name: "Blackwork" }],
		} as Artist;
		const page = html(inkNoir(), [SITA, blackwork], 3);
		assert.match(
			page,
			/<h3 class="ink-style-name" dir="auto"><a class="ink-style-link" aria-label="See Fine line work" href="\/work\?style=fine-line">Fine line<\/a><\/h3>/,
		);
		assert.match(page, /<h3 class="ink-style-name" dir="auto">Blackwork<\/h3>/);
		assert.match(page, /By <a href="\/artists\/bina"><bdi>Bina<\/bdi><\/a>/);
	});

	test("matches names without regard to case, each style once", () => {
		const shouting = {
			...SITA,
			styles: [{ slug: "fine-line", name: "FINE LINE" }],
		} as Artist;
		const view = inkNoirHome(data(inkNoir(), [shouting], 3));
		assert.deepEqual(
			view.styles.map((style) => style.name),
			["Fine line"],
		);
		assert.equal(view.styles[0].artists.length, 1);
	});

	test("is left out when nobody named a style", () => {
		const page = html(inkNoir(), [{ ...SITA, styles: [] }]);
		assert.doesNotMatch(page, /id="styles"/);
	});
});

describe("the studio's sections", () => {
	test("follow its own order, the styles after the work and artists they are made of", () => {
		const page = html(
			inkNoir(GOOD_TO_KNOW_STUDIO, ["inquiry", "info", "artists", "work"]),
			[SITA, ARJUN],
			3,
		);
		assert.deepEqual(sectionIds(page), [
			"studio",
			"inquiry",
			"good-to-know",
			"artists",
			"recent-work",
			"styles",
		]);
		assert.deepEqual(homeSections(["work", "artists", "inquiry"]), [
			"work",
			"artists",
			"styles",
			"inquiry",
		]);
		assert.deepEqual(homeSections(["flash", "info", "inquiry"]), [
			"flash",
			"info",
			"inquiry",
		]);
	});

	test("the visit shows only what the studio wrote, and nothing when it wrote nothing", () => {
		const full = html(inkNoir(GOOD_TO_KNOW_STUDIO));
		assert.match(
			full,
			/<dt>Walk-ins<\/dt><dd class="user-text" dir="auto">Small flash welcome on Saturdays\.<\/dd>/,
		);
		assert.match(full, /<summary><span>Aftercare<\/span>/);
		assert.match(full, />Get directions</);
		const bare = html(inkNoir(EMPTY_STUDIO), []);
		assert.doesNotMatch(bare, /id="good-to-know"/);
		// No introduction to scroll to either: nothing to say in it.
		assert.doesNotMatch(bare, /id="studio"|ink-hero-scroll/);
	});

	test("the close invites while the studio is open, and never above a refusal", () => {
		const open = html(inkNoir());
		assert.match(open, /<section id="inquiry" class="ink-section ink-close"/);
		assert.match(
			open,
			/<ol class="ink-steps" role="list" aria-label="How booking works">/,
		);
		const closed = html(inkNoir(CLOSED_STUDIO));
		assert.match(
			closed,
			/<bdi>Black Needle<\/bdi> isn&#x27;t taking new inquiries right now\./,
		);
		assert.doesNotMatch(closed, /class="ink-steps"/);
		// The studio's own switch is off, but an artist may still take requests: no "books are closed".
		assert.doesNotMatch(closed, /[Bb]ooks are/);
	});
});

describe("home.css", () => {
	test("loads nothing and keys on the page's own classes", () => {
		assert.doesNotMatch(css, /url\(|@import/);
		assert.doesNotMatch(
			css,
			/#[0-9a-fA-F]{3,8}\b/,
			"colours come from the theme's tokens",
		);
	});

	test("moves only for people who have not asked for less motion", () => {
		const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
		const animated = bare.slice(
			bare.indexOf("@media (prefers-reduced-motion: no-preference)"),
		);
		assert.ok(
			animated.length < bare.length,
			"the load sequence is behind no-preference",
		);
		for (const rule of bare.matchAll(/([^{}]+)\{[^{}]*\banimation:/g)) {
			const before = bare.slice(0, rule.index);
			assert.ok(
				before.lastIndexOf("@media (prefers-reduced-motion: no-preference)") >
					before.lastIndexOf("}\n}"),
				`${rule[1].trim()} animates outside the no-preference block`,
			);
		}
		const reduced = bare.slice(
			bare.indexOf("@media (prefers-reduced-motion: reduce)"),
		);
		assert.match(reduced, /\.ink-tile-open img/);
		assert.match(reduced, /\.ink-artist-photo img/);
	});
});
