import { isDnsName, STORED_SLUG } from "./host.ts";

/** The storefront's server-only settings (TAT-12), from process.env. */
export interface StorefrontConfig {
	/** The API's origin, e.g. https://api.example.com; the SDK appends /api/v1. */
	apiUrl: string;
	/** The studio pages' scheme. */
	protocol: "http:" | "https:";
	/** The domain studios are subdomains of, lowercase: "tattoodrip.com", "localhost". */
	baseHost: string;
	/** ":3000" when STOREFRONT_URL names a port other than its scheme's default, else "". */
	port: string;
	/**
	 * STOREFRONT_SERVER_KEY, only when set: the secret the server sends with
	 * its API calls (Authorization: Bearer), for rate limiting only. The
	 * platform checks it from TAT-38. Never sent to a browser.
	 */
	serverKey?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const API_URL_RULE =
	"the API's origin over https (http only on localhost), with no path, query or credentials, e.g. https://api.example.com";
const STOREFRONT_URL_RULE =
	"the studio pages' origin with {tenant} as its first label, over https (http only on localhost), e.g. https://{tenant}.example.com";

/** `{tenant}.`, a host, an optional port, and at most one "/" after it. */
const STOREFRONT_URL_SHAPE =
	/^(https?):\/\/\{tenant\}\.([^/?#:@]+)(?::(\d{1,5}))?\/?$/;

const SERVER_KEY_RULE =
	"32 to 256 letters, digits or -._~+/ characters, then at most two = of padding, e.g. the output of openssl rand -base64 32";

/** RFC 7235 token68, the characters a Bearer token may hold: 32 to 256 of them, then base64's padding. */
const SERVER_KEY_SHAPE = /^[A-Za-z0-9._~+/-]{32,256}={0,2}$/;

const DEFAULT_PORTS = { "http:": 80, "https:": 443 } as const;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Reads API_URL and STOREFRONT_URL (the platform's setting of the same name
 * and value, TAT-65), and STOREFRONT_SERVER_KEY when set (TAT-23). Throws one
 * error naming every bad variable and its rule, never a value, so a secret
 * can't end up in a log.
 */
export function parseStorefrontConfig(env: Env): StorefrontConfig {
	const problems: string[] = [];
	const apiUrl = readApiUrl(env.API_URL?.trim(), problems);
	const site = readStorefrontUrl(env.STOREFRONT_URL?.trim(), problems);
	const serverKey = readServerKey(env.STOREFRONT_SERVER_KEY?.trim(), problems);
	if (!apiUrl || !site || problems.length > 0) {
		const list = problems.map((problem) => `- ${problem}`).join("\n");
		throw new Error(
			`The storefront's settings are invalid (see apps/storefront/.env.local.example):\n${list}`,
		);
	}
	return { apiUrl, ...site, ...(serverKey ? { serverKey } : {}) };
}

/**
 * A studio's origin, e.g. https://blackneedle.tattoodrip.com. Throws for
 * anything but a stored slug, so a redirect built on it stays on our domain.
 */
export function tenantOrigin(config: StorefrontConfig, slug: string): string {
	if (!STORED_SLUG.test(slug)) {
		throw new Error("tenantOrigin() needs a stored tenant slug");
	}
	return `${config.protocol}//${slug}.${config.baseHost}${config.port}`;
}

let cached: StorefrontConfig | undefined;

/** The settings from process.env, read once per server process. Server only. */
export function storefrontConfig(): StorefrontConfig {
	cached ??= parseStorefrontConfig(process.env);
	return cached;
}

function problem(
	name: string,
	value: string | undefined,
	rule: string,
): string {
	return value
		? `${name} is invalid: it must be ${rule}.`
		: `${name} is not set: set it to ${rule}.`;
}

function readApiUrl(
	value: string | undefined,
	problems: string[],
): string | undefined {
	const url = value ? parseUrl(value) : undefined;
	const loopback = url ? LOOPBACK_HOSTS.includes(url.hostname) : false;
	const scheme =
		url?.protocol === "https:" || (url?.protocol === "http:" && loopback);
	if (
		!url ||
		!scheme ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		problems.push(problem("API_URL", value, API_URL_RULE));
		return undefined;
	}
	return url.origin;
}

function readStorefrontUrl(
	value: string | undefined,
	problems: string[],
): Omit<StorefrontConfig, "apiUrl"> | undefined {
	const match = value ? STOREFRONT_URL_SHAPE.exec(value) : null;
	const protocol = match?.[1] === "http" ? "http:" : "https:";
	const baseHost = match?.[2]?.toLowerCase() ?? "";
	const local = baseHost === "localhost" || baseHost.endsWith(".localhost");
	const portNumber = match?.[3] === undefined ? undefined : Number(match[3]);
	const badPort =
		portNumber !== undefined && (portNumber < 1 || portNumber > 65_535);
	if (
		!match ||
		!isDnsName(baseHost) ||
		(protocol === "http:" && !local) ||
		badPort
	) {
		problems.push(problem("STOREFRONT_URL", value, STOREFRONT_URL_RULE));
		return undefined;
	}
	const port =
		portNumber === undefined || portNumber === DEFAULT_PORTS[protocol]
			? ""
			: `:${portNumber}`;
	return { protocol, baseHost, port };
}

/** Optional until the platform checks it (TAT-38); refused when set but malformed. */
function readServerKey(
	value: string | undefined,
	problems: string[],
): string | undefined {
	if (!value) return undefined;
	if (!SERVER_KEY_SHAPE.test(value)) {
		problems.push(problem("STOREFRONT_SERVER_KEY", value, SERVER_KEY_RULE));
		return undefined;
	}
	return value;
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
