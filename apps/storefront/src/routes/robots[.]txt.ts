import { createFileRoute } from "@tanstack/react-router";
import { createRequestSite } from "../site/request.ts";
import { PAGE_CACHE } from "../studio/cache.ts";
import { robotsTxt } from "../studio/sitemap.ts";

/**
 * `/robots.txt` (Prompt 8): everything allowed, and this studio's own
 * sitemap on its own origin. A route rather than a static file, because the
 * sitemap's address is per studio. Deposit pages say noindex themselves.
 */
export const Route = createFileRoute("/robots.txt")({
	server: {
		handlers: {
			GET: () =>
				new Response(robotsTxt(createRequestSite().origin), {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": PAGE_CACHE,
					},
				}),
		},
	},
});
