import { createFileRoute } from "@tanstack/react-router";

/**
 * `/healthz` (D11): the container's health check. It answers while the
 * server runs and reads nothing from the API, so checking it every few
 * seconds spends none of the API's budget and an API outage doesn't make
 * Docker restart Discover (pages then show their own error state). The
 * settings were checked when the server started (src/server/startup.ts).
 */
export const Route = createFileRoute("/healthz")({
	server: {
		handlers: {
			GET: () =>
				new Response("ok\n", {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "no-store",
						"X-Robots-Tag": "noindex",
					},
				}),
		},
	},
});
