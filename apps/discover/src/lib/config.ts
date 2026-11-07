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
}

/** What the browser may know: the router's dehydrated state carries it. */
export type PublicSettings = DiscoverConfig;

type Env = Readonly<Record<string, string | undefined>>;

const ORIGIN_RULE =
	"an origin over https (http only on localhost), with no path, query or credentials";
const RULES = {
	API_URL: `the platform API's origin: ${ORIGIN_RULE}, e.g. https://api.tattoodrip.app`,
	MEDIA_URL: `the origin public photos are served from: ${ORIGIN_RULE}, e.g. https://media.tattoodrip.app; or unset when the API serves them`,
	DISCOVER_URL: `Discover's own origin: ${ORIGIN_RULE}, e.g. https://tattoodrip.app`,
	APP_URL: `Studio OS's origin (the platform's APP_URL): ${ORIGIN_RULE}, e.g. https://app.tattoodrip.app`,
	DISCOVER_INDEXING: `"on" to let search engines index Discover, "off" or unset to keep it out of search results`,
} as const;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
	if (
		siteUrl &&
		studioOsUrl &&
		new URL(siteUrl).host === new URL(studioOsUrl).host
	) {
		problems.push(
			"DISCOVER_URL and APP_URL must be different hosts: Discover never shares Studio OS's origin (docs/discover/domain-migration.md).",
		);
	}

	if (problems.length > 0 || !apiUrl || !siteUrl || !studioOsUrl) {
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
	};
}

/** The settings a page may show: all of them today (nothing secret). */
export function publicSettings(config: DiscoverConfig): PublicSettings {
	return { ...config };
}

/** A bare http(s) origin, normalised (no trailing slash), or null. */
export function readOrigin(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (url.protocol === "http:" && !isLoopback(url.hostname)) return null;
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== "/" && url.pathname !== "") return null;
	return url.origin;
}

function isLoopback(hostname: string): boolean {
	return LOOPBACK.has(hostname) || hostname.endsWith(".localhost");
}

let cached: { env: Env; config: DiscoverConfig } | null = null;

/**
 * This server's settings, from process.env, parsed once per environment
 * object (tests pass their own). Server code only: the browser gets
 * `publicSettings` through the router.
 */
export function discoverConfig(env: Env = process.env): DiscoverConfig {
	if (cached?.env === env) return cached.config;
	const config = parseDiscoverConfig(env);
	cached = { env, config };
	return config;
}
