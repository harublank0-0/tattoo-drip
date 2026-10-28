import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contrastRatio } from "../../src/studio/theme/color.ts";

/**
 * The logo's light tile (TAT-56): a studio's logo sits on a small light tile
 * wherever it shows, in both colour schemes, so a dark logo with a
 * see-through background still reads over the cover photo, in dark mode, in
 * the artist page's bar and on the deposit page. These tests read the rules
 * from styles.css.
 */
const css = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule with exactly this selector. */
function rule(selector: string): string {
	for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const own = match[1].split(/[;}]/).pop()?.trim();
		if (own === selector) return match[2];
	}
	return "";
}

const LOGOS = [
	{ selector: ".profile-logo", height: "4rem" },
	{ selector: ".site-bar-logo", height: "2rem" },
	{ selector: ".deposit-logo", height: "2.75rem" },
];

describe("the logo's light tile (TAT-56)", () => {
	test("--logo-plate is the light paper, defined once, on :root and not in the dark block", () => {
		const defs = [...bare.matchAll(/--logo-plate:\s*([^;]+);/g)];
		assert.equal(defs.length, 1, "defined exactly once");
		assert.equal(defs[0][1].trim(), "#f7f3ee");
		const dark = bare.indexOf("@media (prefers-color-scheme: dark) {");
		assert.ok(dark > 0);
		assert.ok(
			(defs[0].index ?? Number.POSITIVE_INFINITY) < dark,
			"before the dark block",
		);
		assert.match(
			rule(":root"),
			/--logo-plate:\s*#f7f3ee;/,
			"the plain :root rule holds it",
		);
	});

	for (const { selector, height } of LOGOS) {
		test(`${selector} is drawn on the tile and keeps its image ${height} tall`, () => {
			const body = rule(selector);
			assert.match(body, /box-sizing:\s*content-box/);
			assert.match(body, /padding:\s*0\.25rem/);
			assert.match(body, /background:\s*var\(--logo-plate\)/);
			assert.match(body, /border-radius:\s*var\(--radius\)/);
			// content-box: the image's own box stays this tall, the tile is the padding around it.
			assert.match(
				body,
				new RegExp(`block-size:\\s*${height.replace(".", "\\.")}`),
			);
		});
	}

	test("the studio's ink on the tile reads at 15.8:1 or better", () => {
		assert.ok(contrastRatio("#1c1917", "#f7f3ee") >= 15.8);
	});
});
