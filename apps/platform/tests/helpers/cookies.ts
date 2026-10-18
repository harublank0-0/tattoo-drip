/**
 * Set-Cookie lines from a test client response
 * (`response.headers()["set-cookie"]`) or from a response built with
 * ResponseFactory (`response.getHeader("set-cookie")`).
 */
export function setCookieLines(header: unknown): string[] {
	if (header === undefined || header === null) {
		return [];
	}
	return [header].flat().map(String);
}

export type SetCookie = { name: string; attributes: string[] };

/**
 * One Set-Cookie line: the cookie's name and its attributes in lower case
 * ("path=/", "httponly", "samesite=lax"), without the value.
 */
export function parseSetCookie(line: string): SetCookie {
	const [pair, ...attributes] = line.split(/;\s*/);
	return {
		name: pair.slice(0, pair.indexOf("=")),
		attributes: attributes.map((attribute) => attribute.toLowerCase()),
	};
}
