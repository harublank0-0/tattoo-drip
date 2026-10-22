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

	test("a long address with two parts, or one, falls back to its last part, then to nothing", () => {
		const directions =
			"Opposite the Ganesh temple on the main road going up from the bus park";
		assert.ok(graphemes(directions).length > LOCATION_MAX);
		// Two parts: the whole and "the last two" are the same line, so the city is what is left.
		assert.equal(locationLine(`${directions}, Kathmandu`), "Kathmandu");
		// One part over the limit has nothing shorter to fall back to: the hero shows the studio type.
		assert.equal(locationLine(directions), null);
		assert.equal(locationLine("x".repeat(300)), null);
		assert.equal(locationLine(`${"word ".repeat(59)}word`), null);
	});

	test("when the last two parts are long but the last one is short, the last one is the line", () => {
		const address =
			"Third floor, Narayan Gopal Chowk Complex Maharajgunj Road, Kathmandu";
		assert.ok(
			graphemes("Narayan Gopal Chowk Complex Maharajgunj Road, Kathmandu")
				.length > LOCATION_MAX,
		);
		assert.equal(locationLine(address), "Kathmandu");
	});

	test("a long Devanagari address falls back by what a reader counts: the area and city, then the city", () => {
		const long =
			"ठमेल मार्ग गणेश मन्दिरको अगाडि, पुरानो बसपार्क माथि, नीलो फार्मेसी छेउमा, काठमाडौं";
		assert.ok(graphemes(long).length > LOCATION_MAX);
		assert.equal(locationLine(long), "नीलो फार्मेसी छेउमा, काठमाडौं");
		const longer =
			"पुरानो बसपार्क माथिको सडकमा गणेश मन्दिरको अगाडिको पुरानो पसलको छेउमा, काठमाडौं";
		assert.equal(locationLine(longer), "काठमाडौं");
		assert.equal(locationLine("क्\u200dषेत्री ".repeat(20).trim()), null);
	});

	test("never longer than the limit, never cut inside a part, never an ellipsis", () => {
		const addresses = [
			"Thamel",
			"x, ".repeat(40),
			"a".repeat(LOCATION_MAX + 20),
			`${"a".repeat(LOCATION_MAX + 20)}, Pokhara`,
			"House 12, Third floor, Jyatha Road, Thamel, Kathmandu 44600",
			"Opposite the temple, next to the pharmacy, behind the old bus park, Kathmandu",
			"ठमेल\n".repeat(30),
			"क्\u200dष, ".repeat(25),
			`${"é".repeat(30)}\n${"é".repeat(30)}`,
		];
		for (const address of addresses) {
			const line = locationLine(address);
			if (line === null) continue;
			assert.ok(graphemes(line).length <= LOCATION_MAX, address);
			assert.doesNotMatch(line, /…|\.\.\./, address);
			const parts = address
				.split(/[\n,]+/)
				.map((part) => part.trim())
				.filter(Boolean);
			assert.ok(
				[parts.join(", "), parts.slice(-2).join(", "), parts.at(-1)].includes(
					line,
				),
				`${address} -> ${line}`,
			);
		}
	});
});
