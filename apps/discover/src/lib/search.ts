import { normalizeCountry } from "./country.ts";

export { countryName } from "./country.ts";

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

/** An assigned ISO 3166-1 alpha-2 country code, upper-cased (`np` → `NP`), else none. */
export const readCountry = normalizeCountry;

/** A city's slug; the API needs its country too, so `readDirectorySearch` drops a city without one. */
export const readCity = readSlug;

/**
 * A style's slug, by shape. The API refuses a slug that isn't on its list
 * (422), so the loader also checks it against `/styles` (`knownStyle`).
 */
export const readStyle = readSlug;

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
