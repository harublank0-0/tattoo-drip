/*
 * The review link's token (Reviews and Fresh ink, rulings 2 and 4). The
 * studio sends https://<studio>/review#<token>: the token rides in the URL's
 * fragment, which a browser never sends to the storefront's server, its logs
 * or a Referer, as the deposit link's does (src/deposit/token.ts). Only the
 * browser reads it (components/review-screen.tsx, after hydration), and only
 * to call the API, in the X-Review-Token header: never in a path, a query
 * string, storage, a log, the page's HTML or an in-page link.
 */

/** The contract's ReviewToken (openapi.yaml): exactly 43 base64url characters. */
export const REVIEW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token in a URL fragment (with or without its "#"), or null when this
 * link can't work: then the page says so without asking the API.
 */
export function readReviewToken(hash: string): string | null {
	const value = hash.startsWith("#") ? hash.slice(1) : hash;
	return REVIEW_TOKEN.test(value) ? value : null;
}
