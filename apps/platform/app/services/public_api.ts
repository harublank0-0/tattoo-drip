import type { HttpContext } from "@adonisjs/core/http";

/**
 * The public API (TAT-32). Everything under this prefix is stateless and
 * cookieless (the session, CSRF, auth and Inertia middleware skip it), has
 * CORS open without credentials, and answers with the { data } / { error }
 * envelopes. Type imports only: config/cors.ts loads this file at boot.
 */
export const API_PREFIX = "/api";

/** Methods that only read, so an old slug may serve them (TAT-24). */
export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * True for a public API request: the matched route's pattern, or before
 * routing (and for a URL no route matches) the URL path, is /api or below
 * it. Once a route matched, its pattern decides, so no URL can strip the
 * session from a dashboard route.
 */
export function isApiRequest(ctx: HttpContext): boolean {
	const path = ctx.route?.pattern ?? ctx.request.url();
	return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/** Headers every API response carries, errors included. */
export function setApiHeaders(response: HttpContext["response"]) {
	// Nothing is cacheable unless its route opts in (the publicCache middleware).
	response.header("Cache-Control", "no-store");
	// Also without an Origin header, so a CDN copy fetched server-side works in
	// a browser; the value never varies, so no Vary: Origin.
	response.header("Access-Control-Allow-Origin", "*");
	// Shield, which sets this on pages, does not run on the API.
	response.header("X-Content-Type-Options", "nosniff");
}

export type PublicCacheOptions = {
	maxAge?: number;
	staleWhileRevalidate?: number;
};

/**
 * Seconds for a cacheable public read: an owner's edit shows within a
 * minute, and a quiet studio page stays fast while one request refreshes it.
 */
export const PUBLIC_CACHE = { maxAge: 60, staleWhileRevalidate: 600 } as const;

/** The Cache-Control value of a cacheable public read. */
export function publicCacheControl({
	maxAge = PUBLIC_CACHE.maxAge,
	staleWhileRevalidate = PUBLIC_CACHE.staleWhileRevalidate,
}: PublicCacheOptions = {}) {
	return `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}
