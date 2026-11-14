/**
 * The studio pages' Cache-Control (TAT-48), by the route match's status.
 * A page holds no per-visitor data (no cookies, no key: the same HTML for
 * every visitor of a host), so the CDN may keep it like the API's own reads
 * (TAT-32). Keep it that way: anything personal on a page breaks this.
 */

/** A minute at the CDN, then up to ten more minutes served while it refreshes. */
export const PAGE_CACHE =
	"public, max-age=0, s-maxage=60, stale-while-revalidate=600";

/** Like TAT-12's own 404 page. */
export const NOT_FOUND_CACHE = "public, max-age=0, s-maxage=60";

export const NO_STORE = "no-store";

/**
 * Angles: the redirect from one of a tattoo's other photos to the tattoo's
 * page (loadArtworkPage) is temporary and kept a minute at most, since which
 * photo leads a tattoo can change; never a 301, which a browser keeps.
 */
export const ANGLE_REDIRECT_CACHE = "public, max-age=60";

/**
 * `/reviews` and `/fresh-ink` (Reviews and Fresh ink, slice 3): a minute at
 * the CDN and a minute more while it refreshes, so a review or post TattooDrip
 * took down leaves them within 2 minutes (the home page keeps PAGE_CACHE).
 */
export const CLIENT_PAGE_CACHE =
	"public, max-age=0, s-maxage=60, stale-while-revalidate=60";

/** The client pages' Cache-Control: CLIENT_PAGE_CACHE for a page, else as every page. */
export function clientPageCacheHeaders(status: string): Record<string, string> {
	return status === "success"
		? { "Cache-Control": CLIENT_PAGE_CACHE }
		: pageCacheHeaders(status);
}

export function pageCacheHeaders(status: string): Record<string, string> {
	if (status === "success") return { "Cache-Control": PAGE_CACHE };
	if (status === "notFound") return { "Cache-Control": NOT_FOUND_CACHE };
	return { "Cache-Control": NO_STORE };
}
