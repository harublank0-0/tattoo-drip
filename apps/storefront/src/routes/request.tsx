import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { loadRequestPage } from "../studio/loaders.ts";
import { readRequestSearch } from "../studio/request.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedRequestPage } from "../studio/theme/registry.tsx";

/**
 * The request page (TAT-127): the intake form and "How booking works" on a
 * page of their own, which every Request button leads to. `?artist=<slug>`
 * picks that artist; anything else in the address (an ad's `fbclid`, `utm_*`,
 * a renamed artist's old slug, a repeated `artist`) is the general form or the
 * right artist, never a not-found. The router merges the raw search under the
 * checked one, so `loaderDeps` reads it through `readRequestSearch` again and
 * the loader sees only what the reader keeps: a stray key neither changes the
 * artist nor makes a page of its own.
 */
export const Route = createFileRoute("/request")({
	validateSearch: readRequestSearch,
	loaderDeps: ({ search }) => readRequestSearch(search),
	loader: ({ context, deps }) => loadRequestPage(context, deps),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: RequestRoute,
});

function RequestRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<ThemedRequestPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
