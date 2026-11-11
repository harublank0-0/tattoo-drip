import type { Studio } from "@tattoo-drip/sdk";
import { THEME_KEYS, type ThemeKey } from "./config.ts";

/**
 * A theme preview (Page look's "Preview" links): `?preview=<theme key>` on
 * any studio page shows that page in that theme, for this visit only. It
 * changes how the page looks, never what it holds: the studio's own data,
 * links and booking are the same, and the theme is one of this app's fixed
 * keys. The tenant middleware reads it from the first request
 * (src/tenancy/middleware.ts) and marks the answer `no-store` and `noindex`
 * (previewHeaders), the site context carries it to the browser
 * (src/site/context.ts), so in-tab navigation keeps it, and every loader gets
 * the studio through withPreviewTheme, so the server and the browser draw the
 * same theme. A full load without the parameter ends it. Pure.
 */

/** The query parameter Page look's links set. */
export const PREVIEW_PARAM = "preview";

/** The theme names the banner says (the same words as Page look's list). */
export const THEME_NAMES: Record<ThemeKey, string> = {
	"stencil-and-ink": "Stencil & Ink",
	"ink-noir": "Ink Noir",
	irezumi: "Irezumi",
};

/** A theme key exactly as this app has it, else null: nothing else is a preview. */
export function readPreviewTheme(value: unknown): ThemeKey | null {
	return typeof value === "string" &&
		(THEME_KEYS as readonly string[]).includes(value)
		? (value as ThemeKey)
		: null;
}

/** The preview theme a request's address asks for, else null. */
export function previewThemeOf(url: string): ThemeKey | null {
	try {
		return readPreviewTheme(new URL(url).searchParams.get(PREVIEW_PARAM));
	} catch {
		return null;
	}
}

/**
 * The studio with its theme replaced by `preview` (a copy: the cached studio
 * is never changed), or the very studio without a preview. The rest of its
 * look (colours, font, sections) stays the saved one.
 */
export function withPreviewTheme(
	studio: Studio,
	preview: ThemeKey | null,
): Studio {
	if (preview === null) return studio;
	const raw: unknown = Object.hasOwn(studio, "storefront")
		? studio.storefront
		: undefined;
	const storefront =
		typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
	return {
		...studio,
		storefront: { ...storefront, theme: preview },
	} as Studio;
}

/** One of the page's own paths: "/…", never "//…" or "/\\…". */
const OWN_PATH = /^\/(?![/\\])/;

/**
 * "Exit preview": the page's own path and query without the preview (so
 * `/book?artist=aiko&preview=ink-noir` leads to `/book?artist=aiko`), and no
 * fragment; "/" for anything that is not one of the page's own paths.
 */
export function previewExitHref(pathAndSearch: string): string {
	if (!OWN_PATH.test(pathAndSearch)) return "/";
	const url = new URL(pathAndSearch, "http://page.invalid");
	url.searchParams.delete(PREVIEW_PARAM);
	const href = `${url.pathname}${url.search}`;
	return OWN_PATH.test(href) ? href : "/";
}

/**
 * A link's address with the preview added, for a link the browser itself
 * follows (a full load, or a new tab), so the preview goes on; null to leave
 * the link as it is: no address, a fragment on this page (`#main`), another
 * origin, or one that already names a preview. `pageHref` is the page's own
 * address, which the link's is read against.
 */
export function withPreviewParam(
	rawHref: string | null,
	pageHref: string,
	theme: ThemeKey,
): string | null {
	if (rawHref === null || rawHref === "" || rawHref.startsWith("#")) {
		return null;
	}
	let page: URL;
	let url: URL;
	try {
		page = new URL(pageHref);
		url = new URL(rawHref, page);
	} catch {
		return null;
	}
	if (url.origin !== page.origin) return null;
	if (url.searchParams.has(PREVIEW_PARAM)) return null;
	url.searchParams.set(PREVIEW_PARAM, theme);
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * A preview's answer is for the person previewing: never kept by a shared
 * cache (it would show the preview to the next visitor of that address) and
 * never indexed.
 */
export const PREVIEW_HEADERS = {
	"Cache-Control": "private, no-store",
	"X-Robots-Tag": "noindex, nofollow",
} as const;

/** `response` with PREVIEW_HEADERS set over its own. */
export function previewHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
