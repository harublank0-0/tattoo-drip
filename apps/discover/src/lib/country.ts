/**
 * Country-aware discovery (D06.5, docs/discover/frontend.md, "Country").
 * Pure: no request, cookie jar or module state. The server resolves a
 * visitor's country per request from these functions; the browser keeps
 * the result in its router context.
 *
 * The country is a relevance filter only: it never restricts a public
 * profile, and it has nothing to do with tenants, currency, sign-in or
 * where anyone lives.
 */

/**
 * The 249 officially assigned ISO 3166-1 alpha-2 codes. Intl.DisplayNames
 * also names user-assigned and reserved codes (`XK`, `EU`, `UK`, `ZZ`…),
 * and Cloudflare sends `XX` (unknown) and `T1` (Tor), so the list is
 * spelled out rather than taken from Intl.
 */
const ISO_3166_ALPHA_2 = new Set(
	(
		"AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
		"CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
		"GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
		"KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
		"MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
		"SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
		"UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
	).split(" "),
);

/**
 * An ISO 3166-1 alpha-2 code, trimmed and upper-cased (` np ` → `NP`), when
 * it is an assigned code; else undefined.
 */
export function normalizeCountry(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const code = value.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(code) && ISO_3166_ALPHA_2.has(code)
		? code
		: undefined;
}

/**
 * A country's English name (`NP` → "Nepal"), or the code itself. A fixed
 * locale, so the server's render and the browser's hydration agree.
 */
export function countryName(code: string): string {
	try {
		return (
			new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(
				code.toUpperCase(),
			) ?? code
		);
	} catch {
		return code;
	}
}

/** Where a page's country came from, strongest first. */
export type CountrySource = "url" | "cookie" | "geo" | "fallback";

export type ResolvedCountry = { country: string; source: CountrySource };

/** A visitor's preference, without the page's address: never `url`. */
export type CountryPreference = {
	country: string;
	source: Exclude<CountrySource, "url">;
};

export type PreferenceInput = {
	/** The `td_country` cookie's value, if the request had one. */
	cookie?: string | null;
	/**
	 * The trusted proxy's country header, or undefined when geolocation is
	 * off (no DISCOVER_GEO_HEADER): the caller never passes a header the
	 * visitor could have set themselves.
	 */
	trustedHeader?: string | null;
	/** The configured markets: only these are taken from a cookie or the header. */
	markets: readonly string[];
	/** The default country (one of the markets). */
	fallback: string;
};

/**
 * A visitor's preference: the saved cookie if it names a market, else the
 * trusted proxy's country if it is a market, else the default.
 */
export function preferredCountry(input: PreferenceInput): CountryPreference {
	const isMarket = (code: string | undefined): code is string =>
		code !== undefined && input.markets.includes(code);
	const cookie = normalizeCountry(input.cookie);
	if (isMarket(cookie)) return { country: cookie, source: "cookie" };
	const geo = normalizeCountry(input.trustedHeader);
	if (isMarket(geo)) return { country: geo, source: "geo" };
	return { country: input.fallback, source: "fallback" };
}

/**
 * A page's country: an explicit `?country=` (any assigned code: browsing a
 * country that isn't a market yet is allowed, and shows the honest empty
 * state), else the visitor's preference.
 */
export function resolveCountry(
	input: PreferenceInput & { url?: unknown },
): ResolvedCountry {
	const explicit = normalizeCountry(input.url);
	return explicit
		? { country: explicit, source: "url" }
		: preferredCountry(input);
}

/** A page's country from its address's `country`, else the visitor's preference. */
export function pageCountry(
	url: unknown,
	preference: CountryPreference,
): ResolvedCountry {
	const explicit = normalizeCountry(url);
	return explicit ? { country: explicit, source: "url" } : preference;
}

/** What a selector offers: the markets, and the current country when it isn't one. */
export function countryOptions(
	markets: readonly string[],
	current: string,
): string[] {
	return markets.includes(current) ? [...markets] : [...markets, current];
}

/* The preference cookie ------------------------------------------------- */

export const COUNTRY_COOKIE = "td_country";
/** About a year. */
export const COUNTRY_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The preference cookie: host-only (no Domain, so it never reaches Studio
 * OS or a studio's site), the whole site, Lax, HttpOnly (only the server
 * reads it; the page knows the country from its router context), Secure
 * on an https site, about a year. Only a market code is ever stored.
 */
export function countryCookie(
	country: string,
	options: { secure: boolean },
): string {
	return [
		`${COUNTRY_COOKIE}=${country}`,
		"Path=/",
		`Max-Age=${COUNTRY_COOKIE_MAX_AGE}`,
		"SameSite=Lax",
		"HttpOnly",
		...(options.secure ? ["Secure"] : []),
	].join("; ");
}

/** One cookie's value from a Cookie header, or undefined. */
export function readCookie(
	header: string | null | undefined,
	name: string,
): string | undefined {
	if (!header) return undefined;
	for (const pair of header.split(";")) {
		const index = pair.indexOf("=");
		if (index < 0) continue;
		if (pair.slice(0, index).trim() === name)
			return pair.slice(index + 1).trim();
	}
	return undefined;
}

/**
 * This request's preference, from its cookie and, only when a header is
 * configured, the header the trusted proxy sets (nginx overwrites it on
 * every request: deploy/nginx/hosts.split.conf). With no header configured
 * nothing a visitor sends, CF-IPCountry included, is read.
 */
export function requestPreference(
	headers: Headers,
	settings: {
		markets: readonly string[];
		defaultCountry: string;
		geoHeader: string | null;
	},
): CountryPreference {
	return preferredCountry({
		cookie: readCookie(headers.get("cookie"), COUNTRY_COOKIE),
		trustedHeader: settings.geoHeader
			? headers.get(settings.geoHeader)
			: undefined,
		markets: settings.markets,
		fallback: settings.defaultCountry,
	});
}

/* Switching --------------------------------------------------------------- */

const RETURN_BASE = "http://discover.invalid";
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
const CONTROL = /[\u0000-\u001f\u007f\\]/;

/**
 * A same-origin path to send the visitor back to after a switch, from a
 * form's `return`: a relative path starting with one `/` (never `//host`,
 * a backslash, a scheme or a control character), at most 2000 characters;
 * anything else is `/`. Prevents an open redirect.
 */
export function safeReturnPath(value: unknown): string {
	if (typeof value !== "string" || value.length > 2000) return "/";
	if (!value.startsWith("/") || value.startsWith("//") || CONTROL.test(value))
		return "/";
	try {
		const url = new URL(value, RETURN_BASE);
		if (url.origin !== RETURN_BASE) return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}

/**
 * The address to show after switching to `country`: a page whose address
 * names a country gets the new one; a city (which belongs to a country) is
 * dropped; everything else (`q`, `style`, the path) stays. A page without
 * a country in its address is unchanged: it follows the preference.
 */
export function switchCountryPath(path: string, country: string): string {
	const url = new URL(safeReturnPath(path), RETURN_BASE);
	url.searchParams.delete("city");
	if (url.searchParams.has("country")) url.searchParams.set("country", country);
	return `${url.pathname}${url.search}${url.hash}`;
}
