import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { loadStudioPage } from "../studio/loaders.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedStudioPage } from "../studio/theme/registry.tsx";

/** The studio page (TAT-48): profile, contact links, artists and the inquiry section. */
export const Route = createFileRoute("/")({
	loader: ({ context }) => loadStudioPage(context),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: StudioRoute,
});

function StudioRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<ThemedStudioPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
