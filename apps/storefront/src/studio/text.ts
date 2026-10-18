/**
 * Text as the studio page shows it (TAT-48). Pure, so the loaders, the head
 * and the tests share it. Everything the API sends is plain text, rendered
 * as React text, never as HTML.
 */

/** Control characters other than tab and newline. */
const CONTROL = /(?![\t\n])\p{Cc}/gu;

/**
 * Multi-line text from the API (an intro, a bio, an address, a closed
 * message), ready for `white-space: pre-line`: Windows and old Mac line ends
 * become "\n", control characters go, spaces before a line break go, more
 * than one blank line becomes one, and the ends are trimmed. Joiners
 * (U+200C, U+200D) stay: Devanagari and emoji need them. Blank text is null.
 */
export function cleanText(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const text = value
		.replace(/\r\n?/g, "\n")
		.replace(CONTROL, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text === "" ? null : text;
}

/** One-line text (a name): every run of whitespace becomes one space. */
export function cleanLine(value: string | null | undefined): string | null {
	const text = cleanText(value);
	return text === null ? null : text.replace(/\s+/gu, " ");
}

/** The longest meta description, in user-perceived characters. */
export const DESCRIPTION_MAX = 160;

/**
 * A meta description from free text: one line, at most `max` graphemes
 * (user-perceived characters, so a Devanagari cluster or an emoji is never
 * split), cut at the last space when one falls in the second half, and
 * ending in "…" when cut.
 */
export function trimDescription(text: string, max = DESCRIPTION_MAX): string {
	const flat = text.replace(/\s+/gu, " ").trim();
	const parts = graphemes(flat);
	if (parts.length <= max) return flat;
	const kept = parts.slice(0, max - 1);
	const space = kept.lastIndexOf(" ");
	const cut = space >= Math.floor(max / 2) ? kept.slice(0, space) : kept;
	return `${cut.join("").trimEnd()}…`;
}

function graphemes(text: string): string[] {
	if (typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		});
		return Array.from(segmenter.segment(text), (part) => part.segment);
	}
	return Array.from(text);
}
