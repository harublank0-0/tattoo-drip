import type { PublicSettings } from "./config.ts";

export const SITE_NAME = "Tattoo Drip";
export const DEFAULT_TITLE =
	"Tattoo Drip: find tattoo studios, artists and work";
export const DEFAULT_DESCRIPTION =
	"Discover tattoo studios and independent artists, browse their published work and book with them directly.";

/** Header value and robots meta while Discover must stay out of search results. */
export const NOINDEX = "noindex, nofollow";

/**
 * Every HTML page's caching (D06.5): its content depends on the visitor's
 * country (cookie, geolocation), so only the visitor's own browser may keep
 * it, and not even that (takedowns must show at once). `Vary: Cookie` is a
 * second line for a cache that ignores `private`; nothing relies on it.
 * Static assets, robots.txt and the sitemap keep their own headers.
 */
export const HTML_CACHE_HEADERS = {
	"Cache-Control": "private, no-store",
	Vary: "Cookie",
} as const;

export type PageSeo = {
	/** The page's own title; the site name is appended. Omit for the default. */
	title?: string;
	description?: string;
	/** A page that must never be indexed, whatever DISCOVER_INDEXING says (errors, placeholders). */
	noindex?: boolean;
	/** The social card's picture (D08 profiles): an absolute URL from the API, and what it shows. */
	image?: string;
	imageAlt?: string;
};

type Meta = Record<string, string>;
type Link = Record<string, string>;

export function pageTitle(title?: string): string {
	return title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;
}

/** The canonical URL of `pathname` on Discover's own origin (never the request's host). */
export function canonicalUrl(
	settings: Pick<PublicSettings, "siteUrl">,
	pathname: string,
): string {
	return new URL(pathname || "/", settings.siteUrl).toString();
}

/**
 * The pages search engines may index once DISCOVER_INDEXING is on: an
 * allow-list, so a new page stays noindex until it is finished and added
 * here (and so to the sitemap). D06 added `/for-studios`; `/pricing` waits
 * for published prices. D07 added the directories' bare first pages (any
 * parameter makes a directory page noindex: filters, searches, sorts,
 * cursors and `?country=` are never indexed, blueprint H).
 */
export const INDEXABLE_PATHS: readonly string[] = [
	"/",
	"/for-studios",
	"/explore/studios",
	"/explore/artists",
];

/**
 * Dynamic pages that may be indexed (D07): a style's page and a market's or
 * city's location page, the canonical discovery destinations (blueprint H),
 * and (D08) studio, studio-artist and independent-artist profiles.
 * A slug can't be listed in INDEXABLE_PATHS, so they match by shape; the
 * page itself 404s (noindex) an unknown slug and opts out (`noindex`) when
 * it has nothing listed. They are not in the sitemap: listing them needs
 * the API's styles and places at request time (D10's sitemaps).
 */
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const INDEXABLE_PATTERNS: readonly RegExp[] = [
	new RegExp(`^/styles/${SLUG}$`),
	new RegExp(`^/locations/${SLUG}(?:/${SLUG})?$`),
	// D08: public profiles. The API 404s anything not shown (so does the
	// page, noindex) and an old studio slug is a 301, so only a listed
	// profile at its current address answers here. Sitemaps of them are D10.
	new RegExp(`^/studios/${SLUG}(?:/artists/${SLUG})?$`),
	new RegExp(`^/artists/${SLUG}$`),
];

/** Whether a page may be indexed: indexing on, the path listed or matched, and the page not opted out. */
export function indexable(
	settings: Pick<PublicSettings, "indexing">,
	pathname: string,
	page: PageSeo = {},
): boolean {
	return (
		settings.indexing &&
		(INDEXABLE_PATHS.includes(pathname) ||
			INDEXABLE_PATTERNS.some((pattern) => pattern.test(pathname))) &&
		!page.noindex
	);
}

/**
 * The head tags of a page: title, description, canonical, Open Graph and
 * the robots meta. Rendered on the server (HeadContent), so crawlers see
 * them without running JavaScript.
 */
export function headTags(
	settings: Pick<PublicSettings, "siteUrl" | "indexing">,
	pathname: string,
	page: PageSeo = {},
): { meta: Meta[]; links: Link[] } {
	const title = pageTitle(page.title);
	const description = page.description ?? DEFAULT_DESCRIPTION;
	const url = canonicalUrl(settings, pathname);
	const meta: Meta[] = [
		{ title },
		{ name: "description", content: description },
		{ property: "og:site_name", content: SITE_NAME },
		{ property: "og:type", content: "website" },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ name: "twitter:card", content: "summary" },
	];
	if (!indexable(settings, pathname, page))
		meta.push({ name: "robots", content: NOINDEX });
	return { meta, links: [{ rel: "canonical", href: url }] };
}

/** robots.txt: everything disallowed unless indexing is on, then the sitemap. */
export function robotsTxt(
	settings: Pick<PublicSettings, "siteUrl" | "indexing">,
): string {
	if (!settings.indexing) return "User-agent: *\nDisallow: /\n";
	return `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", settings.siteUrl)}\n`;
}

/**
 * The sitemap's entries (D10 extends it): only finished, indexable pages,
 * the static ones (D10 adds styles and places from the API). Empty while
 * indexing is off, and the route answers 404 then.
 */
export function sitemapEntries(
	settings: Pick<PublicSettings, "siteUrl" | "indexing">,
): string[] {
	if (!settings.indexing) return [];
	return INDEXABLE_PATHS.map((path) => canonicalUrl(settings, path));
}

export function sitemapXml(urls: string[]): string {
	const xmlText = (value: string) =>
		value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
		.map((url) => `  <url><loc>${xmlText(url)}</loc></url>`)
		.join("\n")}\n</urlset>\n`;
}

/**
 * A page's own head tags, on top of the root's (HeadContent keeps the
 * deepest match's tag for each title, name and property): its title and
 * description for search and social cards, and noindex when the page must
 * never be indexed.
 */
export function pageMeta(page: PageSeo): Meta[] {
	const meta: Meta[] = [];
	if (page.title) {
		const title = pageTitle(page.title);
		meta.push({ title }, { property: "og:title", content: title });
	}
	if (page.description) {
		meta.push(
			{ name: "description", content: page.description },
			{ property: "og:description", content: page.description },
		);
	}
	if (page.image) {
		meta.push(
			{ property: "og:image", content: page.image },
			{ name: "twitter:card", content: "summary_large_image" },
		);
		if (page.imageAlt)
			meta.push({ property: "og:image:alt", content: page.imageAlt });
	}
	if (page.noindex) meta.push({ name: "robots", content: NOINDEX });
	return meta;
}
