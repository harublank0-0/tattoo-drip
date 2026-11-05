import { FLASH_ID } from "./flash.ts";
import { readPhotoId } from "./gallery.ts";
import { requestHref } from "./links.ts";
import { ARTIST_SLUG, type ArtistView, type StudioView } from "./view-model.ts";

/**
 * The request page's address and the header's Request link (TAT-127). Pure.
 * `/request` is the general form and `/request?artist=<slug>` asks for one
 * artist; anything else in the address (an ad's `fbclid`, `utm_*`, a renamed
 * artist's old slug) is dropped here and never makes the page a not-found.
 */

/**
 * `/request` reads which artist to ask for and, since TAT-129, which flash
 * design. Absent, never null, so the router writes nothing back.
 */
export type RequestSearch = {
	artist?: string;
	flash?: string;
	/** A gallery photo's id (Prompt 5): "Request a similar tattoo"; the loader checks it with the API. */
	artwork?: string;
};

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/**
 * `/request`'s search from its address, strictly: `artist` is kept when it
 * is a string shaped like an artist slug (the router hands over each value as
 * the string in the address, search.ts, so `?artist=12` is "12"); every other
 * key and value is dropped. Whether that artist exists is the loader's to
 * find out. A well-formed `flash` (a lowercase UUID, TAT-129) is kept instead:
 * the design names the artist, so a request page has one spelling and `artist`
 * is then dropped; whether the design exists is the loader's to find out.
 * Beside `artist`, a well-formed `artwork` (a gallery photo's lowercase UUID,
 * Prompt 5) is kept; the loader asks the API for that piece, and only a piece
 * it shows starts the form with a link to it and names its artist.
 */
export function readRequestSearch(
	search: Record<string, unknown>,
): RequestSearch {
	const flash = own(search, "flash");
	if (typeof flash === "string" && FLASH_ID.test(flash)) return { flash };
	const artist = own(search, "artist");
	const artwork = readPhotoId(own(search, "artwork"));
	return {
		...(typeof artist === "string" && ARTIST_SLUG.test(artist)
			? { artist }
			: {}),
		...(artwork ? { artwork } : {}),
	};
}

/** Where a Request button leads, and the artist it names, if any. */
export interface RequestLink {
	readonly href: string;
	/** The artist the link asks for, or null for the general form. */
	readonly artistName: string | null;
}

/**
 * The header's Request link: the artist's while they take new work (on their
 * own page), else the studio's while it takes new work, else none. Each
 * artist has their own switch, so an open artist's link works even while the
 * studio's flag is off, as inquiryState does.
 */
export function requestLink(
	studio: StudioView,
	artist: ArtistView | null,
): RequestLink | null {
	if (artist?.accepting) {
		return {
			href: requestHref({ artist: artist.slug }),
			artistName: artist.name,
		};
	}
	return studio.accepting ? { href: requestHref({}), artistName: null } : null;
}
