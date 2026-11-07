import { bare, studioDomain, within } from "#services/app_origin";
import { pointsAtThisMachine } from "#services/storefront_url";

/**
 * The platform's public origins beside APP_URL (Discover D01,
 * docs/discover/domain-migration.md):
 *
 * - API_URL: where the public API is served. Unset, it is APP_URL's host (the
 *   live layout: dashboard and API on one host). Set to another host, that host
 *   serves /api only.
 * - DISCOVER_URL: the Discover site. Unset until Discover exists. Its host is
 *   never the dashboard's or the API's; the platform answers only /api there
 *   (the legacy /api proxy after the cutover), and it is a browser origin the
 *   API's CORS allows.
 *
 * Pure: start/env.ts runs checkPlatformOrigins while the environment is still
 * being read, so this file imports nothing from the app but the pure URL
 * helpers. Messages name keys and hosts, never a whole value.
 */

export type PlatformOriginSettings = {
	appUrl: string;
	apiUrl?: string;
	discoverUrl?: string;
	storefrontTemplate?: string;
	production: boolean;
};

const SHAPE =
	"an http(s) origin with no path, query, fragment or credentials (e.g. https://api.example.com)";

/** `value` as an origin URL, or a thrown Error naming `key`. */
function originUrl(key: string, value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${key} must be ${SHAPE}`);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		// new URL() drops an empty "?" or "#"; the raw text must not have one.
		/[?#]/.test(value)
	) {
		throw new Error(`${key} must be ${SHAPE}`);
	}
	return url;
}

/**
 * Throws when API_URL or DISCOVER_URL is malformed, when Discover would share
 * a host with the dashboard or the API, and, in production, when either is not
 * https or shares a domain with the studio pages (the rule APP_URL follows,
 * #services/app_origin). A loopback origin (a local production trial) skips
 * the domain comparison, never the https rule.
 */
export function checkPlatformOrigins({
	appUrl,
	apiUrl,
	discoverUrl,
	storefrontTemplate,
	production,
}: PlatformOriginSettings): void {
	const app = bare(new URL(appUrl).hostname);
	const api = apiUrl ? originUrl("API_URL", apiUrl) : undefined;
	const discover = discoverUrl
		? originUrl("DISCOVER_URL", discoverUrl)
		: undefined;

	if (discover) {
		const host = bare(discover.hostname);
		if (host === app || (api && host === bare(api.hostname))) {
			throw new Error(
				`DISCOVER_URL (${host}) must be a host of its own: the dashboard (APP_URL) and the API (API_URL) are served elsewhere`,
			);
		}
	}

	if (!production) return;
	const studios = storefrontTemplate ? studioDomain(storefrontTemplate) : "";
	for (const [key, url] of [
		["API_URL", api],
		["DISCOVER_URL", discover],
	] as const) {
		if (!url) continue;
		if (url.protocol !== "https:") {
			throw new Error(`${key} must be an https origin in production`);
		}
		const host = bare(url.hostname);
		if (pointsAtThisMachine(url.origin)) continue;
		if (studios && (within(host, studios) || within(studios, host))) {
			throw new Error(
				`${key} (${host}) and the studio pages (STOREFRONT_URL, *.${studios}) must be on separate domains in production`,
			);
		}
	}
}

/**
 * The hosts on which the platform serves its public API and nothing else: the
 * API's own host when it differs from the dashboard's, and Discover's host.
 * Lower case, without a port or trailing dot. Empty in the live layout, where
 * neither is set (and so every host answers as before).
 */
export function apiOnlyHosts({
	appUrl,
	apiUrl,
	discoverUrl,
}: Pick<
	PlatformOriginSettings,
	"appUrl" | "apiUrl" | "discoverUrl"
>): ReadonlySet<string> {
	const app = bare(new URL(appUrl).hostname);
	const hosts = new Set<string>();
	for (const value of [apiUrl, discoverUrl]) {
		if (!value) continue;
		const host = bare(new URL(value).hostname);
		if (host !== app) hosts.add(host);
	}
	return hosts;
}
