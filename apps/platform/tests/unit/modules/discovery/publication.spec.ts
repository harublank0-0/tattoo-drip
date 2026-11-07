import { test } from "@japa/runner";
import {
	ARTIST_DISCOVER_STATES,
	type ArtistFacts,
	artistDiscoverState,
	artistStateText,
	artworkDiscoverState,
	DISCOVER_RECOMMENDED,
	LISTING_CONSENT_VERSION,
	listingConsent,
	type PublicationFacts,
	publicationStatus,
	readiness,
	STATUS_WORDS,
} from "#modules/discovery/publication";

const artist = (over: Partial<ArtistFacts> = {}): ArtistFacts => ({
	id: "a1",
	name: "Sita",
	slug: "sita",
	visible: true,
	discoveryListed: true,
	publishedPhotos: 3,
	...over,
});

const facts = (over: Partial<PublicationFacts> = {}): PublicationFacts => ({
	type: "studio",
	optedIn: false,
	takenDown: false,
	publiclyVisible: false,
	hasPlace: true,
	hasLogo: true,
	hasCover: true,
	hasIntro: true,
	artists: [artist({ publishedPhotos: 6 })],
	...over,
});

test.group("Discover publication status", () => {
	test("a takedown wins over every other state", ({ assert }) => {
		for (const optedIn of [true, false]) {
			for (const publiclyVisible of [true, false]) {
				for (const hasPlace of [true, false]) {
					assert.equal(
						publicationStatus(
							facts({ takenDown: true, optedIn, publiclyVisible, hasPlace }),
						),
						"taken_down",
					);
				}
			}
		}
	});

	test("listed only while opted in, publicly visible and every required item holds", ({
		assert,
	}) => {
		assert.equal(
			publicationStatus(facts({ optedIn: true, publiclyVisible: true })),
			"listed",
		);
		// The view doesn't return it: never "listed", whatever the switch says.
		assert.equal(
			publicationStatus(facts({ optedIn: true, publiclyVisible: false })),
			"needs_attention",
		);
		assert.equal(
			publicationStatus(
				facts({ optedIn: true, publiclyVisible: true, hasPlace: false }),
			),
			"needs_attention",
		);
	});

	test("not opted in: ready to list with a city, not listed without one", ({
		assert,
	}) => {
		assert.equal(publicationStatus(facts()), "eligible");
		assert.equal(publicationStatus(facts({ hasPlace: false })), "not_listed");
		// Recommendations never block: no photos, no branding, no artists.
		assert.equal(
			publicationStatus(
				facts({
					hasLogo: false,
					hasCover: false,
					hasIntro: false,
					artists: [],
				}),
			),
			"eligible",
		);
	});
});

test.group("Discover readiness", () => {
	test("a studio: the city is required, everything else is recommended", ({
		assert,
	}) => {
		const ready = readiness(facts({ hasPlace: false }));
		assert.deepEqual(
			ready.items.map((item) => [item.key, item.required]),
			[
				["location", true],
				["branding", false],
				["description", false],
				["portfolio", false],
				["artists", false],
			],
		);
		assert.isFalse(ready.eligible);
		assert.isFalse(ready.complete);
		assert.equal(ready.items[0].action, "discover_place");
	});

	test("the portfolio counts published photos of artists shown on Discover, against 6", ({
		assert,
	}) => {
		const ready = readiness(
			facts({
				artists: [
					artist({ id: "a", publishedPhotos: 2 }),
					artist({ id: "b", publishedPhotos: 2 }),
					// Not shown on Discover: never counted.
					artist({ id: "c", publishedPhotos: 9, discoveryListed: false }),
					artist({ id: "d", publishedPhotos: 9, visible: false }),
				],
			}),
		);
		const portfolio = ready.items.find((item) => item.key === "portfolio");
		assert.include(portfolio, {
			met: false,
			current: 4,
			recommended: DISCOVER_RECOMMENDED.studioPhotos,
		});
		assert.include(portfolio?.detail, "4 of 6");
		const artists = ready.items.find((item) => item.key === "artists");
		assert.include(artists, { met: false, current: 0, recommended: 2 });
		assert.isTrue(ready.eligible);
	});

	test("a complete studio meets every item", ({ assert }) => {
		const ready = readiness(
			facts({ artists: [artist({ publishedPhotos: 6 })] }),
		);
		assert.isTrue(ready.complete);
		assert.isTrue(ready.items.every((item) => item.met));
	});

	test("an independent artist: no artists item, 3 photos recommended", ({
		assert,
	}) => {
		const ready = readiness(
			facts({ type: "independent", artists: [artist({ publishedPhotos: 3 })] }),
		);
		assert.notInclude(
			ready.items.map((item) => item.key),
			"artists",
		);
		const portfolio = ready.items.find((item) => item.key === "portfolio");
		assert.include(portfolio, {
			met: true,
			recommended: DISCOVER_RECOMMENDED.artistPhotos,
		});
		assert.isTrue(ready.complete);
	});
});

test.group("Discover state of an artist and a photo", () => {
	const listed = { takenDown: false, publiclyVisible: true };

	test("an artist: the first reason they don't show, in order", ({
		assert,
	}) => {
		const shown = { visible: true, discoveryListed: true };
		assert.equal(artistDiscoverState(listed, shown), "shown");
		assert.equal(
			artistDiscoverState({ ...listed, publiclyVisible: false }, shown),
			"studio_not_listed",
		);
		assert.equal(
			artistDiscoverState(listed, { ...shown, discoveryListed: false }),
			"opted_out",
		);
		assert.equal(
			artistDiscoverState(listed, { visible: false, discoveryListed: false }),
			"hidden_from_page",
		);
		assert.equal(
			artistDiscoverState(
				{ takenDown: true, publiclyVisible: false },
				{ visible: false, discoveryListed: false },
			),
			"studio_taken_down",
		);
	});

	test("a photo: removed, unpublished, artist hidden, opted out, studio not listed, visible", ({
		assert,
	}) => {
		const shown = { visible: true, discoveryListed: true };
		const live = { hidden: false, takenDown: false };
		assert.equal(artworkDiscoverState(listed, shown, live), "visible");
		assert.equal(
			artworkDiscoverState({ ...listed, publiclyVisible: false }, shown, live),
			"studio_not_listed",
		);
		assert.equal(
			artworkDiscoverState(listed, { ...shown, discoveryListed: false }, live),
			"artist_opted_out",
		);
		assert.equal(
			artworkDiscoverState(listed, { ...shown, visible: false }, live),
			"artist_hidden",
		);
		assert.equal(
			artworkDiscoverState(listed, shown, { ...live, hidden: true }),
			"unpublished",
		);
		assert.equal(
			artworkDiscoverState(listed, shown, { hidden: true, takenDown: true }),
			"removed",
		);
		assert.equal(
			artworkDiscoverState(
				{ takenDown: true, publiclyVisible: false },
				shown,
				live,
			),
			"removed",
		);
	});
});

test.group("Discover listing consent", () => {
	test("a stable version, marked as a draft, worded for each business type", ({
		assert,
	}) => {
		assert.match(LISTING_CONSENT_VERSION, /^[a-z0-9][a-z0-9.-]{0,63}$/);
		for (const type of ["studio", "independent"] as const) {
			const consent = listingConsent(type);
			assert.equal(consent.version, LISTING_CONSENT_VERSION);
			assert.isTrue(consent.draft);
			assert.include(consent.text, "turn the listing off at any time");
			assert.isAbove(consent.shows.length, 2);
		}
		assert.include(listingConsent("studio").text, "studio");
		assert.notInclude(listingConsent("independent").text, "studio");
	});
});

test.group("Discover words for each business type", () => {
	test("an independent artist is never called a studio", ({ assert }) => {
		for (const state of ARTIST_DISCOVER_STATES) {
			assert.notMatch(artistStateText(state, "independent"), /studio/i, state);
			assert.isNotEmpty(artistStateText(state, "studio"));
		}
		for (const words of Object.values(STATUS_WORDS)) {
			assert.notMatch(words.summary("independent"), /studio/i);
		}
		assert.include(STATUS_WORDS.taken_down.summary("studio"), "studio page");
	});
});
