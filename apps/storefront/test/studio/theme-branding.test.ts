import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	accentTokens,
	brandingCss,
	DARK,
	DISPLAY_FACES,
	darkAccent,
	isSafeCss,
	LIGHT,
} from "../../src/studio/theme/branding.ts";
import { contrastRatio } from "../../src/studio/theme/color.ts";
import {
	DEFAULT_THEME_CONFIG,
	FONT_KEYS,
	type ThemeConfig,
} from "../../src/studio/theme/config.ts";

const theme = (values: Partial<ThemeConfig>): ThemeConfig => ({
	...DEFAULT_THEME_CONFIG,
	...values,
});

/** 64 colours across the whole cube: every channel 00, 55, aa or ff. */
const GRID = ["00", "55", "aa", "ff"].flatMap((r) =>
	["00", "55", "aa", "ff"].flatMap((g) =>
		["00", "55", "aa", "ff"].map((b) => `#${r}${g}${b}`),
	),
);

describe("the schemes' fixed colours (TAT-54)", () => {
	const css = readFileSync(
		new URL("../../src/styles.css", import.meta.url),
		"utf8",
	);
	/** The declarations from `start` to the next "}". */
	const block = (start: string) => {
		const from = css.indexOf(start);
		assert.ok(from >= 0, start);
		return css.slice(from, css.indexOf("}", from));
	};
	const light = block(":root {");
	const dark = block("@media (prefers-color-scheme: dark) {");

	test("are src/styles.css's paper, ink and muted ink", () => {
		assert.match(light, new RegExp(`--paper: ${LIGHT.paper};`));
		assert.match(light, new RegExp(`--ink: ${LIGHT.ink};`));
		assert.match(light, new RegExp(`--ink-muted: ${LIGHT.inkMuted};`));
		assert.match(dark, new RegExp(`--paper: ${DARK.paper};`));
		assert.match(dark, new RegExp(`--ink: ${DARK.ink};`));
		assert.match(dark, new RegExp(`--ink-muted: ${DARK.inkMuted};`));
	});

	test("--on-stencil is each scheme's paper, so text on any accent that passes still passes", () => {
		assert.match(light, new RegExp(`--on-stencil: ${LIGHT.paper};`));
		assert.match(dark, new RegExp(`--on-stencil: ${DARK.paper};`));
	});
});

describe("accentTokens (TAT-54)", () => {
	test("a readable accent gets a darker hover and a light wash", () => {
		assert.deepEqual(accentTokens("#b91c1c", LIGHT), {
			stencil: "#b91c1c",
			stencilStrong: "#921b1b",
			stencilWash: "#f0d9d5",
		});
	});

	test("an accent under 4.5:1 on the paper is refused: the scheme keeps the theme's violet", () => {
		assert.equal(accentTokens("#facc15", LIGHT), null);
		assert.equal(accentTokens("#ffffff", LIGHT), null);
		assert.equal(accentTokens("#b91c1c", DARK), null);
	});

	test("whatever it keeps, every text on it passes 4.5:1, in both schemes", () => {
		for (const scheme of [LIGHT, DARK]) {
			for (const accent of GRID) {
				const tokens = accentTokens(accent, scheme);
				if (!tokens) {
					assert.ok(contrastRatio(accent, scheme.paper) < 4.5, accent);
					continue;
				}
				// Accent text on paper, and paper text (--on-stencil) on the accent and its hover.
				assert.ok(contrastRatio(tokens.stencil, scheme.paper) >= 4.5, accent);
				assert.ok(
					contrastRatio(tokens.stencilStrong, scheme.paper) >= 4.5,
					accent,
				);
				// The accent, the ink and the muted ink on the wash.
				for (const text of [tokens.stencil, scheme.ink, scheme.inkMuted]) {
					assert.ok(
						contrastRatio(text, tokens.stencilWash) >= 4.5,
						`${accent} ${text}`,
					);
				}
			}
		}
	});
});

describe("darkAccent (TAT-54)", () => {
	test("a readable accentDark is used as it is", () => {
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: "#fca5a5" }),
			"#fca5a5",
		);
	});

	test("else the accent, lightened until it reads on the dark paper", () => {
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: null }),
			"#ce6060",
		);
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: "#1c1917" }),
			"#ce6060",
		);
		// Already readable on the dark paper: unchanged.
		assert.equal(
			darkAccent({ accent: "#facc15", accentDark: null }),
			"#facc15",
		);
		for (const accent of GRID) {
			const dark = darkAccent({ accent, accentDark: null });
			assert.ok(dark, accent);
			assert.ok(contrastRatio(dark, DARK.paper) >= 4.5, accent);
		}
	});

	test("neither: null, the theme's own", () => {
		assert.equal(darkAccent({ accent: null, accentDark: null }), null);
		assert.equal(darkAccent({ accent: null, accentDark: "#1c1917" }), null);
	});
});

describe("DISPLAY_FACES (TAT-54)", () => {
	test("Eczar is the stylesheet's own; the others are on the phone already", () => {
		assert.deepEqual(Object.keys(DISPLAY_FACES), [...FONT_KEYS]);
		assert.equal(DISPLAY_FACES.eczar, null);
		assert.equal(DISPLAY_FACES.sans, "var(--body-face)");
		const serif = DISPLAY_FACES.serif ?? "";
		assert.match(serif, /Devanagari/);
		assert.match(serif, /, serif$/);
		assert.doesNotMatch(serif, /url\(|['"]/);
	});
});

describe("isSafeCss (TAT-54)", () => {
	test("refuses anything that could end the <style> or reach outside it", () => {
		for (const css of [
			"}</style><script>alert(1)</script>",
			"html{background:url(//evil.example/x.png)}",
			'html{font-family:"x"}',
			"html{font-family:'x'}",
			"html{color:red}/*",
			"html{content:\\3c}",
			"a&b",
			"html{color:red}\u0000",
			"html{color:red}\n",
			"<!--",
		]) {
			assert.equal(isSafeCss(css), false, css);
		}
		assert.equal(isSafeCss(""), true);
	});
});

describe("brandingCss (TAT-54)", () => {
	test("the default theme adds no CSS", () => {
		assert.equal(brandingCss(DEFAULT_THEME_CONFIG), null);
	});

	test("an accent sets the stencil tokens in each scheme's media query", () => {
		assert.equal(
			brandingCss(theme({ accent: "#b91c1c" })),
			"@media (prefers-color-scheme: light){html:root{--stencil:#b91c1c;--stencil-strong:#921b1b;--stencil-wash:#f0d9d5}}" +
				"@media (prefers-color-scheme: dark){html:root{--stencil:#ce6060;--stencil-strong:#d68281;--stencil-wash:#231715}}",
		);
		assert.equal(
			brandingCss(theme({ accent: "#b91c1c", accentDark: "#fca5a5" })),
			"@media (prefers-color-scheme: light){html:root{--stencil:#b91c1c;--stencil-strong:#921b1b;--stencil-wash:#f0d9d5}}" +
				"@media (prefers-color-scheme: dark){html:root{--stencil:#fca5a5;--stencil-strong:#f9b6b4;--stencil-wash:#302321}}",
		);
	});

	test("a scheme the accent can't be read in keeps the theme's violet", () => {
		// Yellow fails on the light paper and passes on the dark one.
		assert.equal(
			brandingCss(theme({ accent: "#facc15" })),
			"@media (prefers-color-scheme: dark){html:root{--stencil:#facc15;--stencil-strong:#f7d348;--stencil-wash:#302710}}",
		);
		assert.equal(brandingCss(theme({ accentDark: "#1c1917" })), null);
	});

	test("a font other than Eczar sets the display face", () => {
		assert.equal(
			brandingCss(theme({ font: "serif" })),
			"html:root{--display-face:Georgia, Noto Serif, Noto Serif Devanagari, Times New Roman, serif}",
		);
		assert.equal(
			brandingCss(theme({ font: "sans" })),
			"html:root{--display-face:var(--body-face)}",
		);
	});

	test("never writes anything isSafeCss refuses, whatever the accent", () => {
		for (const accent of GRID) {
			for (const font of FONT_KEYS) {
				const css = brandingCss(theme({ accent, accentDark: accent, font }));
				if (css !== null) assert.ok(isSafeCss(css), css);
			}
		}
	});

	test("a value that slipped past the checks is never written", () => {
		// Only possible if config.ts were bypassed: brandingCss still refuses it.
		assert.throws(() =>
			brandingCss(theme({ accent: "#fff}</style><script>" })),
		);
	});
});
