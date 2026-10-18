/**
 * Which studio a request's host names (TAT-12). Pure: no I/O and no
 * framework, so the tests and the request middleware share it.
 */

/**
 * The shape of every stored tenant slug: a DNS label of 3 to 63 lowercase
 * letters, digits and hyphens, with no hyphen at either end. A copy of the
 * platform's STORED_SLUG (apps/platform/app/modules/tenancy/slugs.ts) and of
 * the database CHECK `tenant_slugs_slug_format`, because the storefront may
 * not import platform code; test/tenancy/host.test.ts pins it. Only the
 * shape: whether a slug exists, is reserved or is an old one is the API's
 * answer, so the platform's reserved list is never copied here.
 */
export const STORED_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The one label the storefront keeps: `www.` shows the landing page. */
const LANDING_LABEL = "www";

/**
 * What a Host header may hold. Checked before lowercasing, so Unicode never
 * folds into ASCII (the Kelvin sign U+212A lowercases to "k").
 */
const HOST_CHARACTERS = /^[A-Za-z0-9.:[\]-]+$/;

/** A lowercase hostname and an optional port. Brackets (IPv6) never match. */
const HOST_AND_PORT = /^([a-z0-9.-]+)(?::\d{1,5})?$/;

/** One DNS label: 1 to 63 characters, no hyphen at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** No real Host is this long; a longer one is refused before any regex. */
const MAX_HOST_LENGTH = 260;

export type HostTarget =
	| { kind: "tenant"; slug: string }
	| { kind: "landing" }
	| { kind: "none" }
	| { kind: "foreign"; hostname: string };

/**
 * A lowercase DNS name: labels of 1 to 63 characters, at most 253 in all,
 * and not an IPv4 address (no top-level domain is all digits).
 */
export function isDnsName(name: string): boolean {
	const labels = name.split(".");
	return (
		name.length <= 253 &&
		labels.every((label) => LABEL.test(label)) &&
		!/^\d+$/.test(labels[labels.length - 1] ?? "")
	);
}

/**
 * What a Host header names under `baseHost` (lowercase, e.g. "tattoodrip.com"
 * or "localhost"): a studio's slug, the landing page (the base itself or
 * `www.`), nothing (a 404 without asking the API), or a name outside the base
 * (`foreign`: where custom domains, TAT-79, will be looked up; a 404 today).
 * The port is ignored: redirects take theirs from STOREFRONT_URL.
 */
export function tenantFromHost(
	host: string | null | undefined,
	baseHost: string,
): HostTarget {
	if (!host || host.length > MAX_HOST_LENGTH || !HOST_CHARACTERS.test(host)) {
		return { kind: "none" };
	}
	const match = HOST_AND_PORT.exec(host.toLowerCase());
	if (!match) return { kind: "none" };
	const name = match[1].endsWith(".") ? match[1].slice(0, -1) : match[1];
	if (!isDnsName(name)) return { kind: "none" };
	if (name === baseHost) return { kind: "landing" };
	if (!name.endsWith(`.${baseHost}`)) {
		return { kind: "foreign", hostname: name };
	}
	const label = name.slice(0, -(baseHost.length + 1));
	if (label === LANDING_LABEL) return { kind: "landing" };
	if (label.includes(".") || !STORED_SLUG.test(label)) return { kind: "none" };
	return { kind: "tenant", slug: label };
}
