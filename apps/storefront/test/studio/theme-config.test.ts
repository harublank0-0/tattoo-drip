import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	FONT_KEYS,
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

	test("the default theme orders and hides the artists; the inquiry section is required", () => {
		assert.deepEqual(SECTION_KEYS, ["artists", "inquiry"]);
		assert.deepEqual(THEME_SECTIONS["stencil-and-ink"], {
			order: ["artists", "inquiry"],
			required: ["inquiry"],
		});
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
				["artists", "inquiry"],
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
