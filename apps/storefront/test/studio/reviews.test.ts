import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clientPageCacheHeaders } from "../../src/studio/cache.ts";
import { excerptOf } from "../../src/studio/client-words.ts";
import { freshInkView } from "../../src/studio/fresh-ink.ts";
import {
	freshInkPageData,
	reviewsPageData,
	studioPageData,
} from "../../src/studio/loaders.ts";
import {
	dayView,
	MIN_RATED_REVIEWS,
	readReviewsSearch,
	reviewsQuery,
	reviewsView,
} from "../../src/studio/reviews.ts";
import { headTags } from "../../src/studio/seo.ts";
import { THEME_KEYS } from "../../src/studio/theme/config.ts";
import {
	ThemedFreshInkPage,
	ThemedReviewsPage,
	ThemedStudioPage,
} from "../../src/studio/theme/registry.tsx";
import { ARJUN, DEFAULT_STOREFRONT, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Client reviews and Fresh ink on the studio's own page (Reviews and Fresh
 * ink, slice 3): what the page keeps of the API's reviews (every field
 * checked, the average only from 3), and how every theme draws both
 * sections: nothing when there is nothing, the stars in words, the text as
 * text, no review structured data, Fresh ink opening the viewer.
 */

const id = (n: number) =>
	`0199f000-0000-7000-8000-${String(n).padStart(12, "0")}`;

export function apiReview(n: number, over: Record<string, unknown> = {}) {
	return {
		id: id(n),
		rating: 5,
		body: `Review number ${n}: the lines healed crisp and even.`,
		shownName: "Sita R.",
		date: "2026-10-01",
		artist: { slug: SITA.slug, name: SITA.name },
		reply: null,
		...over,
	};
}

export function reviewsPage(
	count: number,
	over: { rating?: unknown; nextCursor?: string | null } = {},
) {
	return {
		data: Array.from({ length: count }, (_, index) => apiReview(index + 1)),
		nextCursor: over.nextCursor ?? null,
		rating:
			over.rating !== undefined
				? over.rating
				: count >= 3
					? { average: 4.7, count }
					: null,
	};
}

const photo = (name: string, width = 1200, height = 1500) => ({
	url: `${IMAGE_ORIGIN}/uploads/tenants/t/fresh_ink_photo/${name}.jpg`,
	width,
	height,
	alt: null,
	variants: [
		{
			url: `${IMAGE_ORIGIN}/uploads/tenants/t/fresh_ink_photo/${name}.320.jpg`,
			width: 320,
		},
	],
});

export function apiPost(n: number, over: Record<string, unknown> = {}) {
	return {
		id: id(100 + n),
		...photo(`post-${n}`),
		angles: [],
		shownName: "Ram K.",
		caption: "Healed after six weeks.",
		styles: [{ slug: "fine-line", name: "Fine line" }],
		placement: "Left forearm",
		artist: { slug: SITA.slug, name: SITA.name },
		date: "2026-10-02",
		...over,
	};
}

export function freshInkPage(count: number, nextCursor: string | null = null) {
	return {
		data: Array.from({ length: count }, (_, index) => apiPost(index + 1)),
		nextCursor,
	};
}

const VIDEO = {
	kind: "video",
	poster: {
		...photo("clip-poster", 1080, 1920),
		alt: null,
	},
	sources: [
		{
			url: `${IMAGE_ORIGIN}/uploads/tenants/t/fresh_ink_video/clip.720x1280.mp4`,
			type: "video/mp4",
			width: 720,
			height: 1280,
		},
	],
	durationMs: 12_000,
	alt: null,
};

describe("reviewsView: what the page keeps of the API's reviews", () => {
	test("keeps a good review, says its stars in words and its month", () => {
		const view = reviewsView(reviewsPage(1, { nextCursor: "abc" }));
		assert.equal(view.reviews.length, 1);
		const [review] = view.reviews;
		assert.equal(review.rating, 5);
		assert.equal(review.ratingText, "5 out of 5");
		assert.equal(review.name, "Sita R.");
		assert.deepEqual(review.date, {
			text: "October 2026",
			dateTime: "2026-10-01",
		});
		assert.deepEqual(review.artist, {
			name: SITA.name,
			href: `/artists/${SITA.slug}`,
		});
		assert.equal(review.reply, null);
		assert.equal(view.nextCursor, "abc");
		assert.equal(view.rating, null);
	});

	test("drops a review that isn't one: a rating off 1 to 5 or not whole, no id, no name, a text too long", () => {
		const page = {
			data: [
				apiReview(1, { rating: 0 }),
				apiReview(2, { rating: 6 }),
				apiReview(3, { rating: 4.5 }),
				apiReview(4, { id: "nope" }),
				apiReview(5, { shownName: "" }),
				apiReview(6, { shownName: "x".repeat(41) }),
				apiReview(7, { body: "y".repeat(2001) }),
				apiReview(8, { body: 42 }),
				apiReview(9),
				apiReview(9),
			],
			nextCursor: "not a cursor!",
			rating: null,
		};
		const view = reviewsView(page);
		assert.deepEqual(
			view.reviews.map((review) => review.id),
			[id(9)],
			"each id once",
		);
		assert.equal(view.nextCursor, null);
		for (const none of [null, undefined, "x", 3, [], { data: "x" }]) {
			assert.deepEqual(reviewsView(none).reviews, [], String(none));
		}
	});

	test("the average shows only from 3 reviews, to one decimal, whatever the API sends", () => {
		assert.equal(MIN_RATED_REVIEWS, 3);
		const at = (rating: unknown) =>
			reviewsView(reviewsPage(1, { rating })).rating;
		assert.equal(at({ average: 4.7, count: 2 }), null);
		assert.equal(at({ average: 0.5, count: 9 }), null);
		assert.equal(at({ average: 5.2, count: 9 }), null);
		assert.equal(at({ average: "4.7", count: 9 }), null);
		assert.equal(at({ average: 4.7, count: 3.5 }), null);
		const rating = at({ average: 4.66, count: 12 });
		assert.deepEqual(rating, {
			average: 4.7,
			averageText: "4.7",
			count: 12,
			text: "4.7 from 12 reviews",
			fromText: "from 12 reviews",
			stars: 4,
		});
		assert.equal(at({ average: 5, count: 3 })?.text, "5.0 from 3 reviews");
	});

	test("keeps the text as text: line breaks stay, control characters go, a reply taken down is none", () => {
		const view = reviewsView({
			data: [
				apiReview(1, {
					body: "Line one,\r\nline two <b>not bold</b>\u0007 at all.",
					reply: { body: "Thanks!\nSee you soon.", date: "2026-10-05" },
				}),
				apiReview(2, { reply: { body: "", date: "2026-10-05" } }),
			],
			nextCursor: null,
			rating: null,
		});
		assert.equal(
			view.reviews[0].body,
			"Line one,\nline two <b>not bold</b> at all.",
		);
		assert.deepEqual(view.reviews[0].reply, {
			body: "Thanks!\nSee you soon.",
			date: { text: "October 2026", dateTime: "2026-10-05" },
		});
		assert.equal(view.reviews[1].reply, null);
	});

	test("a day is a real YYYY-MM-DD day, else none", () => {
		assert.deepEqual(dayView("2026-02-28"), {
			text: "February 2026",
			dateTime: "2026-02-28",
		});
		for (const bad of [
			"2026-02-30",
			"2026-13-01",
			"26-01-01",
			20260101,
			null,
		]) {
			assert.equal(dayView(bad), null, String(bad));
		}
	});

	test("the address keeps only a cursor shaped like one, and the read asks for it and the page size", () => {
		assert.deepEqual(readReviewsSearch({ cursor: "abc_D-1", fbclid: "x" }), {
			cursor: "abc_D-1",
		});
		assert.deepEqual(readReviewsSearch({ cursor: "a b" }), {});
		assert.deepEqual(readReviewsSearch({ cursor: ["abc"] }), {});
		assert.deepEqual(reviewsQuery({ cursor: "abc" }, 24), {
			cursor: "abc",
			limit: 24,
		});
		assert.deepEqual(reviewsQuery({}, 6), { limit: 6 });
	});
});

/** The home page in `theme`, with these answers for the two reads. */
function home(theme: string, reviews: unknown, freshInk: unknown) {
	const studio = withStorefront({ ...DEFAULT_STOREFRONT, theme });
	const data = studioPageData(
		studio,
		[SITA, ARJUN],
		ORIGIN,
		IMAGE_ORIGIN,
		null,
		null,
		undefined,
		{ reviews, freshInk },
	);
	return renderToStaticMarkup(createElement(ThemedStudioPage, { data }));
}

describe("the home page's Reviews and Fresh ink, in every theme", () => {
	for (const theme of THEME_KEYS) {
		test(`${theme}: nothing at all without reviews or posts`, () => {
			const html = home(theme, reviewsPage(0), freshInkPage(0));
			assert.doesNotMatch(html, /id="reviews"/);
			assert.doesNotMatch(html, /id="fresh-ink"/);
			assert.doesNotMatch(html, /client-review-list|fresh-ink-photo/);
			// A failed read (an empty or garbled answer) is the same.
			assert.equal(home(theme, null, "broken"), html);
		});

		test(`${theme}: draws both, the stars in words, the text as text, no review structured data`, () => {
			const reviews = reviewsPage(4, { nextCursor: "next" });
			reviews.data[0].body = "Loved it <script>alert(1)</script> & more";
			(reviews.data[0] as { reply: unknown }).reply = {
				body: "Thank you!",
				date: "2026-10-03",
			};
			const posts = freshInkPage(2, "more");
			posts.data[1] = apiPost(2, { angles: [VIDEO] });
			const html = home(theme, reviews, posts);
			assertSafePage(html, { brandImages: true });

			assert.match(
				html,
				/<section id="reviews"[^>]*aria-labelledby="reviews-title"/,
			);
			assert.match(html, /<h2 [^>]*id="reviews-title"/);
			assert.match(html, /<span class="sr-only">5 out of 5<\/span>/);
			// "4.7 from 4 reviews" on the page, "4.7 out of 5 from 4 reviews" read aloud; the stars rounded down.
			assert.match(
				html,
				/4\.7<span class="sr-only"> out of 5<\/span> from 4 reviews/,
			);
			assert.equal(
				(
					html
						.match(/<p class="client-review-summary">.*?<\/p>/)?.[0]
						.match(/data-on/g) ?? []
				).length,
				4,
			);
			assert.match(
				html,
				/Loved it &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/,
			);
			assert.doesNotMatch(html, /<script>alert/);
			assert.match(html, /Thank you!/);
			assert.match(html, /href="\/reviews"/);
			assert.doesNotMatch(html, /AggregateRating|"@type":"Review"/);

			assert.match(
				html,
				/<section id="fresh-ink"[^>]*aria-labelledby="fresh-ink-title"/,
			);
			assert.match(html, /href="\/fresh-ink"/);
			// Each post opens its own viewer, with ids of its own beside Recent work's.
			assert.match(html, /aria-controls="fresh-ink-photo-1"/);
			assert.match(html, /<dialog id="fresh-ink-photo-1"/);
			assert.match(
				html,
				/<dialog id="fresh-ink-photo-2" class="work-dialog work-dialog-tattoo"/,
			);
			assert.match(html, /alt="Fresh ink from Ram K\., tattoo by Sita Rai"/);
			assert.match(html, /Shown by Ram K\./);
			assert.match(html, /2 photos and videos/);
			assert.match(html, /Healed after six weeks\./);

			// The headings stay in order: nothing below the h1 skips to h3 without an h2.
			const levels = Array.from(html.matchAll(/<h([1-6])[\s>]/g), (m) =>
				Number(m[1]),
			);
			for (let index = 1; index < levels.length; index++) {
				assert.ok(
					levels[index] <= levels[index - 1] + 1,
					`h${levels[index - 1]} then h${levels[index]}`,
				);
			}
		});

		test(`${theme}: below 3 reviews there is no average`, () => {
			const html = home(theme, reviewsPage(2), freshInkPage(0));
			assert.match(html, /id="reviews"/);
			assert.doesNotMatch(html, /client-review-summary|from \d+ reviews/);
			assert.doesNotMatch(html, /href="\/reviews"/, "no more to see");
		});
	}

	test("a studio that hides a section in Page look shows none of it", () => {
		const studio = withStorefront({
			...DEFAULT_STOREFRONT,
			sections: [{ type: "work" }, { type: "inquiry" }],
		});
		const data = studioPageData(
			studio,
			[SITA],
			ORIGIN,
			IMAGE_ORIGIN,
			null,
			null,
			undefined,
			{
				reviews: reviewsPage(3),
				freshInk: freshInkPage(1),
			},
		);
		const html = renderToStaticMarkup(
			createElement(ThemedStudioPage, { data }),
		);
		assert.doesNotMatch(html, /id="reviews"|id="fresh-ink"/);
	});
});

describe("/reviews and /fresh-ink", () => {
	test("have nothing to show when empty or hidden: the loader's not-found", () => {
		assert.equal(
			reviewsPageData(STUDIO, [SITA], reviewsPage(0), {}, ORIGIN),
			null,
		);
		assert.equal(
			freshInkPageData(
				STUDIO,
				[SITA],
				freshInkPage(0),
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			),
			null,
		);
		const hidden = withStorefront({
			...DEFAULT_STOREFRONT,
			sections: [{ type: "work" }, { type: "inquiry" }],
		});
		assert.equal(
			reviewsPageData(hidden, [SITA], reviewsPage(3), {}, ORIGIN),
			null,
		);
		assert.equal(
			freshInkPageData(
				hidden,
				[SITA],
				freshInkPage(1),
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			),
			null,
		);
	});

	test("every page's canonical is the first, with no robots tag (as /gallery and /flash); never review structured data; a shorter cache", () => {
		const first = reviewsPageData(STUDIO, [SITA], reviewsPage(3), {}, ORIGIN);
		const later = reviewsPageData(
			STUDIO,
			[SITA],
			reviewsPage(3),
			{ cursor: "abc" },
			ORIGIN,
		);
		assert.ok(first && later);
		assert.equal(first.seo.canonical, `${ORIGIN}/reviews`);
		assert.equal(later.seo.canonical, `${ORIGIN}/reviews`);
		assert.equal(first.seo.jsonLd, null);
		const robots = (seo: typeof first.seo) =>
			headTags(seo).meta.filter(
				(meta) => "name" in meta && meta.name === "robots",
			);
		assert.deepEqual(robots(first.seo), []);
		assert.deepEqual(robots(later.seo), []);
		const fresh = freshInkPageData(
			STUDIO,
			[SITA],
			freshInkPage(1),
			{ cursor: "abc" },
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.equal(fresh?.seo.canonical, `${ORIGIN}/fresh-ink`);
		assert.ok(fresh && robots(fresh.seo).length === 0);
		assert.deepEqual(clientPageCacheHeaders("success"), {
			"Cache-Control":
				"public, max-age=0, s-maxage=60, stale-while-revalidate=60",
		});
		assert.deepEqual(clientPageCacheHeaders("notFound"), {
			"Cache-Control": "public, max-age=0, s-maxage=60",
		});
		assert.deepEqual(clientPageCacheHeaders("error"), {
			"Cache-Control": "no-store",
		});
	});

	for (const theme of THEME_KEYS) {
		test(`${theme}: each page is one h1, the list, the next page as a link`, () => {
			const studio = withStorefront({ ...DEFAULT_STOREFRONT, theme });
			const reviews = reviewsPageData(
				studio,
				[SITA],
				reviewsPage(3, { nextCursor: "n2" }),
				{ cursor: "n1" },
				ORIGIN,
			);
			assert.ok(reviews);
			const reviewsHtml = renderToStaticMarkup(
				createElement(ThemedReviewsPage, { data: reviews }),
			);
			assertSafePage(reviewsHtml, { brandImages: true });
			assert.match(reviewsHtml, /<h1 [^>]*>Reviews<\/h1>/);
			assert.match(reviewsHtml, /href="\/reviews\?cursor=n2"/);
			assert.match(reviewsHtml, /href="\/reviews">Back to the newest/);
			assert.equal(
				(reviewsHtml.match(/class="client-review"/g) ?? []).length,
				3,
			);

			const fresh = freshInkPageData(
				studio,
				[SITA],
				freshInkPage(2, "n2"),
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			);
			assert.ok(fresh);
			const freshHtml = renderToStaticMarkup(
				createElement(ThemedFreshInkPage, { data: fresh }),
			);
			assertSafePage(freshHtml, { brandImages: true });
			assert.match(freshHtml, /<h1 [^>]*>Fresh ink<\/h1>/);
			assert.match(freshHtml, /href="\/fresh-ink\?cursor=n2"/);
			assert.match(freshHtml, /<dialog id="fresh-ink-photo-2"/);
		});
	}
});

describe("freshInkView: what the page keeps of the API's Fresh ink", () => {
	test("a post is a gallery tattoo with its own ids, no page of its own, and the client's words", () => {
		const view = freshInkView(
			{
				data: [
					apiPost(1),
					apiPost(2, { angles: [VIDEO], caption: null, artist: null }),
				],
				nextCursor: "n",
			},
			IMAGE_ORIGIN,
		);
		assert.equal(view.posts.length, 2);
		const [single, withVideo] = view.posts;
		assert.equal(single.dialogId, "fresh-ink-photo-1");
		assert.equal(single.openId, "fresh-ink-open-1");
		assert.equal(single.href, null);
		assert.equal(single.alt, "Fresh ink from Ram K., tattoo by Sita Rai");
		assert.equal(single.shownBy, "Shown by Ram K.");
		assert.equal(single.postCaption, "Healed after six weeks.");
		assert.equal(single.placement, "Left forearm");
		assert.deepEqual(single.styles, ["Fine line"]);
		assert.deepEqual(single.date, {
			text: "October 2026",
			dateTime: "2026-10-02",
		});
		assert.equal(withVideo.title, "Fresh ink from Ram K.");
		assert.equal(withVideo.angles.length, 1);
		assert.equal(withVideo.angles[0].kind, "video");
		assert.equal(withVideo.photosLabel, "2 photos and videos");
		assert.equal(view.nextCursor, "n");
	});

	test("drops a post whose photo is off the image origin, without an id or a shown name; numbers on from the offset", () => {
		const foreign = apiPost(1, { url: "https://evil.example/x.jpg" });
		const view = freshInkView(
			{
				data: [
					foreign,
					apiPost(2, { id: "nope" }),
					apiPost(3, { shownName: " " }),
					apiPost(4),
				],
				nextCursor: null,
			},
			IMAGE_ORIGIN,
			24,
		);
		assert.deepEqual(
			view.posts.map((post) => post.id),
			[id(104)],
		);
		assert.equal(view.posts[0].dialogId, "fresh-ink-photo-25");
		assert.deepEqual(
			freshInkView(freshInkPage(2), null).posts,
			[],
			"no origin, no photo",
		);
		for (const none of [null, "x", { data: 1 }]) {
			assert.deepEqual(
				freshInkView(none, IMAGE_ORIGIN).posts,
				[],
				String(none),
			);
		}
	});
});

describe("the review fixes (slice 3 review)", () => {
	test("a tile's title is the photo's description, else the client's caption on one line, else the names", () => {
		const view = freshInkView(
			{
				data: [
					apiPost(1, { alt: "Koi on the forearm" }),
					apiPost(2, { caption: "Six weeks on,\nfully healed." }),
					apiPost(3, { caption: null }),
				],
				nextCursor: null,
			},
			IMAGE_ORIGIN,
		);
		assert.deepEqual(
			view.posts.map((post) => post.title),
			[
				"Koi on the forearm",
				"Six weeks on, fully healed.",
				"Fresh ink from Ram K., tattoo by Sita Rai",
			],
		);
	});

	test("Irezumi, Atelier and Flash Parlour's 'All' links are plain words; the others end in an arrow", () => {
		for (const theme of THEME_KEYS) {
			const html = home(
				theme,
				reviewsPage(7, { nextCursor: "n" }),
				freshInkPage(7, "n"),
			);
			const links = [
				...html.matchAll(
					/<a [^>]*href="\/(?:reviews|fresh-ink)"[^>]*>(.*?)<\/a>/g,
				),
			].map((match) => match[1]);
			assert.equal(links.length, 2, theme);
			for (const inner of links) {
				const plain = ["irezumi", "atelier", "flash-parlour"].includes(theme);
				assert.equal(inner.includes("<svg"), !plain, `${theme}: ${inner}`);
			}
		}
	});

	const PAGE_IDIOMS: Record<
		string,
		{ head: RegExp; body: string; grid: string }
	> = {
		"stencil-and-ink": {
			head: /<h1 id="reviews-page-title" class="section-title client-page-title">/,
			body: "client-page-body",
			grid: "work-grid fresh-ink-grid",
		},
		"ink-noir": {
			head: /<header class="ink-dir-hero ink-client-hero">/,
			body: "ink-reviews",
			grid: "ink-fresh-grid",
		},
		irezumi: {
			head: /<header class="irz-page-head">/,
			body: "irz-reviews",
			grid: "irz-pieces",
		},
		atelier: {
			head: /<header class="atl-page-head">/,
			body: "atl-reviews",
			grid: "atl-pieces",
		},
		"flash-parlour": {
			head: /<header class="fp-page-head">/,
			body: "fp-reviews",
			grid: "fp-pieces",
		},
	};

	for (const theme of THEME_KEYS) {
		test(`${theme}: /reviews and /fresh-ink are composed in the theme's own idiom`, () => {
			const idiom = PAGE_IDIOMS[theme];
			const studio = withStorefront({ ...DEFAULT_STOREFRONT, theme });
			const reviews = reviewsPageData(
				studio,
				[SITA],
				reviewsPage(3),
				{},
				ORIGIN,
			);
			assert.ok(reviews);
			const html = renderToStaticMarkup(
				createElement(ThemedReviewsPage, { data: reviews }),
			);
			assert.match(html, idiom.head);
			assert.match(
				html,
				new RegExp(
					`<section class="client-page reviews-page [^"]*\\b${idiom.body}\\b`,
				),
			);
			const fresh = freshInkPageData(
				studio,
				[SITA],
				freshInkPage(2),
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			);
			assert.ok(fresh);
			const freshHtml = renderToStaticMarkup(
				createElement(ThemedFreshInkPage, { data: fresh }),
			);
			assert.match(
				freshHtml,
				new RegExp(`<ul class="${idiom.grid}" role="list">`),
			);
		});
	}
});

/**
 * A client's review and their Fresh ink, linked on the studio's page
 * (docs/superpowers/specs/2026-11-19-review-fresh-ink-link-design.md): the
 * view models keep a review's Fresh ink (with its own dialog ids) and a
 * post's review, and drop either when it doesn't read cleanly, never the
 * item that carries it.
 */
describe("a review and its Fresh ink, linked", () => {
	const long = `${"The lines healed crisp and even, and the shading is soft. ".repeat(4)}Would come back.`;

	test("reviewsView keeps a review's linked Fresh ink with its own dialog ids", () => {
		const view = reviewsView(
			{
				data: [
					apiReview(1, { freshInk: { ...apiPost(1), review: null } }),
					apiReview(2, { freshInk: null }),
				],
				nextCursor: null,
				rating: null,
			},
			IMAGE_ORIGIN,
		);
		const [linked, alone] = view.reviews;
		assert.ok(linked.freshInk);
		assert.ok(linked.freshInk.dialogId.startsWith("review-ink"));
		assert.ok(linked.freshInk.src.startsWith(IMAGE_ORIGIN));
		assert.equal(linked.freshInk.name, "Ram K.");
		assert.equal(alone.freshInk, null);
	});

	test("a garbled or off-origin linked post is dropped and the review kept", () => {
		const view = reviewsView(
			{
				data: [
					apiReview(1, {
						freshInk: apiPost(1, { url: "https://evil.example/x.jpg" }),
					}),
					apiReview(2, { freshInk: "nope" }),
				],
				nextCursor: null,
				rating: null,
			},
			IMAGE_ORIGIN,
		);
		assert.equal(view.reviews.length, 2);
		assert.deepEqual(
			view.reviews.map((review) => review.freshInk),
			[null, null],
		);
	});

	test("freshInkView keeps a post's linked review: stars in words, the date, the excerpt", () => {
		const view = freshInkView(
			{
				data: [
					apiPost(1, {
						review: {
							id: id(1),
							rating: 4,
							body: long,
							date: "2026-10-01",
						},
					}),
				],
				nextCursor: null,
			},
			IMAGE_ORIGIN,
		);
		const review = view.posts[0].review;
		assert.ok(review);
		assert.equal(review.id, id(1));
		assert.equal(review.rating, 4);
		assert.equal(review.ratingText, "4 out of 5");
		assert.equal(review.body, long);
		assert.deepEqual(review.date, {
			text: "October 2026",
			dateTime: "2026-10-01",
		});
		assert.ok(review.excerpt?.endsWith("…"));
	});

	test("the linked review keeps its text as text and cuts its excerpt at a word", () => {
		assert.equal(excerptOf("x".repeat(200)), null);
		const excerpt = excerptOf(long);
		assert.ok(excerpt);
		assert.ok(Array.from(excerpt).length <= 201);
		assert.ok(excerpt.endsWith("…"));
		// Cut at a word: what precedes "…" ends a word of the text.
		const kept = excerpt.slice(0, -1);
		assert.ok(long.startsWith(kept));
		assert.match(long.slice(kept.length, kept.length + 1), /\s/);

		const view = freshInkView(
			{
				data: [
					apiPost(1, {
						review: {
							id: id(1),
							rating: 5,
							body: "First line.\nSecond line, right to left: سلام عليكم.",
							date: "2026-10-01",
						},
					}),
				],
				nextCursor: null,
			},
			IMAGE_ORIGIN,
		);
		assert.equal(
			view.posts[0].review?.body,
			"First line.\nSecond line, right to left: سلام عليكم.",
		);
		assert.equal(view.posts[0].review?.excerpt, null);
	});

	test("an invalid linked review (rating 0, no id) is null and the post kept", () => {
		const view = freshInkView(
			{
				data: [
					apiPost(1, {
						review: { id: id(1), rating: 0, body: long, date: "2026-10-01" },
					}),
					apiPost(2, { review: { rating: 5, body: long, date: "2026-10-01" } }),
				],
				nextCursor: null,
			},
			IMAGE_ORIGIN,
		);
		assert.equal(view.posts.length, 2);
		assert.deepEqual(
			view.posts.map((post) => post.review),
			[null, null],
		);
	});
});

/** A photo angle of a post, as the API sends it. */
const photoAngle = (name: string) => ({ kind: "photo", ...photo(name) });

/** A review linked to a post of `angles.length + 1` items. */
function linkedReview(n: number, angles: unknown[]) {
	return apiReview(n, {
		freshInk: { ...apiPost(n, { angles, shownName: "Sita R." }), review: null },
	});
}

describe("a review's Fresh ink and a post's review on the page", () => {
	const fourItems = [photoAngle("a2"), VIDEO, photoAngle("a4")];

	for (const theme of THEME_KEYS) {
		test(`${theme}: a linked review draws its strip and its post's viewer`, () => {
			const reviews = {
				data: [linkedReview(1, fourItems)],
				nextCursor: null,
				rating: null,
			};
			const html = home(theme, reviews, freshInkPage(0));
			assertSafePage(html, { brandImages: true });
			const strip = html.match(
				/<button[^>]*class="client-review-photos"[^>]*>.*?<\/button>/s,
			)?.[0];
			assert.ok(strip, "the strip is a button");
			assert.match(strip, /aria-label="See Sita R\.&#x27;s Fresh ink"/);
			assert.match(strip, /aria-haspopup="dialog"/);
			assert.equal((strip.match(/<img /g) ?? []).length, 3);
			assert.match(strip, />\+1</);
			assert.match(html, /<dialog id="review-ink-photo-1"/);
			assert.match(strip, /aria-controls="review-ink-photo-1"/);
		});

		test(`${theme}: a post's viewer shows its linked review`, () => {
			const long = `${"The lines healed crisp and even, and the shading is soft. ".repeat(4)}Would come back.`;
			const posts = {
				data: [
					apiPost(1, {
						review: { id: id(1), rating: 4, body: long, date: "2026-10-01" },
					}),
				],
				nextCursor: null,
			};
			const html = home(theme, reviewsPage(0), posts);
			assertSafePage(html, { brandImages: true });
			const review = html.match(
				/<div class="fresh-ink-review">.*?<\/div>/s,
			)?.[0];
			assert.ok(review, "the viewer holds the review");
			assert.match(review, /Review from Ram K\./);
			assert.match(review, /<span class="sr-only">4 out of 5<\/span>/);
			assert.match(
				review,
				/<p class="fresh-ink-review-excerpt user-text" dir="auto">The lines healed[^<]*…<\/p>/,
			);
			assert.match(
				review,
				/<details[^>]*><summary[^>]*>Read the review<\/summary>/,
			);
			assert.ok(
				review.includes("Would come back."),
				"the whole text is in the disclosure",
			);
		});
	}

	test("the strip draws one to three thumbnails, a video's poster, and +N past three", () => {
		const one = home(
			"stencil-and-ink",
			{ data: [linkedReview(1, [])], nextCursor: null, rating: null },
			freshInkPage(0),
		);
		const oneStrip =
			one.match(
				/<button[^>]*class="client-review-photos"[^>]*>.*?<\/button>/s,
			)?.[0] ?? "";
		assert.equal((oneStrip.match(/<img /g) ?? []).length, 1);
		assert.doesNotMatch(oneStrip, />\+\d/);

		const withVideo = home(
			"stencil-and-ink",
			{ data: [linkedReview(1, [VIDEO])], nextCursor: null, rating: null },
			freshInkPage(0),
		);
		const videoStrip =
			withVideo.match(
				/<button[^>]*class="client-review-photos"[^>]*>.*?<\/button>/s,
			)?.[0] ?? "";
		assert.equal((videoStrip.match(/<img /g) ?? []).length, 2);
		assert.match(videoStrip, /clip-poster/);
	});

	test("a post in the grid and in a review has two viewers with distinct ids", () => {
		const post = apiPost(1);
		const html = home(
			"stencil-and-ink",
			{
				data: [apiReview(1, { freshInk: { ...post, review: null } })],
				nextCursor: null,
				rating: null,
			},
			{ data: [post], nextCursor: null },
		);
		const dialogs = Array.from(
			html.matchAll(/<dialog id="([^"]+)"/g),
			(m) => m[1],
		);
		assert.ok(dialogs.includes("fresh-ink-photo-1"));
		assert.ok(dialogs.includes("review-ink-photo-1"));
		assert.equal(
			new Set(dialogs).size,
			dialogs.length,
			"every viewer id is unique",
		);
		assert.match(html, /aria-controls="fresh-ink-photo-1"/);
		assert.match(html, /aria-controls="review-ink-photo-1"/);
	});

	test("the reviews' order is the API's, linked or not", () => {
		const html = home(
			"stencil-and-ink",
			{
				data: [apiReview(1), linkedReview(2, []), apiReview(3)],
				nextCursor: null,
				rating: null,
			},
			freshInkPage(0),
		);
		const order = Array.from(html.matchAll(/Review number (\d)/g), (m) => m[1]);
		assert.deepEqual(order, ["1", "2", "3"]);
	});
});
