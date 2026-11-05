import { createFileRoute } from "@tanstack/react-router";
import { readArtistsSearch } from "../../studio/artists.ts";
import { pageCacheHeaders } from "../../studio/cache.ts";
import { loadArtistsPage } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedArtistsPage } from "../../studio/theme/registry.tsx";

/**
 * The artists directory: every visible artist of the studio the host names,
 * filtered by `?style=<slug>` (readArtistsSearch: one checked slug, nothing
 * else). The artist list is the cached read every page makes, so a filter
 * re-runs only the pure filter (artistsDirectory) and asks the API nothing.
 * Each artist links to their page, `/artists/$slug`.
 */
export const Route = createFileRoute("/artists/")({
	validateSearch: readArtistsSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: ({ context, deps }) => loadArtistsPage(context, deps.search),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: ArtistsRoute,
});

function ArtistsRoute() {
	return <ThemedArtistsPage data={Route.useLoaderData()} />;
}
