import type { ListWorkQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { largeSource } from "./srcset.ts";
import { cleanLine } from "./text.ts";
import { readBrandImage } from "./theme/config.ts";
import { ARTIST_SLUG, type WorkPhotoView } from "./view-model.ts";

/**
 * The gallery (TAT-126): the API's pages of work photos (`GET /work`) as the
 * photos the pages show, and the address's filters read back strictly. Pure.
 * Everything the API sends is checked here, so an older, newer or hostile
 * answer is at worst an emptier gallery.
 */

/** The home page's Recent work shows this many of the newest photos. */
export const RECENT_WORK_COUNT = 9;
/** `/work` and an artist's portfolio load this many photos a page. */
export const WORK_PAGE_SIZE = 24;
/** The most photos read from one answer (the contract's `limit` maximum). */
export const MAX_GALLERY_PAGE = 48;
/** The most styles a photo shows (the contract's: up to three per photo). */
const MAX_PHOTO_STYLES = 3;
/** The most styles one page offers as a filter (the platform's list has 18). */
const MAX_FILTER_STYLES = 24;
/** The longest description kept, in characters; a longer one is no description. */
const MAX_ALT = 200;

/** A cursor as the API writes it: base64url, at most 200 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
/** A style slug, as the platform's list writes them (copy of its STYLE_SLUG_SHAPE, at most 40 characters). */
const STYLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_STYLE_SLUG = 40;

/** One photo of the gallery: a work photo and whose it is, what it shows and whether it has healed. */
export interface GalleryPhotoView extends WorkPhotoView {
	/** The grid button's id, so "Show more" can move focus to the first new photo. */
	readonly openId: string;
	/** Whose work it is, with their page, or null when the API named no usable artist. */
	readonly artist: { readonly name: string; readonly href: string } | null;
	/** The names of up to three styles, in the API's order; [] when none. */
	readonly styles: readonly string[];
	readonly healed: boolean;
}

export interface GalleryView {
	readonly photos: readonly GalleryPhotoView[];
	/** The cursor of the next page, or null on the last. */
	readonly nextCursor: string | null;
	/** The styles the filter offers: at least one photo carries each. */
	readonly styles: readonly { readonly slug: string; readonly name: string }[];
	/** Whether at least one photo is healed, so the Healed filter has something to show. */
	readonly healed: boolean;
}

/** What an older API, a failed read or a garbled answer comes to. */
export const EMPTY_GALLERY: GalleryView = Object.freeze({
	photos: [],
	nextCursor: null,
	styles: [],
	healed: false,
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
 * A page of the gallery (`WorkPage`, whatever the API really sent) as the
 * photos to show. At most 48 photos are read; each passes the brand images'
 * rule (`readBrandImage`: the API's origin only, sides from 1 to 10000,
 * copies on the same origin), the rest are dropped and the others numbered
 * on from `offset` (the photos already shown). The description is one line of
 * plain text up to 200 characters, else "Tattoo by {name}, photo {n}" ("Tattoo,
 * photo {n}" with no usable artist). Anything that is not a page is the empty
 * gallery. Pure.
 */
export function galleryView(
	page: unknown,
	imageOrigin: string | null,
	offset = 0,
): GalleryView {
	if (typeof page !== "object" || page === null) return EMPTY_GALLERY;
	const first = Number.isInteger(offset) && offset > 0 ? offset : 0;
	const data = own(page, "data");
	const kept = (Array.isArray(data) ? data.slice(0, MAX_GALLERY_PAGE) : [])
		.map((item) => ({ item, image: readBrandImage(item, imageOrigin) }))
		.flatMap(({ item, image }) => (image ? [{ item, image }] : []));
	const photos = kept.map(({ item, image }, index): GalleryPhotoView => {
		const n = first + index + 1;
		const artist = readArtist(own(item, "artist"));
		const description = readDescription(own(item, "alt"));
		return {
			...image,
			alt:
				description ??
				(artist
					? fill(studioCopy.work.galleryAlt, { name: artist.name, n })
					: fill(studioCopy.work.galleryAltNoName, { n })),
			caption: description,
			largeSrc: largeSource(image),
			dialogId: `work-photo-${n}`,
			label: fill(studioCopy.work.photoN, { n }),
			openId: `work-open-${n}`,
			artist,
			styles: photoStyleNames(own(item, "styles")),
			healed: own(item, "healed") === true,
		};
	});
	const filters = own(page, "filters");
	const cursor = own(page, "nextCursor");
	return {
		photos,
		nextCursor:
			typeof cursor === "string" && CURSOR.test(cursor) ? cursor : null,
		styles: filterStyles(own(filters, "styles")),
		healed: own(filters, "healed") === true,
	};
}

/** Whose work it is, when the API named an artist whose slug can be a link; the name is their slug when it is not text. */
function readArtist(value: unknown): GalleryPhotoView["artist"] {
	const slug = own(value, "slug");
	if (typeof slug !== "string" || !ARTIST_SLUG.test(slug)) return null;
	const name = own(value, "name");
	return {
		name: (typeof name === "string" ? cleanLine(name) : null) ?? slug,
		href: `/artists/${slug}`,
	};
}

/** The studio's own description: one line of plain text, at most 200 characters, else null. */
function readDescription(value: unknown): string | null {
	const line = typeof value === "string" ? cleanLine(value) : null;
	return line && Array.from(line).length <= MAX_ALT ? line : null;
}

/** A photo's style names: one line of plain text each, in the API's order, at most three. */
function photoStyleNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const item of value) {
		const name = own(item, "name");
		const line = typeof name === "string" ? cleanLine(name) : null;
		if (line) names.push(line);
	}
	return names.slice(0, MAX_PHOTO_STYLES);
}

/** The styles the filter offers: a slug the address can carry and a one-line name, each slug once, in the API's order. */
function filterStyles(value: unknown): GalleryView["styles"] {
	if (!Array.isArray(value)) return [];
	const styles: { slug: string; name: string }[] = [];
	for (const item of value) {
		const slug = own(item, "slug");
		const name = own(item, "name");
		const line = typeof name === "string" ? cleanLine(name) : null;
		if (
			typeof slug !== "string" ||
			!isStyleSlug(slug) ||
			!line ||
			styles.some((style) => style.slug === slug)
		) {
			continue;
		}
		styles.push({ slug, name: line });
	}
	return styles.slice(0, MAX_FILTER_STYLES);
}

function isStyleSlug(value: string): boolean {
	return value.length <= MAX_STYLE_SLUG && STYLE_SLUG.test(value);
}

/** An artist's portfolio page reads these from its address: `?healed=1&cursor=…`. Absent keys, never null, so the router writes nothing back. */
export interface PortfolioSearch {
	healed?: true;
	cursor?: string;
}

/** `/work` reads the same two and which artist and style to show. */
export type WorkSearch = PortfolioSearch & { artist?: string; style?: string };

/**
 * The router parses `?healed=1` as the number 1 (it reads each value as JSON
 * first), so a hand-typed address and a link we wrote both come here as 1;
 * "1" and true are the same wish. Anything else is no filter.
 */
function readHealed(value: unknown): value is 1 | "1" | true {
	return value === 1 || value === "1" || value === true;
}

function readCursor(value: unknown): string | undefined {
	return typeof value === "string" && CURSOR.test(value) ? value : undefined;
}

/**
 * An artist's address: their slug, as the API writes it. The router reads each
 * value as JSON first (see readHealed), so a slug of digits only, `?artist=2025`,
 * arrives as the number 2025: a safe integer is its own digits again. (Larger
 * numbers lose digits on the way, so they are no slug.)
 */
function readSlug(value: unknown): string | undefined {
	const slug = Number.isSafeInteger(value) ? String(value) : value;
	return typeof slug === "string" && ARTIST_SLUG.test(slug) ? slug : undefined;
}

function readStyle(value: unknown): string | undefined {
	return typeof value === "string" && isStyleSlug(value) ? value : undefined;
}

/**
 * What the router writes into an address for `search`: `healed: true` as
 * `healed=1`, the way our links write it. The router (on the server) redirects
 * an address to its own spelling of it, so with its default `healed=true` every
 * `?healed=1` link would cost a redirect. Pure; the router's `stringifySearch`
 * (src/router.tsx) runs the default writer on the result.
 */
export function healedAsOne<T extends Record<string, unknown>>(search: T): T {
	return search.healed === true ? { ...search, healed: 1 } : search;
}

/**
 * The artist page's filters from its address, strictly: `healed` is on for 1,
 * "1" and true only, `cursor` must look like a cursor, and nothing else is
 * read. Absent keys, never null.
 */
export function readPortfolioSearch(
	search: Record<string, unknown>,
): PortfolioSearch {
	const healed = readHealed(own(search, "healed"));
	const cursor = readCursor(own(search, "cursor"));
	return {
		...(healed ? { healed: true as const } : {}),
		...(cursor ? { cursor } : {}),
	};
}

/** `/work`'s filters from its address, strictly (see readPortfolioSearch), in the order the address writes them. */
export function readWorkSearch(search: Record<string, unknown>): WorkSearch {
	const artist = readSlug(own(search, "artist"));
	const style = readStyle(own(search, "style"));
	const { healed, cursor } = readPortfolioSearch(search);
	return {
		...(artist ? { artist } : {}),
		...(style ? { style } : {}),
		...(healed ? { healed } : {}),
		...(cursor ? { cursor } : {}),
	};
}

/**
 * The API's read for these filters: `artist`, `style`, `healed`, `cursor` in
 * that order, absent ones left out, then `limit`. `healed` is only ever true
 * (the contract reads false as no filter).
 */
export function workQuery(search: WorkSearch, limit: number): ListWorkQuery {
	return {
		...(search.artist ? { artist: search.artist } : {}),
		...(search.style ? { style: search.style } : {}),
		...(search.healed ? { healed: true } : {}),
		...(search.cursor ? { cursor: search.cursor } : {}),
		limit,
	};
}
