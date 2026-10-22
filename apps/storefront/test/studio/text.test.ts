import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	cleanLine,
	cleanText,
	DESCRIPTION_MAX,
	LOCATION_MAX,
	locationLine,
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
		assert.equal(cleanText("Black \u202eNeedle\u202c Ink"), "Black Needle Ink");
		for (const mark of [
			"\u202a",
			"\u202b",
			"\u202c",
			"\u202d",
			"\u202e",
			"\u2066",
			"\u2067",
			"\u2068",
			"\u2069",
			"\ufeff",
		]) {
			assert.equal(
				cleanText(`a${mark}b`),
				"ab",
				`U+${mark.codePointAt(0)?.toString(16)}`,
			);
		}
		assert.equal(cleanText("\ufeffSita"), "Sita");
		assert.equal(cleanLine("\u202eSita\u2069 \u2066Rai"), "Sita Rai");
	});

	test("keeps the joiners Devanagari and emoji need, and the harmless direction marks", () => {
		// Devanagari "kssa": ka, virama, ZWJ or ZWNJ, ssa; and an emoji family joined by ZWJ.
		const conjunct = "क्\u200dष";
		const nonJoined = "क्\u200cष";
		const family = "👨\u200d👩\u200d👧";
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
		const family = "👨\u200d👩\u200d👧";
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

describe("locationLine", () => {
	test("is nothing without an address", () => {
		assert.equal(locationLine(null), null);
		assert.equal(locationLine(""), null);
		assert.equal(locationLine(" \n , \n"), null);
	});

	test("puts a short address on one line, its lines and commas in the owner's order", () => {
		assert.equal(locationLine("Thamel, Kathmandu"), "Thamel, Kathmandu");
		assert.equal(
			locationLine("Thamel Marg\nKathmandu"),
			"Thamel Marg, Kathmandu",
		);
		assert.equal(locationLine("  Patan  \n\n Lalitpur "), "Patan, Lalitpur");
	});

	test("keeps a Devanagari address whole, with its conjuncts", () => {
		assert.equal(locationLine("ठमेल\nकाठमाडौं"), "ठमेल, काठमाडौं");
		assert.equal(locationLine("क्\u200dषेत्री टोल, ठमेल"), "क्\u200dषेत्री टोल, ठमेल");
	});

	test("a long address keeps its last two parts: the area and the city", () => {
		const address =
			"House 12, Third floor, Jyatha Road, Thamel, Kathmandu 44600";
		assert.ok([...address].length > LOCATION_MAX);
		assert.equal(locationLine(address), "Thamel, Kathmandu 44600");
		assert.equal(
			locationLine(
				"Third floor, Narayan Gopal Chowk Complex\nMaharajgunj\nKathmandu",
			),
			"Maharajgunj, Kathmandu",
		);
	});

	test("counts what a reader sees, not code points: a Devanagari address under the limit stays whole", () => {
		const address = "बानेश्वर, काठमाडौं, बागमती प्रदेश";
		assert.ok([...address].length > 30);
		assert.equal(locationLine(address), address);
	});

	test("never cuts inside a part or adds an ellipsis: a part longer than the limit stays whole", () => {
		const long = "a".repeat(LOCATION_MAX + 20);
		assert.equal(locationLine(`${long}, Pokhara`), `${long}, Pokhara`);
		assert.equal(locationLine(long), long);
		assert.doesNotMatch(String(locationLine("x, ".repeat(40))), /…/);
	});
});
