/**
 * Where a Discover page ended (Discover D03): the sort it was read in, the
 * last row's sort value and its id, so the next page starts right after it
 * (keyset paging: no row is skipped or repeated while rows are added, and
 * ties on the value are broken by the id).
 *
 * - `name` / `-name`: the value is `lower(name)` as the database computed it.
 * - `newest`: the instant in UTC with six fractional digits, written and
 *   read back by the database as text (a JavaScript date would round
 *   Postgres's microseconds and skip rows).
 *
 * It travels as base64url of a JSON array, canonical only, so one cursor has
 * one spelling; a cursor of another sort is not one.
 */
export type DiscoverSort = "name" | "-name" | "newest";
export type DiscoverCursor = { sort: DiscoverSort; value: string; id: string };

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SORTS: readonly DiscoverSort[] = ["name", "-name", "newest"];
/** Postgres refuses a NUL in text with an error of its own; names never hold control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;
/**
 * A name is at most 120 characters, and lower() can lengthen a few (U+0130
 * becomes two code points): room for that, never for anything much longer.
 */
const MAX_NAME_VALUE = 160;
/** The longest name value's JSON, base64url-encoded, stays below this. */
export const MAX_CURSOR_LENGTH = 1000;

export function encodeDiscoverCursor({
	sort,
	value,
	id,
}: DiscoverCursor): string {
	return Buffer.from(JSON.stringify([sort, value, id])).toString("base64url");
}

/** The cursor in `text` for a page read in `sort`, or null for anything else. */
export function decodeDiscoverCursor(
	text: string,
	sort: DiscoverSort,
): DiscoverCursor | null {
	if (text.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) {
		return null;
	}
	const bytes = Buffer.from(text, "base64url");
	if (bytes.toString("base64url") !== text) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length !== 3) return null;
	const [cursorSort, value, id] = parsed;
	if (cursorSort !== sort || !SORTS.includes(cursorSort)) return null;
	if (typeof value !== "string" || typeof id !== "string" || !ID.test(id)) {
		return null;
	}
	if (
		sort === "newest"
			? !isInstant(value)
			: value.length > MAX_NAME_VALUE || CONTROL.test(value)
	) {
		return null;
	}
	// One spelling per cursor: the same array must encode to the same text.
	if (encodeDiscoverCursor({ sort, value, id }) !== text) return null;
	return { sort, value, id };
}

/** A real UTC instant Postgres takes: 31 February or month 13 would be its error. */
function isInstant(value: string): boolean {
	if (!AT.test(value)) return false;
	const [date, time] = value.slice(0, 19).split("T");
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute, second] = time.split(":").map(Number);
	if (year === 0) return false;
	const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	return (
		at.getUTCFullYear() === year &&
		at.getUTCMonth() === month - 1 &&
		at.getUTCDate() === day &&
		at.getUTCHours() === hour &&
		at.getUTCMinutes() === minute &&
		at.getUTCSeconds() === second
	);
}
