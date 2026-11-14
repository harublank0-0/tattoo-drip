import type { DiscoverClient } from "@tattoo-drip/sdk";
import type { PublicSettings } from "./config.ts";
import { paths } from "./routes.ts";
import { INDEXABLE_PATHS, siteUrl } from "./seo.ts";

/**
 * Discover's sitemaps (D10; docs/discover/frontend.md, "Sitemaps"). Only
 * while DISCOVER_INDEXING is on (the routes answer 404 otherwise).
 *
 * `/sitemap.xml` is an index of child sitemaps under `/sitemaps/`:
 * `static.xml` (INDEXABLE_PATHS, and the Fresh ink feed while it has a
 * post), `styles.xml`, `locations.xml`, and the
 * paged `studios.xml`, `artists.xml` and `tattoos.xml`. A paged child is one
 * page of the API's sitemap list (`/discover/sitemap/*`: identifiers only,
 * keyset-paged by id, `SITEMAP_PAGE` a page, far under the protocol's
 * 50,000 URLs and 50 MB); its first page is `/sitemaps/<kind>.xml`, the
 * next ones `?after=<the previous page's nextCursor>`. The index walks each
 * list once to name its pages. Ids only grow (uuidv7), so new rows land on
 * the last page and the earlier pages' addresses stay stable.
 *
 * Everything comes from the public API, the same projection the pages
 * read: a row the API doesn't show (unlisted, hidden, taken down) is in no
 * sitemap. No `lastmod`: the API exposes no modification time, and a
 * listing or creation time isn't one.
 */

/** URLs per paged child sitemap: one API page (the API's maximum). */
export const SITEMAP_PAGE = 5000;
/** The most pages the index walks per list (a guard against a cursor that never ends: 5 million URLs); past it the index is a 503. */
export const MAX_SITEMAP_PAGES = 1000;
/** Reads in flight at once while checking styles and markets. */
export const SITEMAP_CONCURRENCY = 4;

export const PAGED_SITEMAPS = ["studios", "artists", "tattoos"] as const;
export const SITEMAP_KINDS = [
	"static",
	"styles",
	"locations",
	...PAGED_SITEMAPS,
] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];
type PagedKind = (typeof PAGED_SITEMAPS)[number];

type Settings = Pick<
	PublicSettings,
	"siteUrl" | "indexing" | "markets" | "defaultCountry"
>;

/** A cursor as the API sends it: a row id (any case). Anything else is no page. */
const CURSOR =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Text for XML: the five predefined entities escaped. */
export function xmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** A `<urlset>` of page URLs (no lastmod, see above). */
export function urlsetXml(urls: readonly string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
		.map((url) => `  <url><loc>${xmlText(url)}</loc></url>\n`)
		.join("")}</urlset>\n`;
}

/** A `<sitemapindex>` of child sitemap URLs. */
export function sitemapIndexXml(urls: readonly string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
		.map((url) => `  <sitemap><loc>${xmlText(url)}</loc></sitemap>\n`)
		.join("")}</sitemapindex>\n`;
}

/** A child sitemap's absolute URL: `/sitemaps/<kind>.xml`, `?after=` for a later page. */
export function sitemapUrl(
	settings: Pick<PublicSettings, "siteUrl">,
	kind: SitemapKind,
	after?: string,
): string {
	const url = siteUrl(settings, `/sitemaps/${kind}.xml`);
	return after ? `${url}?after=${encodeURIComponent(after)}` : url;
}

/** Runs `task` over `items`, at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

function list(client: DiscoverClient, kind: PagedKind, after?: string) {
	const query = { limit: SITEMAP_PAGE, ...(after ? { cursor: after } : {}) };
	return kind === "studios"
		? client.sitemap.studios(query)
		: kind === "artists"
			? client.sitemap.artists(query)
			: client.sitemap.tattoos(query);
}

/**
 * The index: the three small children, then every page of the three
 * lists, found by walking each list's cursors (the lists in parallel, each
 * one page after another).
 */
export async function sitemapIndexUrls(
	client: DiscoverClient,
	settings: Settings,
): Promise<string[]> {
	const pages = await Promise.all(
		PAGED_SITEMAPS.map(async (kind) => {
			const urls = [sitemapUrl(settings, kind)];
			let cursor = (await list(client, kind)).nextCursor;
			while (cursor && urls.length < MAX_SITEMAP_PAGES) {
				urls.push(sitemapUrl(settings, kind, cursor));
				cursor = (await list(client, kind, cursor)).nextCursor;
			}
			// Never a partial index: a list longer than the guard is an error (503).
			if (cursor) {
				throw new Error(
					`The ${kind} sitemap has more than ${MAX_SITEMAP_PAGES} pages.`,
				);
			}
			return urls;
		}),
	);
	return [
		sitemapUrl(settings, "static"),
		sitemapUrl(settings, "styles"),
		sitemapUrl(settings, "locations"),
		...pages.flat(),
	];
}

/**
 * One child sitemap's page URLs, or null when there is no such sitemap (an
 * unknown kind, or `after` on a child that isn't paged or isn't a cursor):
 * the route's 404.
 */
export async function sitemapUrls(
	client: DiscoverClient,
	settings: Settings,
	kind: string,
	after: string | null,
): Promise<string[] | null> {
	if (!(SITEMAP_KINDS as readonly string[]).includes(kind)) return null;
	const paged = (PAGED_SITEMAPS as readonly string[]).includes(kind);
	if (after !== null && (!paged || !CURSOR.test(after))) return null;
	const at = (path: string) => siteUrl(settings, path);
	switch (kind as SitemapKind) {
		case "static":
			return [
				...INDEXABLE_PATHS,
				...((await freshInkListed(client, settings)) ? [paths.freshInk()] : []),
			].map(at);
		case "styles":
			return (await listedStyles(client, settings)).map((slug) =>
				at(paths.style(slug)),
			);
		case "locations":
			return (await listedPlaces(client, settings)).map(at);
		case "studios": {
			const page = await client.sitemap.studios(pageQuery(after));
			return page.data.map((row) => at(paths.studio(row.slug)));
		}
		case "artists": {
			const page = await client.sitemap.artists(pageQuery(after));
			return page.data.map((row) =>
				at(
					row.studio.type === "independent"
						? paths.independentArtist(row.studio.slug)
						: paths.studioArtist(row.studio.slug, row.slug),
				),
			);
		}
		case "tattoos": {
			const page = await client.sitemap.tattoos(pageQuery(after));
			return page.data.map((row) => at(paths.tattoo(row.id)));
		}
	}
}

function pageQuery(after: string | null) {
	return {
		limit: SITEMAP_PAGE,
		...(after ? { cursor: after.toLowerCase() } : {}),
	};
}

/**
 * Whether the bare Fresh ink feed is indexable for a crawler: like a style
 * page it follows the visitor's country, a crawler without a cookie gets
 * the default country, and an empty feed is noindex. One read (limit 1).
 */
async function freshInkListed(
	client: DiscoverClient,
	settings: Settings,
): Promise<boolean> {
	const page = await client.freshInk.list({
		country: settings.defaultCountry,
		limit: 1,
	});
	return page.data.length > 0;
}

/**
 * The styles whose page is indexable for a crawler: a style page follows
 * the visitor's country, and a crawler without a cookie gets the default
 * country, where an empty style page is noindex. A style has studios there
 * only if it has artists there (a studio matches a style by its artists),
 * so one artists read per style (limit 1) decides.
 */
async function listedStyles(
	client: DiscoverClient,
	settings: Settings,
): Promise<string[]> {
	const styles = await client.styles.list();
	const listed = await mapLimit(styles, SITEMAP_CONCURRENCY, async (style) => {
		const page = await client.artists.list({
			style: style.slug,
			country: settings.defaultCountry,
			limit: 1,
		});
		return page.data.length > 0;
	});
	return styles.filter((_, index) => listed[index]).map(({ slug }) => slug);
}

/**
 * The location pages that are indexable: each market with a studio or an
 * artist listed (an empty market's page is noindex), and each city page
 * (a market's places in `/locations`: the places a listed business is in).
 * A place whose only business has no shown artist and isn't a studio would
 * be an empty (noindex) city page; the page itself still says noindex then.
 */
async function listedPlaces(
	client: DiscoverClient,
	settings: Settings,
): Promise<string[]> {
	const [places, markets] = await Promise.all([
		client.locations.list(),
		mapLimit(settings.markets, SITEMAP_CONCURRENCY, async (country) => {
			const [studios, artists] = await Promise.all([
				client.studios.list({ country, limit: 1 }),
				client.artists.list({ country, limit: 1 }),
			]);
			return studios.data.length > 0 || artists.data.length > 0;
		}),
	]);
	const urls: string[] = [];
	settings.markets.forEach((country, index) => {
		if (!markets[index]) return;
		urls.push(paths.location(country));
		for (const place of places)
			if (place.country === country) urls.push(paths.city(country, place.slug));
	});
	return urls;
}
