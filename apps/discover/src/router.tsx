import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import {
	NotFoundState,
	RouteErrorState,
} from "./components/discovery/states.tsx";
import {
	type Dehydrated,
	dehydrateContext,
	hydrateContext,
} from "./lib/context.ts";
import { createRequestContext } from "./lib/request.ts";
import { parseSearchText, stringifySearchText } from "./lib/search.ts";
import { routeTree } from "./routeTree.gen";

/**
 * One router per server request and one per browser tab (Start calls this
 * for each), each with its own QueryClient and Discover client
 * (src/lib/context.ts): no request can see another's cache. The server
 * sends the browser only the public settings, in the router's dehydrated
 * state.
 */
export function getRouter() {
	const context = createRequestContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultNotFoundComponent: NotFoundState,
		defaultErrorComponent: RouteErrorState,
		// Search values stay text (`?q=true` is a search for "true"), not JSON.
		parseSearch: parseSearchText,
		stringifySearch: stringifySearchText,
		dehydrate: (): Dehydrated => dehydrateContext(context),
		hydrate: (dehydrated: Dehydrated) => hydrateContext(context, dehydrated),
	});

	// Wraps the router in the QueryClientProvider and streams the cache:
	// a loader's prefetch on the server hydrates the same query in the browser.
	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
	/**
	 * D10: a route that may never be indexed whatever DISCOVER_INDEXING says
	 * (`/pricing`); the root's head reads it (`pageState`, src/lib/seo.ts).
	 */
	interface StaticDataRouteOption {
		noindex?: boolean;
	}
}
