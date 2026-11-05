import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { loadInfoPage } from "../studio/loaders.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedInfoPage } from "../studio/theme/registry.tsx";

/**
 * `/about` (Prompt 7): one of the informational pages, from the studio's and
 * its artists' own data (src/studio/info.ts). Nothing of the studio's own to
 * show is the not-found page.
 */
export const Route = createFileRoute("/about")({
	loader: ({ context }) => loadInfoPage(context, "about"),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: AboutRoute,
});

function AboutRoute() {
	return <ThemedInfoPage data={Route.useLoaderData()} />;
}
