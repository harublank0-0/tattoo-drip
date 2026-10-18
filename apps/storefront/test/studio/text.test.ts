import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	cleanLine,
	cleanText,
	DESCRIPTION_MAX,
	trimDescription,
} from "../../src/studio/text.ts";

const graphemes = (text: string) =>
	Array.from(
		new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		(part) => part.segment,
	);

describe("cleanText", () => {
	test("keeps the owner's line breaks, in one style", () => {
		assert.equal(
			cleanText("Thamel Marg\r\nKathmandu\rNepal"),
			"Thamel Marg\nKathmandu\nNepal",
		);
	});

	test("keeps at most one blank line, drops spaces before a break, trims", () => {
		assert.equal(cleanText("  One.  \n\n\n\nTwo.\n "), "One.\n\nTwo.");
	});

	test("drops control characters but keeps tabs, joiners and Devanagari", () => {
		assert.equal(
			cleanText("a\u0000b\u0007c\u001bd\te\u200df क्ष"),
			"abcd\te\u200df क्ष",
		);
	});

	test("drops bidi overrides, embeddings, isolates and the byte order mark", () => {
		// A right-to-left override would mirror the rest of the page's text.
		assert.equal(cleanText("Black ‮Needle‬ Ink"), "Black Needle Ink");
		for (const mark of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "﻿"]) {
			assert.equal(
				cleanText(`a${mark}b`),
				"ab",
				`U+${mark.codePointAt(0)?.toString(16)}`,
			);
		}
		assert.equal(cleanText("﻿Sita"), "Sita");
		assert.equal(cleanLine("‮Sita⁩ ⁦Rai"), "Sita Rai");
	});

	test("keeps the joiners Devanagari and emoji need, and the harmless direction marks", () => {
		// क्‍ष with a zero width joiner and a zero width non-joiner in Devanagari
		const conjunct = "क्‍ष";
		const nonJoined = "क्‌ष";
		const family = "👨‍👩‍👧";
		assert.equal(cleanText(conjunct), conjunct);
		assert.equal(cleanText(nonJoined), nonJoined);
		assert.equal(cleanText(family), family);
		assert.equal(cleanLine(`${family} ${conjunct}`), `${family} ${conjunct}`);
		assert.equal(cleanText("a‎b‏c"), "a‎b‏c");
	});

	test("blank or missing text is null", () => {
		for (const value of ["", "  \n\t ", null, undefined]) {
			assert.equal(cleanText(value), null, JSON.stringify(value));
		}
	});
});

describe("cleanLine", () => {
	test("puts a name on one line", () => {
		assert.equal(cleanLine("  Sita \n\t Rai "), "Sita Rai");
		assert.equal(cleanLine("   "), null);
	});
});

describe("trimDescription", () => {
	test("leaves a short text whole, on one line", () => {
		assert.equal(
			trimDescription("Fine line\nand  blackwork. "),
			"Fine line and blackwork.",
		);
	});

	test("cuts a long text at a space and marks the cut", () => {
		const text = "Fine line and blackwork in Thamel. ".repeat(10);
		const out = trimDescription(text);
		const kept = out.slice(0, -1);

		assert.ok(out.endsWith("…"));
		assert.ok(graphemes(out).length <= DESCRIPTION_MAX);
		assert.ok(text.startsWith(kept));
		assert.ok(!kept.endsWith(" "));
		assert.equal(text[kept.length], " ");
	});

	test("never splits Devanagari words", () => {
		const word = "फाइनलाइन";
		const text = Array(60).fill(word).join(" ");
		const out = trimDescription(text);
		const kept = out.slice(0, -1);

		assert.ok(out.endsWith("…"));
		assert.ok(text.startsWith(kept));
		assert.ok(kept.endsWith(word));
		assert.ok(graphemes(out).length <= DESCRIPTION_MAX);
	});

	test("never splits an emoji or an accent, even without spaces", () => {
		const family = "👨‍👩‍👧";
		assert.equal(
			trimDescription(family.repeat(200)),
			`${family.repeat(DESCRIPTION_MAX - 1)}…`,
		);
		const accented = "é";
		assert.equal(
			trimDescription(accented.repeat(200)),
			`${accented.repeat(DESCRIPTION_MAX - 1)}…`,
		);
	});
});
