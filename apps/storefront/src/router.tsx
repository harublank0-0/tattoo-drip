import {
	createRouter as createTanStackRouter,
	defaultStringifySearch,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { type DehydratedApi, dehydrateApi, hydrateApi } from "./api/context.ts";
import { createRequestApi } from "./api/request.ts";
import { scrollRestorationKey } from "./deposit/token.ts";
import { routeTree } from "./routeTree.gen";
import {
	type DehydratedSite,
	dehydrateSite,
	hydrateSite,
} from "./site/context.ts";
import { createRequestSite } from "./site/request.ts";
import { NotFoundPage, RouteErrorPage } from "./studio/components/pages.tsx";
import { healedAsOne } from "./studio/gallery.ts";

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
		// `?healed=1`, as our links write it (the default would redirect it to `healed=true`).
		stringifySearch: (search) => defaultStringifySearch(healedAsOne(search)),
		scrollRestoration: true,
		// Never the href: a deposit link's token is in its fragment (TAT-65b).
		getScrollRestorationKey: scrollRestorationKey,
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
