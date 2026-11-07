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
