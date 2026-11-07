import type {
	DiscoverLocation,
	DiscoverStyle,
	DiscoverTattooSummary,
	DiscoverTattoosListQuery,
} from "@tattoo-drip/sdk";
import { countryName } from "./country.ts";
import { humanizeSlug, placeName, readCursor, styleName } from "./directory.ts";
import { readCity, readCountry, readQuery, readStyle } from "./search.ts";

/**
 * The tattoo gallery's address (D09, `/tattoos`, docs/discover/frontend.md,
 * "Gallery"): readers, the API query, the links that change it and the
 * search box's debounce rule. Pure.
 *
 * The API (`/discover/tattoos`) lists published photos newest first only
 * (no other sort, so the gallery shows no sort control), pages with an
 * opaque keyset `cursor` (no totals or page numbers), and since D09 takes
 * `q`: a photo's alt text, its artist's, studio's or style's name.
 */

/** Photos per gallery page (the API's default; at most 48). */
export const GALLERY_LIMIT = 24;
/** How long the search box waits after the last keystroke before it searches. */
export const SEARCH_DEBOUNCE_MS = 400;
/** The first photos of a page that load at once (above the fold on a phone and a desktop). */
export const GALLERY_EAGER = 4;

/** A studio's (tenant's) slug as the API checks it. */
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** An artist's id, any letter case (the API's `artist` filter). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The gallery's search: every key, `undefined` when missing or malformed
 * (validateSearch must return each key it owns). `artist` (an id) and
 * `studio` (a slug) come from a profile's "See all work" link.
 */
export type GallerySearch = {
	q?: string;
	country?: string;
	city?: string;
	style?: string;
	artist?: string;
	studio?: string;
	cursor?: string;
};

/** An artist's id from the address, lower-cased, else none. */
export function readArtistId(value: unknown): string | undefined {
	return typeof value === "string" && UUID.test(value)
		? value.toLowerCase()
		: undefined;
}

/** A studio's slug from the address, else none. */
export function readStudioSlug(value: unknown): string | undefined {
	return typeof value === "string" && TENANT_SLUG.test(value)
		? value
		: undefined;
}

/** The search text; a number or boolean from elsewhere is still that text (as the directories). */
function readSearchText(value: unknown): string | undefined {
	return readQuery(
		typeof value === "number" || typeof value === "boolean" || value === null
			? String(value)
			: value,
	);
}

/** Reads the gallery's address. A city needs its country in the address (as the directories). */
export function readGallerySearch(
	search: Record<string, unknown>,
): GallerySearch {
	const country = readCountry(search.country);
	return {
		q: readSearchText(search.q),
		country,
		city: country ? readCity(search.city) : undefined,
		style: readStyle(search.style),
		artist: readArtistId(search.artist),
		studio: readStudioSlug(search.studio),
		cursor: readCursor(search.cursor),
	};
}

/**
 * What a gallery page was read with. `country` is the address's, else the
 * visitor's (D06.5), except on one artist's or studio's work (`artist`,
 * `studio`): a profile is global, so its work is too unless the address
 * names a country. Then there is no country and no city.
 */
export type GalleryFilters = Omit<GallerySearch, "country"> & {
	country: string | undefined;
};

export function resolveGallery(
	search: GallerySearch,
	pageCountry: string,
	style: string | undefined,
): GalleryFilters {
	const scoped = Boolean(search.artist || search.studio);
	const country = search.country ?? (scoped ? undefined : pageCountry);
	return {
		...search,
		country,
		city: country && search.country === country ? search.city : undefined,
		style,
	};
}

/** The API query of a gallery page (`query` travels as the API's `q`). */
export function galleryQuery(
	filters: GalleryFilters,
): DiscoverTattoosListQuery {
	return {
		...(filters.q ? { query: filters.q } : {}),
		...(filters.country ? { country: filters.country } : {}),
		...(filters.city ? { city: filters.city } : {}),
		...(filters.style ? { style: filters.style } : {}),
		...(filters.artist ? { artist: filters.artist } : {}),
		...(filters.studio ? { studio: filters.studio } : {}),
		...(filters.cursor ? { cursor: filters.cursor } : {}),
		limit: GALLERY_LIMIT,
	};
}

/**
 * The address after a change: back to the first page (the cursor belongs to
 * the old query); a new country drops the city.
 */
export function changeGallery(
	search: GallerySearch,
	change: Partial<GallerySearch>,
): GallerySearch {
	const next: GallerySearch = { ...search, ...change, cursor: undefined };
	if ("country" in change && change.country !== search.country)
		next.city = change.city;
	return next;
}

/** Clear filters: the first page with only the address's own country. */
export function clearedGallery(search: GallerySearch): GallerySearch {
	return { country: search.country };
}

/** Whether the page is narrowed beyond its country (a search, place, style, artist or studio). */
export function isFiltered(filters: GalleryFilters): boolean {
	return Boolean(
		filters.q ||
			filters.city ||
			filters.style ||
			filters.artist ||
			filters.studio,
	);
}

/** The filter controls' values (the toolbar's selects, the mobile sheet's draft). */
export type GalleryDraft = { city?: string; style?: string };

/**
 * The address once the filter controls are applied: the first page again;
 * a city brings its country into the address (as the directories); without
 * a country (one artist's or studio's work) there is no city.
 */
export function applyGalleryFilters(
	search: GallerySearch,
	draft: GalleryDraft,
	pageCountry: string | undefined,
): GallerySearch {
	const next = changeGallery(search, { style: draft.style });
	const country = next.country ?? pageCountry;
	return draft.city && country
		? { ...next, city: draft.city, country }
		: { ...next, city: undefined };
}

/** The names the chips and titles use, looked up from the page's data. */
export type GalleryLabels = {
	city?: string;
	style?: string;
	artist?: string;
	studio?: string;
};

/** The artist's and studio's names when the page's photos carry them. */
export function scopeNames(
	filters: Pick<GalleryFilters, "artist" | "studio">,
	tattoos: readonly DiscoverTattooSummary[],
): { artist?: string; studio?: string } {
	return {
		artist: filters.artist
			? tattoos.find((each) => each.artist.id === filters.artist)?.artist.name
			: undefined,
		studio: filters.studio
			? (tattoos.find((each) => each.studio.slug === filters.studio)?.studio
					.name ?? humanizeSlug(filters.studio))
			: undefined,
	};
}

/** Every name a gallery page shows for its filters. */
export function galleryLabels(
	filters: GalleryFilters,
	lists: {
		styles?: readonly DiscoverStyle[];
		places?: readonly DiscoverLocation[];
	},
	tattoos: readonly DiscoverTattooSummary[],
): GalleryLabels {
	return {
		city:
			filters.city && filters.country
				? placeName(lists.places, filters.country, filters.city)
				: undefined,
		style: filters.style ? styleName(lists.styles, filters.style) : undefined,
		...scopeNames(filters, tattoos),
	};
}

export type GalleryChip = {
	key: keyof GallerySearch;
	label: string;
	remove: GallerySearch;
};

/** The active filters as chips (search, artist, studio, city, style); each removes only itself. */
export function galleryChips(
	search: GallerySearch,
	filters: GalleryFilters,
	labels: GalleryLabels,
): GalleryChip[] {
	const chips: GalleryChip[] = [];
	const chip = (key: keyof GallerySearch, label: string) =>
		chips.push({
			key,
			label,
			remove: changeGallery(search, { [key]: undefined }),
		});
	if (filters.q) chip("q", `“${filters.q}”`);
	if (filters.artist) chip("artist", `By ${labels.artist ?? "this artist"}`);
	if (filters.studio) chip("studio", `At ${labels.studio ?? filters.studio}`);
	if (filters.city) chip("city", labels.city ?? humanizeSlug(filters.city));
	if (filters.style) chip("style", labels.style ?? humanizeSlug(filters.style));
	return chips;
}

/** The filters counted on the mobile Filters button (the sheet's own: city, style). */
export function galleryFilterCount(filters: GalleryFilters): number {
	return [filters.city, filters.style].filter(Boolean).length;
}

/**
 * What the search box does with what the visitor typed, against the
 * address's search: nothing (one character, too long, a control character,
 * or unchanged), or apply a search (`q`), or clear it (`q` undefined: an
 * emptied box). The debounce and Enter both use it.
 */
export function nextSearch(
	typed: string,
	current: string | undefined,
): { apply: false } | { apply: true; q: string | undefined } {
	const text = typed.trim();
	if (text === "")
		return current ? { apply: true, q: undefined } : { apply: false };
	const q = readQuery(text);
	if (!q || q === current) return { apply: false };
	return { apply: true, q };
}

/**
 * A gallery page's title, server-rendered: what it shows ("Blackwork
 * tattoos in Kathmandu", "Tattoos by Sita Rai", "Tattoos matching "koi"").
 */
export function galleryTitle(
	filters: GalleryFilters,
	labels: GalleryLabels,
): string {
	if (filters.q) return `Tattoos matching "${filters.q}"`;
	const where =
		labels.city ?? (filters.country ? countryName(filters.country) : undefined);
	const what = labels.style ? `${labels.style} tattoos` : "Tattoos";
	if (filters.artist) return `${what} by ${labels.artist ?? "one artist"}`;
	if (filters.studio) return `${what} from ${labels.studio ?? filters.studio}`;
	if (labels.style) return where ? `${what} in ${where}` : what;
	return where ? `Tattoo inspiration from ${where}` : "Tattoo inspiration";
}

/** The address as a GET form's hidden fields, without the keys the form sets itself. */
export function galleryFields(
	search: GallerySearch,
	omit: readonly (keyof GallerySearch)[] = [],
): [string, string][] {
	return Object.entries(search)
		.filter(
			([key, value]) =>
				value !== undefined &&
				key !== "cursor" &&
				!omit.includes(key as keyof GallerySearch),
		)
		.map(([key, value]) => [key, String(value)]);
}
