import { createFileRoute } from "@tanstack/react-router";
import { sitemapChildResponse } from "#/lib/sitemap-route";

/** `/sitemaps/styles.xml` (D10): one child of the sitemap index (src/lib/sitemap.ts). */
export const Route = createFileRoute("/sitemaps/styles.xml")({
	server: {
		handlers: {
			GET: ({ request }) => sitemapChildResponse("styles", request),
		},
	},
});
