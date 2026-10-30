import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	DEFAULT_THEME_CONFIG,
	FONT_KEYS,
	parseThemeConfig,
	readBrandImage,
	readCoverImage,
	readFontKey,
	readHexColor,
	readSections,
	readThemeKey,
	SECTION_KEYS,
	THEME_KEYS,
	THEME_SECTIONS,
} from "../../src/studio/theme/config.ts";

/** Strings no allow-list may let through (TAT-54). */
const HOSTILE_STRINGS = [
	"red;background:url(//evil.example/x.png)",
	"}</style><script>alert(1)</script>",
	"url(https://evil.example/x.png)",
	"expression(alert(1))",
	"javascript:alert(1)",
	"x".repeat(100_000),
	"कलाकार",
	"\u0000",
	"stencil-and-ink\u0000",
	"__proto__",
	"constructor",
	"toString",
	"",
];

/** Values of the wrong type. */
const WRONG_TYPES = [
	undefined,
	null,
	0,
	1,
	true,
	["stencil-and-ink"],
	{ toString: () => "stencil-and-ink" },
	() => "stencil-and-ink",
];

describe("readThemeKey (TAT-54)", () => {
	test("a theme this app has is kept", () => {
		assert.deepEqual(THEME_KEYS, ["stencil-and-ink"]);
		assert.equal(readThemeKey("stencil-and-ink"), "stencil-and-ink");
	});

	test("anything else is the default theme", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			// The contract's example, and near misses.
			"classic",
			"Stencil-and-ink",
			" stencil-and-ink",
			"stencil-and-ink ",
		]) {
			assert.equal(readThemeKey(value), "stencil-and-ink", String(value));
		}
	});
});

describe("readFontKey (TAT-54)", () => {
	test("a key from the fixed list is kept", () => {
		assert.deepEqual(FONT_KEYS, ["eczar", "serif", "sans"]);
		for (const key of FONT_KEYS) assert.equal(readFontKey(key), key);
	});

	test("anything else is Eczar: a font name never reaches the page", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			"Comic Sans MS",
			"ECZAR",
			" eczar",
			"eczar;}",
			"serif, url(//evil.example/font.woff2)",
		]) {
			assert.equal(readFontKey(value), "eczar", String(value));
		}
	});
});

describe("readSections (TAT-54)", () => {
	const items = (...types: unknown[]) =>
		types.map((type) => ({ type, props: {} }));

	test("the default order is work, artists, Good to know, then inquiry", () => {
		assert.deepEqual(SECTION_KEYS, ["work", "artists", "info", "inquiry"]);
		assert.deepEqual(THEME_SECTIONS["stencil-and-ink"], {
			order: ["work", "artists", "info", "inquiry"],
			required: ["inquiry"],
		});
		assert.deepEqual(readSections(undefined, "stencil-and-ink"), [
			"work",
			"artists",
			"info",
			"inquiry",
		]);
	});

	test("an older API's list without info shows no Good to know; info can be moved and hidden", () => {
		assert.deepEqual(
			readSections(items("work", "artists", "inquiry"), "stencil-and-ink"),
			["work", "artists", "inquiry"],
		);
		assert.deepEqual(
			readSections(items("info", "work", "inquiry"), "stencil-and-ink"),
			["info", "work", "inquiry"],
		);
		assert.deepEqual(readSections(items("info"), "stencil-and-ink"), [
			"info",
			"inquiry",
		]);
		assert.deepEqual(
			readSections(items("info", "info", "inquiry"), "stencil-and-ink"),
			["info", "inquiry"],
		);
	});

	test("an older API's [artists, inquiry] shows no Recent work", () => {
		assert.deepEqual(
			readSections(items("artists", "inquiry"), "stencil-and-ink"),
			["artists", "inquiry"],
		);
		assert.deepEqual(readSections(items("artists"), "stencil-and-ink"), [
			"artists",
			"inquiry",
		]);
	});

	test("work can be moved anywhere and hidden; the inquiry section stays", () => {
		assert.deepEqual(
			readSections(items("artists", "work", "inquiry"), "stencil-and-ink"),
			["artists", "work", "inquiry"],
		);
		assert.deepEqual(
			readSections(items("inquiry", "work"), "stencil-and-ink"),
			["inquiry", "work"],
		);
		assert.deepEqual(readSections(items("work"), "stencil-and-ink"), [
			"work",
			"inquiry",
		]);
		assert.deepEqual(
			readSections(items("work", "work", "inquiry"), "stencil-and-ink"),
			["work", "inquiry"],
		);
	});

	test("not a list: the theme's default order", () => {
		for (const value of [
			undefined,
			null,
			"artists,inquiry",
			{ 0: { type: "inquiry" } },
			42,
		]) {
			assert.deepEqual(
				readSections(value, "stencil-and-ink"),
				["work", "artists", "info", "inquiry"],
				String(value),
			);
		}
	});

	test("keeps the config's order", () => {
		assert.deepEqual(
			readSections(items("inquiry", "artists"), "stencil-and-ink"),
			["inquiry", "artists"],
		);
		assert.deepEqual(
			readSections(items("artists", "inquiry"), "stencil-and-ink"),
			["artists", "inquiry"],
		);
	});

	test("hides a section the config leaves out, but never the inquiry section", () => {
		assert.deepEqual(readSections(items("inquiry"), "stencil-and-ink"), [
			"inquiry",
		]);
		// Clients can always send an idea: a list without it gets it at the end.
		assert.deepEqual(readSections(items("artists"), "stencil-and-ink"), [
			"artists",
			"inquiry",
		]);
		assert.deepEqual(readSections([], "stencil-and-ink"), ["inquiry"]);
	});

	test("drops unknown and repeated keys, keeping the first of each", () => {
		assert.deepEqual(
			readSections(
				items("hero", "inquiry", "portfolio", "inquiry", "artists", "artists"),
				"stencil-and-ink",
			),
			["inquiry", "artists"],
		);
	});

	test("drops items that aren't { type } objects with a known key", () => {
		assert.deepEqual(
			readSections(
				[
					"artists",
					null,
					7,
					["artists"],
					{ type: 1 },
					{ type: "ARTISTS" },
					{ type: "artists " },
					{ kind: "artists" },
					Object.create({ type: "artists" }),
					...items(...HOSTILE_STRINGS),
				],
				"stencil-and-ink",
			),
			["inquiry"],
		);
	});

	test("reads at most 32 items of a long list", () => {
		const filler = items(...Array.from({ length: 32 }, () => "hero"));
		assert.deepEqual(
			readSections([...filler, ...items("artists")], "stencil-and-ink"),
			["inquiry"],
		);
		assert.deepEqual(
			readSections(
				[...items("artists"), ...items(...Array(100_000).fill("hero"))],
				"stencil-and-ink",
			),
			["artists", "inquiry"],
		);
	});
});

describe("readHexColor (TAT-54)", () => {
	test("#rrggbb is kept, lowercased", () => {
		assert.equal(readHexColor("#b91c1c"), "#b91c1c");
		assert.equal(readHexColor("#B91C1C"), "#b91c1c");
		assert.equal(readHexColor("#000000"), "#000000");
	});

	test("anything else is null: nothing but a colour reaches a CSS variable", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			"red",
			"#fff",
			"#b91c1c80",
			"#b91c1",
			"#b91c1g",
			"b91c1c",
			" #b91c1c",
			"#b91c1c ",
			"#b91c1c\n",
			"#b91c1c;",
			"#b91c1c;color:red",
			"#b91c1c}html{color:red",
			"#b91c1c\u0000",
			"rgb(185, 28, 28)",
			"var(--ink)",
			"#ｂ９１ｃ１ｃ",
			"#१२३४५६",
			`#${"a".repeat(100_000)}`,
			0xb91c1c,
		]) {
			assert.equal(readHexColor(value), null, JSON.stringify(value));
		}
	});
});

describe("readBrandImage (TAT-54)", () => {
	const API = "https://api.example.com";
	const LOGO = "https://api.example.com/uploads/tenants/t/brand_logo/logo.png";
	const image = (
		url: unknown,
		width: unknown = 600,
		height: unknown = 200,
	) => ({
		url,
		width,
		height,
		alt: "Black Needle",
	});

	test("an image on the API's origin is kept: its URL and its size", () => {
		assert.deepEqual(readBrandImage(image(LOGO), API), {
			src: LOGO,
			width: 600,
			height: 200,
		});
		assert.deepEqual(
			readBrandImage(image("https://API.example.com/uploads/a.png"), API),
			{ src: "https://api.example.com/uploads/a.png", width: 600, height: 200 },
		);
	});

	test("a URL from anywhere else, or not https, is no image", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:image/svg+xml,<svg onload=alert(1)>",
			"data:image/png;base64,iVBORw0KGgo=",
			"blob:https://api.example.com/0f0e",
			"http://api.example.com/uploads/a.png",
			"https://evil.example/uploads/a.png",
			"https://api.example.com.evil.example/a.png",
			"https://api.example.com@evil.example/a.png",
			"https://user:secret@api.example.com/a.png",
			"https://api.example.com:8443/a.png",
			"https://аpi.example.com/a.png",
			"https://evil.example\\@api.example.com/a.png",
			"https://api.example.com./a.png",
			"https://api.example.com.:443/a.png",
			"https://api.example.com%2eevil.example/a.png",
			"//evil.example/a.png",
			"/uploads/a.png",
			"uploads/a.png",
			"url(https://api.example.com/a.png)",
			" https://api.example.com/a.png",
			"https://api.example.com/a.png\n",
			"https://api.example.com/a b.png",
			"https://api.example.com/a\tb.png",
			"https://api.example.com/a\u0000.png",
			`https://api.example.com/${"a".repeat(3000)}.png`,
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
		]) {
			assert.equal(readBrandImage(image(url), API), null, JSON.stringify(url));
		}
	});

	test("a URL the parser puts on the API's origin is kept as its normalised form, never as typed", () => {
		for (const [url, src] of [
			// A backslash is a slash in an https URL: the host is still the API's, the rest is path.
			[
				"https://api.example.com\\@evil.example/a.png",
				"https://api.example.com/@evil.example/a.png",
			],
			["https:\\\\api.example.com/a.png", "https://api.example.com/a.png"],
			["https://api.example.com:443/a.png", "https://api.example.com/a.png"],
			["https://api.example.com:/a.png", "https://api.example.com/a.png"],
			["HTTPS://API.EXAMPLE.COM/a.png", "https://api.example.com/a.png"],
			[
				"Https://Api.Example.Com/Uploads/A.png",
				"https://api.example.com/Uploads/A.png",
			],
			[
				"https://api.example.com/uploads/../a.png",
				"https://api.example.com/a.png",
			],
			[
				"https://api.example.com/uploads/./a.png",
				"https://api.example.com/uploads/a.png",
			],
			[
				"https://api.example.com/uploads/%2e%2e/a.png",
				"https://api.example.com/a.png",
			],
			[
				"https://api.example.com/a.png#frag",
				"https://api.example.com/a.png#frag",
			],
			// U+200B is dropped from a host by the URL parser and percent-encoded in a path.
			["https://api.example.com\u200B/a.png", "https://api.example.com/a.png"],
			[
				"https://api.example.com/a\u200Bb.png",
				"https://api.example.com/a%E2%80%8Bb.png",
			],
		]) {
			assert.deepEqual(
				readBrandImage(image(url), API),
				{ src, width: 600, height: 200 },
				JSON.stringify(url),
			);
		}
	});

	test("a URL that would break out of CSS is harmless: it is only ever an <img> src, percent-encoded", () => {
		const breakout = readBrandImage(
			image('https://api.example.com/a.png");background:url(//evil.example'),
			API,
		);
		assert.ok(breakout);
		assert.doesNotMatch(breakout.src, /"/);
		assert.match(breakout.src, /^https:\/\/api\.example\.com\/a\.png%22\)/);
		const devanagari = readBrandImage(
			image("https://api.example.com/uploads/लोगो.png"),
			API,
		);
		assert.equal(
			devanagari?.src,
			"https://api.example.com/uploads/%E0%A4%B2%E0%A5%8B%E0%A4%97%E0%A5%8B.png",
		);
	});

	test("its size must be whole pixels from 1 to 10000", () => {
		for (const [width, height] of [
			[0, 200],
			[600, -1],
			[1.5, 200],
			["600", 200],
			[600, Number.NaN],
			[Number.POSITIVE_INFINITY, 200],
			[10_001, 200],
			[null, 200],
		]) {
			assert.equal(
				readBrandImage(image(LOGO, width, height), API),
				null,
				`${width} x ${height}`,
			);
		}
		assert.equal(readBrandImage({ url: LOGO }, API), null, "no size");
		assert.ok(readBrandImage(image(LOGO, 10_000, 1), API));
	});

	test("not an Image object, or no origin to check against, is no image", () => {
		for (const value of [LOGO, null, undefined, [], [LOGO], 42]) {
			assert.equal(readBrandImage(value, API), null, String(value));
		}
		assert.equal(readBrandImage(Object.create(image(LOGO)), API), null);
		assert.equal(readBrandImage(image(LOGO), null), null);
		assert.equal(readBrandImage(image(LOGO), "not an origin"), null);
	});

	test("the origin is the whole rule: scheme, host and port must all be the API's", () => {
		const local = "http://localhost:3333";
		assert.deepEqual(
			readBrandImage(image("http://localhost:3333/uploads/a.png"), local),
			{ src: "http://localhost:3333/uploads/a.png", width: 600, height: 200 },
		);
		for (const url of [
			"https://localhost:3333/uploads/a.png",
			"http://localhost:3334/uploads/a.png",
			"http://localhost/uploads/a.png",
			"http://127.0.0.1:3333/uploads/a.png",
		]) {
			assert.equal(readBrandImage(image(url), local), null, url);
		}
		for (const url of [
			"http://api.example.com/uploads/a.png",
			"https://api.example.com:8443/uploads/a.png",
			"https://api.example.com:80/uploads/a.png",
			"wss://api.example.com/uploads/a.png",
		]) {
			assert.equal(readBrandImage(image(url), API), null, url);
		}
	});
});

describe("readCoverImage (TAT-54)", () => {
	const API = "https://api.example.com";
	const COVER =
		"https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg";
	const cover = (alt: unknown) => ({
		url: COVER,
		width: 2048,
		height: 1024,
		alt,
	});

	test("the cover keeps its description, as one line of plain text", () => {
		assert.deepEqual(
			readCoverImage(cover("The front of Black Needle on Durbar Marg"), API),
			{
				src: COVER,
				width: 2048,
				height: 1024,
				alt: "The front of Black Needle on Durbar Marg",
			},
		);
		assert.equal(
			readCoverImage(cover("  A\n  photo\tof\u0000 the \u202Estudio  "), API)
				?.alt,
			"A photo of the studio",
		);
		assert.equal(
			readCoverImage(cover("कालो सुई स्टुडियो"), API)?.alt,
			"कालो सुई स्टुडियो",
		);
		assert.equal(
			readCoverImage(cover('"><script>alert(1)</script>'), API)?.alt,
			'"><script>alert(1)</script>',
			"kept as text: React escapes it",
		);
	});

	test("no description, or one that is not text, is an empty alt", () => {
		for (const alt of [
			null,
			undefined,
			42,
			true,
			{},
			["x"],
			"",
			"   ",
			"\u0000\n\t",
			"x".repeat(301),
		]) {
			assert.equal(readCoverImage(cover(alt), API)?.alt, "", String(alt));
		}
		assert.equal(
			readCoverImage({ url: COVER, width: 2048, height: 1024 }, API)?.alt,
			"",
			"no alt at all",
		);
		assert.equal(readCoverImage(cover("x".repeat(300)), API)?.alt.length, 300);
	});

	test("the same checks as any brand image", () => {
		assert.equal(
			readCoverImage(
				{ ...cover("x"), url: "https://evil.example/cover.jpg" },
				API,
			),
			null,
		);
		assert.equal(readCoverImage({ ...cover("x"), width: 0 }, API), null);
		assert.equal(readCoverImage(cover("x"), null), null);
		assert.equal(readCoverImage("not an image", API), null);
	});

	test("the logo's description is never read", () => {
		const parsed = parseThemeConfig(
			{
				branding: {
					logo: { url: COVER, width: 600, height: 200, alt: "Black Needle" },
					heroImage: cover("The studio"),
				},
			},
			API,
		);
		assert.deepEqual(parsed.logo, { src: COVER, width: 600, height: 200 });
		assert.equal(parsed.heroImage?.alt, "The studio");
	});
});

describe("parseThemeConfig (TAT-54)", () => {
	const API = "https://api.example.com";
	const LOGO = {
		url: "https://api.example.com/uploads/tenants/t/brand_logo/logo.png",
		width: 600,
		height: 200,
		alt: null,
	};
	const COVER = {
		url: "https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg",
		width: 2048,
		height: 1024,
		alt: null,
	};
	const BRANDED = {
		theme: "stencil-and-ink",
		branding: {
			logo: LOGO,
			heroImage: COVER,
			colors: { accent: "#B91C1C", accentDark: "#fca5a5" },
			font: "serif",
		},
		sections: [
			{ type: "inquiry", props: {} },
			{ type: "artists", props: {} },
		],
	};

	test("nothing sent (every studio today) is the default theme", () => {
		assert.deepEqual(DEFAULT_THEME_CONFIG, {
			key: "stencil-and-ink",
			sections: ["work", "artists", "info", "inquiry"],
			accent: null,
			accentDark: null,
			font: "eczar",
			logo: null,
			heroImage: null,
		});
		for (const value of [
			undefined,
			null,
			"stencil-and-ink",
			42,
			true,
			[],
			[BRANDED],
		]) {
			assert.deepEqual(
				parseThemeConfig(value, API),
				DEFAULT_THEME_CONFIG,
				String(value),
			);
		}
	});

	test("the default theme and the lists it points at can't be changed by whoever holds them", () => {
		const defaults = {
			key: "stencil-and-ink",
			sections: ["work", "artists", "info", "inquiry"],
			accent: null,
			accentDark: null,
			font: "eczar",
			logo: null,
			heroImage: null,
		};
		assert.ok(Object.isFrozen(DEFAULT_THEME_CONFIG));
		assert.ok(Object.isFrozen(DEFAULT_THEME_CONFIG.sections));
		assert.equal(
			DEFAULT_THEME_CONFIG.sections,
			THEME_SECTIONS["stencil-and-ink"].order,
		);
		for (const key of THEME_KEYS) {
			assert.ok(Object.isFrozen(THEME_SECTIONS[key]), key);
			assert.ok(Object.isFrozen(THEME_SECTIONS[key].order), key);
			assert.ok(Object.isFrozen(THEME_SECTIONS[key].required), key);
		}
		// These tests are ES modules, so strict mode: writing to a frozen object throws.
		const theme = parseThemeConfig(undefined, API) as unknown as {
			accent: string | null;
			sections: string[];
		};
		assert.throws(() => {
			theme.accent = "#ff0000";
		}, TypeError);
		assert.throws(() => theme.sections.push("hero"), TypeError);
		assert.throws(() => theme.sections.reverse(), TypeError);
		assert.throws(() => {
			(THEME_SECTIONS["stencil-and-ink"].order as string[]).length = 0;
		}, TypeError);
		assert.throws(() => {
			(THEME_SECTIONS["stencil-and-ink"].required as string[])[0] = "artists";
		}, TypeError);
		assert.deepEqual(parseThemeConfig(undefined, API), defaults);
		assert.deepEqual(readSections(undefined, "stencil-and-ink"), [
			"work",
			"artists",
			"info",
			"inquiry",
		]);
	});

	test("a whole config, every value checked", () => {
		assert.deepEqual(parseThemeConfig(BRANDED, API), {
			key: "stencil-and-ink",
			sections: ["inquiry", "artists"],
			accent: "#b91c1c",
			accentDark: "#fca5a5",
			font: "serif",
			logo: { src: LOGO.url, width: 600, height: 200 },
			heroImage: { src: COVER.url, width: 2048, height: 1024, alt: "" },
		});
	});

	test("one bad value falls back alone", () => {
		const parsed = parseThemeConfig(
			{
				...BRANDED,
				branding: {
					...BRANDED.branding,
					logo: { ...LOGO, url: "https://evil.example/logo.png" },
					colors: {
						accent: "red;background:url(//evil)",
						accentDark: "#fca5a5",
					},
				},
			},
			API,
		);
		assert.equal(parsed.logo, null);
		assert.equal(parsed.accent, null);
		assert.equal(parsed.accentDark, "#fca5a5");
		assert.equal(parsed.font, "serif");
		assert.deepEqual(parsed.heroImage, {
			src: COVER.url,
			width: 2048,
			height: 1024,
			alt: "",
		});
		assert.deepEqual(parsed.sections, ["inquiry", "artists"]);
	});

	test("every value hostile or of the wrong type is the default theme", () => {
		const hostile = {
			theme: "}</style><script>alert(1)</script>",
			branding: {
				logo: { url: "javascript:alert(1)", width: 1, height: 1 },
				heroImage: {
					url: "data:image/svg+xml,<svg onload=alert(1)>",
					width: 1,
					height: 1,
				},
				colors: {
					accent: "expression(alert(1))",
					accentDark: "url(//evil.example/x.png)",
					primary: "#111111",
				},
				font: "Comic Sans MS; src: url(//evil.example/font.woff2)",
			},
			sections: "artists;inquiry",
		};
		assert.deepEqual(parseThemeConfig(hostile, API), DEFAULT_THEME_CONFIG);
		for (const branding of WRONG_TYPES) {
			assert.deepEqual(
				parseThemeConfig({ branding }, API),
				DEFAULT_THEME_CONFIG,
				String(branding),
			);
		}
	});

	test("reads own properties only, never inherited ones", () => {
		assert.deepEqual(
			parseThemeConfig(
				Object.create({ sections: [], branding: BRANDED.branding }),
				API,
			),
			DEFAULT_THEME_CONFIG,
		);
		assert.deepEqual(
			parseThemeConfig(
				JSON.parse(
					'{"__proto__": {"sections": []}, "branding": {"__proto__": {"font": "sans"}}}',
				),
				API,
			),
			DEFAULT_THEME_CONFIG,
		);
	});

	test("the contract's own example (theme classic, a primary colour, hero and portfolio sections)", () => {
		assert.deepEqual(
			parseThemeConfig(
				{
					theme: "classic",
					branding: { colors: { primary: "#111111" }, font: null },
					sections: [
						{ type: "hero", props: {} },
						{ type: "portfolio", props: {} },
					],
				},
				API,
			),
			{ ...DEFAULT_THEME_CONFIG, sections: ["inquiry"] },
		);
	});

	test("without the API's origin, images are dropped and the rest is kept", () => {
		const parsed = parseThemeConfig(BRANDED, null);
		assert.equal(parsed.logo, null);
		assert.equal(parsed.heroImage, null);
		assert.equal(parsed.accent, "#b91c1c");
	});
});

describe("a logo's and cover's smaller copies (TAT-112)", () => {
	const API = "https://api.example.com";
	const LOGO = "https://api.example.com/uploads/tenants/t/brand_logo/logo.png";
	const COVER =
		"https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg";
	const copy = (base: string, width: number) =>
		base.replace(/\.(png|jpg)$/, `.${width}w.$1`);
	const withCopies = (url: string, width: number, height: number) => ({
		url,
		width,
		height,
		alt: null,
		variants: [
			{ url: copy(url, 640), width: 640 },
			{ url: copy(url, 320), width: 320 },
		],
	});

	test("copies on the API's origin become a srcSet, narrowest first, ending with the image", () => {
		assert.deepEqual(readBrandImage(withCopies(LOGO, 1200, 400), API), {
			src: LOGO,
			width: 1200,
			height: 400,
			srcSet: `${copy(LOGO, 320)} 320w, ${copy(LOGO, 640)} 640w, ${LOGO} 1200w`,
		});
		const cover = readCoverImage(withCopies(COVER, 2048, 1024), API);
		assert.equal(
			cover?.srcSet,
			`${copy(COVER, 320)} 320w, ${copy(COVER, 640)} 640w, ${COVER} 2048w`,
		);
		assert.equal(cover?.alt, "");
	});

	test("copies on another origin are dropped, the image stays", () => {
		const hostile = {
			url: LOGO,
			width: 1200,
			height: 400,
			variants: [
				{ url: "https://evil.example/logo.320w.png", width: 320 },
				{ url: "http://api.example.com/logo.640w.png", width: 640 },
				{ url: "javascript:alert(1)", width: 480 },
			],
		};

		assert.deepEqual(readBrandImage(hostile, API), {
			src: LOGO,
			width: 1200,
			height: 400,
		});
		assert.deepEqual(readCoverImage({ ...hostile, alt: "A cover" }, API), {
			src: LOGO,
			width: 1200,
			height: 400,
			alt: "A cover",
		});
	});

	test("the cover keeps its alt beside its srcSet", () => {
		const cover = readCoverImage(
			{ ...withCopies(COVER, 2048, 1024), alt: "The front of the shop" },
			API,
		);

		assert.equal(cover?.alt, "The front of the shop");
		assert.ok(cover?.srcSet);
	});

	test("an image without variants is exactly { src, width, height }", () => {
		for (const variants of [undefined, null, [], "320w", {}]) {
			assert.deepEqual(
				readBrandImage({ url: LOGO, width: 600, height: 200, variants }, API),
				{ src: LOGO, width: 600, height: 200 },
				JSON.stringify(variants),
			);
		}
	});
});
