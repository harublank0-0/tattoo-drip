import { readFileSync } from "node:fs";
import { test } from "@japa/runner";
import {
	contrastRatio,
	DARK_PAPER,
	DEFAULT_FONT,
	DEFAULT_LOGO_TILE,
	DEFAULT_SECTIONS,
	DEFAULT_THEME,
	FONT_KEYS,
	FONTS,
	LIGHT_PAPER,
	LOGO_TILE_COLOURS,
	LOGO_TILES,
	logoTileOf,
	lookOf,
	MIN_TEXT_CONTRAST,
	readsOn,
	SECTION_KEYS,
	sectionList,
	sectionsOf,
	THEME_ACCENT,
	THEME_ACCENT_DARK,
	THEME_KEYS,
	THEMES,
} from "#modules/storefront/look";

/** Reads a storefront file as text: reading is not importing, so apps stay apart. */
function storefront(path: string): string {
	return readFileSync(
		new URL(`../../../../../storefront/${path}`, import.meta.url),
		"utf8",
	);
}

/** The API contract as text, read like the storefront's source: no YAML parser needed for two lines. */
function contract(): string {
	return readFileSync(
		new URL("../../../../../../packages/types/openapi.yaml", import.meta.url),
		"utf8",
	);
}

/** A schema's lines in the contract: from its name (4 spaces in) to the next schema. */
function schemaOf(yaml: string, name: string): string {
	const match = new RegExp(`\n {4}${name}:\n([\\s\\S]*?)\n {4}[A-Za-z]`).exec(
		yaml,
	);
	if (!match) throw new Error(`${name} is not in the contract.`);
	return match[1];
}

/** The strings of `export const NAME = [ ... ] as const` in a source file. */
function listOf(source: string, name: string): string[] {
	const match = new RegExp(
		`export const ${name} = \\[([^\\]]*)\\] as const`,
	).exec(source);
	if (!match) throw new Error(`${name} is not in the storefront's source.`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const near = (actual: number, expected: number, tolerance = 0.0005) =>
	Math.abs(actual - expected) < tolerance;

test.group("the page look rules match the storefront's own", () => {
	test("the theme, section and font lists are the storefront's", ({
		assert,
	}) => {
		const config = storefront("src/studio/theme/config.ts");
		assert.deepEqual([...THEME_KEYS], listOf(config, "THEME_KEYS"));
		assert.deepEqual([...SECTION_KEYS], listOf(config, "SECTION_KEYS"));
		assert.deepEqual([...FONT_KEYS], listOf(config, "FONT_KEYS"));
		assert.match(config, /required: sectionList\("inquiry"\)/);
		// A studio that set nothing shows the storefront theme's own default order.
		const order = /order: sectionList\(([^)]*)\)/.exec(config)?.[1] ?? "";
		assert.deepEqual(
			[...DEFAULT_SECTIONS],
			[...order.matchAll(/"([^"]+)"/g)].map((item) => item[1]),
		);
		assert.equal(DEFAULT_THEME, "stencil-and-ink");
		assert.match(config, /DEFAULT_FONT: FontKey = "eczar"/);
		assert.equal(DEFAULT_FONT, "eczar");
	});

	test("the contract lists the same sections, so a new key cannot forget it", ({
		assert,
	}) => {
		const yaml = contract();
		const listed = /enum: \[([^\]]*)\]/.exec(
			schemaOf(yaml, "StorefrontSection"),
		);
		assert.deepEqual(
			(listed?.[1] ?? "").split(",").map((key) => key.trim()),
			[...SECTION_KEYS],
			"StorefrontSection's enum is SECTION_KEYS",
		);
		const room = /\n {8}sections:\n[\s\S]*?maxItems: (\d+)/.exec(
			schemaOf(yaml, "StorefrontConfiguration"),
		);
		assert.equal(
			Number(room?.[1]),
			SECTION_KEYS.length,
			"StorefrontConfiguration.sections.maxItems is SECTION_KEYS.length",
		);
	});

	test("the contract's Logo lists the same tiles, light first, and a logo is a Logo", ({
		assert,
	}) => {
		const yaml = contract();
		const logo = schemaOf(yaml, "Logo");
		const listed = /tile:\n\s+type: string\n\s+enum: \[([^\]]*)\]/.exec(logo);
		assert.deepEqual(
			(listed?.[1] ?? "").split(",").map((key) => key.trim()),
			[...LOGO_TILES],
			"Logo.tile's enum is LOGO_TILES",
		);
		assert.match(
			schemaOf(yaml, "StorefrontConfiguration"),
			/logo:[\s\S]*?oneOf: \[\{ \$ref: "#\/components\/schemas\/Logo" \}, \{ type: "null" \}\]/,
		);
	});

	test("the two papers and the minimum contrast are the storefront's", ({
		assert,
	}) => {
		const branding = storefront("src/studio/theme/branding.ts");
		assert.include(branding, `LIGHT: Scheme = {\n\tpaper: "${LIGHT_PAPER}"`);
		assert.include(branding, `DARK: Scheme = {\n\tpaper: "${DARK_PAPER}"`);
		const color = storefront("src/studio/theme/color.ts");
		assert.include(color, `MIN_TEXT_CONTRAST = ${MIN_TEXT_CONTRAST};`);
	});

	test("the theme's violets are the stylesheet's --stencil, light then dark", ({
		assert,
	}) => {
		const css = storefront("src/styles.css");
		const dark = css.indexOf("@media (prefers-color-scheme: dark) {");
		assert.isAbove(dark, 0);
		assert.include(css.slice(0, dark), `--stencil: ${THEME_ACCENT};`);
		assert.include(css.slice(dark), `--stencil: ${THEME_ACCENT_DARK};`);
	});
});

test.group("contrast", () => {
	test("gives the numbers the storefront computes", ({ assert }) => {
		assert.isTrue(near(contrastRatio("#0f766e", LIGHT_PAPER), 4.955));
		assert.isTrue(near(contrastRatio("#e8a317", LIGHT_PAPER), 1.963));
		assert.isTrue(near(contrastRatio("#43389a", DARK_PAPER), 2.033));
		assert.isTrue(near(contrastRatio("#a99cff", DARK_PAPER), 7.957));
		// A saturated mid-tone: neither pale nor dark, and still under the line.
		assert.isTrue(near(contrastRatio("#ff0000", LIGHT_PAPER), 3.62, 0.01));
		assert.isTrue(near(contrastRatio("#5050ff", DARK_PAPER), 3.52, 0.01));
		assert.equal(contrastRatio("#f7f3ee", "#f7f3ee"), 1);
	});

	test("readsOn is the 4.5:1 line, for lowercase #rrggbb only", ({
		assert,
	}) => {
		assert.isFalse(readsOn("#777777", LIGHT_PAPER)); // 4.05
		assert.isTrue(readsOn("#6e6e6e", LIGHT_PAPER)); // 4.62
		assert.isTrue(readsOn("#0f766e", LIGHT_PAPER));
		assert.isFalse(readsOn("#e8a317", LIGHT_PAPER));
		assert.isTrue(readsOn("#a99cff", DARK_PAPER));
		assert.isFalse(readsOn("#43389a", DARK_PAPER));
		assert.isFalse(readsOn("#FFFFFF", DARK_PAPER));
		assert.isFalse(readsOn("white", DARK_PAPER));
		assert.isFalse(readsOn("#fff", DARK_PAPER));
	});
});

test.group("lookOf", () => {
	const good = {
		storefrontTheme: "stencil-and-ink",
		storefrontSections: "inquiry,artists,work",
		brandAccent: "#0f766e",
		brandAccentDark: "#a99cff",
		brandFont: "serif",
	};

	test("keeps every stored value that is on today's list and readable", ({
		assert,
	}) => {
		assert.deepEqual(lookOf(good), {
			theme: "stencil-and-ink",
			accent: "#0f766e",
			accentDark: "#a99cff",
			font: "serif",
			sections: ["inquiry", "artists", "work"],
		});
	});

	test("turns each unusable value into its own default, alone", ({
		assert,
	}) => {
		assert.equal(
			lookOf({ ...good, storefrontTheme: "classic" }).theme,
			DEFAULT_THEME,
		);
		assert.equal(lookOf({ ...good, brandFont: "mono" }).font, DEFAULT_FONT);
		const unreadable = lookOf({ ...good, brandAccent: "#e8a317" });
		assert.isNull(unreadable.accent);
		assert.equal(unreadable.accentDark, "#a99cff");
		const tooDark = lookOf({ ...good, brandAccentDark: "#43389a" });
		assert.isNull(tooDark.accentDark);
		assert.equal(tooDark.accent, "#0f766e");
		// One bad value leaves the others as they were.
		const onlyFont = lookOf({ ...good, brandFont: "mono" });
		assert.equal(onlyFont.accent, "#0f766e");
		assert.deepEqual(onlyFont.sections, ["inquiry", "artists", "work"]);
	});

	test("an unset colour stays unset", ({ assert }) => {
		const look = lookOf({ ...good, brandAccent: null, brandAccentDark: null });
		assert.isNull(look.accent);
		assert.isNull(look.accentDark);
	});

	test("a colour that is not lowercase #rrggbb is the default", ({
		assert,
	}) => {
		assert.isNull(lookOf({ ...good, brandAccent: "#0F766E" }).accent);
		assert.isNull(lookOf({ ...good, brandAccent: "teal" }).accent);
	});
});

test.group("sections", () => {
	test("the default is Recent work, the artists, Flash, Good to know, then the form", ({
		assert,
	}) => {
		const all = ["work", "artists", "flash", "info", "inquiry"];
		assert.deepEqual([...SECTION_KEYS], all);
		assert.deepEqual([...DEFAULT_SECTIONS], all);
	});

	test("sectionList keeps Flash once, where it was put", ({ assert }) => {
		assert.deepEqual(sectionList(["flash", "artists", "flash"]), [
			"flash",
			"artists",
			"inquiry",
		]);
		assert.deepEqual(sectionsOf("work,artists,inquiry"), [
			"work",
			"artists",
			"inquiry",
		]);
		assert.deepEqual(sectionsOf("work,flash,inquiry"), [
			"work",
			"flash",
			"inquiry",
		]);
	});

	test("sectionList keeps Good to know once, where it was put", ({
		assert,
	}) => {
		assert.deepEqual(sectionList(["info", "work", "info", "inquiry"]), [
			"info",
			"work",
			"inquiry",
		]);
		assert.deepEqual(sectionList(["work", "info"]), [
			"work",
			"info",
			"inquiry",
		]);
		assert.deepEqual(sectionsOf("artists,info,inquiry"), [
			"artists",
			"info",
			"inquiry",
		]);
	});

	test("sectionList keeps known keys once, in order, and adds the form at the end", ({
		assert,
	}) => {
		assert.deepEqual(sectionList(["artists", "work", "artists", "zzz"]), [
			"artists",
			"work",
			"inquiry",
		]);
		assert.deepEqual(sectionList(["inquiry", "work"]), ["inquiry", "work"]);
		assert.deepEqual(sectionList([]), ["inquiry"]);
		assert.deepEqual(sectionList(["work"]), ["work", "inquiry"]);
	});

	test("sectionsOf reads a stored list: known keys once, then the form if it was left out", ({
		assert,
	}) => {
		assert.deepEqual(sectionsOf("inquiry,artists,inquiry,zzz"), [
			"inquiry",
			"artists",
		]);
		assert.deepEqual(sectionsOf("artists"), ["artists", "inquiry"]);
		assert.deepEqual(sectionsOf(""), ["inquiry"]);
		assert.deepEqual(sectionsOf("work,artists,inquiry"), [
			"work",
			"artists",
			"inquiry",
		]);
	});

	test("a stored list without work stays without it", ({ assert }) => {
		assert.deepEqual(sectionsOf("artists,inquiry"), ["artists", "inquiry"]);
		assert.deepEqual(
			lookOf({
				storefrontTheme: "stencil-and-ink",
				storefrontSections: "artists,inquiry",
				brandAccent: null,
				brandAccentDark: null,
				brandFont: "eczar",
			}).sections,
			["artists", "inquiry"],
		);
	});

	test("every list keeps the form", ({ assert }) => {
		for (const keys of [[], ["work"], ["artists", "work"], ["flash"]]) {
			assert.include(sectionList(keys), "inquiry");
		}
	});
});

test.group("the rules module is shared with the public read path", () => {
	test("it holds rules and lists, none of the dashboard's sentences", ({
		assert,
	}) => {
		const source = readFileSync(
			new URL("../../../../app/modules/storefront/look.ts", import.meta.url),
			"utf8",
		);
		// The save flash and the notes live with the dashboard (#modules/tenancy/look_messages).
		assert.notMatch(source, /minutes/i);
		assert.notMatch(source, /Page look saved/);
		assert.notMatch(source, /LOOK_SAVED_MESSAGE/);
	});
});

test.group("the lists the dashboard shows", () => {
	test("THEMES and FONTS name exactly the keys the rules know, in order", ({
		assert,
	}) => {
		assert.deepEqual(
			THEMES.map((theme) => theme.key),
			[...THEME_KEYS],
		);
		assert.deepEqual(
			FONTS.map((font) => font.key),
			[...FONT_KEYS],
		);
	});
});

test.group("a logo's tile (TAT-123)", () => {
	test("the tiles are the light and the dark paper, light by default", ({
		assert,
	}) => {
		assert.deepEqual([...LOGO_TILES], ["light", "dark"]);
		assert.equal(DEFAULT_LOGO_TILE, "light");
		assert.deepEqual(LOGO_TILE_COLOURS, {
			light: LIGHT_PAPER,
			dark: DARK_PAPER,
		});
	});

	test("logoTileOf reads the exact word and anything else as light", ({
		assert,
	}) => {
		assert.equal(logoTileOf("dark"), "dark");
		assert.equal(logoTileOf("light"), "light");
		for (const stored of ["Dark", "", "accent", "dark "]) {
			assert.equal(logoTileOf(stored), "light", stored);
		}
	});
});
