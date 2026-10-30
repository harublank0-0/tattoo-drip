/**
 * Text as the studio page shows it (TAT-48). Pure, so the loaders, the head
 * and the tests share it. Everything the API sends is plain text, rendered
 * as React text, never as HTML.
 */

/**
 * What never reaches the page: control characters other than tab and newline;
 * the bidi embeddings and overrides (U+202A to U+202E) and isolates (U+2066 to
 * U+2069), which would reorder or mirror the text around them (`dir="auto"`
 * and `<bdi>` don't undo an explicit override); and the byte order mark
 * (U+FEFF). The joiners (U+200C, U+200D) and the direction marks (U+200E,
 * U+200F) stay: Devanagari, emoji sequences and mixed-script names use them.
 */
const CONTROL = /(?![\t\n])\p{Cc}|[\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/**
 * A surrogate with no partner (a JSON "\ud800" the API passed on): `\p{Cs}`
 * matches only an unpaired one in a `u` regex, so a real pair (an emoji) is
 * left whole. `encodeURIComponent` throws on one, and a name is encoded into
 * the chat link on every page. The same repair as `String.prototype
 * .toWellFormed`, which the ES2022 lib and older browsers lack.
 */
const LONE_SURROGATE = /\p{Cs}/gu;

/**
 * Multi-line text from the API (an intro, a bio, an address, a closed
 * message), ready for `white-space: pre-line`: Windows and old Mac line ends
 * become "\n", control characters go, spaces before a line break go, more
 * than one blank line becomes one, and the ends are trimmed. Bidi overrides
 * and the byte order mark go too, and an unpaired surrogate becomes U+FFFD;
 * joiners (U+200C, U+200D) stay: Devanagari and emoji need them. Blank text
 * is null.
 */
export function cleanText(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const text = value
		.replace(LONE_SURROGATE, "\uFFFD")
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

/** The longest address, in user-perceived characters, the hero's location line shows whole. */
export const LOCATION_MAX = 48;

/**
 * The hero's one location line (TAT-105) from the address text: its lines and
 * comma-separated parts in the owner's order, on one line, and never longer
 * than `LOCATION_MAX` user-perceived characters (the contract allows a
 * 300-character address, and a longer line would push the buttons off a
 * phone's first screen). The first of these that fits: the whole address, its
 * last two parts (usually the area and the city, "Thamel, Kathmandu"), its
 * last part, else null (the hero then shows the kind of studio). The whole
 * address stays under "Visit". Never cut inside a part and never an ellipsis
 * (names and addresses may be Devanagari).
 */
export function locationLine(
	address: string | null | undefined,
): string | null {
	if (typeof address !== "string") return null;
	const parts = address
		.split(/[\n,]+/)
		.map((part) => part.replace(/\s+/gu, " ").trim())
		.filter((part) => part !== "");
	const fits = (line: string) => graphemes(line).length <= LOCATION_MAX;
	const candidates = [
		parts.join(", "),
		parts.slice(-2).join(", "),
		parts.slice(-1).join(", "),
	];
	return candidates.find((line) => line !== "" && fits(line)) ?? null;
}

/** The user-perceived characters of `text`, by Intl.Segmenter when there is one. */
export function graphemes(text: string): string[] {
	if (typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		});
		return Array.from(segmenter.segment(text), (part) => part.segment);
	}
	return Array.from(text);
}
