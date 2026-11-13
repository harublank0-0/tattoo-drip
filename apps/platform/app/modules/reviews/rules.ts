/**
 * Reviews and Fresh ink (docs/superpowers/specs/
 * 2026-11-12-reviews-and-fresh-ink-design.md): the rules as plain values and
 * functions, no I/O, so a unit test runs them. The database checks the same
 * limits (migration 1791920000000); the validators and services apply them
 * first, with words for people.
 */

/** A review's rating: whole stars (ruling 5). */
export const MIN_RATING = 1;
export const MAX_RATING = 5;
/** A review's text, in characters as PostgreSQL counts them (code points). */
export const MIN_REVIEW_LENGTH = 20;
export const MAX_REVIEW_LENGTH = 2000;
/** The name shown with a review or post (ruling 9), any script. */
export const MAX_SHOWN_NAME_LENGTH = 40;
/** A Fresh ink post's caption (ruling 5). */
export const MAX_CAPTION_LENGTH = 280;
/** Where it is on the body, in the client's words (the inquiry's placement column). */
export const MAX_PLACEMENT_LENGTH = 120;
/** Styles per post, from the studio's list (ruling 5). */
export const MAX_POST_STYLES = 3;
/** Photos and videos per post: a lead photo and up to seven more (ruling 5). */
export const MAX_POST_MEDIA = 8;
/** Fresh ink posts per project, deleted ones included: a declined post may be posted again once (finding 1). */
export const MAX_POSTS_PER_PROJECT = 2;

/** The project statuses whose tattoo work may be done (ruling 3). */
export const REVIEWABLE_STATUSES = [
	"in_progress",
	"healing_check",
	"completed",
] as const;

/** A post's place in the studio's queue (ruling 7). */
export const POST_STATUSES = [
	"waiting",
	"approved",
	"declined",
	"unpublished",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Why a studio may report a review or a post to TattooDrip (ruling 6). */
export const REPORT_REASONS = [
	"hate",
	"threats",
	"personal_data",
	"off_topic",
	"not_a_client",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Why TattooDrip took something down (ruling 12): the report reasons, the client's own request, or another reason. */
export const TAKEDOWN_REASONS = [
	...REPORT_REASONS,
	"client_request",
	"other",
] as const;
export type TakedownReason = (typeof TAKEDOWN_REASONS)[number];

/**
 * The fixed sentence the client's page shows for each takedown reason
 * (ruling 12). The operator's note is never shown to the client.
 */
export const TAKEDOWN_SENTENCES: Record<TakedownReason, string> = {
	hate: "TattooDrip took this down because it contained hateful words.",
	threats: "TattooDrip took this down because it contained a threat.",
	personal_data:
		"TattooDrip took this down because it showed someone's personal details.",
	off_topic:
		"TattooDrip took this down because it wasn't about the tattoo or the studio.",
	not_a_client:
		"TattooDrip took this down because it didn't come from the studio's client.",
	client_request: "TattooDrip took this down because you asked us to.",
	other: "TattooDrip took this down. Contact us if you think it was a mistake.",
};

/** Characters as PostgreSQL's char_length counts them: code points, not UTF-16 units. */
export function charLength(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The first user-perceived character: "रा" of "राई", "S" of "Sharma". */
function firstGrapheme(word: string): string {
	for (const { segment } of graphemes.segment(word)) return segment;
	return "";
}

/**
 * Characters a shown name may never hold (finding 9): bidi controls, which
 * can make a name read as something else, and zero-width characters, which
 * make two names look the same. The database checks the same set.
 */
export const INVISIBLE_NAME_CHARACTERS =
	/[\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/** Whether a shown name is allowed: 1 to 40 characters, no control or invisible character, not blank. */
export function shownNameAllowed(name: string): boolean {
	const length = charLength(name);
	return (
		length >= 1 &&
		length <= MAX_SHOWN_NAME_LENGTH &&
		name.trim() !== "" &&
		!INVISIBLE_NAME_CHARACTERS.test(name) &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
		!/[\u0000-\u001f\u007f\u2028\u2029]/.test(name)
	);
}

/**
 * The name a review or post shows until the client changes it (ruling 9):
 * the client record's first name and the initial of their last name
 * ("Sita Rai" is "Sita R."), the first name alone for a one-word name, and
 * "Client" for a record with no name left (an anonymised one) or a
 * one-word name that looks like a handle or a number (digits or "@": a
 * studio that saved a phone or an Instagram handle as the name). Never the
 * full name, the phone or the email. Invisible characters are dropped; cut
 * to MAX_SHOWN_NAME_LENGTH.
 */
export function defaultShownName(fullName: string): string {
	const words = fullName
		.replace(new RegExp(INVISIBLE_NAME_CHARACTERS.source, "gu"), "")
		.trim()
		.split(/\s+/u)
		.filter(Boolean);
	if (words.length === 0) return "Client";
	const first = words[0];
	if (words.length === 1 && /[\p{Nd}@]/u.test(first)) return "Client";
	const shown =
		words.length > 1 ? `${first} ${firstGrapheme(words.at(-1) ?? "")}.` : first;
	const cut = Array.from(shown).slice(0, MAX_SHOWN_NAME_LENGTH).join("");
	return shownNameAllowed(cut) ? cut : "Client";
}

/**
 * Whether the client may still change a post's content (photos, caption,
 * styles, placement): while it waits or once approved, and never once
 * TattooDrip took it down. A declined or unpublished post is the studio's
 * decision: the client can delete it, and change where it may show and the
 * name, but not its content.
 */
export function postContentEditable(post: {
	status: PostStatus;
	takenDownAt: unknown;
}): boolean {
	return (
		!post.takenDownAt &&
		(post.status === "waiting" || post.status === "approved")
	);
}

/** Whether the client may still change a review's rating and text: until TattooDrip takes it down. */
export function reviewEditable(review: { takenDownAt: unknown }): boolean {
	return !review.takenDownAt;
}

/**
 * The order a post's media take after `removed` goes: the rest in their
 * order, except that the first photo leads (a video never does). Null when
 * only videos would be left, which the caller refuses.
 */
export function orderWithout<T extends { id: string; kind: string }>(
	items: readonly T[],
	removed: string,
): T[] | null {
	const rest = items.filter((item) => item.id !== removed);
	return leadFirst(rest);
}

/**
 * `items` with its first photo moved to the front, the rest in order; null
 * when it holds videos but no photo. An empty list stays empty.
 */
export function leadFirst<T extends { kind: string }>(
	items: readonly T[],
): T[] | null {
	if (items.length === 0) return [];
	const lead = items.findIndex((item) => item.kind === "photo");
	if (lead === -1) return null;
	return [items[lead], ...items.filter((_, index) => index !== lead)];
}
