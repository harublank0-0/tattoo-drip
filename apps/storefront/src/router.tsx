import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { type DehydratedApi, dehydrateApi, hydrateApi } from "./api/context.ts";
import { createRequestApi } from "./api/request.ts";
import { routeTree } from "./routeTree.gen";

/**
 * One router per server request and one per browser tab (Start calls this
 * for each), each with its own QueryClient and SDK client (TAT-23,
 * src/api/). The server sends the browser only the API's origin and the
 * studio's slug, in the router's dehydrated state; the browser connects its
 * own client, without the server key, before the first route loads.
 */
export function getRouter() {
	const api = createRequestApi();

	const router = createTanStackRouter({
		routeTree,
		context: { queryClient: api.queryClient, tattoo: api.tattoo },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		dehydrate: (): DehydratedApi => dehydrateApi(api),
		hydrate: (dehydrated: DehydratedApi) => hydrateApi(api, dehydrated),
	});

	// Wraps the router in the QueryClientProvider and streams the cache.
	setupRouterSsrQueryIntegration({ router, queryClient: api.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
