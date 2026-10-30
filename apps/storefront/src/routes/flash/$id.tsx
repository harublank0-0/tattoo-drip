import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../../studio/cache.ts";
import { loadFlashDesignPage } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedFlashDesignPage } from "../../studio/theme/registry.tsx";

/**
 * One flash design (TAT-129). An id that is not a lowercase UUID, a design
 * the API doesn't know (hidden, its artist hidden, unknown) and one the page
 * can't show are all the not-found page.
 */
export const Route = createFileRoute("/flash/$id")({
	loader: ({ context, params }) => loadFlashDesignPage(context, params.id),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: FlashDesignRoute,
});

function FlashDesignRoute() {
	return <ThemedFlashDesignPage data={Route.useLoaderData()} />;
}
