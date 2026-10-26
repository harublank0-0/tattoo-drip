import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Studio } from "@tattoo-drip/sdk";
import {
	ARTIST_SLUG,
	artistViewModels,
	findArtist,
	studioViewModel,
} from "../../src/studio/view-model.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	SITA,
	SITA_PHOTO_URL,
	STUDIO,
} from "./fixtures.ts";

describe("studioViewModel", () => {
	test("shows the profile as the page needs it", () => {
		const view = studioViewModel(STUDIO);

		assert.equal(view.slug, "black-needle-48");
		assert.equal(view.name, "Black Needle");
		assert.equal(view.type, "studio");
		assert.equal(view.typeLabel, "Tattoo studio");
		assert.equal(
			view.intro,
			"Fine line and blackwork in Thamel.\nWalk-ins on Sundays.",
		);
		assert.equal(view.accepting, true);
		assert.equal(view.phone, "+9779812345678");
		assert.equal(view.email, "hello@black-needle.example");
		assert.deepEqual(view.address, {
			text: "Thamel Marg\nKathmandu",
			mapsHref:
				"https://www.google.com/maps/search/?api=1&query=Black%20Needle%2C%20Thamel%20Marg%2C%20Kathmandu",
		});
		assert.deepEqual(view.socialUrls, [
			"https://instagram.com/blackneedle",
			"https://facebook.com/blackneedle",
			"https://www.tiktok.com/@blackneedle",
			"https://black-needle.example/",
		]);
	});

	test("orders the links: Instagram, then ways to reach the studio, then other places", () => {
		assert.deepEqual(
			studioViewModel(STUDIO).links.map((link) => [link.label, link.href]),
			[
				["Instagram", "https://instagram.com/blackneedle"],
				["WhatsApp", "https://wa.me/9779812345678"],
				["Viber", "viber://chat?number=%2B9779812345678"],
				["Call", "tel:+9779812345678"],
				["Email", "mailto:hello@black-needle.example"],
				["Facebook", "https://facebook.com/blackneedle"],
				["TikTok", "https://www.tiktok.com/@blackneedle"],
				["Website", "https://black-needle.example/"],
			],
		);
	});

	test("an unknown platform is a plain link named by its host, after the known ones", () => {
		const view = studioViewModel({
			...STUDIO,
			socialLinks: [
				{ platform: "youtube", url: "https://www.youtube.com/@blackneedle" },
				{ platform: "constructor", url: "https://example.org/x" },
				...STUDIO.socialLinks,
			],
		});
		const labels = view.links.map((link) => link.label);

		assert.equal(labels[0], "Instagram");
		assert.deepEqual(labels.slice(-2), ["youtube.com", "example.org"]);
		assert.deepEqual(
			view.links.slice(-2).map((link) => link.kind),
			["other", "other"],
		);
	});

	test("drops links and contacts that aren't safe", () => {
		const view = studioViewModel({
			...STUDIO,
			contact: { phone: "9812345678", email: "not an email", address: "  " },
			socialLinks: [
				{ platform: "instagram", url: "javascript:alert(1)" },
				{ platform: "facebook", url: "http://facebook.com/blackneedle" },
				{ platform: "website", url: " https://black-needle.example" },
				{ platform: "tiktok", url: "data:text/html,hi" },
			],
		});

		assert.deepEqual(view.links, []);
		assert.deepEqual(view.socialUrls, []);
		assert.equal(view.phone, null);
		assert.equal(view.email, null);
		assert.equal(view.address, null);
	});

	test("an empty profile has no intro, links, address or location", () => {
		const view = studioViewModel(EMPTY_STUDIO);

		assert.equal(view.intro, null);
		assert.deepEqual(view.links, []);
		assert.equal(view.address, null);
		assert.equal(view.location, null);
	});

	test("the hero's location line is the address on one line (TAT-105)", () => {
		assert.equal(studioViewModel(STUDIO).location, "Thamel Marg, Kathmandu");
		assert.equal(
			studioViewModel({
				...STUDIO,
				contact: { ...STUDIO.contact, address: "ठमेल\nकाठमाडौं" },
			}).location,
			"ठमेल, काठमाडौं",
		);
		// A hostile address is still plain text with its bidi controls gone.
		assert.equal(
			studioViewModel({
				...STUDIO,
				contact: { ...STUDIO.contact, address: "Thamel \u202eMarg\nKathmandu" },
			}).location,
			"Thamel Marg, Kathmandu",
		);
	});

	test("says what kind of tenant it is and whether it takes inquiries", () => {
		assert.equal(
			studioViewModel({ ...STUDIO, type: "independent" }).typeLabel,
			"Independent tattoo artist",
		);
		assert.equal(studioViewModel(CLOSED_STUDIO).accepting, false);
	});

	test("an unknown tenant type is a studio, even one named like an object's own key", () => {
		// A lookup that trusts the enum would return Object.prototype's members,
		// and React can't render a function or an object as text.
		for (const type of [
			"constructor",
			"__proto__",
			"toString",
			"hasOwnProperty",
			"something-new",
		]) {
			const view = studioViewModel({ ...STUDIO, type } as unknown as Studio);
			assert.equal(view.typeLabel, "Tattoo studio", type);
			assert.equal(typeof view.typeLabel, "string", type);
		}
	});
});

describe("artistViewModels", () => {
	test("shows each visible artist", () => {
		const [sita, arjun] = artistViewModels([SITA, ARJUN]);

		assert.deepEqual(sita, {
			id: SITA.id,
			slug: "sita",
			name: "Sita Rai",
			bio: "Fine line florals.\nBooks a month ahead.",
			photo: {
				src: SITA_PHOTO_URL,
				width: 1200,
				height: 1500,
				alt: "Photo of Sita Rai",
			},
			accepting: true,
			closedMessage: null,
			pageHref: "/artists/sita",
			inquiryHref: "/artists/sita#inquiry",
		});
		assert.equal(arjun.name, "अर्जुन थापा");
		assert.equal(arjun.photo, null);
		assert.equal(arjun.accepting, false);
		assert.equal(arjun.closedMessage, "Books open in March.");
	});

	test("a closed message never shows while the artist accepts", () => {
		const [view] = artistViewModels([
			{ ...SITA, closedMessage: "Old message." },
		]);
		assert.equal(view.closedMessage, null);
	});

	test("drops photos that aren't web images or have no real size", () => {
		for (const photo of [
			{ url: "javascript:alert(1)", width: 10, height: 10, variants: [] },
			{
				url: "data:image/png;base64,AAAA",
				width: 10,
				height: 10,
				variants: [],
			},
			{
				url: "https://api.example.com/p.jpg",
				width: 0,
				height: 10,
				variants: [],
			},
			{
				url: "https://api.example.com/p.jpg",
				width: 10.5,
				height: 10,
				variants: [],
			},
		]) {
			const [view] = artistViewModels([{ ...SITA, photo }]);
			assert.equal(view.photo, null, JSON.stringify(photo));
		}
		const [local] = artistViewModels([
			{
				...SITA,
				photo: {
					url: "http://localhost:3333/uploads/p.jpg",
					width: 10,
					height: 10,
					variants: [],
				},
			},
		]);
		assert.equal(local.photo?.src, "http://localhost:3333/uploads/p.jpg");
	});

	test("leaves out an artist whose slug can't be a link", () => {
		assert.deepEqual(
			artistViewModels([
				{ ...SITA, slug: "../admin" },
				{ ...SITA, slug: "Sita" },
				ARJUN,
			]).map((artist) => artist.slug),
			["arjun"],
		);
	});
});

describe("findArtist", () => {
	const artists = artistViewModels([SITA, ARJUN]);

	test("finds an artist by exact slug", () => {
		assert.equal(findArtist(artists, "sita")?.name, "Sita Rai");
	});

	test("finds nothing for any other slug", () => {
		for (const slug of [
			"Sita",
			"sita ",
			"sita%20",
			"-sita",
			"s",
			"x".repeat(64),
			"nobody",
			"",
		]) {
			assert.equal(findArtist(artists, slug), null, JSON.stringify(slug));
		}
	});
});

describe("ARTIST_SLUG", () => {
	test("is the contract's ArtistSlug pattern (packages/types/openapi.yaml)", () => {
		const yaml = readFileSync(
			new URL("../../../../packages/types/openapi.yaml", import.meta.url),
			"utf8",
		);
		const match = /ArtistSlug:[\s\S]*?pattern: "([^"]+)"/.exec(yaml);

		assert.ok(match, "ArtistSlug has a pattern in openapi.yaml");
		assert.equal(ARTIST_SLUG.source, match[1]);
		assert.equal(ARTIST_SLUG.flags, "");
	});
});
