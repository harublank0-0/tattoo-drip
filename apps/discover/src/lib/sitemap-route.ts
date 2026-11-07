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
 */

const XML = "application/xml; charset=utf-8";

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
		body = await build(client, settings);
	} catch {
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
	return respond(async (client, settings) =>
		sitemapIndexXml(await sitemapIndexUrls(client, settings)),
	);
}

/** `/sitemaps/<kind>.xml[?after=<cursor>]`: one child sitemap. */
export function sitemapChildResponse(
	kind: string,
	request: Request,
): Promise<Response> {
	const after = new URL(request.url).searchParams.get("after");
	return respond(async (client, settings) => {
		const urls = await sitemapUrls(client, settings, kind, after);
		return urls ? urlsetXml(urls) : null;
	});
}
