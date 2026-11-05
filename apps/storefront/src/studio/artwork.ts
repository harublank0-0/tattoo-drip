import {
	artworkTitle,
	type GalleryPhotoView,
	type GalleryView,
} from "./gallery.ts";
import { requestHref } from "./links.ts";
import { type ArtistView, findArtist, type StudioView } from "./view-model.ts";

/**
 * One tattoo's page (`/gallery/$photo`, Prompt 5): the gallery photo the API
 * reads by id (getWorkPhoto), the artist it names found in the studio's own
 * visible list, and a few pieces related to it. Pure and theme-independent:
 * every theme's page gets the same data and shows it its own way.
 *
 * The API knows a photo's description, styles, healed mark and artist, and
 * nothing more: no title, placement, technique, date or further photos. So
 * the page's title is the studio's own description when it wrote one, else
 * built from the styles and the artist ("Fine line tattoo by Sita Rai"),
 * never invented.
 */

/** The related pieces a page shows, at most. */
export const RELATED_COUNT = 6;
/** Each related read asks for one more: the current piece may be among them. */
export const RELATED_READ = RELATED_COUNT + 1;

export interface ArtworkView {
	/** The photo, as the gallery shows it (numbered 1). */
	readonly photo: GalleryPhotoView;
	/** Its checked id: the page's address. */
	readonly id: string;
	/** The studio's own description, else "{style} tattoo by {artist}" from the data. */
	readonly title: string;
	/** Whether the title is the studio's own description (then the page doesn't repeat it as a caption). */
	readonly titleIsCaption: boolean;
	/** The artist, from the studio's visible list, or null when the photo names none the list has. */
	readonly artist: ArtistView | null;
}

/** A piece's title (gallery.ts's artworkTitle), for the page, its head and every card that links to it. */
export { artworkTitle } from "./gallery.ts";

/** The piece's view: the photo (with an id: galleryPhotoView refuses one without) and its artist from the visible list. */
export function artworkView(
	photo: GalleryPhotoView & { readonly id: string },
	artists: readonly ArtistView[],
): ArtworkView {
	const slug = photo.artist?.href.slice("/artists/".length);
	return {
		photo,
		id: photo.id,
		title: artworkTitle(photo),
		titleIsCaption: photo.caption !== null,
		artist: slug ? findArtist(artists, slug) : null,
	};
}

/**
 * The pieces shown below this one, at most six: those of its first style,
 * then its artist's, then the studio's newest, each once, never this one,
 * never one without its own page. `reads` are those three gallery reads in
 * that order, null for one not made or failed. Their photos keep the numbers
 * of their own read, so a related piece is shown as a link to its page, never
 * with the grid's viewer (its dialog ids could repeat).
 */
export function relatedArtwork(
	id: string,
	reads: readonly (GalleryView | null)[],
): GalleryPhotoView[] {
	const seen = new Set([id]);
	const related: GalleryPhotoView[] = [];
	for (const read of reads) {
		for (const photo of read?.photos ?? []) {
			if (related.length === RELATED_COUNT) return related;
			if (!photo.id || !photo.href || seen.has(photo.id)) continue;
			seen.add(photo.id);
			related.push(photo);
		}
	}
	return related;
}

/**
 * Where "Request a similar tattoo" goes: the artist's own request while they
 * take new work, else the studio's general one while it takes any, else
 * nowhere. Either carries the piece (`similar=<id>`), so the form starts with
 * a link to it; nothing is sent until the client sends the form.
 */
export function similarRequest(
	studio: StudioView,
	artwork: ArtworkView,
): { readonly href: string; readonly artist: ArtistView | null } | null {
	if (artwork.artist?.accepting) {
		return {
			href: requestHref({ artist: artwork.artist.slug, similar: artwork.id }),
			artist: artwork.artist,
		};
	}
	return studio.accepting
		? { href: requestHref({ similar: artwork.id }), artist: null }
		: null;
}
