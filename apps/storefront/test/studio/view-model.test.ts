import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import {
	ARTIST_SLUG,
	artistViewModels,
	findArtist,
	MAX_WORK_PHOTOS,
	socialContactLinks,
	studioViewModel,
	workPhotoViews,
} from "../../src/studio/view-model.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	SITA,
	SITA_PHOTO_URL,
	SITA_SIZED,
	SITA_SRCSET,
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
			requestHref: "/request?artist=sita",
			workPhotos: [],
			styles: ["Fine line"],
			links: [
				{
					kind: "instagram",
					label: "Instagram",
					href: "https://instagram.com/sita.ink",
				},
			],
		});
		assert.equal(arjun.name, "अर्जुन थापा");
		assert.equal(arjun.photo, null);
		assert.equal(arjun.accepting, false);
		assert.equal(arjun.closedMessage, "Books open in March.");
	});

	test("a photo with copies gets a checked srcset; one without gets none (TAT-112)", () => {
		const [sized] = artistViewModels([SITA_SIZED]);
		assert.equal(sized.photo?.srcSet, SITA_SRCSET);
		assert.equal(sized.photo?.src, SITA_PHOTO_URL);

		const [plain] = artistViewModels([SITA]);
		assert.ok(plain.photo);
		assert.equal("srcSet" in plain.photo, false);
	});

	test("a copy on another origin is dropped and the photo stays (TAT-112)", () => {
		const [view] = artistViewModels([
			{
				...SITA_SIZED,
				photo: {
					...SITA_SIZED.photo,
					variants: [
						{ url: "https://evil.example/sita.320w.jpg", width: 320 },
						...(SITA_SIZED.photo?.variants ?? []).slice(1),
					],
				} as NonNullable<typeof SITA_SIZED.photo>,
			},
		]);

		assert.ok(view.photo);
		assert.equal(
			view.photo.srcSet,
			`${SITA_SIZED.photo?.variants[1].url} 640w, ${SITA_PHOTO_URL} 1200w`,
		);
		assert.ok(!view.photo.srcSet?.includes("evil.example"));
	});

	test("a photo whose variants are not a list, or all hostile, keeps only its src (TAT-112)", () => {
		for (const variants of [undefined, null, "320w", {}, [null], [{}]]) {
			const [view] = artistViewModels([
				{
					...SITA,
					photo: { ...SITA.photo, variants } as unknown as NonNullable<
						typeof SITA.photo
					>,
				},
			]);
			assert.ok(view.photo, JSON.stringify(variants));
			assert.equal("srcSet" in view.photo, false, JSON.stringify(variants));
		}
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

describe("an artist's styles and links", () => {
	/** An API response that sends whatever these two keys hold (a hostile or older API can send what the contract does not allow). */
	const withKeys = (keys: Record<string, unknown>) =>
		({ ...SITA, ...keys }) as unknown as Artist;
	const view = (artist: Artist) => artistViewModels([artist])[0];

	test("an artist's styles are their names, in the API's order", () => {
		assert.deepEqual(view(SITA).styles, ["Fine line"]);
		assert.deepEqual(
			view(
				withKeys({
					styles: [
						{ slug: "japanese", name: "Japanese" },
						{ slug: "blackwork", name: "Blackwork" },
					],
				}),
			).styles,
			["Japanese", "Blackwork"],
		);
		assert.deepEqual(view(ARJUN).styles, []);
	});

	test("a style name is one line of plain text, and at most five are kept", () => {
		const named = (name: unknown) => ({ slug: "x", name });
		assert.deepEqual(
			view(
				withKeys({
					styles: [
						named("  Fine \n line  "),
						named("A"),
						named("B"),
						named("C"),
						named("D"),
						named("E"),
					],
				}),
			).styles,
			["Fine line", "A", "B", "C", "D"],
		);
	});

	test("an artist's links are the safe ones, labelled like the studio's", () => {
		assert.deepEqual(view(SITA).links, [
			{
				kind: "instagram",
				label: "Instagram",
				href: "https://instagram.com/sita.ink",
			},
		]);
		assert.deepEqual(
			view(
				withKeys({
					socialLinks: [
						{ platform: "instagram", url: "javascript:alert(1)" },
						{ platform: "facebook", url: "http://facebook.com/sita" },
						{ platform: "tiktok", url: "https://www.tiktok.com/@sita" },
					],
				}),
			).links,
			[
				{
					kind: "tiktok",
					label: "TikTok",
					href: "https://www.tiktok.com/@sita",
				},
			],
		);
		assert.deepEqual(view(ARJUN).links, []);
	});

	test("an older API without styles or socialLinks means none", () => {
		const older: Record<string, unknown> = { ...SITA };
		delete older.styles;
		delete older.socialLinks;
		for (const artist of [
			older,
			{ ...SITA, styles: "x", socialLinks: {} },
			{ ...SITA, styles: null, socialLinks: null },
			{ ...SITA, styles: { length: 1, 0: { name: "x" } }, socialLinks: 7 },
		]) {
			const shown = view(artist as unknown as Artist);
			assert.deepEqual(shown.styles, []);
			assert.deepEqual(shown.links, []);
		}
	});

	test("a style or link that is malformed is dropped and the rest stay", () => {
		const shown = view(
			withKeys({
				styles: [
					null,
					"Fine line",
					{ slug: "no-name" },
					{ slug: "x", name: 7 },
					{ slug: "x", name: "   " },
					{ slug: "japanese", name: "Japanese" },
				],
				socialLinks: [
					null,
					"https://instagram.com/a",
					{ platform: "instagram" },
					{ platform: "instagram", url: 7 },
					{ platform: "instagram", url: "https://instagram.com/sita.ink" },
				],
			}),
		);
		assert.deepEqual(shown.styles, ["Japanese"]);
		assert.deepEqual(
			shown.links.map((link) => link.href),
			["https://instagram.com/sita.ink"],
		);
	});
});

describe("socialContactLinks", () => {
	test("names the known platforms, labels an unknown one by its host and drops what is not https", () => {
		assert.deepEqual(
			socialContactLinks([
				{ platform: "instagram", url: "https://instagram.com/a" },
				{ platform: "youtube", url: "https://www.youtube.com/@a" },
				{ platform: "constructor", url: "https://example.org/x" },
				{ platform: "facebook", url: "http://facebook.com/a" },
			]),
			[
				{
					kind: "instagram",
					label: "Instagram",
					href: "https://instagram.com/a",
				},
				{
					kind: "other",
					label: "youtube.com",
					href: "https://www.youtube.com/@a",
				},
				{ kind: "other", label: "example.org", href: "https://example.org/x" },
			],
		);
	});

	test("anything but a list is none", () => {
		for (const value of [undefined, null, "x", 7, {}, { length: 1, 0: {} }]) {
			assert.deepEqual(socialContactLinks(value), []);
		}
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

describe("workPhotoViews (TAT-116)", () => {
	const ORIGIN = "https://api.example.com";
	const work = (n: number, over: Record<string, unknown> = {}) => ({
		url: `${ORIGIN}/uploads/tenants/t/artist_work_photo/w${n}.320-640-1280.jpg`,
		width: 2048,
		height: 1536,
		alt: null,
		variants: [320, 640, 1280].map((width) => ({
			url: `${ORIGIN}/uploads/tenants/t/artist_work_photo/w${n}.${width}w.jpg`,
			width,
		})),
		...over,
	});

	test("keeps at most six of nine, in the API's order", () => {
		const views = workPhotoViews(
			Array.from({ length: 9 }, (_, n) => work(n)),
			"Sita Rai",
			ORIGIN,
		);
		assert.equal(MAX_WORK_PHOTOS, 6);
		assert.equal(views.length, 6);
		assert.deepEqual(
			views.map((view) => view.src),
			Array.from({ length: 6 }, (_, n) => work(n).url),
		);
	});

	test("a photo has its checked srcset, the viewer's 1280 copy, its place and the dialog's id", () => {
		const [first, second] = workPhotoViews(
			[work(0), work(1, { alt: "Koi on the forearm" })],
			"Sita Rai",
			ORIGIN,
		);
		assert.equal(first.width, 2048);
		assert.equal(first.height, 1536);
		assert.match(
			first.srcSet ?? "",
			/w0\.320w\.jpg 320w, .*w0\.1280w\.jpg 1280w, .*w0\.320-640-1280\.jpg 2048w$/,
		);
		assert.equal(
			first.largeSrc,
			`${ORIGIN}/uploads/tenants/t/artist_work_photo/w0.1280w.jpg`,
		);
		assert.equal(first.dialogId, "work-photo-1");
		assert.equal(first.label, "Photo 1 of 2");
		assert.equal(second.dialogId, "work-photo-2");
		assert.equal(second.label, "Photo 2 of 2");
	});

	test("the description is the alt and the caption; without one the alt is built from the name and place", () => {
		const [described, plain] = workPhotoViews(
			[work(0, { alt: "  Koi on the forearm  " }), work(1)],
			"Sita Rai",
			ORIGIN,
		);
		assert.equal(described.alt, "Koi on the forearm");
		assert.equal(described.caption, "Koi on the forearm");
		assert.equal(plain.alt, "Tattoo by Sita Rai, photo 2 of 2");
		assert.equal(plain.caption, null);
		const [devanagari] = workPhotoViews([work(0)], "अर्जुन थापा", ORIGIN);
		assert.equal(devanagari.alt, "Tattoo by अर्जुन थापा, photo 1 of 1");
	});

	test("a description is cleaned to one line of plain text; one that is too long, blank or not text is the fallback", () => {
		const FALLBACK = "Tattoo by Sita Rai, photo 1 of 1";
		const cases: [unknown, string][] = [
			['"><script>alert(1)</script>', '"><script>alert(1)</script>'],
			["two\nlines", "two lines"],
			["a\r\n\r\nb", "a b"],
			["  Koi  ", "Koi"],
			["क".repeat(200), "क".repeat(200)],
			["x".repeat(201), FALLBACK],
			["   ", FALLBACK],
			["\u0000\u2028", FALLBACK],
			[7, FALLBACK],
			[{ not: "text" }, FALLBACK],
			[null, FALLBACK],
		];
		for (const [alt, expected] of cases) {
			const [view] = workPhotoViews([work(0, { alt })], "Sita Rai", ORIGIN);
			assert.equal(view.alt, expected, String(alt));
			assert.equal(view.caption, expected === FALLBACK ? null : expected);
			assert.doesNotMatch(view.alt, /[\p{Cc}\p{Zl}\p{Zp}]/u);
		}
	});

	test("an item off the API's origin, with sides out of range or not an image at all is dropped; the rest renumber", () => {
		const views = workPhotoViews(
			[
				work(0, { url: "https://evil.example/w.jpg" }),
				work(1, { width: 0 }),
				work(2, { height: 10001 }),
				work(3, { url: "javascript:alert(1)" }),
				"nonsense",
				work(4),
			],
			"Sita Rai",
			ORIGIN,
		);
		assert.equal(views.length, 1);
		assert.equal(views[0].label, "Photo 1 of 1");
		assert.equal(views[0].alt, "Tattoo by Sita Rai, photo 1 of 1");
	});

	test("a copy off the origin is dropped and the photo stays", () => {
		const [view] = workPhotoViews(
			[
				work(0, {
					variants: [
						{ url: "https://evil.example/w.320w.jpg", width: 320 },
						{ url: `${ORIGIN}/w.640w.jpg`, width: 640 },
					],
				}),
			],
			"Sita Rai",
			ORIGIN,
		);
		assert.equal(
			view.srcSet,
			`${ORIGIN}/w.640w.jpg 640w, ${work(0).url} 2048w`,
		);
		assert.equal(view.largeSrc, `${ORIGIN}/w.640w.jpg`);
	});

	test("not a list, undefined (an older API) or no origin gives none", () => {
		for (const value of [undefined, null, "x", 7, {}, { length: 2 }]) {
			assert.deepEqual(workPhotoViews(value, "Sita Rai", ORIGIN), []);
		}
		assert.deepEqual(workPhotoViews([work(0)], "Sita Rai", null), []);
	});

	test("artistViewModels passes the origin through, and leaves the work out without one", () => {
		const sita = { ...SITA, workPhotos: [work(0), work(1)] };
		const [withOrigin] = artistViewModels([sita], ORIGIN);
		const [without] = artistViewModels([sita]);
		assert.equal(withOrigin.workPhotos.length, 2);
		assert.deepEqual(without.workPhotos, []);
		// Their alt names the artist as the page shows the name.
		assert.equal(
			withOrigin.workPhotos[0].alt,
			"Tattoo by Sita Rai, photo 1 of 2",
		);
	});
});
