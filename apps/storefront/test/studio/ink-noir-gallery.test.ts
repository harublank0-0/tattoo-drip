import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import type { Artist, Studio, WorkPage } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { Route as WorkRedirect } from "../../src/routes/work.tsx";
import { SiteRef } from "../../src/site/context.ts";
import { relatedArtwork } from "../../src/studio/artwork.ts";
import {
	galleryPhotoView,
	galleryView,
	matchesSearch,
	readWorkSearch,
	WORK_PAGE_SIZE,
	workQuery,
} from "../../src/studio/gallery.ts";
import { requestHref } from "../../src/studio/links.ts";
import {
	type ArtworkPageData,
	artworkPageData,
	loadArtworkPage,
	requestPageData,
	type WorkPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import { readRequestSearch } from "../../src/studio/request.ts";
import {
	ThemedArtworkPage,
	ThemedWorkPage,
} from "../../src/studio/theme/registry.tsx";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	galleryPage,
	ORIGIN,
	photoId,
	SITA,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Prompt 5: the gallery at /gallery (/work redirects) and one tattoo's page
 * at /gallery/$photo. These pin that the pages show only what the API knows
 * of a piece, link to pages that exist, search honestly (only the pieces
 * loaded, and say so), and book only someone who takes new work.
 */

const inkNoir = (studio: Studio = STUDIO): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme: "ink-noir" }, studio);
const stencil = (studio: Studio = STUDIO): Studio =>
	withStorefront(DEFAULT_STOREFRONT, studio);

const fineLine = { slug: "fine-line", name: "Fine line" };
const blackwork = { slug: "blackwork", name: "Blackwork" };

/** A gallery page: `count` photos by Sita (fixtures.ts), the first described and tagged. */
function page(count: number, over: Partial<WorkPage> = {}): WorkPage {
	const base = galleryPage(count, over);
	return {
		...base,
		data: base.data.map((photo, index) =>
			index === 0
				? { ...photo, alt: "Koi on the forearm", styles: [fineLine, blackwork] }
				: photo,
		),
	};
}

function gallery(
	work: WorkPage | null,
	search = {},
	studio = inkNoir(),
	artists: Artist[] = [SITA, ARJUN],
): WorkPageData {
	return workPageData(studio, artists, work, search, ORIGIN, IMAGE_ORIGIN);
}
const galleryHtml = (data: WorkPageData) =>
	renderToStaticMarkup(createElement(ThemedWorkPage, { data }));

function artwork({
	photo = page(1).data[0],
	reads = [null, null, null] as unknown[],
	studio = inkNoir(),
	artists = [SITA, ARJUN] as Artist[],
} = {}): ArtworkPageData {
	const data = artworkPageData(
		studio,
		artists,
		photo,
		reads,
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data, "the piece can be shown");
	return data;
}
const artworkHtml = (data: ArtworkPageData) =>
	renderToStaticMarkup(createElement(ThemedArtworkPage, { data }));

const mainOf = (html: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(html);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (html: string) =>
	Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1]);

function holdsTheRules(html: string) {
	assertSafePage(html, { brandImages: true });
	const seen = ids(html);
	assert.deepEqual(seen, [...new Set(seen)], "every id once");
	assert.doesNotMatch(
		html,
		/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /,
		"no link inside a link",
	);
}

describe("the gallery's data (Prompt 5)", () => {
	test("each photo carries its checked id and its own page; one without a usable id has neither", () => {
		const view = galleryView(page(2), IMAGE_ORIGIN);
		assert.equal(view.photos[0].id, photoId(1));
		assert.equal(view.photos[0].href, `/gallery/${photoId(1)}`);
		assert.deepEqual(view.photos[0].styleRefs, [fineLine, blackwork]);
		const odd = page(2);
		const garbled = galleryView(
			{
				...odd,
				data: [
					{ ...odd.data[0], id: "NOT-A-UUID" },
					{ ...odd.data[1], id: photoId(2).toUpperCase() },
				],
			},
			IMAGE_ORIGIN,
		);
		for (const photo of garbled.photos) {
			assert.equal(photo.id, null);
			assert.equal(photo.href, null);
		}
		// A single photo's page needs the id.
		assert.equal(
			galleryPhotoView({ ...odd.data[0], id: null }, IMAGE_ORIGIN),
			null,
		);
		assert.equal(galleryPhotoView(odd.data[0], IMAGE_ORIGIN)?.id, photoId(1));
	});

	test("the search reads one line of up to 80 characters and never reaches the API", () => {
		assert.deepEqual(readWorkSearch({ q: "  koi  " }), { q: "koi" });
		assert.deepEqual(readWorkSearch({ q: "   " }), {});
		assert.deepEqual(readWorkSearch({ q: "x".repeat(81) }), {});
		assert.deepEqual(readWorkSearch({ q: ["a", "b"] }), {});
		assert.deepEqual(
			readWorkSearch({ cursor: "c2", q: "koi", style: "fine-line" }),
			{ style: "fine-line", q: "koi", cursor: "c2" },
		);
		assert.deepEqual(
			workQuery({ style: "fine-line", q: "koi" }, WORK_PAGE_SIZE),
			{
				style: "fine-line",
				limit: WORK_PAGE_SIZE,
			},
		);
	});

	test("matches every word in the description, a style or the artist's name, ignoring case and accents", () => {
		const [koi, plain] = galleryView(page(2), IMAGE_ORIGIN).photos;
		assert.ok(matchesSearch(koi, ""));
		assert.ok(matchesSearch(koi, "KOI"));
		assert.ok(matchesSearch(koi, "fine sita"));
		assert.ok(matchesSearch(koi, "blackwork forearm"));
		assert.ok(matchesSearch(plain, "sita"));
		assert.ok(!matchesSearch(plain, "koi"));
		assert.ok(!matchesSearch(koi, "koi rose"));
		const one = page(1);
		const accented = galleryView(
			{ ...one, data: [{ ...one.data[0], alt: "Rosé on the wrist" }] },
			IMAGE_ORIGIN,
		).photos[0];
		assert.ok(matchesSearch(accented, "rose"));
	});

	test("/work is a permanent redirect to /gallery with its query as it was", () => {
		const beforeLoad = WorkRedirect.options.beforeLoad as unknown as (input: {
			location: { searchStr: string };
		}) => void;
		try {
			beforeLoad({ location: { searchStr: "?style=fine-line&cursor=c2" } });
			assert.fail("it redirects");
		} catch (error) {
			assert.ok(isRedirect(error));
			assert.equal(error.options.href, "/gallery?style=fine-line&cursor=c2");
			assert.equal(error.status, 301);
		}
	});
});

describe("Ink Noir's gallery", () => {
	test("holds to every rule of a studio page, whatever the collection holds", () => {
		for (const html of [
			galleryHtml(gallery(page(4))),
			galleryHtml(gallery(page(4, { nextCursor: "c2" }))),
			galleryHtml(gallery(page(4), { q: "koi" })),
			galleryHtml(gallery(page(4), { q: "nothing-like-it" })),
			galleryHtml(gallery(page(4), { style: "fine-line", healed: true })),
			galleryHtml(gallery(page(4), { cursor: "c2", artist: "sita" })),
			galleryHtml(gallery(page(0))),
			galleryHtml(gallery(page(0), { style: "realism" })),
			galleryHtml(gallery(null)),
			galleryHtml(gallery(page(3), {}, inkNoir(CLOSED_STUDIO))),
		]) {
			holdsTheRules(html);
		}
	});

	test("opens with the collection's one h1 and whose work it is, not the home page's hero", () => {
		const html = mainOf(galleryHtml(gallery(page(2))));
		assert.match(html, /<p class="ink-label">The collection<\/p>/);
		assert.match(html, /<h1 class="ink-dir-title">/);
		assert.match(html, /the artists of <bdi>Black Needle<\/bdi>/);
		assert.doesNotMatch(html, /ink-hero-media/);
		const solo = mainOf(
			galleryHtml(
				gallery(page(1), {}, inkNoir({ ...STUDIO, type: "independent" })),
			),
		);
		assert.match(solo, /The newest work of <bdi>Black Needle<\/bdi>,/);
	});

	test("each piece is one link to its own page, its photo whole and named by its title, then its artist", () => {
		const html = mainOf(galleryHtml(gallery(page(2))));
		assert.match(
			html,
			new RegExp(
				`<li class="ink-piece ink-ar-135"><a class="ink-piece-link" id="work-open-1" href="/gallery/${photoId(1)}"><span class="ink-piece-frame"><img class="ink-piece-photo" src="[^"]+" srcSet="[^"]+" sizes="\\(min-width: 64rem\\) 34rem, [^"]+" width="2048" height="1536" alt="" loading="lazy" decoding="async"/></span><span class="ink-piece-title user-text" dir="auto">Koi on the forearm</span></a>`,
			),
		);
		// No description: the title is built from the data, never invented.
		assert.match(
			html,
			/<span class="ink-piece-title user-text" dir="auto">Tattoo by Sita Rai<\/span>/,
		);
		assert.match(
			html,
			/<p class="ink-piece-meta"><a href="\/artists\/sita"><bdi>Sita Rai<\/bdi><\/a><span class="ink-piece-healed">Healed<\/span><\/p>/,
		);
		// The viewer is the piece's own page now: no dialog in the grid.
		assert.doesNotMatch(html, /<dialog|work-grid/);
	});

	test("filters by the styles the photos carry, keeping the artist and the search; Healed and Clear when they apply", () => {
		// The artist filter offers the artists with photos (workPageData).
		const withWork = [
			sitaWithWork(1),
			{ ...ARJUN, workPhotos: sitaWithWork(1).workPhotos },
		];
		const html = mainOf(
			galleryHtml(
				gallery(page(3), { artist: "sita", q: "koi" }, inkNoir(), withWork),
			),
		);
		assert.match(
			html,
			/<a class="ink-filter" aria-current="page" href="\/gallery\?artist=sita&amp;q=koi">All work<\/a>/,
		);
		assert.match(
			html,
			/<a class="ink-filter" href="\/gallery\?artist=sita&amp;style=fine-line&amp;q=koi">Fine line<\/a>/,
		);
		assert.match(
			html,
			/<summary><span>Artist: <bdi>Sita Rai<\/bdi><\/span><\/summary>/,
		);
		assert.match(
			html,
			/<a class="ink-filter ink-healed-filter" href="\/gallery\?artist=sita&amp;healed=1&amp;q=koi">Healed only<\/a>/,
		);
		assert.match(
			html,
			/<a class="ink-link ink-clear-filters" href="\/gallery">Clear filters<\/a>/,
		);
		// A studio of one artist offers no artist filter, and nothing to clear.
		const one = mainOf(galleryHtml(gallery(page(3), {}, inkNoir(), [SITA])));
		assert.doesNotMatch(one, /ink-artist-filter|Clear filters/);
	});

	test("the search sits by the pieces, keeps the filters, and says what it matched among the pieces shown", () => {
		const html = mainOf(
			galleryHtml(
				gallery(page(4, { nextCursor: "c2" }), {
					style: "fine-line",
					q: "koi",
				}),
			),
		);
		const form =
			/<form class="ink-gallery-search"[^>]*>[\s\S]*?<\/form>/.exec(
				html,
			)?.[0] ?? "";
		assert.match(form, / method="get"/);
		assert.match(form, / action="\/gallery"/);
		assert.match(
			form,
			/<input type="hidden" name="style" value="fine-line"\/>/,
		);
		assert.match(form, / name="q" [^>]*value="koi"/);
		assert.match(
			html,
			/<p class="ink-filter-status ink-collection-status" role="status"><bdi>1<\/bdi> of the <bdi>4<\/bdi> pieces shown match “<bdi>koi<\/bdi>” Show more to search further\.<\/p>/,
		);
		assert.equal((html.match(/class="ink-piece /g) ?? []).length, 1);
		// "Show more" keeps the search and the filters.
		assert.match(
			html,
			/href="\/gallery\?style=fine-line&amp;q=koi&amp;cursor=c2">Show more/,
		);
		const all = mainOf(galleryHtml(gallery(page(4))));
		assert.match(all, /role="status"><bdi>4<\/bdi> pieces<\/p>/);
		const more = mainOf(galleryHtml(gallery(page(4, { nextCursor: "c2" }))));
		assert.match(more, /role="status">The newest <bdi>4<\/bdi> pieces<\/p>/);
	});

	test("a search, a filter or a studio with no photos each says so, and offers the way back", () => {
		const searched = mainOf(galleryHtml(gallery(page(2), { q: "rose" })));
		assert.match(
			searched,
			/Nothing among the pieces shown matches “<bdi>rose<\/bdi>”\./,
		);
		assert.match(
			searched,
			/<a class="ink-link" href="\/gallery">Clear search<\/a>/,
		);
		const filtered = mainOf(
			galleryHtml(gallery(page(0), { style: "realism" })),
		);
		assert.match(filtered, /No pieces match these filters\./);
		assert.match(filtered, /href="\/gallery">Show all work</);
		const empty = mainOf(galleryHtml(gallery(page(0))));
		assert.match(empty, /The collection is empty for now\./);
		assert.doesNotMatch(empty, /ink-gallery-search|ink-collection"/);
	});

	test("invites a request only while someone takes new work", () => {
		assert.match(
			mainOf(galleryHtml(gallery(page(1)))),
			/<a class="action action-primary ink-cta" href="\/book">Request a session<\/a>/,
		);
		assert.doesNotMatch(
			mainOf(
				galleryHtml(gallery(page(1), {}, inkNoir(CLOSED_STUDIO), [ARJUN])),
			),
			/ink-gallery-close|href="\/book/,
		);
	});
});

describe("one tattoo's page", () => {
	test("holds to every rule of a studio page, in both themes, whatever is known of the piece", () => {
		const plain = page(2).data[1];
		const related = [page(4), page(4), page(4)];
		for (const studio of [inkNoir(), stencil()]) {
			for (const data of [
				artwork({ studio }),
				artwork({ studio, photo: plain }),
				artwork({ studio, reads: related }),
				artwork({ studio, artists: [ARJUN] }),
				artwork({
					studio:
						studio === stencil()
							? stencil(CLOSED_STUDIO)
							: inkNoir(CLOSED_STUDIO),
					artists: [{ ...SITA, acceptingInquiries: false }],
				}),
			]) {
				holdsTheRules(artworkHtml(data));
			}
		}
	});

	test("its one h1 is the studio's description, else built from its styles and artist", () => {
		const described = mainOf(artworkHtml(artwork()));
		assert.match(
			described,
			/<h1 class="ink-artwork-title user-text" dir="auto">Koi on the forearm<\/h1>/,
		);
		assert.match(described, /<p class="ink-label">Fine line<\/p>/);
		assert.match(
			described,
			/<nav class="ink-breadcrumb" aria-label="Breadcrumb">/,
		);
		assert.match(described, /<a href="\/gallery">Gallery<\/a>/);
		const tagged = artwork({
			photo: { ...page(1).data[0], alt: null },
		});
		assert.equal(tagged.artwork.title, "Fine line tattoo by Sita Rai");
		assert.equal(
			artwork({ photo: page(2).data[1] }).artwork.title,
			"Tattoo by Sita Rai",
		);
	});

	test("shows the photo large and first, a button to the full-screen viewer", () => {
		const html = mainOf(artworkHtml(artwork()));
		assert.match(
			html,
			/<button type="button" class="artwork-open" id="work-open-1" aria-haspopup="dialog" aria-controls="work-photo-1"><img class="artwork-photo" [^>]* alt="Koi on the forearm" loading="eager" decoding="async" fetchPriority="high"\/><span class="artwork-open-hint">View full screen<\/span><\/button><dialog id="work-photo-1"/,
		);
	});

	test("says only what the API knows: artist, styles (each a filtered gallery), healed and studio", () => {
		const html = mainOf(artworkHtml(artwork()));
		assert.match(
			html,
			/<dt>Artist<\/dt><dd><a href="\/artists\/sita"><bdi>Sita Rai<\/bdi><\/a><\/dd>/,
		);
		assert.match(
			html,
			/<a href="\/gallery\?style=fine-line">Fine line<\/a><a href="\/gallery\?style=blackwork">Blackwork<\/a>/,
		);
		assert.match(html, /<dt>Healed<\/dt><dd>Photographed healed<\/dd>/);
		assert.doesNotMatch(
			mainOf(artworkHtml(artwork({ photo: page(2).data[1] }))),
			/Photographed healed/,
		);
		assert.doesNotMatch(
			html,
			/placement|technique|completed|price|\bNPR\b|available on/i,
		);
	});

	test("asks for something similar from the artist while they take new work, else the studio, else nobody", () => {
		const id = photoId(1);
		const open = artwork();
		assert.equal(open.similar?.href, `/book?artist=sita&artwork=${id}`);
		assert.match(
			mainOf(artworkHtml(open)),
			new RegExp(
				`<a class="action action-primary ink-cta" href="/book\\?artist=sita&amp;artwork=${id}">Request a similar tattoo</a>`,
			),
		);
		const artistClosed = artwork({
			artists: [{ ...SITA, acceptingInquiries: false }],
		});
		assert.equal(artistClosed.similar?.href, `/book?artwork=${id}`);
		const nobody = artwork({
			studio: inkNoir(CLOSED_STUDIO),
			artists: [{ ...SITA, acceptingInquiries: false }],
		});
		assert.equal(nobody.similar, null);
		const html = mainOf(artworkHtml(nobody));
		assert.doesNotMatch(html, /Request a similar tattoo|artwork=/);
		assert.match(
			html,
			/<bdi>Sita Rai<\/bdi> isn&#x27;t taking new work right now\./,
		);
	});

	test("the booking page checks the piece with the API, then names its artist and starts the idea with a link to it", () => {
		const id = photoId(1);
		const photo = page(1).data[0];
		assert.deepEqual(readRequestSearch({ artist: "sita", artwork: id }), {
			artist: "sita",
			artwork: id,
		});
		assert.deepEqual(readRequestSearch({ artwork: "nope" }), {});
		assert.equal(requestHref({ artwork: id }), `/book?artwork=${id}`);
		const data = requestPageData(
			STUDIO,
			[SITA, ARJUN],
			{ artwork: id },
			ORIGIN,
			IMAGE_ORIGIN,
			null,
			photo,
		);
		assert.equal(data.inquiry.kind, "open");
		assert.equal(
			data.inquiry.kind === "open" ? data.inquiry.preferredArtist?.name : null,
			"Sita Rai",
		);
		assert.equal(
			data.inquiry.kind === "open" ? data.inquiry.start?.idea : null,
			`Inspired by this piece in your gallery: ${ORIGIN}/gallery/${id}`,
		);
		assert.equal(data.booking.artwork?.title, "Koi on the forearm");
		assert.equal(data.booking.artwork?.href, `/gallery/${id}`);
		// A piece the API didn't show (or another id) starts nothing and names no one.
		for (const shown of [null, page(2).data[1]]) {
			const none = requestPageData(
				STUDIO,
				[SITA, ARJUN],
				{ artwork: id },
				ORIGIN,
				IMAGE_ORIGIN,
				null,
				shown,
			);
			assert.equal(none.booking.artwork, null);
			assert.equal(
				none.inquiry.kind === "open" ? none.inquiry.start : null,
				undefined,
			);
		}
		const closed = requestPageData(
			CLOSED_STUDIO,
			[ARJUN],
			{ artwork: id },
			ORIGIN,
			IMAGE_ORIGIN,
			null,
			photo,
		);
		assert.notEqual(closed.inquiry.kind, "open");
	});

	test("relates pieces of its style, then its artist's, then the newest, each once, never itself, at most six", () => {
		const views = [page(3), page(5), page(8)].map((read, index) =>
			galleryView(read, IMAGE_ORIGIN, index * 7),
		);
		const related = relatedArtwork(photoId(1), views);
		assert.deepEqual(
			related.map((photo) => photo.id),
			[2, 3, 4, 5, 6, 7].map(photoId),
		);
		const html = mainOf(
			artworkHtml(artwork({ reads: [page(3), page(5), page(8)] })),
		);
		assert.equal((html.match(/class="ink-piece /g) ?? []).length, 6);
		assert.doesNotMatch(html, new RegExp(`href="/gallery/${photoId(1)}"`));
		assert.match(
			html,
			/<a class="ink-link" href="\/gallery">View all work<\/a>/,
		);
		assert.doesNotMatch(mainOf(artworkHtml(artwork())), /ink-related/);
	});

	test("its head names the piece, its artist and studio, with its own address and the photo", () => {
		const { seo } = artwork();
		assert.equal(seo.title, "Koi on the forearm, by Sita Rai at Black Needle");
		assert.equal(seo.canonical, `${ORIGIN}/gallery/${photoId(1)}`);
		assert.match(
			seo.description,
			/^A Fine line and Blackwork tattoo by Sita Rai at Black Needle\. Koi on the forearm$/,
		);
		assert.equal(seo.image?.alt, "Koi on the forearm");
		const built = artwork({ photo: page(2).data[1] }).seo;
		assert.equal(built.title, "Tattoo by Sita Rai at Black Needle");
	});
});

describe("loadArtworkPage", () => {
	const API = "http://api.test";
	const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
	function context(fetch: typeof globalThis.fetch) {
		const api = createApiContext("server");
		connectServer(api, {
			config: { apiUrl: API, mediaUrl: IMAGE_ORIGIN },
			studio: STUDIO,
			fetch,
		});
		seedStudio(api, STUDIO);
		const site = new SiteRef();
		site.connect(ORIGIN);
		return { ...api, site };
	}
	const photo = page(1).data[0];

	test("an id that can't be a photo's is the not-found, with no API call", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, {}));
		await assert.rejects(
			loadArtworkPage(context(fetch), "not-a-uuid"),
			isNotFound,
		);
		assert.equal(calls.length, 0);
	});

	test("a photo the API doesn't show is the not-found", async () => {
		const { fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(200, { data: [SITA] })
				: json(404, NOT_FOUND),
		);
		await assert.rejects(
			loadArtworkPage(context(fetch), photoId(9)),
			isNotFound,
		);
	});

	test("reads the photo, then its style's, its artist's and the newest pieces, seven each", async () => {
		const { calls, fetch } = fakeFetch(({ url }) => {
			if (url.endsWith("/artists")) return json(200, { data: [SITA] });
			if (url.endsWith(`/work/${photoId(1)}`))
				return json(200, { data: photo });
			if (url.includes("/work?")) return json(200, page(3));
			return json(404, NOT_FOUND);
		});
		const data = await loadArtworkPage(context(fetch), photoId(1));
		assert.equal(data.artwork.id, photoId(1));
		assert.deepEqual(
			calls
				.map((call) => call.url)
				.filter((url) => url.includes("/work?"))
				.sort(),
			[
				`${API}/api/v1/tenants/${STUDIO.slug}/work?artist=sita&limit=7`,
				`${API}/api/v1/tenants/${STUDIO.slug}/work?limit=7`,
				`${API}/api/v1/tenants/${STUDIO.slug}/work?style=fine-line&limit=7`,
			],
		);
		assert.deepEqual(
			data.related.map((piece) => piece.id),
			[photoId(2), photoId(3)],
		);
	});

	test("a related read that fails is logged and leaves the piece standing", async (t) => {
		const log = t.mock.method(console, "error", () => {});
		const { fetch } = fakeFetch(({ url }) => {
			if (url.endsWith("/artists")) return json(200, { data: [SITA] });
			if (url.endsWith(`/work/${photoId(1)}`))
				return json(200, { data: photo });
			return json(502, { error: { code: "bad_gateway", message: "down" } });
		});
		const data = await loadArtworkPage(context(fetch), photoId(1));
		assert.deepEqual(data.related, []);
		assert.equal(data.artwork.title, "Koi on the forearm");
		assert.ok(log.mock.callCount() >= 1);
	});
});

describe("gallery.css", () => {
	const css = readFileSync(
		new URL("../../src/studio/theme/ink-noir/gallery.css", import.meta.url),
		"utf8",
	);

	test("loads nothing and takes its colours from the theme's tokens", () => {
		assert.doesNotMatch(css, /url\(|@import/);
		assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
	});

	test("has a shape class for every step from 1:2 to 2:1, and no masonry columns that reshuffle", () => {
		for (let n = 50; n <= 200; n += 5) {
			assert.match(
				css,
				new RegExp(
					`\\.ink-ar-${n} \\{\\n\\tflex: ${n} 1 calc\\(var\\(--ink-row\\) \\* ${n / 100}\\);`,
				),
			);
		}
		assert.doesNotMatch(css, /(?<![-\w])columns:/);
		assert.doesNotMatch(css, /object-fit: cover;\n[^}]*\n?\}\n\.ink-piece/);
	});

	test("stops its motion for people who asked for less", () => {
		const reduced = css.slice(
			css.indexOf("@media (prefers-reduced-motion: reduce)"),
		);
		assert.match(reduced, /\.ink-piece \{\n\t\tanimation: none;/);
		assert.match(reduced, /\.ink-piece-photo/);
	});
});

describe("review fixes (Prompt 5)", () => {
	test("the tattoo page's ids are each once when its related pieces start elsewhere", () => {
		// The style read starts after the piece: its first photo is numbered 1, as the piece is.
		const later = page(5);
		const reads = [{ ...later, data: later.data.slice(1) }, null, null];
		const html = artworkHtml(artwork({ reads }));
		const seen = ids(html);
		assert.deepEqual(seen, [...new Set(seen)], "every id once");
		assert.equal((html.match(/class="ink-piece /g) ?? []).length, 4);
	});

	test("a piece without a description is found by the title it shows", () => {
		const [, plain] = galleryView(page(2), IMAGE_ORIGIN).photos;
		assert.ok(matchesSearch(plain, "tattoo by sita"));
	});

	test("the page's one photo has no number in its description", () => {
		const data = artwork({ photo: page(2).data[1] });
		assert.equal(data.artwork.photo.alt, "Tattoo by Sita Rai");
		assert.equal(data.seo.image?.alt, "Tattoo by Sita Rai");
	});

	test("Clear search is a link while the search is in the address", () => {
		const html = mainOf(galleryHtml(gallery(page(2), { q: "rose" })));
		assert.match(
			html,
			/<a class="ink-link" href="\/gallery">Clear search<\/a>/,
		);
		assert.doesNotMatch(html, /ink-clear-search/);
	});
});
