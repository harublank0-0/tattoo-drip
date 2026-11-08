import { createFileRoute } from "@tanstack/react-router";
import { sitemapChildResponse } from "#/lib/sitemap-route";

/** `/sitemaps/tattoos.xml` (D10): one child of the sitemap index (src/lib/sitemap.ts). */
export const Route = createFileRoute("/sitemaps/tattoos.xml")({
	server: {
		handlers: {
			GET: ({ request }) => sitemapChildResponse("tattoos", request),
		},
	},
});
