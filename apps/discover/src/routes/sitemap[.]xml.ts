import { createFileRoute } from "@tanstack/react-router";
import { sitemapIndexResponse } from "#/lib/sitemap-route";

/**
 * `/sitemap.xml` (D10): the sitemap index (src/lib/sitemap.ts), a 404 while
 * DISCOVER_INDEXING is off.
 */
export const Route = createFileRoute("/sitemap.xml")({
	server: { handlers: { GET: () => sitemapIndexResponse() } },
});
