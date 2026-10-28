import { readFileSync } from "node:fs";
import { test } from "@japa/runner";
import {
	ARTIST_PLACEMENT_KEYS,
	ARTIST_PLACEMENTS,
	contrastRatio,
	DARK_PAPER,
	DEFAULT_FONT,
	DEFAULT_THEME,
	FONT_KEYS,
	FONTS,
	LIGHT_PAPER,
	lookOf,
	MIN_TEXT_CONTRAST,
	placementOf,
	readsOn,
	SECTION_KEYS,
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

/** The strings of `export const NAME = [ ... ] as const` in a source file. */
function listOf(source: string, name: string): string[] {
	const match = new RegExp(
		`export const ${name} = \\[([^\\]]*)\\] as const`,
	).exec(source);
	if (!match) throw new Error(`${name} is not in the storefront's source.`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const near = (actual: number, expected: number) =>
	Math.abs(actual - expected) < 0.0005;

test.group("the page look rules match the storefront's own", () => {
	test("the theme, section and font lists are the storefront's", ({
		assert,
	}) => {
		const config = storefront("src/studio/theme/config.ts");
		assert.deepEqual([...THEME_KEYS], listOf(config, "THEME_KEYS"));
		assert.deepEqual([...SECTION_KEYS], listOf(config, "SECTION_KEYS"));
		assert.deepEqual([...FONT_KEYS], listOf(config, "FONT_KEYS"));
		assert.match(config, /required: sectionList\("inquiry"\)/);
		assert.equal(DEFAULT_THEME, "stencil-and-ink");
		assert.match(config, /DEFAULT_FONT: FontKey = "eczar"/);
		assert.equal(DEFAULT_FONT, "eczar");
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
		storefrontSections: "inquiry,artists",
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
			sections: ["inquiry", "artists"],
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
		assert.deepEqual(onlyFont.sections, ["inquiry", "artists"]);
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
	test("sectionsOf keeps known keys once and adds the form if it is missing", ({
		assert,
	}) => {
		assert.deepEqual(sectionsOf("inquiry,artists,inquiry,flash"), [
			"inquiry",
			"artists",
		]);
		assert.deepEqual(sectionsOf("artists"), ["artists", "inquiry"]);
		assert.deepEqual(sectionsOf(""), ["inquiry"]);
		assert.deepEqual(sectionsOf("artists,inquiry"), ["artists", "inquiry"]);
	});

	test("placementOf reads back every placement", ({ assert }) => {
		for (const key of ARTIST_PLACEMENT_KEYS) {
			assert.equal(placementOf(ARTIST_PLACEMENTS[key]), key);
			assert.equal(
				placementOf(sectionsOf(ARTIST_PLACEMENTS[key].join(","))),
				key,
			);
		}
		assert.deepEqual(ARTIST_PLACEMENT_KEYS, ["first", "last", "hidden"]);
	});

	test("every placement keeps the form", ({ assert }) => {
		for (const key of ARTIST_PLACEMENT_KEYS) {
			assert.include([...ARTIST_PLACEMENTS[key]], "inquiry");
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
		for (const entry of [...THEMES, ...FONTS]) {
			assert.isAbove(entry.label.length, 0);
		}
		for (const theme of THEMES) assert.isAbove(theme.description.length, 0);
	});
});
