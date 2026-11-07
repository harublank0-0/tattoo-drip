const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A bare http(s) origin, normalised (no trailing slash), or null: https, or
 * http on localhost, with no path, query, fragment or credentials. Shared by
 * the server's settings and the browser's check of the dehydrated ones, so
 * this module must never import the settings.
 */
export function readOrigin(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (url.protocol === "http:" && !isLoopback(url.hostname)) return null;
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== "/" && url.pathname !== "") return null;
	return url.origin;
}

function isLoopback(hostname: string): boolean {
	return LOOPBACK.has(hostname) || hostname.endsWith(".localhost");
}
