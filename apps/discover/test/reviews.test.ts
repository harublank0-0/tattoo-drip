import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discoverKeys } from "@tattoo-drip/react";
import {
	createDiscoverClient,
	type DiscoverReviewsPage,
} from "@tattoo-drip/sdk";
import {
	applyFreshInkFilters,
	changeFreshInk,
	clearedFreshInk,
	freshInkChips,
	freshInkQuery,
	freshInkTitle,
	readFreshInkSearch,
	resolveFreshInk,
} from "../src/lib/fresh-ink.ts";
import {
	averageText,
	dayText,
	filledStars,
	freshInkAlt,
	mediaCount,
	mergePages,
	profileReviewQueries,
	ratingSummary,
	ratingWords,
	reviewsLd,
	videoLabel,
} from "../src/lib/reviews.ts";
import { hasRoute, paths } from "../src/lib/routes.ts";
import { INDEXABLE_PATHS, indexable } from "../src/lib/seo.ts";
import { studioLd } from "../src/lib/structured-data.ts";

/** Reviews and Fresh ink on Discover (slice 4): the words, the reads, the markup and the feed's address. */

const SETTINGS = { siteUrl: "https://tattoodrip.app", indexing: true };

const review = (id: string, rating: number) => ({
	id,
	rating,
	body: "Healed beautifully, the lines are crisp.",
	shownName: "Sita R.",
	date: "2026-10-12",
	artist: { id: "a1", slug: "maya", name: "Maya" },
	studio: {
		slug: "black-needle",
		name: "Black Needle",
		type: "studio" as const,
	},
	reply: null,
});

const page = (
	ratings: number[],
	rating: DiscoverReviewsPage["rating"],
): DiscoverReviewsPage => ({
	data: ratings.map((each, index) => review(`r${index}`, each)),
	nextCursor: null,
	rating,
});

describe("ratings in words", () => {
	test("a rating reads as words, an average to one decimal, its stars rounded down", () => {
		assert.equal(ratingWords(4), "4 out of 5");
		assert.equal(averageText(4), "4.0");
		assert.equal(averageText(4.7), "4.7");
		assert.equal(filledStars(4.7), 4, "never rounded up");
		assert.equal(filledStars(4.99), 4);
		assert.equal(filledStars(5), 5);
		assert.equal(filledStars(1.2), 1);
		assert.equal(filledStars(Number.NaN), 0);
		assert.equal(filledStars(9), 5);
	});

	test("an average only from 3 reviews", () => {
		assert.equal(ratingSummary(null), null);
		assert.equal(ratingSummary(undefined), null);
		assert.equal(ratingSummary({ average: 5, count: 2 }), null);
		assert.equal(
			ratingSummary({ average: 4.7, count: 12 }),
			"4.7 from 12 reviews",
		);
		assert.equal(ratingSummary({ average: 4, count: 3 }), "4.0 from 3 reviews");
	});

	test("days, video labels, photo counts and alt text from the data", () => {
		assert.equal(dayText("2026-10-02"), "2 October 2026");
		assert.equal(dayText("nope"), "nope");
		assert.equal(videoLabel(42_400), "Video, 0:42");
		assert.equal(videoLabel(60_000), "Video, 1:00");
		assert.equal(mediaCount({ angles: [] }), null);
		assert.equal(
			mediaCount({ angles: [{ kind: "photo" }] as never }),
			"2 photos",
		);
		assert.equal(
			mediaCount({ angles: [{ kind: "photo" }, { kind: "video" }] as never }),
			"3 photos and videos",
		);
		const artist = { id: "a1", slug: "maya", name: "Maya" };
		assert.equal(freshInkAlt({ alt: "  Koi, healed ", artist }), "Koi, healed");
		assert.equal(freshInkAlt({ alt: null, artist }), "Healed tattoo by Maya");
		assert.equal(
			freshInkAlt({ alt: " ", artist }, { index: 1, total: 3 }),
			"Healed tattoo by Maya, photo 2 of 3",
		);
	});

	test("Show more merges pages without repeating a row", () => {
		assert.deepEqual(
			mergePages([
				{ data: [{ id: "a" }, { id: "b" }] },
				{ data: [{ id: "b" }, { id: "c" }] },
			]).map(({ id }) => id),
			["a", "b", "c"],
		);
	});
});

describe("profile reads", () => {
	test("each profile's reads use discoverQueries' keys and the SDK's paths", async () => {
		const calls: string[] = [];
		const client = createDiscoverClient({
			baseUrl: "https://api.test",
			fetch: (async (input: RequestInfo | URL) => {
				calls.push(String(input));
				return new Response(
					JSON.stringify({ data: [], nextCursor: null, rating: null }),
					{
						headers: { "content-type": "application/json" },
					},
				);
			}) as typeof fetch,
		});
		const studio = profileReviewQueries(client, { kind: "studio", slug: "s" });
		assert.deepEqual(
			studio.reviews.queryKey,
			discoverKeys.studioReviews("s", { limit: 6 }),
		);
		assert.deepEqual(
			studio.freshInk.queryKey,
			discoverKeys.studioFreshInk("s", { limit: 8 }),
		);
		const artist = profileReviewQueries(
			client,
			{ kind: "studioArtist", studio: "s", artist: "maya" },
			{ reviews: "c1" },
		);
		assert.deepEqual(
			artist.reviews.queryKey,
			discoverKeys.studioArtistReviews("s", "maya", { limit: 6, cursor: "c1" }),
		);
		const solo = profileReviewQueries(client, {
			kind: "independent",
			slug: "asha",
		});
		assert.deepEqual(
			solo.freshInk.queryKey,
			discoverKeys.independentArtistFreshInk("asha", { limit: 8 }),
		);
		const signal = new AbortController().signal;
		const context = { signal } as never;
		await (studio.reviews.queryFn as (c: never) => Promise<unknown>)(context);
		await (artist.reviews.queryFn as (c: never) => Promise<unknown>)(context);
		await (solo.freshInk.queryFn as (c: never) => Promise<unknown>)(context);
		assert.deepEqual(calls, [
			"https://api.test/api/v1/discover/studios/s/reviews?limit=6",
			"https://api.test/api/v1/discover/studios/s/artists/maya/reviews?limit=6&cursor=c1",
			"https://api.test/api/v1/discover/artists/asha/fresh-ink?limit=8",
		]);
	});
});

describe("review structured data", () => {
	test("AggregateRating and Review only from 3 reviews, as the page shows them", () => {
		assert.deepEqual(reviewsLd(SETTINGS, "black-needle", undefined), {});
		assert.deepEqual(
			reviewsLd(SETTINGS, "black-needle", page([5, 4], null)),
			{},
		);
		// Even a forged rating under 3 is never marked up.
		assert.deepEqual(
			reviewsLd(
				SETTINGS,
				"black-needle",
				page([5, 4], { average: 4.5, count: 2 }),
			),
			{},
		);
		const ld = reviewsLd(
			SETTINGS,
			"black-needle",
			page([5, 4, 4], { average: 4.3, count: 7 }),
		);
		assert.deepEqual(ld.aggregateRating, {
			"@type": "AggregateRating",
			ratingValue: 4.3,
			reviewCount: 7,
			bestRating: 5,
			worstRating: 1,
		});
		const reviews = ld.review as Record<string, unknown>[];
		assert.equal(reviews.length, 3);
		assert.deepEqual(reviews[0], {
			"@type": "Review",
			"@id": "https://tattoodrip.app/studios/black-needle#review-r0",
			reviewRating: {
				"@type": "Rating",
				ratingValue: 5,
				bestRating: 5,
				worstRating: 1,
			},
			author: { "@type": "Person", name: "Sita R." },
			datePublished: "2026-10-12",
			reviewBody: "Healed beautifully, the lines are crisp.",
		});
	});

	test("the studio's TattooParlor carries them; without reviews it is as before", () => {
		const studio = {
			id: "s1",
			slug: "black-needle",
			name: "Black Needle",
			type: "studio",
			location: null,
			logo: null,
			cover: null,
			styles: [],
			storefrontUrl: "https://black-needle.example/",
			intro: null,
			timezone: "Asia/Kathmandu",
			socialLinks: [],
			artists: [],
			tattoos: [],
			bookingUrl: "https://black-needle.example/book",
		} as never;
		const bare = studioLd(SETTINGS, studio);
		assert.equal(bare.aggregateRating, undefined);
		assert.equal(bare.review, undefined);
		const rated = studioLd(
			SETTINGS,
			studio,
			page([5, 4, 3], { average: 4, count: 3 }),
		);
		assert.equal(rated["@type"], "TattooParlor");
		assert.equal(
			(rated.aggregateRating as { ratingValue: number }).ratingValue,
			4,
		);
		assert.equal((rated.review as unknown[]).length, 3);
	});
});

describe("the Fresh ink feed's address", () => {
	test("reads country, city (with its country), style and cursor; nothing else", () => {
		assert.deepEqual(
			readFreshInkSearch({
				country: "np",
				city: "kathmandu",
				style: "blackwork",
				cursor: "abc_-",
				q: "koi",
				artist: "x",
			}),
			{ country: "NP", city: "kathmandu", style: "blackwork", cursor: "abc_-" },
		);
		assert.deepEqual(readFreshInkSearch({ city: "kathmandu" }), {
			country: undefined,
			city: undefined,
			style: undefined,
			cursor: undefined,
		});
	});

	test("always one country: the address's, else the visitor's; a city only with the address's", () => {
		const visitor = resolveFreshInk({ city: undefined }, "NP", undefined);
		assert.equal(visitor.country, "NP");
		assert.deepEqual(freshInkQuery(visitor), { country: "NP", limit: 24 });
		const explicit = resolveFreshInk(
			{ country: "IN", city: "new-delhi", cursor: "c" },
			"NP",
			"blackwork",
		);
		assert.deepEqual(freshInkQuery(explicit), {
			country: "IN",
			city: "new-delhi",
			style: "blackwork",
			cursor: "c",
			limit: 24,
		});
	});

	test("changes reset paging; a city brings its country; chips remove themselves", () => {
		const search = {
			country: "NP",
			city: "pokhara",
			style: "realism",
			cursor: "c",
		};
		assert.deepEqual(changeFreshInk(search, { style: undefined }), {
			country: "NP",
			city: "pokhara",
			style: undefined,
			cursor: undefined,
		});
		assert.deepEqual(changeFreshInk(search, { country: "IN" }).city, undefined);
		assert.deepEqual(clearedFreshInk(search), { country: "NP" });
		assert.deepEqual(
			applyFreshInkFilters({}, { city: "kathmandu", style: "blackwork" }, "NP"),
			{
				city: "kathmandu",
				style: "blackwork",
				country: "NP",
				cursor: undefined,
			},
		);
		const filters = resolveFreshInk(search, "NP", "realism");
		const chips = freshInkChips(search, filters, {
			city: "Pokhara",
			style: "Realism",
		});
		assert.deepEqual(
			chips.map((chip) => [chip.label, chip.remove]),
			[
				[
					"Pokhara",
					{
						country: "NP",
						city: undefined,
						style: "realism",
						cursor: undefined,
					},
				],
				[
					"Realism",
					{
						country: "NP",
						city: "pokhara",
						style: undefined,
						cursor: undefined,
					},
				],
			],
		);
	});

	test("titles say what the page lists", () => {
		const filters = resolveFreshInk({}, "NP", undefined);
		assert.equal(freshInkTitle(filters, {}), "Fresh ink from Nepal");
		assert.equal(
			freshInkTitle(
				{ ...filters, style: "blackwork" },
				{ style: "Blackwork", city: "Pokhara" },
			),
			"Blackwork Fresh ink in Pokhara",
		);
	});

	test("the feed has a route, is indexable only bare and populated, and is not in the static sitemap", () => {
		assert.equal(paths.freshInk(), "/fresh-ink");
		assert.ok(hasRoute("/fresh-ink"));
		assert.ok(indexable(SETTINGS, "/fresh-ink"));
		assert.ok(!indexable(SETTINGS, "/fresh-ink", { noindex: true }));
		assert.ok(!INDEXABLE_PATHS.includes("/fresh-ink"));
	});
});
