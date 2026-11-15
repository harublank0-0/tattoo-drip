import type { PublicSettings } from "./config.ts";

/**
 * Discover's head tags, robots and canonical policy (D05, D10;
 * docs/discover/frontend.md, "SEO and indexing"). Everything here is pure:
 * the root route renders the shared tags on the server for every page, a
 * page adds its own title, description and picture (`pageMeta`), and the
 * robots decision is made once, from every match (`pageState`).
 */

export const SITE_NAME = "Tattoo Drip";
export const DEFAULT_TITLE =
	"Tattoo Drip: find tattoo studios, artists and work";
export const DEFAULT_DESCRIPTION =
	"Discover tattoo studios and independent artists, browse their published work and book with them directly.";

/** Robots meta and X-Robots-Tag while Discover must stay out of search results (DISCOVER_INDEXING off). */
export const NOINDEX = "noindex, nofollow";
/**
 * Robots meta and X-Robots-Tag of a page that may not be indexed while
 * indexing is on (D10): a filtered, searched, sorted or paged URL, a
 * `?country=` variant, an empty hub, a placeholder, a 404 or an error. Its
 * links still lead to indexable pages (profiles, artwork, hubs), so
 * crawlers may follow them (blueprint H: "noindex, follow").
 */
export const NOINDEX_FOLLOW = "noindex, follow";

/**
 * The social card when a page has no picture of its own: Studio OS's
 * interim mark (TAT-67, the favicon's PNG; apps/platform/public/icons),
 * copied into public/brand. Square, so the card stays `summary`.
 */
export const BRAND_IMAGE = {
	path: "/brand/tattoo-drip-512.png",
	width: 512,
	height: 512,
	alt: "Tattoo Drip",
} as const;

/**
 * Every HTML page's caching (D06.5): its content depends on the visitor's
 * country (cookie, geolocation), so only the visitor's own browser may keep
 * it, and not even that (takedowns must show at once). `Vary: Cookie` is a
 * second line for a cache that ignores `private`; nothing relies on it.
 * Static assets, robots.txt and the sitemaps keep their own headers.
 */
export const HTML_CACHE_HEADERS = {
	"Cache-Control": "private, no-store",
	Vary: "Cookie",
} as const;

export type PageSeo = {
	/** The page's own title; the site name is appended. Omit for the default. */
	title?: string;
	description?: string;
	/** The social card's picture: an absolute URL from the API, its size and what it shows. */
	image?: { url: string; width: number; height: number; alt: string };
};

type Meta = Record<string, string>;
type Link = Record<string, string>;

export function pageTitle(title?: string): string {
	return title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;
}

/** The longest page title (before " | Tattoo Drip") `fitTitle` aims for. */
export const TITLE_BUDGET = 60;

/**
 * A title from its parts, most important first: the parts that fit the
 * budget, dropping the least important whole parts from the end; never a
 * part cut mid-word, and never fewer than the first (a name is never cut).
 * `fitTitle(["Black Needle", " — Tattoo studio in Kathmandu", ", Nepal"])`.
 */
export function fitTitle(parts: readonly string[], max = TITLE_BUDGET): string {
	let title = parts[0] ?? "";
	for (const part of parts.slice(1)) {
		if ((title + part).length > max) break;
		title += part;
	}
	return title;
}

/**
 * The canonical URL of `pathname` on Discover's own origin (DISCOVER_URL,
 * never the request's host): the path alone, no query, no trailing slash
 * but the root's. Paths come from the route's match, already encoded.
 */
export function canonicalUrl(
	settings: Pick<PublicSettings, "siteUrl">,
	pathname: string,
): string {
	const path = (pathname || "/").replace(/(.)\/+$/, "$1");
	const url = new URL(path, settings.siteUrl);
	url.search = "";
	url.hash = "";
	return url.toString();
}

/** An absolute URL on Discover's origin for one of its own paths (sitemaps, JSON-LD). */
export function siteUrl(
	settings: Pick<PublicSettings, "siteUrl">,
	path: string,
): string {
	return canonicalUrl(settings, path);
}

/**
 * The pages search engines may index once DISCOVER_INDEXING is on: an
 * allow-list, so a new page stays noindex until it is finished and added
 * here (and so to the static sitemap). D06 added `/for-studios`; `/pricing`
 * waits for published prices. D07 added the directories' bare first pages,
 * D09 the gallery's (any parameter makes a page noindex, `pageState`).
 */
export const INDEXABLE_PATHS: readonly string[] = [
	"/",
	"/for-studios",
	"/explore/studios",
	"/explore/artists",
	"/tattoos",
];

/**
 * Dynamic pages that may be indexed: (D07) a style's page and a market's or
 * city's location page, (D08) studio, studio-artist and independent-artist
 * profiles, and (D09) artwork pages, by shape and only at their canonical
 * spelling (lower case; anything else is a 301 or a 404). The page itself
 * 404s an unknown slug and opts out (`noindex` in its loader data) when it
 * has nothing listed. The sitemaps (src/lib/sitemap.ts) list them from the API.
 */
// The API's slugs: letters and digits, hyphens inside (artists' and legacy
// studios' may hold "--"), never at either end.
const SLUG = "[a-z0-9]+(?:-+[a-z0-9]+)*";
export const INDEXABLE_PATTERNS: readonly RegExp[] = [
	new RegExp(`^/styles/${SLUG}$`),
	new RegExp(`^/locations/${SLUG}(?:/${SLUG})?$`),
	new RegExp(`^/studios/${SLUG}(?:/artists/${SLUG})?$`),
	new RegExp(`^/artists/${SLUG}$`),
	/^\/tattoos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	// Reviews and Fresh ink (slice 4): the bare feed, indexable only when it has
	// posts (its loader says `noindex` when empty). A pattern, not an
	// INDEXABLE_PATHS entry: the static sitemap lists it only while the
	// default country's feed has a post (src/lib/sitemap.ts).
	/^\/fresh-ink$/,
];

/** Whether a page may be indexed: indexing on, the path listed or matched, and the page not opted out. */
export function indexable(
	settings: Pick<PublicSettings, "indexing">,
	pathname: string,
	page: { noindex?: boolean } = {},
): boolean {
	return (
		settings.indexing &&
		(INDEXABLE_PATHS.includes(pathname) ||
			INDEXABLE_PATTERNS.some((pattern) => pattern.test(pathname))) &&
		!page.noindex
	);
}

/**
 * The page's robots value (meta and X-Robots-Tag), or null for an indexable
 * page (no tag: indexing and following are the default). Indexing off:
 * `noindex, nofollow` everywhere (robots.txt disallows everything too).
 * Indexing on: `noindex, follow` for every page that may not be indexed.
 */
export function robotsValue(
	settings: Pick<PublicSettings, "indexing">,
	pathname: string,
	page: { noindex?: boolean } = {},
): string | null {
	if (!settings.indexing) return NOINDEX;
	return indexable(settings, pathname, page) ? null : NOINDEX_FOLLOW;
}

/** What a route match holds that the head reads (the router's RouteMatch, structurally). */
export type HeadMatch = {
	routeId: string;
	status: string;
	pathname: string;
	search: unknown;
	loaderData?: unknown;
	staticData?: { noindex?: boolean };
};

/** Whether a search object has any value: the address has a query (filters, cursor, `?country=`, anything). */
export function hasQuery(search: unknown): boolean {
	return (
		typeof search === "object" &&
		search !== null &&
		Object.values(search).some((value) => value !== undefined)
	);
}

/**
 * The page a list of matches renders, for its head and headers: its path
 * (an index route's trailing `/` dropped), whether it is the 404 page or an
 * error page, and whether it opts out of indexing. A page opts out when:
 * it is a 404 or an error; its address has any query (every canonical is
 * the bare path, so a query is always a variant: filters, searches, sorts,
 * cursors, `?country=`, tracking parameters); a route says so statically
 * (`staticData.noindex`, `/pricing`); or a loader says so (`noindex` in
 * its data: an empty style, market or city page).
 */
export function pageState(
	matches: readonly HeadMatch[],
	rootId = "__root__",
): { pathname: string; notFound: boolean; error: boolean; noindex: boolean } {
	const page = matches[matches.length - 1];
	const notFound =
		!matches.some((each) => each.routeId !== rootId) ||
		matches.some((each) => each.status === "notFound");
	const error = matches.some((each) => each.status === "error");
	const optedOut = matches.some(
		(each) =>
			each.staticData?.noindex === true ||
			(each.loaderData as { noindex?: unknown } | undefined)?.noindex === true,
	);
	return {
		pathname: (page?.pathname ?? "/").replace(/(.)\/$/, "$1"),
		notFound,
		error,
		noindex:
			notFound || error || optedOut || hasQuery(page?.search ?? undefined),
	};
}

/**
 * The shared head tags of every page: title, description, canonical, Open
 * Graph (site name, type, title, description, url, the brand picture),
 * Twitter's card and robots. Rendered on the server (HeadContent), so
 * crawlers see them without running JavaScript; a page's own `pageMeta`
 * replaces title, description and picture (the deepest match wins per
 * name or property).
 */
export function headTags(
	settings: Pick<PublicSettings, "siteUrl" | "indexing">,
	pathname: string,
	page: PageSeo & {
		noindex?: boolean;
		/** False on a 404 or an error page: it has no canonical address (nor og:url). */
		canonical?: boolean;
	} = {},
): { meta: Meta[]; links: Link[] } {
	const title = pageTitle(page.title);
	const description = page.description ?? DEFAULT_DESCRIPTION;
	const url = canonicalUrl(settings, pathname);
	const canonical = page.canonical !== false;
	const meta: Meta[] = [
		{ title },
		{ name: "description", content: description },
		{ property: "og:site_name", content: SITE_NAME },
		{ property: "og:type", content: "website" },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		...(canonical ? [{ property: "og:url", content: url }] : []),
		...imageMeta(
			page.image ?? {
				url: siteUrl(settings, BRAND_IMAGE.path),
				width: BRAND_IMAGE.width,
				height: BRAND_IMAGE.height,
				alt: BRAND_IMAGE.alt,
			},
			!page.image,
		),
	];
	const robots = robotsValue(settings, pathname, page);
	if (robots) meta.push({ name: "robots", content: robots });
	return {
		meta,
		links: canonical ? [{ rel: "canonical", href: url }] : [],
	};
}

function imageMeta(
	image: NonNullable<PageSeo["image"]>,
	brand: boolean,
): Meta[] {
	return [
		{ property: "og:image", content: image.url },
		{ property: "og:image:width", content: String(image.width) },
		{ property: "og:image:height", content: String(image.height) },
		{ property: "og:image:alt", content: image.alt },
		// The brand mark is square: a small card. A page's own photo: a large one.
		{
			name: "twitter:card",
			content: brand ? "summary" : "summary_large_image",
		},
	];
}

/**
 * A page's own head tags, on top of the root's (HeadContent keeps the
 * deepest match's tag for each title, name and property): its title,
 * description and social picture. Robots are never a page's own tag: a
 * page opts out with `noindex` in its loader data (or `staticData`), and
 * the root decides (`pageState`, `robotsValue`).
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
	if (page.image) meta.push(...imageMeta(page.image, false));
	return meta;
}

/**
 * robots.txt. Indexing off: everything disallowed. On: everything allowed
 * and the sitemap index named. Nothing is disallowed while on: a page that
 * mustn't be indexed (filters, `?country=`, empty hubs) says noindex, and a
 * crawler can only see that on a page it may fetch; a disallowed URL can
 * still be indexed from links, without its content. robots.txt is never a
 * security measure: everything here is public.
 */
export function robotsTxt(
	settings: Pick<PublicSettings, "siteUrl" | "indexing">,
): string {
	if (!settings.indexing) return "User-agent: *\nDisallow: /\n";
	return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl(settings, "/sitemap.xml")}\n`;
}
