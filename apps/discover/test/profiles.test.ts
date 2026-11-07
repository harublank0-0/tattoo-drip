import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	nearbyLinks,
	placeLine,
	readArtistSlug,
	readTenantSlug,
	summary,
} from "../src/lib/profiles.ts";

const KATHMANDU = {
	country: "NP",
	slug: "kathmandu",
	name: "Kathmandu",
	region: "Bagmati",
};

describe("profile rules (D08)", () => {
	test("slugs are read as the API checks them, before any request", () => {
		assert.equal(readTenantSlug("black-needle"), "black-needle");
		for (const bad of [
			"ab",
			"Black",
			"-ink",
			"ink-",
			"a b",
			"x".repeat(64),
			undefined,
		])
			assert.equal(readTenantSlug(bad), undefined, String(bad));
		assert.equal(readArtistSlug("ab"), "ab");
		assert.equal(readArtistSlug("a"), undefined);
		assert.equal(readArtistSlug("Maya"), undefined);
	});

	test("the location is the profile's own, never the visitor's", () => {
		assert.equal(placeLine(KATHMANDU), "Kathmandu, Nepal");
		assert.equal(placeLine(KATHMANDU, true), "Kathmandu, Bagmati, Nepal");
		assert.equal(placeLine(null), null);
		// A market: its location pages; elsewhere: the directory for that place.
		assert.deepEqual(
			nearbyLinks(KATHMANDU, ["NP", "IN"], "studios").map((link) => link.to),
			["/locations/nepal/kathmandu", "/locations/nepal"],
		);
		assert.deepEqual(
			nearbyLinks(
				{ country: "US", slug: "austin", name: "Austin", region: null },
				["NP"],
				"artists",
			),
			[
				{
					key: "city",
					to: "/explore/artists",
					search: { country: "US", city: "austin" },
					text: "More artists in Austin",
				},
			],
		);
		assert.deepEqual(nearbyLinks(null, ["NP"], "studios"), []);
	});

	test("descriptions are cut at a word", () => {
		assert.equal(summary("  Fine\n lines.  "), "Fine lines.");
		const long = summary("word ".repeat(60));
		assert.ok(long.length <= 155);
		assert.match(long, /word…$/);
		assert.equal(summary(null), "");
	});
});
