import { createFileRoute, isNotFound } from "@tanstack/react-router";
import { createRequestApi } from "../api/request.ts";
import { createRequestSite } from "../site/request.ts";
import { PAGE_CACHE } from "../studio/cache.ts";
import { loadSitemapPaths } from "../studio/loaders.ts";
import { sitemapXml } from "../studio/sitemap.ts";

/**
 * `/sitemap.xml` (Prompt 8): the studio's own pages on its own origin
 * (src/studio/sitemap.ts), cached like a page. The studio comes from the
 * request's host, as for every page (src/tenancy/); an unknown host never
 * gets here.
 */
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async () => {
				const api = createRequestApi();
				const site = createRequestSite();
				try {
					const paths = await loadSitemapPaths(api);
					return new Response(sitemapXml(site.origin, paths), {
						headers: {
							"Content-Type": "application/xml; charset=utf-8",
							"Cache-Control": PAGE_CACHE,
						},
					});
				} catch (error) {
					// The read logged itself (rethrowAsNotFound). A crawler retries a
					// 503 later; nothing here is cached or says why.
					const missing = isNotFound(error);
					return new Response(missing ? "Not found\n" : "Unavailable\n", {
						status: missing ? 404 : 503,
						headers: {
							"Content-Type": "text/plain; charset=utf-8",
							"Cache-Control": "no-store",
							...(missing ? {} : { "Retry-After": "30" }),
						},
					});
				}
			},
		},
	},
});
