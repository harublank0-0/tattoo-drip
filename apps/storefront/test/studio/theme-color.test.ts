import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	contrastRatio,
	MIN_TEXT_CONTRAST,
	mixColors,
	relativeLuminance,
} from "../../src/studio/theme/color.ts";

/** A ratio as the stylesheet's comment writes it: one decimal. */
const rounded = (ratio: number) => Math.round(ratio * 10) / 10;

describe("contrastRatio (TAT-54)", () => {
	test("black on white is 21, a colour on itself 1, in either order", () => {
		assert.equal(contrastRatio("#000000", "#ffffff"), 21);
		assert.equal(contrastRatio("#ffffff", "#000000"), 21);
		assert.equal(contrastRatio("#777777", "#777777"), 1);
		assert.equal(relativeLuminance("#000000"), 0);
		assert.equal(relativeLuminance("#ffffff"), 1);
		assert.equal(MIN_TEXT_CONTRAST, 4.5);
	});

	test("matches the contrast src/styles.css measured for its palette", () => {
		const light = [
			["#1c1917", 15.8],
			["#5e5650", 6.5],
			["#43389a", 8.4],
			["#8c8279", 3.4],
		] as const;
		for (const [color, ratio] of light) {
			assert.equal(rounded(contrastRatio(color, "#f7f3ee")), ratio, color);
		}
		const dark = [
			["#efe9e2", 15.6],
			["#a89f96", 7.2],
			["#a99cff", 8.0],
			["#6d645c", 3.2],
		] as const;
		for (const [color, ratio] of dark) {
			assert.equal(rounded(contrastRatio(color, "#14110f")), ratio, color);
		}
	});

	test("refuses anything but #rrggbb in lowercase", () => {
		for (const color of [
			"red",
			"#fff",
			"#FFFFFF",
			"#ffffff ",
			"ffffff",
			"#ffffff;color:red",
			"",
		]) {
			assert.throws(() => contrastRatio(color, "#ffffff"), color);
		}
	});
});

describe("mixColors (TAT-54)", () => {
	test("moves one colour toward another, channel by channel", () => {
		assert.equal(mixColors("#000000", "#ffffff", 0.5), "#808080");
		assert.equal(mixColors("#43389a", "#f7f3ee", 0), "#43389a");
		assert.equal(mixColors("#43389a", "#f7f3ee", 1), "#f7f3ee");
		assert.equal(mixColors("#ff0000", "#0000ff", 0.25), "#bf0040");
	});

	test("refuses anything but #rrggbb in lowercase", () => {
		assert.throws(() => mixColors("blue", "#ffffff", 0.5));
		assert.throws(() => mixColors("#000000", "url(x)", 0.5));
	});
});
