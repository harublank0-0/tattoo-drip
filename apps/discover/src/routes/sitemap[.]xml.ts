import { createFileRoute } from "@tanstack/react-router";
import { discoverConfig } from "#/lib/config";
import { sitemapEntries, sitemapXml } from "#/lib/seo";

/**
 * `/sitemap.xml` (D10 fills it in): a 404 while DISCOVER_INDEXING is off,
 * so nothing advertises pages as indexable; then the finished pages only.
 */
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () => {
				const config = discoverConfig();
				if (!config.indexing) {
					return new Response("Not found\n", {
						status: 404,
						headers: {
							"Content-Type": "text/plain; charset=utf-8",
							"X-Robots-Tag": "noindex",
						},
					});
				}
				return new Response(sitemapXml(sitemapEntries(config)), {
					headers: {
						"Content-Type": "application/xml; charset=utf-8",
						"Cache-Control": "public, max-age=300",
					},
				});
			},
		},
	},
});
