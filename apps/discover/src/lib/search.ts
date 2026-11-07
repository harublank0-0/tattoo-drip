import { normalizeCountry } from "./country.ts";

export { countryName } from "./country.ts";

/** The API's search length (docs/discover/api.md): the form asks for the same. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;

// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A search text from the address: trimmed, 2 to 80 characters with no
 * control character (the API's rule), else none. A hand-edited address
 * never reaches the API malformed.
 */
export function readQuery(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text.length >= SEARCH_MIN &&
		text.length <= SEARCH_MAX &&
		!CONTROL.test(text)
		? text
		: undefined;
}

/**
 * The router's search parser (src/router.tsx): every value stays the text
 * the address has. The router's default reads values as JSON, so `?q=true`,
 * `?q=null` or `?q=007` would be a boolean, null or 7, never that search.
 * A repeated key keeps its last value.
 */
export function parseSearchText(search: string): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(search));
}

/**
 * The router's serializer, the parser's inverse: each defined value as text
 * (`true` for a boolean), never JSON-quoted (`?q=true`, not `?q=%22true%22`).
 */
export function stringifySearchText(search: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search))
		if (value !== undefined)
			params.set(
				key,
				typeof value === "object" && value !== null
					? JSON.stringify(value)
					: String(value),
			);
	const text = params.toString();
	return text ? `?${text}` : "";
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
 * Drops a style the platform's list doesn't have (it would be a 422). The
 * loader drops a style it can't check too (no list: `/styles` failed), and
 * the page says it isn't filtered by style (`styleUnchecked`).
 */
export function knownStyle(
	style: string | undefined,
	styles: readonly { slug: string }[],
): string | undefined {
	if (!style) return undefined;
	return styles.some((each) => each.slug === style) ? style : undefined;
}
