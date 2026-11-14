import type { ListFreshInkQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { type GalleryPhotoView, tattooEntry } from "./gallery.ts";
import {
	type DayView,
	dayView,
	readArtistTag,
	readShownName,
} from "./reviews.ts";
import { cleanLine, cleanText } from "./text.ts";

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

/** A cursor as the API writes it: base64url, at most 200 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

/** One post: a gallery tattoo (its main photo, angles, artist, styles) and what the client wrote. */
export interface FreshInkPostView extends GalleryPhotoView {
	/** The client's shown name ("Sita R."). */
	readonly name: string;
	/** "Shown by Sita R.". */
	readonly shownBy: string;
	/**
	 * "Fresh ink from Sita R., tattoo by Ram K." (without an artist, "Fresh ink
	 * from Sita R."): what a theme's piece title says, where its photo is
	 * decoration inside the button the title names.
	 */
	readonly title: string;
	/** The client's caption, plain text with its line breaks, or null. */
	readonly postCaption: string | null;
	/** Where it is on the body, in the client's words, one line, or null. */
	readonly placement: string | null;
	/** The day it was published on the studio's page. */
	readonly date: DayView | null;
}

export interface FreshInkView {
	readonly posts: readonly FreshInkPostView[];
	/** The cursor of the next page, or null on the last. */
	readonly nextCursor: string | null;
}

/** What an older API, a failed read, the flag off or a garbled answer comes to. */
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
		const name = readShownName(own(item, "shownName"));
		if (name === null) continue;
		const entry = tattooEntry(
			item,
			imageOrigin,
			first + posts.length + 1,
			FRESH_INK_PREFIX,
		);
		if (entry === null || entry.id === null) continue;
		if (posts.some((post) => post.id === entry.id)) continue;
		const artist = readArtistTag(own(item, "artist"));
		const title = artist
			? fill(studioCopy.freshInk.alt, { name, artist: artist.name })
			: fill(studioCopy.freshInk.altNoArtist, { name });
		posts.push({
			...entry,
			// No page of its own: the viewer is the way in.
			href: null,
			artist,
			// The client's words say what it is; nothing is claimed for them.
			healed: false,
			alt: entry.caption || entry.angles.length > 0 ? entry.alt : title,
			title,
			name,
			shownBy: fill(studioCopy.freshInk.shownBy, { name }),
			postCaption: readText(own(item, "caption"), MAX_CAPTION),
			placement: readLine(own(item, "placement"), MAX_PLACEMENT),
			date: dayView(own(item, "date")),
		});
	}
	const cursor = own(page, "nextCursor");
	return {
		posts,
		nextCursor:
			typeof cursor === "string" && CURSOR.test(cursor) ? cursor : null,
	};
}

function readText(value: unknown, max: number): string | null {
	const text = typeof value === "string" ? cleanText(value) : null;
	return text && Array.from(text).length <= max ? text : null;
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
