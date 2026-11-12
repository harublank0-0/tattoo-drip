import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	ANGLE_REDIRECT_CACHE,
	artworkCredit,
	artworkRedirect,
	artworkSeo,
	artworkSlug,
	artworkTitle,
	cameFromGallery,
	FROM_GALLERY,
	MAX_ARTWORK_SLUG,
	RELATED_SHOWN,
	readArtworkSlug,
	relatedWork,
} from "../src/lib/artwork.ts";
import { bookingLinks } from "../src/lib/booking.ts";
import { paths } from "../src/lib/routes.ts";

const ID = "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50";

const photo = (over: Record<string, unknown> = {}) =>
	({
		id: ID,
		image: {
			url: "https://media.example/p.jpg",
			width: 1200,
			height: 1500,
			alt: null,
			variants: [],
		},
		styles: [{ slug: "blackwork", name: "Blackwork" }],
		healed: false,
		artist: { id: "a1", slug: "sita", name: "Sita Rai" },
		studio: { slug: "black-needle", name: "Black Needle", type: "studio" },
		location: {
			country: "NP",
			slug: "kathmandu",
			name: "Kathmandu",
			region: "Bagmati",
		},
		artistAcceptingInquiries: true,
		storefrontUrl: `https://black-needle.example/gallery/${ID}`,
		bookingUrl: `https://black-needle.example/book?artwork=${ID}&ref=a.b`,
		...over,
	}) as never;

describe("artwork slugs (D09)", () => {
	test("the canonical slug is the id in lower case; its address encodes it", () => {
		assert.equal(artworkSlug(ID.toUpperCase()), ID);
		assert.equal(paths.tattoo(ID.toUpperCase()), `/tattoos/${ID}`);
		assert.deepEqual(readArtworkSlug(ID), { id: ID, canonical: true });
	});

	test("another spelling resolves by the id part only, and isn't canonical", () => {
		assert.deepEqual(readArtworkSlug(ID.toUpperCase()), {
			id: ID,
			canonical: false,
		});
		assert.deepEqual(readArtworkSlug(`koi-sleeve-${ID}`), {
			id: ID,
			canonical: false,
		});
	});

	test("no id, a bad readable part or too long: not an artwork address", () => {
		for (const slug of [
			"koi-sleeve",
			"nope",
			"",
			`${ID}-koi`,
			`koi_sleeve-${ID}`,
			`koi--${ID}x`,
			`-${ID}x`,
			`${"a".repeat(MAX_ARTWORK_SLUG)}-${ID}`,
			ID.slice(1),
			undefined,
			42,
		])
			assert.equal(readArtworkSlug(slug), undefined, String(slug));
	});
});

describe("artwork words and SEO (D09)", () => {
	test("the title is the studio's own text, else built from the data", () => {
		assert.equal(artworkTitle(photo()), "Blackwork tattoo by Sita Rai");
		assert.equal(artworkTitle(photo({ styles: [] })), "Tattoo by Sita Rai");
		assert.equal(
			artworkTitle(
				photo({
					image: {
						url: "https://media.example/p.jpg",
						width: 1,
						height: 1,
						alt: "  Koi on the forearm ",
						variants: [],
					},
				}),
			),
			"Koi on the forearm",
		);
		assert.equal(artworkCredit(photo()), "Sita Rai at Black Needle");
		assert.equal(
			artworkCredit(
				photo({ studio: { slug: "asha", name: "Asha", type: "independent" } }),
			),
			"Sita Rai",
		);
	});

	test("title, description and the social card come from the answer", () => {
		const seo = artworkSeo(photo());
		assert.equal(
			seo.title,
			"Blackwork tattoo by Sita Rai at Black Needle, Kathmandu",
		);
		assert.match(seo.description, /in Kathmandu, Nepal\./);
		assert.match(seo.description, /request a similar tattoo/);
		assert.ok(seo.description.length <= 155);
		assert.equal(seo.image.url, "https://media.example/p.jpg");
		assert.equal(seo.image.alt, "Blackwork tattoo by Sita Rai at Black Needle");
		assert.ok(seo.image.width > 0 && seo.image.height > 0);
		const nowhere = artworkSeo(photo({ location: null }));
		assert.equal(nowhere.title, "Blackwork tattoo by Sita Rai at Black Needle");
		// D10: the studio's own words first, cut at a word; whole parts dropped
		// (place, then studio) when long, never the artist.
		const own = artworkSeo(
			photo({
				image: {
					url: "https://media.example/p.jpg",
					width: 1200,
					height: 1500,
					alt: "A very detailed koi swimming up the forearm through waves and maple leaves",
					variants: [],
				},
			}),
		);
		assert.match(
			own.title,
			/^A very detailed koi swimming up the forearm[^ ]*… — tattoo by Sita Rai$/,
		);
		assert.ok(own.title.length <= 70, own.title);
	});
});

describe("related work (D09)", () => {
	const t = (id: string) => ({ id });
	test("never the current photo, never twice, the artist's first, bounded", () => {
		const related = relatedWork(
			"x",
			[t("x"), t("a"), t("b")],
			[t("b"), t("x"), t("c"), t("a"), t("d")],
		);
		assert.deepEqual(
			related.byArtist.map((each) => each.id),
			["a", "b"],
		);
		assert.deepEqual(
			related.byStyle.map((each) => each.id),
			["c", "d"],
		);
		const many = Array.from({ length: 20 }, (_, n) => t(`p${n}`));
		const capped = relatedWork("p0", many, many);
		assert.equal(capped.byArtist.length, RELATED_SHOWN);
		assert.ok(!capped.byArtist.some((each) => each.id === "p0"));
		assert.equal(capped.byStyle.length, RELATED_SHOWN);
		assert.ok(
			!capped.byStyle.some((each) =>
				capped.byArtist.some((other) => other.id === each.id),
			),
		);
		assert.deepEqual(relatedWork("x"), { byArtist: [], byStyle: [] });
	});

	test("the gallery's mark in the history entry", () => {
		assert.equal(cameFromGallery(FROM_GALLERY), true);
		assert.equal(cameFromGallery({ fromGallery: "yes" }), false);
		assert.equal(cameFromGallery(null), false);
		assert.equal(cameFromGallery(undefined), false);
	});
});

describe("the artwork's booking link (D09)", () => {
	test("keeps the photo's own `artwork` and `ref`, rebuilt from checked parts", () => {
		const { request, site } = bookingLinks(photo(), undefined, ID);
		assert.equal(
			request,
			`https://black-needle.example/book?artwork=${ID}&ref=a.b`,
		);
		assert.equal(site, `https://black-needle.example/gallery/${ID}`);
	});

	test("another photo's id, flash or stray parameters never survive", () => {
		const other = "11111111-2222-4333-8444-555555555555";
		assert.equal(
			bookingLinks(
				photo({
					bookingUrl: `https://black-needle.example/book?artwork=${other}&flash=${other}&utm_source=x&ref=a.b`,
				}),
				undefined,
				ID,
			).request,
			"https://black-needle.example/book?ref=a.b",
		);
		// A profile's link (no artwork asked for) never gains one.
		assert.equal(
			bookingLinks(photo()).request,
			"https://black-needle.example/book?ref=a.b",
		);
		// An upper-case id isn't the storefront's shape.
		assert.equal(
			bookingLinks(
				photo({
					bookingUrl: `https://black-needle.example/book?artwork=${ID.toUpperCase()}&ref=a.b`,
				}),
				undefined,
				ID.toUpperCase(),
			).request,
			"https://black-needle.example/book?ref=a.b",
		);
	});

	test("another host or path: no booking link at all", () => {
		assert.equal(
			bookingLinks(
				photo({ bookingUrl: `https://evil.example/book?artwork=${ID}` }),
				undefined,
				ID,
			).request,
			null,
		);
		assert.equal(
			bookingLinks(
				photo({
					bookingUrl: `https://black-needle.example/gallery?artwork=${ID}`,
				}),
				undefined,
				ID,
			).request,
			null,
		);
	});
});

describe("artworkRedirect (angles)", () => {
	const LEAD = "1c7f9e3d-7b5b-4f2f-8b62-2c1d3e4f5a61";

	test("the canonical address of the photo the API answered with is shown as it is", () => {
		assert.equal(artworkRedirect({ id: ID, canonical: true }, ID), null);
	});

	test("another spelling of the same id is a permanent 301 to the canonical one", () => {
		assert.deepEqual(artworkRedirect({ id: ID, canonical: false }, ID), {
			href: `/tattoos/${ID}`,
			statusCode: 301,
		});
	});

	test("one of a tattoo's other photos is a temporary 302 to the tattoo, cached a minute only, whatever its spelling", () => {
		for (const canonical of [true, false]) {
			assert.deepEqual(artworkRedirect({ id: ID, canonical }, LEAD), {
				href: `/tattoos/${LEAD}`,
				statusCode: 302,
				headers: { "Cache-Control": "public, max-age=60" },
			});
		}
		assert.equal(ANGLE_REDIRECT_CACHE, "public, max-age=60");
	});
});
