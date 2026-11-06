/**
 * The browser origins the public API answers cross-origin (CORS, Discover
 * D01). The API is cookieless and never allows credentials, so CORS guards
 * no session; the allowlist keeps other sites' pages from reading it or
 * posting to it with the bot-challenge header from a visitor's browser.
 *
 * - every studio page: STOREFRONT_URL's origin with any stored-slug-shaped
 *   label for `{tenant}` (all of them are hosts we serve; an unknown slug is
 *   the storefront's own 404 page);
 * - the dashboard (APP_URL) and Discover (DISCOVER_URL, when set).
 *
 * Nothing else: not the studio pages' apex, not `null`, never a pattern from
 * outside. Custom studio domains (TAT-79) are not served yet; when they are,
 * their verified hosts join this list. Pure: config/cors.ts builds it once
 * from the environment.
 */

export type BrowserOriginSettings = {
	appUrl: string;
	discoverUrl?: string;
	/** STOREFRONT_URL, or the development default when it is unset. */
	storefrontTemplate: string;
};

/** A slug as a studio host carries it: the shape of the slug registry's CHECK. */
const SLUG_LABEL = "[a-z0-9][a-z0-9-]{1,61}[a-z0-9]";
const MARKER = "tdslugmarker";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A matcher for the origins of every studio page under `template`. */
function studioPages(template: string): RegExp {
	const origin = new URL(template.replaceAll("{tenant}", MARKER)).origin;
	const pattern = escapeRegExp(origin).replace(MARKER, SLUG_LABEL);
	return new RegExp(`^${pattern}$`);
}

/**
 * Whether a browser at `origin` (the request's Origin header, exactly as
 * sent) may read the API's answers.
 */
export function browserOriginPolicy({
	appUrl,
	discoverUrl,
	storefrontTemplate,
}: BrowserOriginSettings): (origin: string) => boolean {
	const exact = new Set(
		[appUrl, discoverUrl]
			.filter((value): value is string => Boolean(value))
			.map((value) => new URL(value).origin),
	);
	const studios = studioPages(storefrontTemplate);
	return (origin) => exact.has(origin) || studios.test(origin);
}
