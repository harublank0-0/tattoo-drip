import { createFileRoute } from "@tanstack/react-router";
import { discoverConfig } from "#/lib/config";
import { robotsTxt } from "#/lib/seo";

/**
 * `/robots.txt`: everything disallowed while DISCOVER_INDEXING is off
 * (pages also say noindex, in a meta tag and an X-Robots-Tag header), then
 * everything allowed with the sitemap.
 */
export const Route = createFileRoute("/robots.txt")({
	server: {
		handlers: {
			GET: () =>
				new Response(robotsTxt(discoverConfig()), {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "public, max-age=300",
					},
				}),
		},
	},
});
