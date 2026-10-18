import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { type DehydratedApi, dehydrateApi, hydrateApi } from "./api/context.ts";
import { createRequestApi } from "./api/request.ts";
import { routeTree } from "./routeTree.gen";
import {
	type DehydratedSite,
	dehydrateSite,
	hydrateSite,
} from "./site/context.ts";
import { createRequestSite } from "./site/request.ts";
import { NotFoundPage, RouteErrorPage } from "./studio/components/pages.tsx";

type Dehydrated = DehydratedApi & DehydratedSite;

/**
 * One router per server request and one per browser tab (Start calls this
 * for each), each with its own QueryClient and SDK client (TAT-23,
 * src/api/) and the page's own origin (TAT-48, src/site/). The server sends
 * the browser only the API's origin, the studio's slug and the page's
 * origin, in the router's dehydrated state.
 *
 * The default error component also covers the root route, whose shell
 * (`shellComponent`) wraps the route's error boundary in this router
 * version: a failed read replaces only the page's body, never the document.
 */
export function getRouter() {
	const api = createRequestApi();
	const site = createRequestSite();

	const router = createTanStackRouter({
		routeTree,
		context: { queryClient: api.queryClient, tattoo: api.tattoo, site },
		scrollRestoration: true,
		defaultNotFoundComponent: NotFoundPage,
		defaultErrorComponent: RouteErrorPage,
		dehydrate: (): Dehydrated => ({
			...dehydrateApi(api),
			...dehydrateSite(site),
		}),
		hydrate: (dehydrated: Dehydrated) => {
			hydrateApi(api, dehydrated);
			hydrateSite(site, dehydrated);
		},
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
