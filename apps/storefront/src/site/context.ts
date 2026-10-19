/**
 * The studio page's own origin, e.g. https://blackneedle.tattoodrip.com
 * (TAT-48): canonical links and Open Graph URLs must be absolute. Set once,
 * like TAT-23's TattooClientRef: on the server from STOREFRONT_URL and the
 * slug the tenant middleware confirmed (src/site/request.ts), in the browser
 * from the router's dehydrated state. The browser never reads its own host
 * (TAT-12). The origin is public: it is in every page's canonical link.
 */

const NOT_SET =
	"The site origin is not set yet: getRouter() sets it on the server, the router's hydrate in the browser.";
const INVALID =
	"This page's site address is missing or invalid. Reload the page.";

/** The router context's part for the site (next to TAT-23's ApiContext). */
export interface SiteContext {
	readonly site: SiteRef;
}

/** What the router's dehydrated state carries for the site. */
export interface DehydratedSite {
	site: { origin: string };
}

export class SiteRef {
	#origin: string | undefined;

	connect(origin: string): void {
		if (this.#origin !== undefined) {
			throw new Error("The site origin is already set.");
		}
		this.#origin = parseSiteOrigin(origin);
	}

	get origin(): string {
		if (this.#origin === undefined) throw new Error(NOT_SET);
		return this.#origin;
	}
}

/** An http(s) origin exactly (no path, no trailing slash, lowercase), or a fixed error. */
export function parseSiteOrigin(value: unknown): string {
	if (typeof value === "string") {
		const url = parseUrl(value);
		if (
			url &&
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin === value
		) {
			return value;
		}
	}
	throw new Error(INVALID);
}

/** The router's dehydrate: the origin, and nothing else. */
export function dehydrateSite(site: SiteRef): DehydratedSite {
	return { site: { origin: site.origin } };
}

/** The router's hydrate: sets the browser's origin from the server's. */
export function hydrateSite(
	site: SiteRef,
	dehydrated: { site?: unknown } | undefined,
): void {
	const value = dehydrated?.site;
	const origin =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>).origin
			: undefined;
	site.connect(parseSiteOrigin(origin));
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
