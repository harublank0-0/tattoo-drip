import type { Artist } from "@tattoo-drip/sdk";
import { filterStyles, readStyle } from "./gallery.ts";
import { ARTIST_SLUG, type ArtistView } from "./view-model.ts";

/**
 * The artists directory (`/artists`): every visible artist, filtered by one
 * tattoo style from the address. Pure and theme-free: a theme decides how it
 * looks. The list is the API's whole artist list (`GET /artists`, one read,
 * no pages, only the studio's visible artists), so the filter runs over all
 * of it and costs no request; each artist's six newest work photos come with
 * it (TAT-116), so previews cost none either.
 */

/** The directory's address, read strictly: one style slug, else nothing. */
export interface ArtistsSearch {
	readonly style?: string;
}

/** `?style=<slug>` when it has a style's shape, else no filter (search.ts hands over strings). */
export function readArtistsSearch(
	search: Record<string, unknown>,
): ArtistsSearch {
	const value = Object.hasOwn(search, "style") ? search.style : undefined;
	const style = readStyle(value);
	return style ? { style } : {};
}

/** A style an artist lists, as the filter offers it. */
export interface DirectoryStyle {
	readonly slug: string;
	readonly name: string;
	/** How many of the artists list it. */
	readonly count: number;
}

/**
 * An artist in the directory: the page's view and the styles they list as the
 * filter reads them (checked slug, one-line name, each slug once, at most
 * five), which is what the card shows, so a card always names the style that
 * selected it.
 */
export interface DirectoryArtist extends ArtistView {
	readonly styleRefs: readonly {
		readonly slug: string;
		readonly name: string;
	}[];
}

export interface ArtistsDirectory {
	/** Every visible artist, in the API's order. */
	readonly artists: readonly DirectoryArtist[];
	/** The styles at least one artist lists, by name; each with its count. */
	readonly styles: readonly DirectoryStyle[];
	/**
	 * The address's style: its name when an artist lists it, null when nobody
	 * does (an old or hand-typed link), so the page can say so and offer the
	 * way back. Null for no filter.
	 */
	readonly selected: {
		readonly slug: string;
		readonly name: string | null;
	} | null;
	/** The artists the filter keeps, in the same order. */
	readonly shown: readonly DirectoryArtist[];
	/** Whether the filter can narrow anything: two artists, and a style not everyone lists. */
	readonly filterable: boolean;
}

/** The most styles an artist lists (the contract's maxItems), as styleNames keeps. */
const MAX_ARTIST_STYLES = 5;

/**
 * The directory from the API's artists (raw, for their style slugs) and the
 * page's views of them (artistViewModels, which drops an artist whose slug
 * can't be a link), filtered by `search`. Pure.
 */
export function artistsDirectory(
	raw: readonly Artist[],
	views: readonly ArtistView[],
	search: ArtistsSearch,
): ArtistsDirectory {
	const bySlug = new Map(
		raw
			.filter((artist) => ARTIST_SLUG.test(artist.slug))
			.map((artist) => [artist.slug, artist]),
	);
	const counts = new Map<string, { name: string; count: number }>();
	const artists = views.map((view): DirectoryArtist => {
		const styles = filterStyles(bySlug.get(view.slug)?.styles).slice(
			0,
			MAX_ARTIST_STYLES,
		);
		for (const style of styles) {
			const entry = counts.get(style.slug);
			counts.set(style.slug, {
				name: entry?.name ?? style.name,
				count: (entry?.count ?? 0) + 1,
			});
		}
		return { ...view, styleRefs: styles };
	});
	const styles = [...counts]
		.map(([slug, { name, count }]) => ({ slug, name, count }))
		.sort((a, b) => a.name.localeCompare(b.name, "en"));
	const wanted = search.style;
	const selected =
		wanted === undefined
			? null
			: {
					slug: wanted,
					name: styles.find((style) => style.slug === wanted)?.name ?? null,
				};
	return {
		artists,
		styles,
		selected,
		shown:
			wanted === undefined
				? artists
				: artists.filter((artist) =>
						artist.styleRefs.some((style) => style.slug === wanted),
					),
		filterable:
			artists.length > 1 &&
			styles.some((style) => style.count < artists.length),
	};
}
