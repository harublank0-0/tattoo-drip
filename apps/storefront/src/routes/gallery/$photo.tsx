import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../../studio/cache.ts";
import { loadArtworkPage } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedArtworkPage } from "../../studio/theme/registry.tsx";

/**
 * One tattoo's own page (Prompt 5): a gallery photo by its id, with its
 * artist and related work. An id that is not a lowercase UUID, a photo the
 * API doesn't show (a hidden artist's, removed, unknown) and one the page
 * can't show are all the not-found page.
 */
export const Route = createFileRoute("/gallery/$photo")({
	loader: ({ context, params }) => loadArtworkPage(context, params.photo),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: ArtworkRoute,
});

function ArtworkRoute() {
	return <ThemedArtworkPage data={Route.useLoaderData()} />;
}
