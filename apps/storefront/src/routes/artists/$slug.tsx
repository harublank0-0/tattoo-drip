import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../../studio/cache.ts";
import {
	readPortfolioSearch,
	WORK_PAGE_SIZE,
	workQuery,
} from "../../studio/gallery.ts";
import { loadArtistPage, moreWork } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedArtistPage } from "../../studio/theme/registry.tsx";

/**
 * One visible artist (TAT-48): the link an artist shares to be asked for by
 * name. A hidden, unknown or renamed artist is the not-found page. Their whole
 * portfolio (TAT-126) is read a page at a time: `?healed=1` and `&cursor=` in
 * the address, each checked (readPortfolioSearch), "Show more" a link that
 * works without JavaScript.
 */
export const Route = createFileRoute("/artists/$slug")({
	validateSearch: readPortfolioSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: ({ context, params, deps }) =>
		loadArtistPage(context, params.slug, deps.search),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: ArtistRoute,
});

function ArtistRoute() {
	const data = Route.useLoaderData();
	const { queryClient, tattoo, site } = Route.useRouteContext();
	const query = workQuery(
		{ artist: data.artist.slug, ...data.portfolio.search },
		WORK_PAGE_SIZE,
	);
	return (
		<ThemedArtistPage
			data={data}
			challengeSiteKey={site.challengeSiteKey}
			more={(cursor, offset) =>
				moreWork(
					{ queryClient, tattoo },
					query,
					cursor,
					offset,
					tattoo.connection.apiUrl,
				)
			}
		/>
	);
}
