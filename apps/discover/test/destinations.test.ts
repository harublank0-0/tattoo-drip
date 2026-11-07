import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	artistSiteNote,
	PROFILE_PAGES,
	profileDestination,
	profilePath,
	tattooProfile,
} from "../src/lib/destinations.ts";
import { hasRoute } from "../src/lib/routes.ts";

const artist = (studio: string, slug: string, independent = false) => ({
	slug,
	independent,
	studio: { slug: studio },
	storefrontUrl: `https://${studio}.example/artists/${slug}`,
});

describe("profile destinations (D07; flipped in D08)", () => {
	test("every destination is Discover's own profile, a route that exists", () => {
		assert.equal(PROFILE_PAGES, true);
		const studio = {
			slug: "black-needle",
			storefrontUrl: "https://black-needle.example/",
		};
		assert.deepEqual(profileDestination(studio), {
			href: "/studios/black-needle",
			external: false,
			profile: "/studios/black-needle",
		});
		assert.ok(hasRoute(profilePath(studio)));
		assert.ok(hasRoute(profilePath(artist("a", "maya"))));
		assert.ok(hasRoute(profilePath(artist("a", "maya", true))));
		// Off (D07's behaviour): the storefront page the API names.
		assert.deepEqual(profileDestination(studio, false), {
			href: "https://black-needle.example/",
			external: true,
			profile: "/studios/black-needle",
		});
	});

	test("a photo leads to its artist's profile from its own data", () => {
		const photo = (type: "studio" | "independent") => ({
			artist: { slug: "maya" },
			studio: { slug: "ink-house", type },
		});
		assert.equal(
			tattooProfile(photo("studio")),
			"/studios/ink-house/artists/maya",
		);
		assert.equal(tattooProfile(photo("independent")), "/artists/ink-house");
		assert.equal(tattooProfile(photo("studio"), false), undefined);
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
		assert.equal(solo.href, "/artists/maya-tattoo");
		assert.equal(
			profileDestination(artist("maya-tattoo", "maya", true), false).href,
			"https://maya-tattoo.example/artists/maya",
		);
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
