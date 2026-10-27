import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contrastRatio, mixColors } from "../../src/studio/theme/color.ts";

/**
 * The cover hero (TAT-116): the studio's photo with its name over it. The
 * text sits on a scrim that keeps it readable over any photo, and the photo's
 * box shows a dark placeholder until the image arrives, so the name reads
 * first on a slow line. These tests read the rules from styles.css.
 */
const css = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule with exactly this selector. */
function rule(selector: string, within = bare): string {
	for (const match of within.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		// A rule's selector follows the last statement or rule before it.
		const own = match[1].split(/[;}]/).pop()?.trim();
		if (own === selector) return match[2];
	}
	return "";
}

/** The text of the `@media (min-width: 60rem)` block that holds the cover. */
function wideBlock(): string {
	const start = bare.indexOf("@media (min-width: 60rem) {");
	assert.ok(start >= 0, "no 60rem block");
	let depth = 0;
	for (let at = bare.indexOf("{", start); at < bare.length; at++) {
		if (bare[at] === "{") depth++;
		if (bare[at] === "}" && --depth === 0) return bare.slice(start, at + 1);
	}
	return assert.fail("unbalanced 60rem block");
}

const token = (name: string, within: string) =>
	new RegExp(`${name}:\\s*([^;]+);`).exec(within)?.[1].trim();

/** The `:root` block that defines the tokens, not the dark scheme's. */
const rootBody = rule(":root");
const darkBlock =
	/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
		bare,
	)?.[1] ?? "";

describe("the cover's colours", () => {
	test("the photo colours are the same in both schemes", () => {
		for (const name of ["--on-photo", "--photo-shade", "--photo-scrim"]) {
			assert.ok(token(name, rootBody), `${name} is in :root`);
			assert.ok(darkBlock.includes("--paper"), "found the dark scheme");
			assert.equal(
				token(name, darkBlock),
				undefined,
				`${name} is not redefined for dark`,
			);
		}
	});

	test("the name keeps 7:1 over a white photo under the scrim", () => {
		const onPhoto = token("--on-photo", rootBody) as string;
		const scrim = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/.exec(
			token("--photo-scrim", rootBody) ?? "",
		);
		assert.ok(scrim, "--photo-scrim is rgb(r g b / alpha)");
		const [, r, g, b, alpha] = scrim;
		const hex = `#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
		const overWhite = mixColors("#ffffff", hex, Number(alpha));
		const ratio = contrastRatio(onPhoto, overWhite);
		assert.ok(ratio >= 7, `on a white photo: ${ratio.toFixed(2)}:1`);
		// The placeholder shown while the photo loads.
		const shade = token("--photo-shade", rootBody) as string;
		assert.ok(contrastRatio(onPhoto, shade) >= 7, "on the placeholder");
	});
});

describe("the cover's box", () => {
	test("is 4:3 on a phone and 21:9 from 60rem, across both columns", () => {
		assert.match(rule(".profile-cover"), /aspect-ratio:\s*4\s*\/\s*3/);
		const wide = rule(".profile-cover", wideBlock());
		assert.match(wide, /aspect-ratio:\s*21\s*\/\s*9/);
		assert.match(wide, /grid-column:\s*1\s*\/\s*-1/);
	});

	test("the photo fills it, crops toward the top and shows a dark placeholder first", () => {
		const body = rule(".profile-cover > img");
		assert.match(body, /object-fit:\s*cover/);
		assert.match(body, /object-position:\s*50%\s+25%/);
		assert.match(body, /background:\s*var\(--photo-shade\)/);
		assert.match(body, /position:\s*absolute/);
	});

	test("the name never sits on the scrim's fade: its padding equals the fade", () => {
		const heading = rule(".profile-cover .profile-heading");
		const fade = /calc\(100%\s*-\s*([\d.]+)rem\)/.exec(heading)?.[1];
		const padding = /padding:\s*([\d.]+)rem/.exec(heading)?.[1];
		assert.ok(fade, "the gradient fades over a fixed length");
		assert.equal(padding, fade, "the top padding is the fade");
		assert.match(heading, /var\(--photo-scrim\)/);
		assert.match(heading, /color:\s*var\(--on-photo\)/);
		// The wide screen keeps the same top padding, so the same rule holds.
		const wide = rule(".profile-cover .profile-heading", wideBlock());
		assert.equal(/padding:\s*([\d.]+)rem/.exec(wide)?.[1], fade);
	});

	test("the location line is the photo's text colour too", () => {
		assert.match(
			rule(".profile-cover .profile-location"),
			/color:\s*var\(--on-photo\)/,
		);
	});
});

describe("a cover and a logo together (TAT-116 fix round 1)", () => {
	test("only the cover's own image gets the cover styles: no rule selects the cover's descendant images", () => {
		// The logo sits inside the cover's heading when a theme supplies both;
		// a descendant selector would stretch it over the heading.
		const selectors = Array.from(bare.matchAll(/([^{}]+)\{/g), (match) =>
			match[1].split(/[;}]/).pop()?.trim(),
		);
		const onCoverImages = selectors.filter(
			(selector) =>
				selector?.startsWith(".profile-cover") && /\bimg\b/.test(selector),
		);
		assert.deepEqual(onCoverImages, [".profile-cover > img"]);
		// The logo keeps its own contained layout.
		const logo = rule(".profile-logo");
		assert.match(logo, /object-fit:\s*contain/);
		assert.match(logo, /block-size:\s*4rem/);
		assert.doesNotMatch(logo, /position:\s*absolute/);
	});
});
