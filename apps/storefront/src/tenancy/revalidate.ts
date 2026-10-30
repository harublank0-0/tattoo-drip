/**
 * Fresh reads for a server render (TAT-128). A studio page is cached for up
 * to 11 minutes after it is rendered (`PAGE_CACHE`: 60 s, then served stale
 * for 600 s while it refreshes). The API's public reads are cacheable too
 * (`public, max-age=60, stale-while-revalidate=600`), so with a shared cache
 * in front of the API a page can be built from an answer that is itself up
 * to 11 minutes old, and its data would be up to 22 minutes old when
 * served, past the "up to 15 minutes" the dashboard promises. The server's
 * reads therefore ask every cache on the way for a fresh answer (a request
 * `Cache-Control: no-cache`, which an API cache must revalidate); the
 * deployment must make the API's shared cache honour it (apps/platform
 * docs/deploy.md). Only the server's own reads: the browser's requests are
 * cross-origin, and the API's CORS list does not allow this header.
 * Imports nothing: the browser loads src/api/context.ts, which imports this.
 */

/** `base` (else the global fetch) with `Cache-Control: no-cache` on every read (GET and HEAD). */
export function withRevalidation(base: typeof fetch | undefined): typeof fetch {
	const wrapped = (input: RequestInfo | URL, init: RequestInit = {}) => {
		const method = (
			init.method ?? (input instanceof Request ? input.method : "GET")
		).toUpperCase();
		if (method !== "GET" && method !== "HEAD") {
			return (base ?? globalThis.fetch)(input, init);
		}
		const headers = new Headers(init.headers);
		headers.set("Cache-Control", "no-cache");
		return (base ?? globalThis.fetch)(input, { ...init, headers });
	};
	return wrapped as typeof fetch;
}
