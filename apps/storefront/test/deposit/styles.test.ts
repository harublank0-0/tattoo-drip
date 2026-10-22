import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/*
 * The deposit page's layout rules that a node test can pin (TAT-110). The
 * browser pass measures the rest. A named grid area that its template doesn't
 * define makes implicit lines, and every item then lands in one cell: so the
 * names live only inside the desktop media query, where the template is.
 */

const css = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);

/** The text between the braces that open at `from`'s first "{" after it, braces balanced. */
function blockAt(text: string, from: number): { body: string; end: number } {
	const open = text.indexOf("{", from);
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === "{") depth++;
		if (text[index] === "}" && --depth === 0) {
			return { body: text.slice(open + 1, index), end: index + 1 };
		}
	}
	throw new Error("unbalanced braces");
}

/** The deposit's desktop media block: the one that mentions .deposit-wide. */
function desktop(): { body: string; rest: string } {
	const marker = "@media (min-width: 60rem)";
	for (
		let at = css.indexOf(marker);
		at !== -1;
		at = css.indexOf(marker, at + 1)
	) {
		const { body, end } = blockAt(css, at);
		if (body.includes(".deposit-wide")) {
			return { body, rest: css.slice(0, at) + css.slice(end) };
		}
	}
	throw new Error("no desktop block for .deposit-wide");
}

describe("the deposit page's styles", () => {
	test("the I've paid bar is sticky to the bottom edge, below 60rem only", () => {
		const { body, rest } = desktop();

		assert.match(
			rest,
			/\.deposit-paid-bar\s*\{[^}]*position:\s*sticky[^}]*inset-block-end:\s*0/,
		);
		assert.match(body, /\.deposit-paid-bar[^{}]*\{[^}]*display:\s*none/);
	});

	test("a sticky bar needs a flex or block container, not a grid cell: .deposit-due is a grid only on a desktop", () => {
		const { body, rest } = desktop();

		assert.doesNotMatch(rest, /\.deposit-due\s*\{[^}]*display:\s*grid/);
		assert.match(rest, /\.deposit-due\s*\{[^}]*display:\s*flex/);
		assert.match(body, /\.deposit-wide \.deposit-due\s*\{[^}]*display:\s*grid/);
	});

	test("grid-area names appear only inside the desktop media query", () => {
		const { body, rest } = desktop();

		assert.doesNotMatch(rest, /grid-area/);
		assert.match(body, /grid-template-areas/);
		for (const name of ["amount", "code", "pay", "proof", "policy", "panel"]) {
			assert.match(body, new RegExp(`grid-area:\\s*${name}\\b`), name);
		}
	});

	test("the picked method's panel is sticky beside the steps on a desktop", () => {
		const { body } = desktop();

		assert.match(
			body,
			/\.deposit-wide \.deposit-method-panel\s*\{[^}]*position:\s*sticky[^}]*align-self:\s*start/,
		);
	});

	test("a long unbroken studio or artist name wraps inside the header instead of widening the page", () => {
		assert.match(
			css,
			/\.deposit-header-text\s*\{[^}]*overflow-wrap:\s*anywhere/,
		);
	});

	test("a focused control in steps 1 and 2 is never hidden under the bar (WCAG 2.4.11)", () => {
		assert.match(
			css,
			/:root:has\(\.deposit-paid-bar\)\s*\{[^}]*scroll-padding-block-end:\s*5rem/,
		);
	});
});
