import { type StorefrontConfig, tenantOrigin } from "./config.ts";

/**
 * What the storefront answers itself, before any route runs (TAT-12): three
 * fixed pages and the old-slug redirect. Nothing from the request goes into
 * a page, so nothing needs escaping and nothing leaks.
 */

/** A minute at the CDN, revalidated by browsers: a new studio shows up fast. */
export const SHORT_PUBLIC_CACHE = "public, max-age=0, s-maxage=60";
export const NO_STORE = "no-store";
export const RETRY_AFTER_SECONDS = 30;

const PAGE_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"x-content-type-options": "nosniff",
	"content-security-policy":
		"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

type Page = { title: string; heading: string; text: string };

const LANDING: Page = {
	title: "Tattoo Drip",
	heading: "Tattoo Drip",
	text: "Studio pages for tattoo artists. Looking for a studio? Open the link it shared with you.",
};

const NOT_FOUND: Page = {
	title: "Studio not found",
	heading: "We couldn't find this studio",
	text: "Check the address, or ask the studio for its current link.",
};

const UNAVAILABLE: Page = {
	title: "Please try again",
	heading: "This page can't load right now",
	text: "Please try again in a minute.",
};

/** The base domain's and `www.`'s front page. */
export function landingResponse(): Response {
	return page(200, SHORT_PUBLIC_CACHE, LANDING);
}

/** Every "no studio here", whatever the reason, so the reason never shows. */
export function notFoundResponse(): Response {
	return page(404, SHORT_PUBLIC_CACHE, NOT_FOUND);
}

/** The API failed or timed out: temporary, so never stored. */
export function unavailableResponse(): Response {
	return page(503, NO_STORE, UNAVAILABLE, {
		"retry-after": String(RETRY_AFTER_SECONDS),
	});
}

/**
 * An old slug's redirect. 302, not 301/308: a studio can switch back to an
 * old slug, and a cached permanent redirect would then loop (TAT-24).
 */
export function redirectResponse(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location, "cache-control": NO_STORE },
	});
}

/**
 * Where an old slug's request goes: the same path and query under the
 * current slug's origin, which comes from STOREFRONT_URL, never from the
 * request. The path is appended as text, not resolved, so `//evil.test`
 * stays a path; the origin is checked again anyway.
 */
export function aliasLocation(
	config: StorefrontConfig,
	slug: string,
	requestUrl: string,
): string {
	const origin = tenantOrigin(config, slug);
	const { pathname, search } = new URL(requestUrl);
	const location = `${origin}${pathname}${search}`;
	if (new URL(location).origin !== origin) {
		throw new Error("An old-slug redirect must stay on the studio's origin");
	}
	return location;
}

function page(
	status: number,
	cacheControl: string,
	content: Page,
	headers: Record<string, string> = {},
): Response {
	return new Response(html(content), {
		status,
		headers: { ...PAGE_HEADERS, "cache-control": cacheControl, ...headers },
	});
}

function html({ title, heading, text }: Page): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; box-sizing: border-box; }
main { max-width: 32rem; text-align: center; }
h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
p { margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<main>
<h1>${heading}</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
}
