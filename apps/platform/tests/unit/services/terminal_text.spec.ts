import { test } from "@japa/runner";
import { terminalText } from "#services/terminal_text";

test.group("terminalText", () => {
	test("leaves ordinary text, Devanagari and joiners as they are", ({
		assert,
	}) => {
		for (const text of [
			"Kathmandu Ink",
			"Tattoo Point (tattoo-point)",
			"कला स्टुडियो",
			"क्\u200dष और क्\u200cत",
			"Café Ñandú 🖋",
			"",
		]) {
			assert.equal(terminalText(text), text);
		}
	});

	test("shows C0 and C1 controls, DEL and the Unicode separators as escapes", ({
		assert,
	}) => {
		assert.equal(
			terminalText("a\u001b[2Jb\rc\nd\te\u0000f\u007fg\u0085h\u009bi j k"),
			"a\\x1b[2Jb\\x0dc\\x0ad\\x09e\\x00f\\x7fg\\x85h\\x9bi\\u{2028}j\\u{2029}k",
		);
	});

	test("shows bidirectional overrides and marks, which can reorder what is read", ({
		assert,
	}) => {
		assert.equal(
			terminalText("a‮b⁦c‎d؜e"),
			"a\\u{202e}b\\u{2066}c\\u{200e}d\\u{61c}e",
		);
	});

	test("leaves no character a terminal would obey", ({ assert }) => {
		let everything = "";
		for (let code = 0; code <= 0xa0; code += 1) {
			everything += String.fromCodePoint(code);
		}
		assert.notMatch(terminalText(everything), /[\p{Cc}\p{Zl}\p{Zp}]/u);
	});
});
