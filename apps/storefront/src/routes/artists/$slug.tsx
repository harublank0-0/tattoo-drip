import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../../studio/cache.ts";
import { loadArtistPage } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedArtistPage } from "../../studio/theme/registry.tsx";

/**
 * One visible artist (TAT-48): the link an artist shares to be asked for by
 * name. A hidden, unknown or renamed artist is the not-found page.
 */
export const Route = createFileRoute("/artists/$slug")({
	loader: ({ context, params }) => loadArtistPage(context, params.slug),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: ArtistRoute,
});

function ArtistRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<ThemedArtistPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
