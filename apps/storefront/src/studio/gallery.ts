import type { ListWorkQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { galleryPhotoHref } from "./links.ts";
import { largeSource } from "./srcset.ts";
import { cleanLine } from "./text.ts";
import { type BrandImage, readBrandImage } from "./theme/config.ts";
import { ARTIST_SLUG, type WorkPhotoView } from "./view-model.ts";

/**
 * The gallery (TAT-126): the API's pages of work photos (`GET /work`) as the
 * photos the pages show, and the address's filters read back strictly. Pure.
 * Everything the API sends is checked here, so an older, newer or hostile
 * answer is at worst an emptier gallery.
 */

/** The home page's Recent work shows this many of the newest photos. */
export const RECENT_WORK_COUNT = 9;
/** `/gallery` and an artist's portfolio load this many photos a page. */
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
/** A photo's id, as the API writes it: a lowercase UUID (getWorkPhoto takes it). */
export const PHOTO_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest search text the gallery reads from its address, in characters. */
export const MAX_SEARCH = 80;
/** A style slug, as the platform's list writes them (copy of its STYLE_SLUG_SHAPE, at most 40 characters). */
const STYLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_STYLE_SLUG = 40;

/** The most other photos of one tattoo (the contract's `angles` maxItems: eight photos in all). */
export const MAX_ANGLES = 7;

/**
 * One more photo of a tattoo (angles): the brand images' rule like the main
 * photo, its own description, else "Tattoo by {name}, photo {n} of {count}"
 * with its place in the whole tattoo (the main photo being 1), and the copy
 * the viewer shows.
 */
export interface AngleView extends BrandImage {
	readonly alt: string;
	/** The studio's description for the viewer, or null. */
	readonly caption: string | null;
	/** What the viewer shows (largeSource). */
	readonly largeSrc: string;
}

/** One photo of the gallery: a work photo and whose it is, what it shows and whether it has healed. */
export interface GalleryPhotoView extends WorkPhotoView {
	/** The grid button's id, so "Show more" can move focus to the first new photo. */
	readonly openId: string;
	/** The photo's id (a checked UUID), or null from an API that sends none. */
	readonly id: string | null;
	/** The photo's own page (`/gallery/<id>`), or null without an id. */
	readonly href: string | null;
	/** Whose work it is, with their page, or null when the API named no usable artist. */
	readonly artist: { readonly name: string; readonly href: string } | null;
	/** The names of up to three styles, in the API's order; [] when none. */
	readonly styles: readonly string[];
	/** The same styles with their slugs, for those whose slug the address can carry (a link to the gallery filtered by it). */
	readonly styleRefs: readonly {
		readonly slug: string;
		readonly name: string;
	}[];
	readonly healed: boolean;
	/**
	 * Angles: the tattoo's other photos, in order, after this one (the main
	 * photo); [] for a tattoo of one photo, an older API or none that pass.
	 */
	readonly angles: readonly AngleView[];
	/** The tile's mark for a tattoo of several photos ("3 photos"); null for one. */
	readonly photosLabel: string | null;
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
 * rule (`readBrandImage`: the image origin only, sides from 1 to 10000,
 * copies on the same origin), the rest are dropped and the others numbered
 * on from `offset` (the photos already shown). The description is one line of
 * plain text up to 200 characters, else "Tattoo by {name}, photo {n}" ("Tattoo,
 * photo {n}" with no usable artist). Each entry is a tattoo: its main photo
 * and its other photos (`angles`, readAngles). Anything that is not a page is
 * the empty gallery. Pure.
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
	const photos = kept.map(({ item, image }, index) =>
		shownPhoto(item, image, first + index + 1, imageOrigin),
	);
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

/**
 * One photo as the API sent it (`getWorkPhoto`'s `data`, whatever it really
 * is) as the photo its page shows, numbered 1; null when it can't be shown
 * (galleryView's rules), or has no id a page could be addressed by. Pure.
 */
export function galleryPhotoView(
	item: unknown,
	imageOrigin: string | null,
): GalleryPhotoView | null {
	const image = readBrandImage(item, imageOrigin);
	if (!image) return null;
	const photo = shownPhoto(item, image, 1, imageOrigin);
	if (!photo.id) return null;
	// The page's one photo: no number in its description, unless it is the
	// first of several (angles), already numbered in the whole tattoo.
	if (photo.caption || photo.angles.length > 0) return photo;
	return {
		...photo,
		alt: photo.artist
			? fill(studioCopy.artwork.by, { name: photo.artist.name })
			: studioCopy.artwork.untitled,
	};
}

/**
 * "Tattoo by Sita Rai, photo 2 of 4" (the contract's fallback for a photo of
 * a tattoo with no description), or "Tattoo, photo 2 of 4" with no usable
 * artist.
 */
function angleAlt(name: string | null, n: number, count: number): string {
	return name
		? fill(studioCopy.work.angleAlt, { name, n, count })
		: fill(studioCopy.work.angleAltNoName, { n, count });
}

/**
 * The tattoo's other photos as the API sent them (`angles`, whatever it
 * really is): at most seven, each passing the brand images' rule, the rest
 * dropped, and each described by the studio or by its place in the whole
 * tattoo. Pure.
 */
function readAngles(
	value: unknown,
	imageOrigin: string | null,
	artist: string | null,
): AngleView[] {
	if (!Array.isArray(value)) return [];
	const kept = value
		.slice(0, MAX_ANGLES)
		.map((item) => ({ item, image: readBrandImage(item, imageOrigin) }))
		.flatMap(({ item, image }) => (image ? [{ item, image }] : []));
	const count = kept.length + 1;
	return kept.map(({ item, image }, index) => {
		const description = readDescription(own(item, "alt"));
		return {
			...image,
			alt: description ?? angleAlt(artist, index + 2, count),
			caption: description,
			largeSrc: largeSource(image),
		};
	});
}

/** A photo the brand images' rule kept, numbered `n` (the dialog and button ids, the label and the fallback description). */
function shownPhoto(
	item: unknown,
	image: NonNullable<ReturnType<typeof readBrandImage>>,
	n: number,
	imageOrigin: string | null,
): GalleryPhotoView {
	const artist = readArtist(own(item, "artist"));
	const description = readDescription(own(item, "alt"));
	const id = readPhotoId(own(item, "id"));
	const angles = readAngles(
		own(item, "angles"),
		imageOrigin,
		artist?.name ?? null,
	);
	return {
		...image,
		// A tattoo with angles numbers its main photo in the whole tattoo, like
		// its angles, so its viewer reads one scheme; a single photo is numbered
		// in the gallery, as before.
		alt:
			description ??
			(angles.length > 0
				? angleAlt(artist?.name ?? null, 1, angles.length + 1)
				: artist
					? fill(studioCopy.work.galleryAlt, { name: artist.name, n })
					: fill(studioCopy.work.galleryAltNoName, { n })),
		caption: description,
		largeSrc: largeSource(image),
		dialogId: `work-photo-${n}`,
		label: fill(studioCopy.work.photoN, { n }),
		openId: `work-open-${n}`,
		id,
		href: id ? galleryPhotoHref(id) : null,
		artist,
		styles: photoStyleNames(own(item, "styles")),
		styleRefs: filterStyles(own(item, "styles")).slice(0, MAX_PHOTO_STYLES),
		healed: own(item, "healed") === true,
		angles,
		photosLabel:
			angles.length > 0
				? fill(studioCopy.work.photosCount, { count: angles.length + 1 })
				: null,
	};
}

/**
 * One photo of a tattoo as its page and its viewer step through them: the
 * main photo first, then the angles. The main photo keeps its own alt (the
 * grid's or the page's), each angle its own.
 */
export type TattooShot = AngleView;

/** A tattoo's photos in order: its main photo, then its angles. */
export function tattooShots(photo: GalleryPhotoView): TattooShot[] {
	const { src, width, height, srcSet, alt, caption, largeSrc } = photo;
	return [
		{
			src,
			width,
			height,
			...(srcSet ? { srcSet } : {}),
			alt,
			caption,
			largeSrc,
		},
		...photo.angles,
	];
}

/**
 * The class that pins a tattoo page's main photo to its own shape
 * (styles.css, `.artwork-ar-50` to `.artwork-ar-200`: width over height,
 * rounded to 0.05 within 1:2 to 2:1), so stepping to an angle of another
 * shape never moves the page: the angle is fitted whole inside the same box.
 * A class, not a `style` attribute, which the page never carries.
 */
export function artworkShapeClass(photo: {
	width: number;
	height: number;
}): string {
	const stepped = Math.round((photo.width / photo.height) * 20) / 20;
	const shape = Math.min(2, Math.max(0.5, stepped));
	return `artwork-ar-${Math.round(shape * 100)}`;
}

/** A photo's id when it is a lowercase UUID, else null. */
export function readPhotoId(value: unknown): string | null {
	return typeof value === "string" && PHOTO_ID.test(value) ? value : null;
}

/**
 * A piece's title: the studio's own description, else built from its first
 * style and its artist ("Fine line tattoo by Sita Rai"), never invented.
 */
export function artworkTitle(photo: GalleryPhotoView): string {
	if (photo.caption) return photo.caption;
	const style = photo.styles[0];
	const name = photo.artist?.name;
	const words = studioCopy.artwork;
	if (style && name) return fill(words.styleBy, { style, name });
	if (name) return fill(words.by, { name });
	if (style) return fill(words.style, { style });
	return words.untitled;
}

/**
 * Whether a photo answers the gallery's search text: every word of `query`
 * is in its title (artworkTitle: its description, else the one built from
 * its data), one of its style names or its artist's name, ignoring case and
 * accents. The API has no text search, so this runs on the
 * photos a page has loaded; an empty query matches everything. Pure.
 */
export function matchesSearch(photo: GalleryPhotoView, query: string): boolean {
	const words = folded(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const text = folded(
		[artworkTitle(photo), ...photo.styles, photo.artist?.name ?? ""].join(" "),
	);
	return words.every((word) => text.includes(word));
}

/** Lowercase, without accents, for matching only (never shown). */
function folded(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
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
export function filterStyles(value: unknown): GalleryView["styles"] {
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

/** `/gallery` reads the same two, which artist and style to show and the search text (`q`, the page's own: the API never sees it). */
export type WorkSearch = PortfolioSearch & {
	artist?: string;
	style?: string;
	q?: string;
};

/**
 * The router hands over each value as the string in the address (search.ts),
 * so `?healed=1` is "1". Anything else is no filter.
 */
function readHealed(value: unknown): value is "1" {
	return value === "1";
}

function readCursor(value: unknown): string | undefined {
	return typeof value === "string" && CURSOR.test(value) ? value : undefined;
}

/** An artist's address: their slug, as the API writes it. */
function readSlug(value: unknown): string | undefined {
	return typeof value === "string" && ARTIST_SLUG.test(value)
		? value
		: undefined;
}

/** A style slug from the address, as the platform writes them, else undefined. */
export function readStyle(value: unknown): string | undefined {
	return typeof value === "string" && isStyleSlug(value) ? value : undefined;
}

/**
 * The artist page's filters from its address, strictly: `healed` is on for
 * "1" only, `cursor` must look like a cursor, and nothing else is read.
 * Absent keys, never null.
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

/** `/gallery`'s filters from its address, strictly (see readPortfolioSearch), in the order the address writes them. */
export function readWorkSearch(search: Record<string, unknown>): WorkSearch {
	const artist = readSlug(own(search, "artist"));
	const style = readStyle(own(search, "style"));
	const q = readSearchText(own(search, "q"));
	const { healed, cursor } = readPortfolioSearch(search);
	return {
		...(artist ? { artist } : {}),
		...(style ? { style } : {}),
		...(healed ? { healed } : {}),
		...(q ? { q } : {}),
		...(cursor ? { cursor } : {}),
	};
}

/** The search text: one line of plain text up to 80 characters, else none (an empty or blank one included). */
function readSearchText(value: unknown): string | undefined {
	const line = typeof value === "string" ? cleanLine(value) : null;
	return line && Array.from(line).length <= MAX_SEARCH ? line : undefined;
}

/**
 * The API's read for an artist's portfolio, built only from what that page
 * offers: their slug, `healed` (exactly `true`, as in workQuery), the
 * address's `cursor` as typed (a garbled one is the API's 422, the not-found
 * page) and `limit`. Never a `style` or any other key of the address: the
 * router merges what the readers dropped back into `search`, and the page has
 * no such filter to show.
 */
export function portfolioQuery(
	slug: string,
	search: PortfolioSearch,
	limit: number,
): ListWorkQuery {
	const { healed, cursor } = search;
	return workQuery(
		{
			artist: slug,
			...(healed === true ? { healed } : {}),
			...(cursor !== undefined ? { cursor } : {}),
		},
		limit,
	);
}

/**
 * The API's read for these filters: `artist`, `style`, `healed`, `cursor` in
 * that order, absent ones left out, then `limit`. `healed` is only ever true
 * (the contract reads false as no filter), and is on only for exactly `true`,
 * which is all readHealed makes of an address: the router merges what the
 * readers dropped (`?healed=false`, `0`, `yes`) back into the search the
 * loaders get, as the strings typed, and those must not filter.
 */
export function workQuery(search: WorkSearch, limit: number): ListWorkQuery {
	return {
		...(search.artist ? { artist: search.artist } : {}),
		...(search.style ? { style: search.style } : {}),
		...(search.healed === true ? { healed: true } : {}),
		...(search.cursor ? { cursor: search.cursor } : {}),
		limit,
	};
}
