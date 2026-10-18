/*
 * The deposit link's token (TAT-65 ruling 9, TAT-65b ruling 3). The studio
 * sends https://<studio>/deposit#<token>: the token rides in the URL's
 * fragment, which a browser never sends to the storefront's server, its logs
 * or a Referer. Only the browser reads it (components/deposit-screen.tsx,
 * after hydration), and only to call the API. It never goes in a query
 * string, storage, a log, the page's HTML or an in-page link.
 */

/** The contract's DepositToken (openapi.yaml): exactly 43 base64url characters. */
export const DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token in a URL fragment (with or without its "#"), or null when this
 * link can't work: then the page says so without asking the API. Nothing is
 * trimmed or decoded: a real token never needs it.
 */
export function readDepositToken(hash: string): string | null {
	const value = hash.startsWith("#") ? hash.slice(1) : hash;
	return DEPOSIT_TOKEN.test(value) ? value : null;
}

/**
 * The router's scroll-restoration key (src/router.tsx). The router keeps
 * scroll positions in sessionStorage under this key, and its default falls
 * back to the whole href, fragment and all, for a history entry without a
 * key of its own. This falls back to the path, so a deposit token can never
 * reach storage.
 */
export function scrollRestorationKey(location: {
	readonly pathname: string;
	readonly state: { readonly __TSR_key?: string };
}): string {
	return location.state.__TSR_key || location.pathname;
}
