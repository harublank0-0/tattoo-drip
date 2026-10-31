import type { ListFlashQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { flashDesignHref, requestHref } from "./links.ts";
import { largeSource } from "./srcset.ts";
import { cleanLine } from "./text.ts";
import { type BrandImage, readBrandImage } from "./theme/config.ts";
import { ARTIST_SLUG, type ArtistView } from "./view-model.ts";

/**
 * Flash designs (TAT-129): the API's pages of designs (`GET /flash`) and one
 * design (`GET /flash/<id>`) as the designs the pages show, and the address's
 * filter read back strictly. Pure. Everything the API sends is checked here,
 * so an older, newer or hostile answer is at worst an emptier page.
 */

/** A design's id, as the API writes it: a lowercase UUID. */
export const FLASH_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The home page's Flash section shows this many of the newest designs. */
export const HOME_FLASH_COUNT = 6;
/** An artist's page shows this many, then "All flash by {name}". */
export const ARTIST_FLASH_COUNT = 12;
/** `/flash` loads this many designs a page. */
export const FLASH_PAGE_SIZE = 24;
/** The most designs read from one answer (the contract's `limit` maximum). */
export const MAX_FLASH_PAGE = 48;
/** The most artists the filter offers. */
const MAX_FILTER_ARTISTS = 100;

const MAX_NAME = 80;
const MAX_SIZE = 60;

/** A cursor as the API writes it: base64url, at most 200 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

/** One flash design, ready to draw. */
export interface FlashDesignView {
	readonly id: string;
	readonly name: string;
	readonly size: string;
	/** "NPR 3,000", as the API words it, or null when the studio keeps the price to itself. */
	readonly priceText: string | null;
	/** The picture, checked: the API's origin only, with its copies. */
	readonly image: BrandImage;
	/** The widest copy up to 1280 px, for the design's own page. */
	readonly largeSrc: string;
	readonly alt: string;
	/** Whose design it is, with their page, or null when the API named no usable artist. */
	readonly artist: {
		readonly slug: string;
		readonly name: string;
		readonly href: string;
	} | null;
	/** Someone has claimed this one-of-a-kind design (`status` other than `available`): shown greyed, marked Claimed, never requestable. */
	readonly claimed: boolean;
	readonly requestable: boolean;
	/** The design's own page. */
	readonly href: string;
	/** The request page for this design. */
	readonly requestHref: string;
}

export interface FlashListView {
	readonly designs: readonly FlashDesignView[];
	/** The cursor of the next page, or null on the last. */
	readonly nextCursor: string | null;
	/** The artists the filter offers: each has at least one shown design. */
	readonly artists: readonly { readonly slug: string; readonly name: string }[];
}

/** What an older API, a failed read or a garbled answer comes to. */
export const EMPTY_FLASH: FlashListView = Object.freeze({
	designs: [],
	nextCursor: null,
	artists: [],
});

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/** One line of plain text of at most `max` characters, else null. */
function line(value: unknown, max: number): string | null {
	const text = typeof value === "string" ? cleanLine(value) : null;
	return text && Array.from(text).length <= max ? text : null;
}

/** `{ slug, name }` when the slug can be an artist's and the name is text, else null. */
function readSlugName(value: unknown): { slug: string; name: string } | null {
	const slug = own(value, "slug");
	const name = line(own(value, "name"), 120);
	return typeof slug === "string" && ARTIST_SLUG.test(slug) && name
		? { slug, name }
		: null;
}

/**
 * A design (`FlashDesign`, whatever the API really sent) as the view to show,
 * or null when it can't be shown: no lowercase-UUID `id`, a name of 1 to 80
 * characters or a size of 1 to 60 (one line of plain text each) missing, or
 * no usable picture (readBrandImage: the API's origin only). The artist is
 * kept only with a slug that can be an artist's and a name; `requestable`
 * only for `true` and never for a claimed design. A `status` other than
 * `available` is claimed (the contract: an unknown value is `claimed`); a
 * missing one, from an older API, is not. Pure.
 */
export function flashDesignView(
	value: unknown,
	imageOrigin: string | null,
): FlashDesignView | null {
	const id = own(value, "id");
	if (typeof id !== "string" || !FLASH_ID.test(id)) return null;
	const name = line(own(value, "name"), MAX_NAME);
	const size = line(own(value, "size"), MAX_SIZE);
	const image = readBrandImage(own(value, "image"), imageOrigin);
	if (!name || !size || !image) return null;
	const artistRef = readSlugName(own(value, "artist"));
	const artist = artistRef
		? { ...artistRef, href: `/artists/${artistRef.slug}` }
		: null;
	const status = own(value, "status");
	const claimed = status !== undefined && status !== "available";
	return {
		id,
		name,
		size,
		priceText: line(own(own(value, "price"), "text"), 40),
		image,
		largeSrc: largeSource(image),
		alt: artist
			? fill(studioCopy.flash.alt, { name, artist: artist.name })
			: fill(studioCopy.flash.altNoArtist, { name }),
		artist,
		claimed,
		requestable: own(value, "requestable") === true && !claimed,
		href: flashDesignHref(id),
		requestHref: requestHref({ flash: id }),
	};
}

/**
 * A page of flash (`FlashPage`, whatever the API really sent) as the designs
 * to show: at most 48, the broken ones dropped. The next cursor is kept only
 * when it looks like one; anything that is not a page is EMPTY_FLASH. Pure.
 */
export function flashListView(
	page: unknown,
	imageOrigin: string | null,
): FlashListView {
	if (typeof page !== "object" || page === null) return EMPTY_FLASH;
	const data = own(page, "data");
	if (!Array.isArray(data)) return EMPTY_FLASH;
	const designs = data.slice(0, MAX_FLASH_PAGE).flatMap((item) => {
		const view = flashDesignView(item, imageOrigin);
		return view ? [view] : [];
	});
	const cursor = own(page, "nextCursor");
	const artists: { slug: string; name: string }[] = [];
	const listed = own(own(page, "filters"), "artists");
	for (const item of Array.isArray(listed) ? listed : []) {
		const artist = readSlugName(item);
		if (artist && !artists.some(({ slug }) => slug === artist.slug)) {
			artists.push(artist);
		}
	}
	return {
		designs,
		nextCursor:
			typeof cursor === "string" && CURSOR.test(cursor) ? cursor : null,
		artists: artists.slice(0, MAX_FILTER_ARTISTS),
	};
}

/**
 * What the request page's read of `?flash=<id>` gave (TAT-129): the API's
 * design as it came (flashDesignView checks it), the API not knowing it (a
 * 404: hidden, its artist hidden, unknown) or the read failing for any other
 * reason.
 */
export type FlashLookup =
	| { readonly kind: "found"; readonly design: unknown }
	| { readonly kind: "gone" }
	| { readonly kind: "failed" };

/** What the request page shows of the design the address names. */
export type FlashRequestView =
	| { readonly kind: "requestable"; readonly design: FlashDesignView }
	/** Someone has claimed it: the page asks the artist for something similar instead. */
	| { readonly kind: "claimed"; readonly design: FlashDesignView }
	| {
			readonly kind: "closed";
			readonly design: FlashDesignView;
			/** The artist's own words, else ours: why the design can't be asked for now. */
			readonly note: string;
	  }
	| { readonly kind: "gone" }
	| { readonly kind: "failed" };

/** `/flash` reads these from its address. Absent keys, never null, so the router writes nothing back. */
export interface FlashSearch {
	artist?: string;
	cursor?: string;
}

/**
 * `/flash`'s filter from its address, strictly (the router hands over each
 * value as the string in the address): `artist` must be shaped like an
 * artist's slug and `cursor` like a cursor, and nothing else is read.
 */
export function readFlashSearch(search: Record<string, unknown>): FlashSearch {
	const artist = own(search, "artist");
	const cursor = own(search, "cursor");
	return {
		...(typeof artist === "string" && ARTIST_SLUG.test(artist)
			? { artist }
			: {}),
		...(typeof cursor === "string" && CURSOR.test(cursor) ? { cursor } : {}),
	};
}

/**
 * The API's read for this filter: `artist`, `cursor` (as typed: a garbled one
 * is the API's 422, the not-found page), `available` (only the home's Flash
 * section asks for it: claimed designs stay out of it), then `limit`. Never any other key of
 * the address: the router merges what the reader dropped back into `search`.
 */
export function flashQuery(
	search: FlashSearch,
	limit: number,
	available = false,
): ListFlashQuery {
	return {
		...(search.artist ? { artist: search.artist } : {}),
		...(search.cursor ? { cursor: search.cursor } : {}),
		// The studio page's sections show what can still be asked for.
		...(available ? { available: true } : {}),
		limit,
	};
}

/**
 * What a design that can't be requested says: null while it can, and for a
 * claimed design (its Claimed badge says it); else the artist's own closed
 * message, else "Not taking flash requests right now".
 */
export function closedNoteFor(
	design: FlashDesignView,
	artists: readonly ArtistView[],
): string | null {
	if (design.claimed || design.requestable) return null;
	const artist = design.artist
		? artists.find(({ slug }) => slug === design.artist?.slug)
		: undefined;
	return artist?.closedMessage ?? studioCopy.flash.closed;
}
