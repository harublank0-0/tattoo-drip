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

	// content-box adds the padding to the image's width, so a cap of `100%` would let the tile
	// overflow a container narrower than the logo's own cap plus its padding (12.5rem).
	test(".profile-logo's cap leaves room for the tile's padding, so the tile fits its container", () => {
		const body = rule(".profile-logo");
		const padding = Number(/padding:\s*([\d.]+)rem/.exec(body)?.[1]);
		assert.ok(padding > 0, "the tile has padding");
		const cap =
			/max-inline-size:\s*min\(\s*([\d.]+)rem,\s*calc\(\s*100%\s*-\s*([\d.]+)rem\s*\)\s*\)/.exec(
				body,
			);
		assert.ok(
			cap,
			"max-inline-size is min(<cap>rem, calc(100% - <padding on both sides>rem))",
		);
		assert.equal(
			Number(cap[1]),
			12,
			"the logo's own cap stays 12rem (srcset.test.ts, logoSizes)",
		);
		assert.equal(Number(cap[2]), padding * 2, "both sides of the padding");
	});

	test("the studio's ink on the tile reads at 15.8:1 or better, with the colours read from the stylesheet", () => {
		const root = rule(":root");
		const ink = /--ink:\s*(#[0-9a-f]{6});/.exec(root)?.[1];
		const plate = /--logo-plate:\s*(#[0-9a-f]{6});/.exec(root)?.[1];
		assert.ok(ink && plate, "--ink and --logo-plate are in :root");
		assert.ok(contrastRatio(ink as string, plate as string) >= 15.8);
	});
});

describe("the logo's dark tile (TAT-123)", () => {
	const DARK_LOGOS = LOGOS.map(
		({ selector }) => `${selector}[data-tile="dark"]`,
	);

	test("--logo-plate-dark is the dark paper, defined once, on :root and not in the dark block", () => {
		const defs = [...bare.matchAll(/--logo-plate-dark:\s*([^;]+);/g)];
		assert.equal(defs.length, 1, "defined exactly once");
		assert.equal(defs[0][1].trim(), "#14110f");
		const dark = bare.indexOf("@media (prefers-color-scheme: dark) {");
		assert.ok(dark > 0);
		assert.ok(
			(defs[0].index ?? Number.POSITIVE_INFINITY) < dark,
			"before the dark block",
		);
		assert.match(rule(":root"), /--logo-plate-dark:\s*#14110f;/);
	});

	test("one rule puts the three logos on it when their tile is dark", () => {
		const selector = DARK_LOGOS.join(", ");
		assert.match(
			rule(selector),
			/background:\s*var\(--logo-plate-dark\)/,
			"the one rule",
		);
	});

	test("white on the dark tile reads at 18:1 or better", () => {
		const plate = /--logo-plate-dark:\s*(#[0-9a-f]{6});/.exec(
			rule(":root"),
		)?.[1];
		assert.ok(plate);
		assert.ok(contrastRatio("#ffffff", plate as string) >= 18);
	});
});
