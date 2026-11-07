import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	DiscoverArtistSummary,
	DiscoverStudioSummary,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { createDiscoverClient } from "@tattoo-drip/sdk";
import {
	artistAffiliation,
	artistWork,
	enough,
	HOME_CAPS,
	HOME_THRESHOLDS,
	heroPhotos,
	homeQueries,
	inspirationPhotos,
	pairStylesWithPhotos,
	placesIn,
	tattooAlt,
	tattooCredit,
	tattooDestination,
} from "../src/lib/home.ts";
import { fixtures, STYLES } from "./stub-api.ts";

const data = (count: number) =>
	fixtures(count) as unknown as {
		studios: DiscoverStudioSummary[];
		artists: DiscoverArtistSummary[];
		tattoos: DiscoverTattooSummary[];
	};

describe("the homepage's section rules", () => {
	test("thresholds: the hero collage needs 4 photos, the inspiration grid 6", () => {
		assert.deepEqual(heroPhotos(data(3).tattoos), []);
		assert.equal(heroPhotos(data(4).tattoos).length, 4);
		assert.deepEqual(
			heroPhotos(data(20).tattoos).map((each) => each.id),
			data(20)
				.tattoos.slice(0, 4)
				.map((each) => each.id),
		);
		assert.deepEqual(inspirationPhotos(data(5).tattoos, []), []);
		assert.equal(inspirationPhotos(data(6).tattoos, []).length, 6);
	});

	test("the inspiration grid skips the hero's photos when 6 others remain, else repeats them", () => {
		const twenty = data(20).tattoos;
		const hero = heroPhotos(twenty);
		const grid = inspirationPhotos(twenty, hero);
		assert.equal(grid.length, HOME_CAPS.inspiration);
		assert.ok(grid.every((each) => !hero.includes(each)));
		const eight = data(8).tattoos;
		// 8 photos, 4 in the hero: only 4 others, so the grid shows all 8.
		assert.equal(inspirationPhotos(eight, heroPhotos(eight)).length, 8);
	});

	test("styles pair with a different recent photo each, in the list's order; 3 at least", () => {
		const pairs = pairStylesWithPhotos(STYLES, data(20).tattoos);
		assert.deepEqual(
			pairs.map((pair) => pair.style.slug),
			STYLES.map((style) => style.slug),
		);
		assert.equal(
			new Set(pairs.map((pair) => pair.tattoo.id)).size,
			pairs.length,
		);
		for (const { style, tattoo } of pairs)
			assert.ok(tattoo.styles.some((tag) => tag.slug === style.slug));
		// The newest photo with the style.
		assert.equal(pairs[0]?.tattoo.id, data(20).tattoos[0]?.id);
		// Two styles with a photo are too few.
		assert.deepEqual(pairStylesWithPhotos(STYLES, data(2).tattoos), []);
		assert.equal(pairStylesWithPhotos(STYLES, data(3).tattoos).length, 3);
		// A photo tagged with two styles is used once.
		const [one] = data(1).tattoos;
		const both = {
			...one,
			styles: STYLES.slice(0, 2),
		} as DiscoverTattooSummary;
		assert.equal(
			pairStylesWithPhotos(STYLES, [both, ...data(20).tattoos.slice(1, 3)])
				.length,
			3,
		);
	});

	test("enough: a missing or short list never shows", () => {
		assert.equal(enough(undefined, HOME_THRESHOLDS.studios), false);
		assert.equal(enough([], HOME_THRESHOLDS.studios), false);
		assert.equal(enough([1], HOME_THRESHOLDS.studios), true);
		assert.equal(enough([1], HOME_THRESHOLDS.artists), false);
		assert.equal(enough([1, 2], HOME_THRESHOLDS.locations), true);
	});

	test("a photo links to its artist's page, else its studio's, else nowhere", () => {
		const { tattoos, artists, studios } = data(3);
		const [tattoo] = tattoos;
		assert.ok(tattoo);
		assert.equal(
			tattooDestination(tattoo, artists, studios),
			artists[0]?.storefrontUrl,
		);
		assert.equal(
			tattooDestination(tattoo, [], studios),
			studios.find((each) => each.slug === tattoo.studio.slug)?.storefrontUrl,
		);
		assert.equal(tattooDestination(tattoo, undefined, undefined), undefined);
	});

	test("alt text and credits come from the data", () => {
		const { tattoos, artists } = data(4);
		const [studioWork, , , soloWork] = tattoos;
		assert.ok(studioWork && soloWork);
		assert.equal(
			tattooAlt(studioWork),
			"Blackwork tattoo by Stub Artist 0 at Stub Ink <b>Studio</b>",
		);
		assert.equal(tattooAlt(soloWork), "Traditional tattoo by Stub Artist 3");
		assert.equal(
			tattooAlt({ ...studioWork, styles: [] }),
			"Tattoo by Stub Artist 0 at Stub Ink <b>Studio</b>",
		);
		assert.equal(
			tattooAlt({
				...studioWork,
				image: { ...studioWork.image, alt: " Koi " },
			}),
			"Koi",
		);
		assert.equal(
			tattooCredit(studioWork),
			"Stub Artist 0 · Stub Ink <b>Studio</b>",
		);
		assert.equal(tattooCredit(soloWork), "Stub Artist 3");
		assert.equal(
			artistWork(artists[1] as DiscoverArtistSummary, tattoos)?.id,
			tattoos[1]?.id,
		);
		assert.equal(
			artistAffiliation(artists[0] as DiscoverArtistSummary),
			"at Stub Ink <b>Studio</b> · Pokhara",
		);
		assert.equal(
			artistAffiliation(artists[3] as DiscoverArtistSummary),
			"Independent · New Delhi",
		);
	});

	test("the homepage's reads carry the page's country; styles and places stay global, places filtered in the page", () => {
		const client = createDiscoverClient({ baseUrl: "https://api.example.com" });
		const nepal = homeQueries(client, "NP");
		const india = homeQueries(client, "IN");
		for (const read of ["tattoos", "studios", "artists"] as const) {
			assert.deepEqual(nepal[read].queryKey.at(-1), {
				limit: read === "tattoos" ? 24 : 8,
				country: "NP",
			});
			assert.notDeepEqual(nepal[read].queryKey, india[read].queryKey);
		}
		assert.deepEqual(nepal.styles.queryKey, india.styles.queryKey);
		assert.deepEqual(nepal.locations.queryKey, india.locations.queryKey);
		const places = fixtures(4).locations;
		assert.deepEqual(
			placesIn(places, "IN")?.map((place) => place.slug),
			["new-delhi"],
		);
		assert.equal(placesIn(places, "NP")?.length, 3);
		assert.equal(placesIn(undefined, "NP"), undefined);
	});
});
