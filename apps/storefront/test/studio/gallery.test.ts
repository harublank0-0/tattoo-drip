import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultStringifySearch } from "@tanstack/react-router";
import {
	EMPTY_GALLERY,
	galleryView,
	healedAsOne,
	MAX_GALLERY_PAGE,
	RECENT_WORK_COUNT,
	readPortfolioSearch,
	readWorkSearch,
	WORK_PAGE_SIZE,
	workQuery,
} from "../../src/studio/gallery.ts";
import {
	isAllowedHref,
	portfolioHref,
	workHref,
} from "../../src/studio/links.ts";
import { galleryPage } from "./fixtures.ts";
import { IMAGE_ORIGIN } from "./theme-fixtures.ts";

/** A page whose first photo is changed by `change`. */
const withFirst = (change: Record<string, unknown>) => {
	const page = galleryPage(2);
	return { ...page, data: [{ ...page.data[0], ...change }, page.data[1]] };
};

describe("galleryView: a page becomes photos (TAT-126)", () => {
	test("a page becomes photos with the artist, style names and the healed mark", () => {
		const view = galleryView(galleryPage(3), IMAGE_ORIGIN);
		const [first, second] = view.photos;

		assert.equal(view.photos.length, 3);
		assert.deepEqual(first.artist, { name: "Sita Rai", href: "/artists/sita" });
		assert.deepEqual(first.styles, ["Fine line"]);
		assert.equal(first.healed, true);
		assert.equal(first.alt, "Tattoo by Sita Rai, photo 1");
		assert.equal(first.caption, null);
		assert.equal(first.label, "Photo 1");
		assert.equal(first.dialogId, "work-photo-1");
		assert.equal(first.openId, "work-open-1");
		assert.match(first.srcSet ?? "", /w1\.320w\.jpg 320w/);
		assert.match(first.largeSrc, /w1\.1280w\.jpg$/);
		assert.deepEqual(second.styles, []);
		assert.equal(second.healed, false);
		assert.equal(second.alt, "Tattoo by Sita Rai, photo 2");
		assert.equal(second.dialogId, "work-photo-2");
		assert.deepEqual(view.styles, [{ slug: "fine-line", name: "Fine line" }]);
		assert.equal(view.healed, true);
		assert.equal(view.nextCursor, null);
	});

	test("the studio's description is the alt and the caption", () => {
		const view = galleryView(
			withFirst({ alt: "Koi on the forearm" }),
			IMAGE_ORIGIN,
		);

		assert.equal(view.photos[0].alt, "Koi on the forearm");
		assert.equal(view.photos[0].caption, "Koi on the forearm");
		assert.equal(view.photos[1].caption, null);
	});

	test("an offset continues the numbering", () => {
		const photos = galleryView(galleryPage(2), IMAGE_ORIGIN, 24).photos;

		assert.equal(photos[0].dialogId, "work-photo-25");
		assert.equal(photos[0].openId, "work-open-25");
		assert.equal(photos[0].label, "Photo 25");
		assert.equal(photos[0].alt, "Tattoo by Sita Rai, photo 25");
		assert.equal(photos[1].dialogId, "work-photo-26");
	});

	test("the next cursor is kept only when it is a cursor", () => {
		const page = galleryPage(1);
		const cursor = (value: unknown) =>
			galleryView({ ...page, nextCursor: value }, IMAGE_ORIGIN).nextCursor;

		assert.equal(cursor("abc_-XYZ019"), "abc_-XYZ019");
		assert.equal(cursor("a".repeat(200)), "a".repeat(200));
		for (const bad of ["a b", "", "a".repeat(201), "a/b", "a=", 5, null, {}]) {
			assert.equal(cursor(bad), null, JSON.stringify(bad));
		}
	});

	test("an older or broken answer is an empty gallery", () => {
		for (const broken of [undefined, null, "x", 5, [], {}, { data: "x" }]) {
			assert.deepEqual(
				galleryView(broken, IMAGE_ORIGIN),
				EMPTY_GALLERY,
				JSON.stringify(broken),
			);
		}
		assert.deepEqual(EMPTY_GALLERY, {
			photos: [],
			nextCursor: null,
			styles: [],
			healed: false,
		});
	});

	test("a page without filters has none to offer", () => {
		const { filters: _gone, ...older } = galleryPage(2);
		const view = galleryView(older, IMAGE_ORIGIN);

		assert.equal(view.photos.length, 2);
		assert.deepEqual(view.styles, []);
		assert.equal(view.healed, false);
		for (const filters of [null, "x", [], { styles: "x", healed: "yes" }]) {
			const odd = galleryView({ ...older, filters }, IMAGE_ORIGIN);
			assert.deepEqual(odd.styles, []);
			assert.equal(odd.healed, false);
		}
	});

	test("the filters' styles are checked: a slug and a one-line name, each once", () => {
		const page = {
			...galleryPage(1),
			filters: {
				healed: true,
				styles: [
					{ slug: "blackwork", name: "Black\nwork" },
					{ slug: "blackwork", name: "again" },
					{ slug: "Fine line", name: "Bad slug" },
					{ slug: "fine-line", name: "" },
					{ slug: "realism", name: 5 },
					{ slug: "x".repeat(41), name: "Too long" },
					null,
					"x",
					{ slug: "traditional", name: "Traditional" },
				],
			},
		};

		assert.deepEqual(galleryView(page, IMAGE_ORIGIN).styles, [
			{ slug: "blackwork", name: "Black work" },
			{ slug: "traditional", name: "Traditional" },
		]);
	});

	test("a photo from another origin is dropped, and the rest are renumbered", () => {
		const page = galleryPage(3);
		const elsewhere = {
			...page,
			data: [
				{ ...page.data[0], url: "https://evil.example/w.jpg" },
				page.data[1],
				page.data[2],
			],
		};
		const view = galleryView(elsewhere, IMAGE_ORIGIN);

		assert.equal(view.photos.length, 2);
		assert.equal(view.photos[0].dialogId, "work-photo-1");
		assert.equal(view.photos[0].alt, "Tattoo by Sita Rai, photo 1");
		assert.deepEqual(galleryView(page, null).photos, []);
	});

	test("a photo without a usable artist keeps its photo, without a link", () => {
		for (const artist of [
			undefined,
			null,
			"sita",
			{},
			{ slug: "Sita", name: "Sita Rai" },
			{ slug: "../admin", name: "Sita Rai" },
			{ slug: 5, name: "Sita Rai" },
		]) {
			const view = galleryView(withFirst({ artist }), IMAGE_ORIGIN);

			assert.equal(view.photos.length, 2, JSON.stringify(artist));
			assert.equal(view.photos[0].artist, null);
			assert.equal(view.photos[0].alt, "Tattoo, photo 1");
		}
	});

	test("an artist whose name is not text is named by their slug", () => {
		const view = galleryView(
			withFirst({ artist: { slug: "sita", name: 5 } }),
			IMAGE_ORIGIN,
		);

		assert.deepEqual(view.photos[0].artist, {
			name: "sita",
			href: "/artists/sita",
		});
	});

	test("at most 3 style names, malformed ones dropped, each on one line", () => {
		const styles = [
			{ slug: "a", name: "Fine\nline" },
			{ slug: "b" },
			null,
			"x",
			{ slug: "c", name: 5 },
			{ slug: "d", name: "Blackwork" },
			{ slug: "e", name: "Realism" },
			{ slug: "f", name: "Japanese" },
		];

		assert.deepEqual(
			galleryView(withFirst({ styles }), IMAGE_ORIGIN).photos[0].styles,
			["Fine line", "Blackwork", "Realism"],
		);
		for (const odd of [undefined, null, "x", {}]) {
			assert.deepEqual(
				galleryView(withFirst({ styles: odd }), IMAGE_ORIGIN).photos[0].styles,
				[],
			);
		}
	});

	test("healed is on only for true", () => {
		for (const [healed, expected] of [
			[true, true],
			[false, false],
			["true", false],
			[1, false],
			[undefined, false],
		] as const) {
			assert.equal(
				galleryView(withFirst({ healed }), IMAGE_ORIGIN).photos[0].healed,
				expected,
				String(healed),
			);
		}
	});

	test("at most 48 photos are read", () => {
		const view = galleryView(galleryPage(60), IMAGE_ORIGIN);

		assert.equal(view.photos.length, MAX_GALLERY_PAGE);
		assert.equal(view.photos[47].dialogId, "work-photo-48");
	});

	test("a description that is not one short line of text is not used", () => {
		const long = "x".repeat(201);
		for (const alt of [long, 5, "  ", null, undefined]) {
			const view = galleryView(withFirst({ alt }), IMAGE_ORIGIN);

			assert.equal(view.photos[0].caption, null, String(alt));
			assert.equal(view.photos[0].alt, "Tattoo by Sita Rai, photo 1");
		}
	});

	test("the sizes are the page's", () => {
		assert.equal(RECENT_WORK_COUNT, 9);
		assert.equal(WORK_PAGE_SIZE, 24);
		assert.equal(MAX_GALLERY_PAGE, 48);
	});
});

describe("the address's filters are read strictly (TAT-126)", () => {
	test("a good address keeps all four", () => {
		assert.deepEqual(
			readWorkSearch({
				artist: "sita",
				style: "fine-line",
				healed: 1,
				cursor: "abc_-",
			}),
			{ artist: "sita", style: "fine-line", healed: true, cursor: "abc_-" },
		);
	});

	test("healed is on for the number 1 (what the router makes of ?healed=1), '1' and true only", () => {
		for (const on of [1, "1", true]) {
			assert.deepEqual(
				readWorkSearch({ healed: on }),
				{ healed: true },
				String(on),
			);
			assert.deepEqual(readPortfolioSearch({ healed: on }), { healed: true });
		}
		for (const off of [
			"on",
			0,
			"true ",
			"true",
			"yes",
			false,
			null,
			2,
			[],
			{},
		]) {
			assert.deepEqual(
				readWorkSearch({ healed: off }),
				{},
				JSON.stringify(off),
			);
		}
	});

	test("anything else is dropped, and a key is absent, never null", () => {
		for (const [key, value] of [
			["artist", "Sita"],
			["artist", "s"],
			["artist", "-sita"],
			["artist", 12],
			["style", "Fine line"],
			["style", "fine--line"],
			["style", "x".repeat(41)],
			["cursor", "a b"],
			["cursor", ""],
			["cursor", "a".repeat(201)],
			["cursor", 123],
			["cursor", ["a"]],
			["cursor", null],
		] as const) {
			const read = readWorkSearch({ [key]: value });
			assert.deepEqual(read, {}, `${key}=${JSON.stringify(value)}`);
			assert.ok(!(key in read));
		}
		assert.deepEqual(readWorkSearch({}), {});
	});

	test("the artist page reads only healed and cursor", () => {
		assert.deepEqual(
			readPortfolioSearch({
				artist: "sita",
				style: "fine-line",
				healed: "1",
				cursor: "c2",
			}),
			{ healed: true, cursor: "c2" },
		);
		assert.deepEqual(readPortfolioSearch({ cursor: "a b" }), {});
	});

	test("properties it did not set itself are not read", () => {
		const inherited = Object.create({ artist: "sita", healed: 1 });

		assert.deepEqual(readWorkSearch(inherited), {});
	});

	test("the keys come in the order the address writes them", () => {
		assert.deepEqual(
			Object.keys(
				readWorkSearch({ cursor: "c", healed: 1, style: "s", artist: "sita" }),
			),
			["artist", "style", "healed", "cursor"],
		);
	});
});

describe("workQuery (TAT-126)", () => {
	test("keys in the API's order, absent ones left out", () => {
		assert.deepEqual(Object.keys(workQuery({}, 24)), ["limit"]);
		assert.deepEqual(
			Object.keys(
				workQuery(
					{ artist: "sita", style: "fine-line", healed: true, cursor: "c2" },
					24,
				),
			),
			["artist", "style", "healed", "cursor", "limit"],
		);
		assert.deepEqual(workQuery({ artist: "sita", healed: true }, 9), {
			artist: "sita",
			healed: true,
			limit: 9,
		});
	});
});

describe("workHref and portfolioHref keep the filters (TAT-126)", () => {
	test("/work", () => {
		assert.equal(workHref({}), "/work");
		assert.equal(
			workHref({ artist: "sita", healed: true }),
			"/work?artist=sita&healed=1",
		);
		assert.equal(
			workHref({
				artist: "sita",
				style: "fine-line",
				healed: true,
				cursor: "c2",
			}),
			"/work?artist=sita&style=fine-line&healed=1&cursor=c2",
		);
		assert.equal(
			workHref({ artist: "sita", healed: true, cursor: "c2" }),
			"/work?artist=sita&healed=1&cursor=c2",
		);
		assert.equal(workHref({ cursor: "c2" }), "/work?cursor=c2");
	});

	test("an artist's portfolio", () => {
		assert.equal(portfolioHref("sita", {}), "/artists/sita#work");
		assert.equal(
			portfolioHref("sita", { healed: true, cursor: "c2" }),
			"/artists/sita?healed=1&cursor=c2#work",
		);
		assert.equal(
			portfolioHref("sita", { healed: true }),
			"/artists/sita?healed=1#work",
		);
	});

	test("each is a link the page may render", () => {
		for (const href of [
			workHref({}),
			workHref({
				artist: "sita",
				style: "fine-line",
				healed: true,
				cursor: "c2",
			}),
			portfolioHref("sita", {}),
			portfolioHref("sita", { healed: true, cursor: "c2" }),
		]) {
			assert.ok(isAllowedHref(href), href);
		}
	});
});

describe("the router writes the addresses our links write (TAT-126)", () => {
	// The router redirects an address to its own spelling of it, so a link it
	// would spell differently costs a redirect every time it is followed.
	const searches = [
		{ artist: "sita", healed: true as const },
		{
			artist: "sita",
			style: "fine-line",
			healed: true as const,
			cursor: "c2_-",
		},
		{ style: "japanese" },
		{ cursor: "abcDEF012" },
		{ healed: true as const },
		{},
	];

	test("healed is written 1, not true", () => {
		assert.deepEqual(healedAsOne({ healed: true, cursor: "c" }), {
			healed: 1,
			cursor: "c",
		});
		assert.equal(defaultStringifySearch({ healed: true }), "?healed=true");
		assert.equal(
			defaultStringifySearch(healedAsOne({ healed: true })),
			"?healed=1",
		);
	});

	test("its spelling of a search is the one workHref and portfolioHref write", () => {
		for (const search of searches) {
			const router = defaultStringifySearch(healedAsOne(search));
			assert.equal(workHref(search), `/work${router}`, JSON.stringify(search));
		}
		const { artist: _a, style: _s, ...portfolio } = searches[1];
		assert.equal(
			portfolioHref("sita", portfolio),
			`/artists/sita${defaultStringifySearch(healedAsOne(portfolio))}#work`,
		);
	});

	test("what is not true is left as it is", () => {
		const search = { healed: false, cursor: "c" };

		assert.equal(healedAsOne(search), search);
		const none = {};
		assert.equal(healedAsOne(none), none);
	});
});
