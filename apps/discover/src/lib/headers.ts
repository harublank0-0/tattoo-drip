/**
 * Response headers every Discover response carries (D10 phase B), set once
 * for the whole server by Nitro's route rules (vite.config.ts): pages,
 * server routes (robots, sitemaps, the preference endpoint), static files
 * and error responses alike. Pure data, no imports: vite.config.ts reads it.
 *
 * - `X-Content-Type-Options: nosniff`: a file is only ever what its type says.
 * - `Referrer-Policy: strict-origin-when-cross-origin`: another site (a
 *   studio's storefront, a social profile) sees only `https://tattoodrip.app`,
 *   never the page's path and query (a search, a filter).
 * - `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`: no page may be
 *   framed (clickjacking); the older header for browsers without CSP 2.
 * - The rest of the CSP restricts only what can't break the app:
 *   `base-uri 'self'` (an injected `<base>` can't redirect relative URLs),
 *   `object-src 'none'` (no plugins), `form-action 'self'` (every form,
 *   the search and the country selector, posts to Discover itself). It sets
 *   no `script-src`: TanStack Start's hydration and JSON-LD are inline
 *   scripts, so a script policy needs per-request nonces (D11 follow-up,
 *   rolled out Report-Only first; frontend guidance, "Security headers").
 * - `Permissions-Policy`: the powerful features Discover never uses are off
 *   for the page and anything it embeds. Web Share and the Clipboard (the
 *   artwork page's Share and Copy link) keep their defaults.
 *
 * No `Strict-Transport-Security` here: TLS ends at Cloudflare, and HSTS
 * (with its max-age and subdomains) is a decision for the domain (D11).
 */
export const SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy":
		"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
} as const;

/**
 * Static files outside `/assets` (D10): the favicon and the brand mark keep
 * their names across deploys, so they are cached for a day, not for good.
 * Hashed `/assets/*` files are `public, max-age=31536000, immutable`
 * (TanStack Start's own rule): a new build has new names.
 */
export const BRAND_CACHE_CONTROL = "public, max-age=86400";
