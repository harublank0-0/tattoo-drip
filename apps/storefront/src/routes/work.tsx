import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import {
	readWorkSearch,
	WORK_PAGE_SIZE,
	workQuery,
} from "../studio/gallery.ts";
import { loadWorkPage, moreWork } from "../studio/loaders.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedWorkPage } from "../studio/theme/registry.tsx";

/**
 * All work (TAT-126): every visible artist's photos, newest first. The
 * address holds the filters (`?artist=&style=&healed=1`) and the page
 * (`&cursor=`): each is checked (readWorkSearch), a refused one is the
 * not-found page, and "Show more" is a link that works without JavaScript.
 */
export const Route = createFileRoute("/work")({
	validateSearch: readWorkSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: ({ context, deps }) => loadWorkPage(context, deps.search),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: WorkRoute,
});

function WorkRoute() {
	const data = Route.useLoaderData();
	const { queryClient, tattoo } = Route.useRouteContext();
	const query = workQuery(data.search, WORK_PAGE_SIZE);
	return (
		<ThemedWorkPage
			data={data}
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
