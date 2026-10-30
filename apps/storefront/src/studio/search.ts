/**
 * The address's search as plain strings, both ways (TAT-126). TanStack's
 * default reads each value as JSON first and writes strings that would parse
 * back in quotes, so a slug that looks like JSON (`true`, `false`, `null`,
 * `1e2`, `2025`) arrived as a boolean, null or a number, or as another number
 * altogether (`1e2` is 100), and `?artist=2025` was written back as
 * `?artist=%222025%22`. Here nothing is parsed and nothing is quoted: every
 * value is the string in the address, the readers in gallery.ts check it, and
 * what they accepted is written back exactly as it came.
 */

/**
 * The search of an address as `{ key: "value" }`: no leading `?` needed, each
 * value the string as typed, the first of a repeated key. No prototype, so a
 * key like `__proto__` is only a key.
 */
export function parsePlainSearch(searchStr: string): Record<string, string> {
	const search: Record<string, string> = Object.create(null);
	for (const [key, value] of new URLSearchParams(searchStr)) {
		if (!(key in search)) search[key] = value;
	}
	return search;
}

/**
 * `?a=1&b=2` for a validated search, in its key order, or "" when it holds
 * nothing: a string as it is, `true` as `1` (the way `healed` is written and
 * the way our links write it, links.ts), numbers as their digits; anything
 * else (absent, null, false, objects) is left out. Percent-encoded like
 * links.ts, so a link and the router spell one search the same way.
 */
export function stringifyPlainSearch(search: Record<string, unknown>): string {
	const pairs: string[] = [];
	for (const [key, value] of Object.entries(search)) {
		const text =
			value === true
				? "1"
				: typeof value === "string"
					? value
					: typeof value === "number" && Number.isFinite(value)
						? String(value)
						: undefined;
		if (text !== undefined) {
			pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
		}
	}
	return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}
