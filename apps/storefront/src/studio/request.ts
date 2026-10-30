import { requestHref } from "./links.ts";
import { ARTIST_SLUG, type ArtistView, type StudioView } from "./view-model.ts";

/**
 * The request page's address and the header's Request link (TAT-127). Pure.
 * `/request` is the general form and `/request?artist=<slug>` asks for one
 * artist; anything else in the address (an ad's `fbclid`, `utm_*`, a renamed
 * artist's old slug) is dropped here and never makes the page a not-found.
 */

/** `/request` reads which artist to ask for. Absent, never null, so the router writes nothing back. */
export type RequestSearch = { artist?: string };

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
 * find out.
 */
export function readRequestSearch(
	search: Record<string, unknown>,
): RequestSearch {
	const artist = own(search, "artist");
	return typeof artist === "string" && ARTIST_SLUG.test(artist)
		? { artist }
		: {};
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
