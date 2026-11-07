import { createDiscoverClient, type DiscoverClient } from "@tattoo-drip/sdk";
import { discoverConfig, publicSettings } from "./config.ts";
import { SERVER_TIMEOUT_MS } from "./context.ts";
import {
	sitemapIndexUrls,
	sitemapIndexXml,
	sitemapUrls,
	urlsetXml,
} from "./sitemap.ts";

/**
 * The sitemap routes' responses (D10, server only): `/sitemap.xml` and
 * `/sitemaps/<kind>.xml`. A 404 while DISCOVER_INDEXING is off (nothing
 * advertises pages as indexable) and for a sitemap that doesn't exist.
 * Cached an hour by browsers and shared caches (`public, max-age=3600`):
 * a removed profile leaves the sitemaps within that hour of the API
 * dropping it, while the profile itself is a 404 at once (pages are
 * `private, no-store`). When the API can't be read the answer is a 503
 * with `Retry-After`, never a partial sitemap, and nothing caches it.
 *
 * The server also keeps each built sitemap for DISCOVER_SITEMAP_CACHE_SECONDS
 * (default 10 minutes) and shares one build between concurrent requests: a
 * sitemap costs up to twenty API reads, and every Discover page shares one
 * API budget, so repeated sitemap requests must not use it up. A failed
 * build is never kept.
 */

const XML = "application/xml; charset=utf-8";

/** The most sitemaps kept at once (the index, its children and their pages). */
const KEPT_LIMIT = 64;
const kept = new Map<
	string,
	{ expires: number; body: Promise<string | null> }
>();

function remembered(
	key: string,
	seconds: number,
	build: () => Promise<string | null>,
): Promise<string | null> {
	if (seconds === 0) return build();
	const now = Date.now();
	const hit = kept.get(key);
	if (hit && hit.expires > now) return hit.body;
	kept.delete(key);
	if (kept.size >= KEPT_LIMIT) {
		const oldest = kept.keys().next().value;
		if (oldest !== undefined) kept.delete(oldest);
	}
	const body = build();
	kept.set(key, { expires: now + seconds * 1000, body });
	body.catch(() => {
		if (kept.get(key)?.body === body) kept.delete(key);
	});
	return body;
}

function notFound(): Response {
	return new Response("Not found\n", {
		status: 404,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"X-Robots-Tag": "noindex",
		},
	});
}

async function respond(
	key: string,
	build: (
		client: DiscoverClient,
		settings: ReturnType<typeof publicSettings>,
	) => Promise<string | null>,
): Promise<Response> {
	const config = discoverConfig();
	if (!config.indexing) return notFound();
	const settings = publicSettings(config);
	const client = createDiscoverClient({
		baseUrl: settings.apiUrl,
		timeoutMs: SERVER_TIMEOUT_MS,
	});
	let body: string | null;
	try {
		body = await remembered(key, config.sitemapCacheSeconds, () =>
			build(client, settings),
		);
	} catch (error) {
		// An API outage and a bug both answer 503; the log tells them apart.
		console.error(`Discover sitemap ${key} failed:`, error);
		return new Response("The sitemap is unavailable for a moment.\n", {
			status: 503,
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				"Retry-After": "300",
				"X-Robots-Tag": "noindex",
			},
		});
	}
	if (body === null) return notFound();
	return new Response(body, {
		headers: {
			"Content-Type": XML,
			"Cache-Control": "public, max-age=3600",
			// The sitemap itself is for crawlers, not a search result.
			"X-Robots-Tag": "noindex",
		},
	});
}

/** `/sitemap.xml`: the index of every child sitemap. */
export function sitemapIndexResponse(): Promise<Response> {
	return respond("/sitemap.xml", async (client, settings) =>
		sitemapIndexXml(await sitemapIndexUrls(client, settings)),
	);
}

/** `/sitemaps/<kind>.xml[?after=<cursor>]`: one child sitemap. */
export function sitemapChildResponse(
	kind: string,
	request: Request,
): Promise<Response> {
	const after = new URL(request.url).searchParams.get("after");
	const key = `/sitemaps/${kind}.xml${after === null ? "" : `?after=${after}`}`;
	return respond(key, async (client, settings) => {
		const urls = await sitemapUrls(client, settings, kind, after);
		return urls ? urlsetXml(urls) : null;
	});
}
