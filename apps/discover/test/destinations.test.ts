import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	artistSiteNote,
	PROFILE_PAGES,
	profileDestination,
	profilePath,
} from "../src/lib/destinations.ts";
import { hasRoute } from "../src/lib/routes.ts";

const artist = (studio: string, slug: string, independent = false) => ({
	slug,
	independent,
	studio: { slug: studio },
	storefrontUrl: `https://${studio}.example/artists/${slug}`,
});

describe("profile destinations (D07; D08 flips them)", () => {
	test("today every destination is the storefront page the API names, never a missing route", () => {
		assert.equal(PROFILE_PAGES, false);
		const studio = {
			slug: "black-needle",
			storefrontUrl: "https://black-needle.example/",
		};
		assert.deepEqual(profileDestination(studio), {
			href: "https://black-needle.example/",
			external: true,
			profile: "/studios/black-needle",
		});
		// The planned profile paths are not routes yet.
		assert.equal(hasRoute(profilePath(studio)), false);
		assert.equal(hasRoute(profilePath(artist("a", "maya"))), false);
	});

	test("two artists with the same slug at different studios get different destinations", () => {
		const one = profileDestination(artist("ink-house", "maya"));
		const two = profileDestination(artist("black-needle", "maya"));
		assert.notEqual(one.href, two.href);
		assert.notEqual(one.profile, two.profile);
		assert.equal(one.profile, "/studios/ink-house/artists/maya");
		assert.equal(two.profile, "/studios/black-needle/artists/maya");
		// With D08's pages, the Discover paths differ too.
		assert.notEqual(
			profileDestination(artist("ink-house", "maya"), true).href,
			profileDestination(artist("black-needle", "maya"), true).href,
		);
	});

	test("an independent artist is reached by their business's (tenant's) slug", () => {
		const solo = profileDestination(artist("maya-tattoo", "maya", true));
		assert.equal(solo.profile, "/artists/maya-tattoo");
		assert.equal(solo.href, "https://maya-tattoo.example/artists/maya");
		assert.deepEqual(
			profileDestination(artist("maya-tattoo", "maya", true), true),
			{
				href: "/artists/maya-tattoo",
				external: false,
				profile: "/artists/maya-tattoo",
			},
		);
		// Segments are encoded.
		assert.equal(
			profilePath(artist("a b", "c/d")),
			"/studios/a%20b/artists/c%2Fd",
		);
	});

	test("screen readers hear where an artist's link goes: their own site, or their page on the studio's", () => {
		assert.equal(
			artistSiteNote(artist("ink-house", "maya")),
			"their page on the studio's site",
		);
		assert.equal(
			artistSiteNote(artist("solo-ink", "maya", true)),
			"their own site",
		);
	});
});
