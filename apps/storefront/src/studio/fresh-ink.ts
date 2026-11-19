import type { ListFreshInkQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import {
	type DayView,
	dayView,
	excerptOf,
	readArtistTag,
	readShownName,
	readText,
} from "./client-words.ts";
import { studioCopy } from "./copy.ts";
import { type GalleryPhotoView, tattooEntry } from "./gallery.ts";
import { cleanLine } from "./text.ts";

/**
 * Fresh ink on the studio's own page (Reviews and Fresh ink, slice 3):
 * healed tattoos the studio's clients posted and the studio approved, from
 * `GET /fresh-ink` (listFreshInk). Each post is shaped like a gallery tattoo
 * and read by the gallery's own rules (`tattooEntry`: the image origin only
 * for the main photo, its angles and its videos' posters and sources), so it
 * opens in the same viewer with its angles; its dialog and button ids are
 * its own (`fresh-ink-photo-<n>`), since Recent work shares the home page.
 * Pure. A post has no page of its own (`href` is null): its viewer is the
 * way in. Text stays text: the caption keeps its line breaks.
 */

/** The home page's Fresh ink section shows the newest this many. */
export const HOME_FRESH_INK_COUNT = 6;
/** `/fresh-ink` loads this many a page. */
export const FRESH_INK_PAGE_SIZE = 24;
/** The most posts read from one answer (the contract's `limit` maximum). */
const MAX_FRESH_INK_PAGE = 48;
/** A caption and a placement at most, in characters (the contract's). */
const MAX_CAPTION = 280;
const MAX_PLACEMENT = 120;
/** The ids of Fresh ink's viewers and tiles. */
export const FRESH_INK_PREFIX = "fresh-ink";
/** The ids of a review's linked Fresh ink viewer: its own, so a post in the grid and in a review never share one. */
export const REVIEW_INK_PREFIX = "review-ink";

/** A cursor as the API writes it: base64url, at most 200 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A linked review's text at most, in characters (the contract's). */
const MAX_REVIEW_BODY = 2000;

/** One post: a gallery tattoo (its main photo, angles, artist, styles) and what the client wrote. */
export interface FreshInkPostView extends GalleryPhotoView {
	/** The client's shown name ("Sita R."). */
	readonly name: string;
	/** "Shown by Sita R.". */
	readonly shownBy: string;
	/**
	 * What a theme's piece title says, where its photo is decoration inside
	 * the button the title names: the main photo's own description, else the
	 * client's caption on one line, else "Fresh ink from Sita R., tattoo by Ram
	 * K." ("Fresh ink from Sita R." without an artist), as `artworkTitle`
	 * prefers the photo's own words; so two posts of one client and artist
	 * are told apart by what they say.
	 */
	readonly title: string;
	/** The client's caption, plain text with its line breaks, or null. */
	readonly postCaption: string | null;
	/** Where it is on the body, in the client's words, one line, or null. */
	readonly placement: string | null;
	/** The day it was published (the latest publication, for any surface). */
	readonly date: DayView | null;
	/** The client's review of the same project, while the page shows it too. */
	readonly review: LinkedReviewView | null;
}

/** A post's linked review, as its viewer shows it. */
export interface LinkedReviewView {
	readonly id: string;
	/** Whole stars, 1 to 5. */
	readonly rating: number;
	/** "4 out of 5". */
	readonly ratingText: string;
	/** The client's words, plain text with its line breaks. */
	readonly body: string;
	/** Its start with "…", or null when the whole text is short. */
	readonly excerpt: string | null;
	readonly date: DayView | null;
}

export interface FreshInkView {
	readonly posts: readonly FreshInkPostView[];
	/** The cursor of the next page, or null on the last. */
	readonly nextCursor: string | null;
}

/** What an older API, a failed read or a garbled answer comes to. */
export const EMPTY_FRESH_INK: FreshInkView = Object.freeze({
	posts: [],
	nextCursor: null,
});

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/**
 * A page of Fresh ink (`FreshInkPage`, whatever the API really sent) as the
 * posts to show: at most 48, each a tattoo the gallery's rules keep, with an
 * id and a one-line shown name of up to 40 characters (anything else is
 * dropped), numbered on from `offset`. A post of one photo without a
 * description is named "Fresh ink from Sita R., tattoo by Ram K." (the
 * gallery's own "photo n of m" names a post with angles, as its viewer
 * reads). Anything that is not a page is no posts. Pure.
 */
export function freshInkView(
	page: unknown,
	imageOrigin: string | null,
	offset = 0,
): FreshInkView {
	if (typeof page !== "object" || page === null) return EMPTY_FRESH_INK;
	const first = Number.isInteger(offset) && offset > 0 ? offset : 0;
	const data = own(page, "data");
	const posts: FreshInkPostView[] = [];
	for (const item of Array.isArray(data)
		? data.slice(0, MAX_FRESH_INK_PAGE)
		: []) {
		const post = readFreshInkPost(
			item,
			imageOrigin,
			first + posts.length + 1,
			FRESH_INK_PREFIX,
		);
		if (post === null || posts.some((shown) => shown.id === post.id)) {
			continue;
		}
		posts.push(post);
	}
	const cursor = own(page, "nextCursor");
	return {
		posts,
		nextCursor:
			typeof cursor === "string" && CURSOR.test(cursor) ? cursor : null,
	};
}

/**
 * One post the API sent, as the page shows it: a gallery tattoo (its main
 * photo on the image origin, its angles) with the client's words and its
 * linked review, its viewer's ids from `prefix` and `n`; null when it
 * doesn't read cleanly (no shown name, no id, a photo off the origin).
 * `freshInkView`'s entries, and a review's linked Fresh ink
 * (`REVIEW_INK_PREFIX`).
 */
export function readFreshInkPost(
	item: unknown,
	imageOrigin: string | null,
	n: number,
	prefix: string,
): FreshInkPostView | null {
	const name = readShownName(own(item, "shownName"));
	if (name === null) return null;
	const entry = tattooEntry(item, imageOrigin, n, prefix);
	if (entry === null || entry.id === null) return null;
	const artist = readArtistTag(own(item, "artist"));
	const named = artist
		? fill(studioCopy.freshInk.alt, { name, artist: artist.name })
		: fill(studioCopy.freshInk.altNoArtist, { name });
	const postCaption = readText(own(item, "caption"), MAX_CAPTION);
	return {
		...entry,
		// No page of its own: the viewer is the way in.
		href: null,
		artist,
		// The client's words say what it is; nothing is claimed for them.
		healed: false,
		alt: entry.caption || entry.angles.length > 0 ? entry.alt : named,
		title: entry.caption ?? cleanLine(postCaption) ?? named,
		name,
		shownBy: fill(studioCopy.freshInk.shownBy, { name }),
		postCaption,
		placement: readLine(own(item, "placement"), MAX_PLACEMENT),
		date: dayView(own(item, "date")),
		review: readLinkedReview(own(item, "review")),
	};
}

/** A post's linked review: a UUID, whole stars 1 to 5, a text of up to 2,000 characters; else null. */
function readLinkedReview(value: unknown): LinkedReviewView | null {
	const id = own(value, "id");
	const rating = own(value, "rating");
	const body = readText(own(value, "body"), MAX_REVIEW_BODY);
	if (
		typeof id !== "string" ||
		!UUID.test(id) ||
		typeof rating !== "number" ||
		!Number.isInteger(rating) ||
		rating < 1 ||
		rating > 5 ||
		body === null
	) {
		return null;
	}
	return {
		id,
		rating,
		ratingText: fill(studioCopy.reviews.stars, { n: rating }),
		body,
		excerpt: excerptOf(body),
		date: dayView(own(value, "date")),
	};
}

function readLine(value: unknown, max: number): string | null {
	const line = typeof value === "string" ? cleanLine(value) : null;
	return line && Array.from(line).length <= max ? line : null;
}

/** What `/fresh-ink` reads from its address: only a cursor shaped like one. */
export interface FreshInkSearch {
	readonly cursor?: string;
}

/** The address's search read strictly: `cursor` when it is shaped like one; every other key dropped. */
export function readFreshInkSearch(
	search: Record<string, unknown>,
): FreshInkSearch {
	const cursor = own(search, "cursor");
	return typeof cursor === "string" && CURSOR.test(cursor) ? { cursor } : {};
}

/** The API's read for this page: `cursor` (as typed: a garbled one is the API's 422) then `limit`. */
export function freshInkQuery(
	search: FreshInkSearch,
	limit: number,
): ListFreshInkQuery {
	return {
		...(search.cursor ? { cursor: search.cursor } : {}),
		limit,
	};
}
