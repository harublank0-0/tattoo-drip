/**
 * The studio page's public settings (TAT-48, TAT-57): its own origin, e.g.
 * https://blackneedle.tattoodrip.com (canonical links and Open Graph URLs
 * must be absolute), and the public site key of the intake form's bot check
 * (null in development without one). Set once, like TAT-23's
 * TattooClientRef: on the server from the settings and the slug the tenant
 * middleware confirmed (src/site/request.ts), in the browser from the
 * router's dehydrated state. The browser never reads its own host (TAT-12).
 * Both values are public: every page carries them.
 */

const NOT_SET =
	"The site origin is not set yet: getRouter() sets it on the server, the router's hydrate in the browser.";
const INVALID =
	"This page's site address is missing or invalid. Reload the page.";

/** A Turnstile site key: public, and safe wherever it is written. */
export const CHALLENGE_SITE_KEY_SHAPE = /^[A-Za-z0-9_-]{10,100}$/;

/** The router context's part for the site (next to TAT-23's ApiContext). */
export interface SiteContext {
	readonly site: SiteRef;
}

/** What the router's dehydrated state carries for the site. */
export interface DehydratedSite {
	site: { origin: string; challengeSiteKey: string | null };
}

export class SiteRef {
	#origin: string | undefined;
	#challengeSiteKey: string | null = null;

	connect(origin: string, challengeSiteKey: string | null = null): void {
		if (this.#origin !== undefined) {
			throw new Error("The site origin is already set.");
		}
		const key = parseChallengeSiteKey(challengeSiteKey);
		this.#origin = parseSiteOrigin(origin);
		this.#challengeSiteKey = key;
	}

	get origin(): string {
		if (this.#origin === undefined) throw new Error(NOT_SET);
		return this.#origin;
	}

	/** The intake form's public Turnstile site key, or null (no bot check). */
	get challengeSiteKey(): string | null {
		if (this.#origin === undefined) throw new Error(NOT_SET);
		return this.#challengeSiteKey;
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

/** A site key of the expected shape, null for none (also from an older server's page), or a fixed error. */
export function parseChallengeSiteKey(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" && CHALLENGE_SITE_KEY_SHAPE.test(value)) {
		return value;
	}
	throw new Error(INVALID);
}

/** The router's dehydrate: the origin and the site key, and nothing else. */
export function dehydrateSite(site: SiteRef): DehydratedSite {
	return {
		site: { origin: site.origin, challengeSiteKey: site.challengeSiteKey },
	};
}

/** The router's hydrate: sets the browser's site from the server's. */
export function hydrateSite(
	site: SiteRef,
	dehydrated: { site?: unknown } | undefined,
): void {
	const value = dehydrated?.site;
	const fields =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	site.connect(
		parseSiteOrigin(fields.origin),
		parseChallengeSiteKey(fields.challengeSiteKey),
	);
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
