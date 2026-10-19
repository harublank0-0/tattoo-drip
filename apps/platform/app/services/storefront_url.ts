/**
 * The storefront's address for deposit links (TAT-65): the studio pages'
 * origin with `{tenant}` for the slug, from STOREFRONT_URL. This file
 * imports nothing from the app, because start/env.ts runs it while the
 * environment is still being read.
 */

const EXAMPLE = "https://{tenant}.example.com";

/** A studio's slug for checking a template's shape. */
function originOf(template: string, slug: string): URL {
	return new URL(template.replaceAll("{tenant}", slug));
}

/**
 * Checks STOREFRONT_URL as start/env.ts reads it and returns it. Set, it
 * must contain `{tenant}`, be an http(s) URL and carry the slug in its host
 * (deposit links use only the origin, so a slug elsewhere would send every
 * studio to one address). Unset or empty it is fine in development and
 * tests, where deposit links use the dev host, and an error in production,
 * where a link to localhost reaches nobody. Throws an Error whose message
 * the environment loader prints.
 */
export function checkStorefrontUrl(
	key: string,
	value: string | undefined,
	production: boolean,
): string | undefined {
	if (!value) {
		if (production) {
			throw new Error(
				`${key} is required in production: the studio pages' origin with {tenant} for the slug, e.g. ${EXAMPLE}`,
			);
		}
		return undefined;
	}
	if (!value.includes("{tenant}")) {
		throw new Error(`${key} must contain {tenant}, e.g. ${EXAMPLE}`);
	}
	let first: URL;
	let second: URL;
	try {
		first = originOf(value, "studio-one");
		second = originOf(value, "studio-two");
	} catch {
		throw new Error(`${key} must be an http(s) URL, e.g. ${EXAMPLE}`);
	}
	if (first.protocol !== "http:" && first.protocol !== "https:") {
		throw new Error(`${key} must be an http(s) URL, e.g. ${EXAMPLE}`);
	}
	if (first.origin === second.origin) {
		throw new Error(
			`${key} must have {tenant} in its host (links use only the origin), e.g. ${EXAMPLE}`,
		);
	}
	return value;
}

/**
 * The host of `slug`'s studio page under `template` (STOREFRONT_URL), lower
 * case, without port: where its intake form's bot-challenge token must have
 * been made (TAT-55).
 */
export function studioHostname(template: string, slug: string): string {
	return originOf(template, slug).hostname;
}

/**
 * Whether links built from `template` open on the machine that made them
 * (a loopback host such as the dev default): a client who gets one can't
 * open it.
 */
export function pointsAtThisMachine(template: string): boolean {
	const { hostname } = originOf(template, "studio");
	return (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname === "0.0.0.0" ||
		hostname === "[::1]" ||
		/^127(\.\d{1,3}){3}$/.test(hostname)
	);
}
