import { cleanLine, cleanText, graphemes } from "./text.ts";
import { ARTIST_SLUG } from "./view-model.ts";

/*
 * What a client's review and Fresh ink share on the studio's page: a day,
 * a shown name, an artist tag, plain text and the review's excerpt. Here
 * so reviews.ts and fresh-ink.ts can each read the other's linked item
 * (docs/superpowers/specs/2026-11-19-review-fresh-ink-link-design.md)
 * without importing each other.
 */

/** A shown name at most, in characters (the contract's). */
const MAX_NAME = 40;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A linked review's excerpt in the Fresh ink viewer, at most, in characters before "…". */
const EXCERPT = 200;

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/** A day the API sent ("2026-10-01"), as the page says it ("October 2026") and as `<time dateTime>` takes it. */
export interface DayView {
	readonly text: string;
	readonly dateTime: string;
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

/**
 * A day the API sent, as the page says it: "October 2026" (the month is
 * enough for a review and keeps server and browser the same: it is read in
 * UTC), or null for anything that is not a real YYYY-MM-DD day.
 */
export function dayView(value: unknown): DayView | null {
	if (typeof value !== "string") return null;
	const match = DAY.exec(value);
	if (!match) return null;
	const date = new Date(`${value}T00:00:00Z`);
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		return null;
	}
	return { text: MONTH_YEAR.format(date), dateTime: value };
}

/** A visible artist's tag ({ slug, name }), with their page; null for anything else. */
export function readArtistTag(
	value: unknown,
): { readonly name: string; readonly href: string } | null {
	const slug = own(value, "slug");
	if (typeof slug !== "string" || !ARTIST_SLUG.test(slug)) return null;
	const name = own(value, "name");
	return {
		name: (typeof name === "string" ? cleanLine(name) : null) ?? slug,
		href: `/artists/${slug}`,
	};
}

/** A shown name: one line, 1 to 40 characters, else null (the item is dropped). */
export function readShownName(value: unknown): string | null {
	const line = typeof value === "string" ? cleanLine(value) : null;
	return line && Array.from(line).length <= MAX_NAME ? line : null;
}

/** Plain text up to `max` characters, its line breaks kept, else null. */
export function readText(value: unknown, max: number): string | null {
	const text = typeof value === "string" ? cleanText(value) : null;
	return text && Array.from(text).length <= max ? text : null;
}

/**
 * A review's start, for the Fresh ink viewer: null when the whole text is
 * 200 user-perceived characters or fewer (graphemes: an emoji, a flag or a
 * Devanagari cluster is one, never split); else its first 200, cut back to
 * the last whitespace when one falls in the second half (so "Wow " before a
 * long unspaced run, as Thai or Japanese text is, isn't the whole excerpt),
 * trimmed, with "…". As `trimDescription` cuts a meta description.
 */
export function excerptOf(body: string): string | null {
	const parts = graphemes(body);
	if (parts.length <= EXCERPT) return null;
	const kept = parts.slice(0, EXCERPT);
	let space = -1;
	for (let index = kept.length - 1; index >= 0; index--) {
		if (/^\s+$/u.test(kept[index])) {
			space = index;
			break;
		}
	}
	const cut = space >= Math.floor(EXCERPT / 2) ? kept.slice(0, space) : kept;
	return `${cut.join("").trimEnd()}…`;
}
