/** The API's search length (docs/discover/api.md): the form asks for the same. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;

/**
 * A search text from the address: trimmed, 2 to 80 characters (the API's
 * rule), else none. A hand-edited address never reaches the API malformed.
 */
export function readQuery(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text.length >= SEARCH_MIN && text.length <= SEARCH_MAX
		? text
		: undefined;
}

/** A place or style slug as the API checks it (`places_slug_format`, at most 63). */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readSlug(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.length <= 63 && SLUG.test(value) ? value : undefined;
}

/** An ISO 3166-1 alpha-2 country code, upper-cased (`np` → `NP`), else none. */
export function readCountry(value: unknown): string | undefined {
	if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value))
		return undefined;
	return value.toUpperCase();
}

/** A city's slug; the API needs its country too, so `readStudioSearch` drops a city without one. */
export const readCity = readSlug;

/**
 * A style's slug, by shape. The API refuses a slug that isn't on its list
 * (422), so the loader also checks it against `/styles` (`knownStyle`).
 */
export const readStyle = readSlug;

/** `/explore/studios`'s search: every key, `undefined` when missing or malformed. */
export type StudioSearch = {
	q?: string;
	country?: string;
	city?: string;
	style?: string;
};

/**
 * Reads `/explore/studios`'s address (its validateSearch). Returns every
 * key: the router merges the result over the raw search, so a key left
 * out would let a malformed value through.
 */
export function readStudioSearch(
	search: Record<string, unknown>,
): StudioSearch {
	const country = readCountry(search.country);
	return {
		q: readQuery(search.q),
		country,
		city: country ? readCity(search.city) : undefined,
		style: readStyle(search.style),
	};
}

/**
 * Drops a style the platform's list doesn't have (it would be a 422). When
 * the list couldn't be read, the shape check stands alone.
 */
export function knownStyle(
	style: string | undefined,
	styles: readonly { slug: string }[] | undefined,
): string | undefined {
	if (!style || !styles) return style;
	return styles.some((each) => each.slug === style) ? style : undefined;
}

/** The studios list's API query for a search, or undefined for the plain first page. */
export function studioQuery(search: StudioSearch) {
	const query = {
		...(search.q ? { query: search.q } : {}),
		...(search.country ? { country: search.country } : {}),
		...(search.country && search.city ? { city: search.city } : {}),
		...(search.style ? { style: search.style } : {}),
	};
	return Object.keys(query).length > 0 ? query : undefined;
}

/** A slug as words, for a filter whose name Discover couldn't look up (`new-york` → "New york"). */
export function humanizeSlug(slug: string): string {
	const words = slug.replace(/-/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A country's English name from its code (`NP` → "Nepal"), or the code itself. */
export function countryName(code: string): string {
	try {
		return (
			new Intl.DisplayNames(["en"], { type: "region" }).of(
				code.toUpperCase(),
			) ?? code
		);
	} catch {
		return code;
	}
}
