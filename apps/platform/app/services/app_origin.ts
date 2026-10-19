import { pointsAtThisMachine, studioHostname } from "#services/storefront_url";

/**
 * The dashboard's origin in production (TAT-9). The session cookie is
 * `__Host-` and Secure (#services/cookie_policy), so APP_URL must be https,
 * and it must not share a domain with the studio pages (STOREFRONT_URL): a
 * studio page on, under or above the dashboard's host could set and
 * receive its cookies and would be same-site with it. Two hosts under a
 * shared parent (app.example.com and *.sites.example.com) are not detected:
 * without the Public Suffix List that looks like two names under a public
 * suffix such as com.np. start/env.ts runs this once the environment is
 * read, so it imports nothing from the app but the pure storefront_url.
 */

const LAYOUT =
	"https://app.example.com with studio pages on https://{tenant}.example-studios.com";

/** A URL, or undefined when it doesn't parse. */
function parsed(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/** A hostname without its one trailing dot. */
function bare(hostname: string): string {
	return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** Whether `inner` is `outer` or one of its subdomains. */
function within(inner: string, outer: string): boolean {
	return inner === outer || inner.endsWith(`.${outer}`);
}

/**
 * The domain every studio page sits under: the labels two studios' hosts
 * share (`https://{tenant}.example.com` and `https://{tenant}-ink.example.com`
 * both give `example.com`).
 */
export function studioDomain(template: string): string {
	const one = bare(studioHostname(template, "studio-one")).split(".");
	const two = bare(studioHostname(template, "studio-two")).split(".");
	const shared: string[] = [];
	while (one.length > 0 && one.at(-1) === two.at(-1)) {
		shared.unshift(one.pop() as string);
		two.pop();
	}
	return shared.join(".");
}

/**
 * Throws, in production, when APP_URL is not https or shares a domain with
 * the studio pages. A loopback APP_URL (the local production trial behind
 * an HTTPS proxy) skips the domain comparison, never the https rule. A
 * missing STOREFRONT_URL is left to its own check, which refuses it in
 * production. The messages name hosts only.
 */
export function checkAppOrigin(
	appUrl: string,
	storefrontTemplate: string | undefined,
	production: boolean,
): void {
	if (!production) {
		return;
	}
	const origin = parsed(appUrl);
	if (!origin || origin.protocol !== "https:") {
		throw new Error(
			"APP_URL must be an https URL in production: the dashboard's session cookie is __Host- and Secure, which browsers drop over http, so nobody could sign in (e.g. https://app.example.com)",
		);
	}
	if (!storefrontTemplate || pointsAtThisMachine(appUrl)) {
		return;
	}
	const appHost = bare(origin.hostname);
	// No studio domain (a one-label studio host such as `https://{tenant}`)
	// means nothing to share with APP_URL: skipped on purpose, and for
	// checkStorefrontUrl to judge.
	const studios = studioDomain(storefrontTemplate);
	if (studios && (within(appHost, studios) || within(studios, appHost))) {
		throw new Error(
			`APP_URL (${appHost}) and the studio pages (STOREFRONT_URL, *.${studios}) must be on separate domains in production: with one inside the other, a studio page can set and receive the dashboard's cookies. Use e.g. ${LAYOUT}`,
		);
	}
}
