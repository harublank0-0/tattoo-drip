/**
 * Where a page of work photos ended (TAT-126): the last photo's `created_at`
 * and id, so the next page starts after it even when other photos share
 * that instant, and when that photo has been removed meanwhile.
 *
 * `at` is the instant in UTC with exactly six fractional digits
 * (`2026-10-30T04:05:06.123456Z`). It is written by the database and passed
 * back to it as text and never goes through a JavaScript date, which would
 * round the microseconds Postgres keeps to milliseconds and skip photos.
 */
export type WorkCursor = { at: string; id: string };

const AT = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A cursor is 86 characters; anything much longer is not one. */
const MAX_LENGTH = 200;

/** The cursor as it travels in a URL: base64url of `at~id`, no padding. */
export function encodeWorkCursor({ at, id }: WorkCursor): string {
	return Buffer.from(`${at}~${id}`).toString("base64url");
}

/** The cursor in `text`, or null for anything `encodeWorkCursor` could not have made. */
export function decodeWorkCursor(text: string): WorkCursor | null {
	if (text.length > MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
	const bytes = Buffer.from(text, "base64url");
	// Only the canonical spelling: one text per cursor.
	if (bytes.toString("base64url") !== text) return null;
	const parts = bytes.toString("utf8").split("~");
	if (parts.length !== 2) return null;
	const [at, id] = parts;
	if (!isTime(at) || !ID.test(id)) return null;
	return { at, id };
}

/** A real UTC time Postgres takes: 31 February or month 13 would be a 500 there. */
function isTime(at: string): boolean {
	const match = AT.exec(at);
	if (!match || match[1] === "0000") return false;
	const seconds = at.slice(0, 19);
	const date = new Date(`${seconds}Z`);
	return (
		!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === seconds
	);
}
