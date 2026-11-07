import type {
	DiscoverArtistSummary,
	DiscoverLocation,
	DiscoverStudioSummary,
	DiscoverStyle,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { readCity, readCountry, readQuery, readStyle } from "./search.ts";

/**
 * The studio and artist directories' address (D07, docs/discover/frontend.md,
 * "Directories"): readers, the API query and the links that change it. Pure.
 *
 * The API (docs/discover/api.md) pages with an opaque keyset `cursor` and a
 * `nextCursor` (null on the last page), never with page numbers or totals,
 * so neither does Discover.
 */
export type DirectoryKind = "studios" | "artists";

/** Rows per directory page (the API's default; at most 48). */
export const DIRECTORY_LIMIT = 24;
/** The recent photos read beside a directory page, for each row's work. */
export const DIRECTORY_WORK_LIMIT = 48;

/**
 * The API's sorts, exactly (`sort`: ties by id). `newest` is the API's
 * default, so the address leaves it out.
 */
export const SORTS = ["newest", "name", "-name"] as const;
export type DirectorySort = (typeof SORTS)[number];

export function sortLabel(sort: DirectorySort, kind: DirectoryKind): string {
	if (sort === "name") return "Name, A to Z";
	if (sort === "-name") return "Name, Z to A";
	return kind === "studios" ? "Recently listed" : "Recently added";
}

/**
 * A directory's search: every key, `undefined` when missing or malformed
 * (validateSearch must return each key it owns). `independent` is the
 * artists' only; `sort` is never `newest` (the default).
 */
export type DirectorySearch = {
	q?: string;
	country?: string;
	city?: string;
	style?: string;
	sort?: Exclude<DirectorySort, "newest">;
	independent?: boolean;
	cursor?: string;
};

/** A sort the API has, other than the default; anything else is none. */
export function readSort(value: unknown): DirectorySearch["sort"] {
	return value === "name" || value === "-name" ? value : undefined;
}

/** A cursor as the API accepts it (base64url, at most 1000); its meaning is the API's. */
export function readCursor(value: unknown): string | undefined {
	return typeof value === "string" &&
		value.length <= 1000 &&
		/^[A-Za-z0-9_-]+$/.test(value)
		? value
		: undefined;
}

/** `true`/`false` (the router parses them to booleans; a hand-typed string too). */
export function readIndependent(value: unknown): boolean | undefined {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return undefined;
}

/** The search text; a number the router parsed from `?q=42` is still text. */
function readSearchText(value: unknown): string | undefined {
	return readQuery(typeof value === "number" ? String(value) : value);
}

/**
 * Reads a directory's address. A city needs its country in the address (a
 * city slug is unique per country only, and an address must mean the same
 * thing for every visitor).
 */
export function readDirectorySearch(
	search: Record<string, unknown>,
	kind: DirectoryKind,
): DirectorySearch {
	const country = readCountry(search.country);
	return {
		q: readSearchText(search.q),
		country,
		city: country ? readCity(search.city) : undefined,
		style: readStyle(search.style),
		sort: readSort(search.sort),
		independent:
			kind === "artists" ? readIndependent(search.independent) : undefined,
		cursor: readCursor(search.cursor),
	};
}

/** The filters a page was read with: always one country. */
export type DirectoryFilters = DirectorySearch & { country: string };

/**
 * The filters a loader reads with: the address's country, else the
 * visitor's (`context.country`); the city only when the address names its
 * country and it is that country; the style once checked against the list.
 */
export function resolveDirectory(
	search: DirectorySearch,
	country: string,
	style: string | undefined,
): DirectoryFilters {
	return {
		...search,
		country,
		city: search.country === country ? search.city : undefined,
		style,
	};
}

/** The API query of a directory page (`query` travels as the API's `q`). */
export function directoryQuery(filters: DirectoryFilters, kind: DirectoryKind) {
	return {
		...(filters.q ? { query: filters.q } : {}),
		country: filters.country,
		...(filters.city ? { city: filters.city } : {}),
		...(filters.style ? { style: filters.style } : {}),
		...(kind === "artists" && filters.independent !== undefined
			? { independent: filters.independent }
			: {}),
		...(filters.sort ? { sort: filters.sort } : {}),
		...(filters.cursor ? { cursor: filters.cursor } : {}),
		limit: DIRECTORY_LIMIT,
	};
}

/**
 * The recent photos read beside a directory (the same country, city and
 * style, newest first): each row shows its own work from it. The same for
 * every page and sort of one filter set, so paging reuses it.
 */
export function directoryWorkQuery(filters: DirectoryFilters) {
	return {
		country: filters.country,
		...(filters.city ? { city: filters.city } : {}),
		...(filters.style ? { style: filters.style } : {}),
		limit: DIRECTORY_WORK_LIMIT,
	};
}

/**
 * The address after a change: any filter, search, sort or country change
 * starts again at the first page (the cursor belongs to the old query);
 * a new country drops the city (it belongs to the old country), keeping
 * `q` and `style`, as the country selector does (`switchCountryPath`).
 */
export function changeSearch(
	search: DirectorySearch,
	change: Partial<DirectorySearch>,
): DirectorySearch {
	const next: DirectorySearch = { ...search, ...change, cursor: undefined };
	if ("country" in change && change.country !== search.country)
		next.city = change.city;
	return next;
}

/**
 * Choosing a city: it needs its country in the address, so an implicit
 * country becomes explicit (the page's own; nothing else changes).
 */
export function chooseCity(
	search: DirectorySearch,
	city: string | undefined,
	pageCountry: string,
): DirectorySearch {
	return city
		? changeSearch(search, { city, country: search.country ?? pageCountry })
		: changeSearch(search, { city: undefined });
}

/** Clear all: back to the first page with only the address's own country. */
export function clearedSearch(search: DirectorySearch): DirectorySearch {
	return { country: search.country };
}

/** The filters counted on the mobile Filters button (city, style, who; not sort). */
export function activeFilterCount(filters: DirectorySearch): number {
	return [filters.city, filters.style, filters.independent].filter(
		(value) => value !== undefined,
	).length;
}

/** Whether the address has any parameter: such a page is never indexed. */
export function hasSearchParams(search: Record<string, unknown>): boolean {
	return Object.values(search).some((value) => value !== undefined);
}

/** The address as form fields (a GET form's hidden inputs), without the keys a form sets itself. */
export function searchFields(
	search: DirectorySearch,
	omit: readonly (keyof DirectorySearch)[] = [],
): [string, string][] {
	return Object.entries(search)
		.filter(
			([key, value]) =>
				value !== undefined &&
				key !== "cursor" &&
				!omit.includes(key as keyof DirectorySearch),
		)
		.map(([key, value]) => [key, String(value)]);
}

/** A removable filter: its label and the address without it. */
export type FilterChip = {
	key: keyof DirectorySearch;
	label: string;
	remove: DirectorySearch;
};

/** A slug as words, for a filter whose name Discover couldn't look up (`new-delhi` → "New delhi"). */
export function humanizeSlug(slug: string): string {
	const words = slug.replace(/-/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The name of a place in a country, else the slug in words. */
export function placeName(
	places: readonly DiscoverLocation[] | undefined,
	country: string,
	slug: string,
): string {
	return (
		places?.find((each) => each.country === country && each.slug === slug)
			?.name ?? humanizeSlug(slug)
	);
}

/** The name of a style, else the slug in words. */
export function styleName(
	styles: readonly DiscoverStyle[] | undefined,
	slug: string,
): string {
	return styles?.find((each) => each.slug === slug)?.name ?? humanizeSlug(slug);
}

/**
 * The page's active filters as chips (the search, city, style, who). Each
 * removes only itself and keeps the rest of the address (an implicit
 * country stays implicit).
 */
export function filterChips(
	search: DirectorySearch,
	filters: DirectoryFilters,
	lists: {
		styles?: readonly DiscoverStyle[];
		places?: readonly DiscoverLocation[];
	},
): FilterChip[] {
	const chips: FilterChip[] = [];
	if (filters.q)
		chips.push({
			key: "q",
			label: `“${filters.q}”`,
			remove: changeSearch(search, { q: undefined }),
		});
	if (filters.city)
		chips.push({
			key: "city",
			label: placeName(lists.places, filters.country, filters.city),
			remove: changeSearch(search, { city: undefined }),
		});
	if (filters.style)
		chips.push({
			key: "style",
			label: styleName(lists.styles, filters.style),
			remove: changeSearch(search, { style: undefined }),
		});
	if (filters.independent !== undefined)
		chips.push({
			key: "independent",
			label: filters.independent ? "Independent" : "At a studio",
			remove: changeSearch(search, { independent: undefined }),
		});
	return chips;
}

/* Recent work ------------------------------------------------------------- */

/** An artist's newest photos in a recent-work read, at most `max`. */
export function artistWorks(
	artist: Pick<DiscoverArtistSummary, "id">,
	tattoos: readonly DiscoverTattooSummary[],
	max = 3,
): DiscoverTattooSummary[] {
	return tattoos.filter((each) => each.artist.id === artist.id).slice(0, max);
}

/** A studio's newest photos in a recent-work read (by its slug), at most `max`. */
export function studioWorks(
	studio: Pick<DiscoverStudioSummary, "slug">,
	tattoos: readonly DiscoverTattooSummary[],
	max = 3,
): DiscoverTattooSummary[] {
	return tattoos
		.filter(
			(each) =>
				each.studio.type === "studio" && each.studio.slug === studio.slug,
		)
		.slice(0, max);
}

/** The styles that appear in some listings, in the platform list's order. */
export function stylesIn(
	styles: readonly DiscoverStyle[] | undefined,
	listings: readonly { styles: readonly { slug: string }[] }[],
): DiscoverStyle[] {
	const seen = new Set(
		listings.flatMap((each) => each.styles.map((style) => style.slug)),
	);
	return (styles ?? []).filter((style) => seen.has(style.slug));
}

/** The filter controls' values (the toolbar's selects, the mobile sheet's draft). */
export type FilterDraft = Pick<
	DirectorySearch,
	"city" | "style" | "sort" | "independent"
>;

export function draftOf(filters: DirectorySearch): FilterDraft {
	return {
		city: filters.city,
		style: filters.style,
		sort: filters.sort,
		independent: filters.independent,
	};
}

/**
 * The address once the filter controls are applied: first page again; a
 * city brings its country into the address (`chooseCity`); `q` and the
 * country stay.
 */
export function applyFilters(
	search: DirectorySearch,
	draft: FilterDraft,
	pageCountry: string,
): DirectorySearch {
	const next = changeSearch(search, {
		style: draft.style,
		sort: draft.sort,
		independent: draft.independent,
	});
	return draft.city
		? { ...next, city: draft.city, country: next.country ?? pageCountry }
		: { ...next, city: undefined };
}
