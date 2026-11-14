import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { readFreshInkSearch } from "../studio/fresh-ink.ts";
import { loadFreshInkPage } from "../studio/loaders.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedFreshInkPage } from "../studio/theme/registry.tsx";

/**
 * Fresh ink (Reviews and Fresh ink, slice 3): every healed tattoo the
 * studio's clients posted and it approved, newest first, each opening the
 * gallery's viewer with its angles. Paged and cached like `/reviews`; a
 * later page is `noindex`, and nothing to show is the not-found page.
 */
export const Route = createFileRoute("/fresh-ink")({
	validateSearch: readFreshInkSearch,
	loaderDeps: ({ search }) => readFreshInkSearch(search),
	loader: ({ context, deps }) => loadFreshInkPage(context, deps),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: FreshInkRoute,
});

function FreshInkRoute() {
	return <ThemedFreshInkPage data={Route.useLoaderData()} />;
}
