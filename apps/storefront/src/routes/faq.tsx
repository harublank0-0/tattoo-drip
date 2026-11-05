import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { loadInfoPage } from "../studio/loaders.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedInfoPage } from "../studio/theme/registry.tsx";

/**
 * `/faq` (Prompt 7): one of the informational pages, from the studio's and
 * its artists' own data (src/studio/info.ts). Nothing of the studio's own to
 * show is the not-found page.
 */
export const Route = createFileRoute("/faq")({
	loader: ({ context }) => loadInfoPage(context, "faq"),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: FaqRoute,
});

function FaqRoute() {
	return <ThemedInfoPage data={Route.useLoaderData()} />;
}
