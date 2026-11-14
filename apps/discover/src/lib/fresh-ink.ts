import type {
	DiscoverFreshInkQuery,
	DiscoverLocation,
	DiscoverStyle,
} from "@tattoo-drip/sdk";
import { countryName } from "./country.ts";
import { humanizeSlug, placeName, readCursor, styleName } from "./directory.ts";
import { readCity, readCountry, readStyle } from "./search.ts";

/**
 * The Fresh ink feed's address (`/fresh-ink`, Reviews and Fresh ink slice
 * 4; docs/discover/frontend.md, "Fresh ink"), as the gallery's (D09) but
 * with no search, artist or studio: `country`, `city`, `style` and the
 * API's opaque `cursor`. Country-aware like the gallery (D06.5): the
 * address's country, else the visitor's. Pure.
 */

/** Posts per feed page. */
export const FRESH_INK_LIMIT = 24;
/** The first tiles of a first page that load at once. */
export const FRESH_INK_EAGER = 4;

export type FreshInkSearch = {
	country?: string;
	city?: string;
	style?: string;
	cursor?: string;
};

/** Every key, `undefined` when missing or malformed; a city needs its country in the address. */
export function readFreshInkSearch(
	search: Record<string, unknown>,
): FreshInkSearch {
	const country = readCountry(search.country);
	return {
		country,
		city: country ? readCity(search.city) : undefined,
		style: readStyle(search.style),
		cursor: readCursor(search.cursor),
	};
}

/** What a page was read with: always one country (the address's, else the visitor's). */
export type FreshInkFilters = Omit<FreshInkSearch, "country"> & {
	country: string;
};

export function resolveFreshInk(
	search: FreshInkSearch,
	pageCountry: string,
	style: string | undefined,
): FreshInkFilters {
	const country = search.country ?? pageCountry;
	return {
		...search,
		country,
		city: search.country === country ? search.city : undefined,
		style,
	};
}

export function freshInkQuery(filters: FreshInkFilters): DiscoverFreshInkQuery {
	return {
		country: filters.country,
		...(filters.city ? { city: filters.city } : {}),
		...(filters.style ? { style: filters.style } : {}),
		...(filters.cursor ? { cursor: filters.cursor } : {}),
		limit: FRESH_INK_LIMIT,
	};
}

/** The address after a change: the first page again; a new country drops the city. */
export function changeFreshInk(
	search: FreshInkSearch,
	change: Partial<FreshInkSearch>,
): FreshInkSearch {
	const next: FreshInkSearch = { ...search, ...change, cursor: undefined };
	if ("country" in change && change.country !== search.country)
		next.city = change.city;
	return next;
}

/** Clear filters: the first page with only the address's own country. */
export function clearedFreshInk(search: FreshInkSearch): FreshInkSearch {
	return { country: search.country };
}

/** The filter controls applied: a city brings its country into the address (as the gallery). */
export function applyFreshInkFilters(
	search: FreshInkSearch,
	draft: { city?: string; style?: string },
	pageCountry: string,
): FreshInkSearch {
	const next = changeFreshInk(search, { style: draft.style });
	const country = next.country ?? pageCountry;
	return draft.city
		? { ...next, city: draft.city, country }
		: { ...next, city: undefined };
}

export type FreshInkLabels = { city?: string; style?: string };

export function freshInkLabels(
	filters: FreshInkFilters,
	lists: {
		styles?: readonly DiscoverStyle[];
		places?: readonly DiscoverLocation[];
	},
): FreshInkLabels {
	return {
		city: filters.city
			? placeName(lists.places, filters.country, filters.city)
			: undefined,
		style: filters.style ? styleName(lists.styles, filters.style) : undefined,
	};
}

export type FreshInkChip = {
	key: keyof FreshInkSearch;
	label: string;
	remove: FreshInkSearch;
};

/** The active filters as chips; each removes only itself. */
export function freshInkChips(
	search: FreshInkSearch,
	filters: FreshInkFilters,
	labels: FreshInkLabels,
): FreshInkChip[] {
	const chips: FreshInkChip[] = [];
	if (filters.city)
		chips.push({
			key: "city",
			label: labels.city ?? humanizeSlug(filters.city),
			remove: changeFreshInk(search, { city: undefined }),
		});
	if (filters.style)
		chips.push({
			key: "style",
			label: labels.style ?? humanizeSlug(filters.style),
			remove: changeFreshInk(search, { style: undefined }),
		});
	return chips;
}

/** "Fresh ink from Nepal", "Blackwork Fresh ink in Pokhara". */
export function freshInkTitle(
	filters: FreshInkFilters,
	labels: FreshInkLabels,
): string {
	const where = labels.city ?? countryName(filters.country);
	return labels.style
		? `${labels.style} Fresh ink in ${where}`
		: `Fresh ink from ${where}`;
}

/** The address as a GET form's hidden fields, without the keys the form sets itself. */
export function freshInkFields(
	search: FreshInkSearch,
	omit: readonly (keyof FreshInkSearch)[] = [],
): [string, string][] {
	return Object.entries(search)
		.filter(
			([key, value]) =>
				value !== undefined &&
				key !== "cursor" &&
				!omit.includes(key as keyof FreshInkSearch),
		)
		.map(([key, value]) => [key, String(value)]);
}
