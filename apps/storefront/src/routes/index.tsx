import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { StudioPage } from "../studio/components/pages.tsx";
import { loadStudioPage } from "../studio/loaders.ts";
import { headTags, statusHead } from "../studio/seo.ts";

/** The studio page (TAT-48): profile, contact links, artists and the inquiry section. */
export const Route = createFileRoute("/")({
	loader: ({ context }) => loadStudioPage(context),
	head: ({ loaderData, match }) =>
		loaderData ? headTags(loaderData.seo) : statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: StudioRoute,
});

function StudioRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<StudioPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
