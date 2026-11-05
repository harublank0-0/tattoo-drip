import { createFileRoute } from "@tanstack/react-router";
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
				const paths = await loadSitemapPaths(api);
				return new Response(sitemapXml(site.origin, paths), {
					headers: {
						"Content-Type": "application/xml; charset=utf-8",
						"Cache-Control": PAGE_CACHE,
					},
				});
			},
		},
	},
});
