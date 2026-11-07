import { normalizeCountry } from "./country.ts";
import { readOrigin } from "./origin.ts";

/**
 * Discover's settings (D05, docs/discover/frontend.md), read on the server
 * from process.env. Only what `publicSettings` returns ever reaches a
 * browser; there is no secret here today, but keep it that way: a secret
 * added later stays server-only.
 */
export interface DiscoverConfig {
	/** API_URL: the platform API's origin; the SDK appends /api/v1. */
	apiUrl: string;
	/** MEDIA_URL: the origin public photos are served from; unset, the API's. */
	mediaUrl: string;
	/** DISCOVER_URL: Discover's own public origin, for canonical and social URLs. */
	siteUrl: string;
	/** APP_URL: Studio OS's origin, for Sign in and Get started. */
	studioOsUrl: string;
	/**
	 * DISCOVER_INDEXING: whether search engines may index Discover. Off unless
	 * it is exactly "on": every page then says noindex, robots.txt disallows
	 * everything and there is no sitemap.
	 */
	indexing: boolean;
	/**
	 * DISCOVER_MARKETS (D06.5): the countries Discover is local-first for, in
	 * the selector's order. Only these are saved in the preference cookie or
	 * taken from geolocation. Default: NP.
	 */
	markets: string[];
	/** DISCOVER_DEFAULT_COUNTRY: the country with no preference; one of the markets. */
	defaultCountry: string;
	/**
	 * DISCOVER_GEO_HEADER: the request header the trusted proxy sets to the
	 * visitor's country (nginx: X-Discover-Country, overwritten on every
	 * request), lower-cased; null (unset) turns geolocation off. Server only.
	 */
	geoHeader: string | null;
}

/** What the browser may know: the router's dehydrated state carries it. */
export type PublicSettings = Omit<DiscoverConfig, "geoHeader">;

type Env = Readonly<Record<string, string | undefined>>;

const ORIGIN_RULE =
	"an origin over https (http only on localhost), with no path, query or credentials";
const RULES = {
	API_URL: `the platform API's origin: ${ORIGIN_RULE}, e.g. https://api.tattoodrip.app`,
	MEDIA_URL: `the origin public photos are served from: ${ORIGIN_RULE}, e.g. https://media.tattoodrip.app; or unset when the API serves them`,
	DISCOVER_URL: `Discover's own origin: ${ORIGIN_RULE}, e.g. https://tattoodrip.app`,
	APP_URL: `Studio OS's origin (the platform's APP_URL): ${ORIGIN_RULE}, e.g. https://app.tattoodrip.app`,
	DISCOVER_INDEXING: `"on" to let search engines index Discover, "off" or unset to keep it out of search results`,
	DISCOVER_MARKETS:
		"a comma-separated list of ISO 3166-1 alpha-2 country codes Discover serves first, e.g. NP or NP,IN; unset: NP",
	DISCOVER_DEFAULT_COUNTRY:
		"the ISO 3166-1 alpha-2 code of one of DISCOVER_MARKETS, e.g. NP; unset: the first market",
	DISCOVER_GEO_HEADER:
		"the name of the header the trusted proxy sets to the visitor's country (X-Discover-Country behind deploy/nginx), or unset to turn geolocation off; never CF-IPCountry, which a visitor can send",
} as const;

/** An HTTP header name (RFC 9110 token, letters, digits and hyphens here). */
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/**
 * Reads and checks every setting. Throws one error naming each missing or
 * malformed variable and its rule, never a value.
 */
export function parseDiscoverConfig(env: Env): DiscoverConfig {
	const problems: string[] = [];
	const origin = (name: keyof typeof RULES, required: boolean) => {
		const value = env[name]?.trim();
		if (!value) {
			if (required) problems.push(`${name} is missing: ${RULES[name]}.`);
			return null;
		}
		const parsed = readOrigin(value);
		if (!parsed) problems.push(`${name} is not valid: ${RULES[name]}.`);
		return parsed;
	};
	const apiUrl = origin("API_URL", true);
	const mediaUrl = origin("MEDIA_URL", false);
	const siteUrl = origin("DISCOVER_URL", true);
	const studioOsUrl = origin("APP_URL", true);

	const indexingValue = env.DISCOVER_INDEXING?.trim().toLowerCase() ?? "";
	if (!["", "on", "off"].includes(indexingValue)) {
		problems.push(
			`DISCOVER_INDEXING is not valid: ${RULES.DISCOVER_INDEXING}.`,
		);
	}
	const marketsValue = env.DISCOVER_MARKETS?.trim() || "NP";
	const marketCodes = marketsValue
		.split(",")
		.map((code) => normalizeCountry(code));
	const markets = [
		...new Set(marketCodes.filter((code): code is string => !!code)),
	];
	if (marketCodes.some((code) => !code) || markets.length === 0) {
		problems.push(`DISCOVER_MARKETS is not valid: ${RULES.DISCOVER_MARKETS}.`);
	}
	const defaultValue = env.DISCOVER_DEFAULT_COUNTRY?.trim();
	const defaultCountry = defaultValue
		? normalizeCountry(defaultValue)
		: markets[0];
	if (!defaultCountry || !markets.includes(defaultCountry)) {
		problems.push(
			`DISCOVER_DEFAULT_COUNTRY is not valid: ${RULES.DISCOVER_DEFAULT_COUNTRY}.`,
		);
	}
	const geoValue = env.DISCOVER_GEO_HEADER?.trim() ?? "";
	if (
		geoValue &&
		(!HEADER_NAME.test(geoValue) || geoValue.toLowerCase() === "cf-ipcountry")
	) {
		problems.push(
			`DISCOVER_GEO_HEADER is not valid: ${RULES.DISCOVER_GEO_HEADER}.`,
		);
	}
	if (
		siteUrl &&
		studioOsUrl &&
		new URL(siteUrl).host === new URL(studioOsUrl).host
	) {
		problems.push(
			"DISCOVER_URL and APP_URL must be different hosts: Discover never shares Studio OS's origin (docs/discover/domain-migration.md).",
		);
	}

	if (
		problems.length > 0 ||
		!apiUrl ||
		!siteUrl ||
		!studioOsUrl ||
		!defaultCountry
	) {
		throw new Error(
			`Discover's settings are incomplete:\n- ${problems.join("\n- ")}`,
		);
	}
	return {
		apiUrl,
		mediaUrl: mediaUrl ?? apiUrl,
		siteUrl,
		studioOsUrl,
		indexing: indexingValue === "on",
		markets,
		defaultCountry,
		geoHeader: geoValue ? geoValue.toLowerCase() : null,
	};
}

/**
 * The settings a page may show: all but the geolocation header's name
 * (not a secret, but the browser has no use for it).
 */
export function publicSettings(config: DiscoverConfig): PublicSettings {
	const { geoHeader: _serverOnly, ...settings } = config;
	return { ...settings, markets: [...settings.markets] };
}

let cached: DiscoverConfig | undefined;

/**
 * This server's settings, from process.env, parsed on first use and kept
 * for the life of the process. Server code only: the browser gets
 * `publicSettings` through the router. Tests call `parseDiscoverConfig`.
 */
export function discoverConfig(): DiscoverConfig {
	cached ??= parseDiscoverConfig(process.env);
	return cached;
}
