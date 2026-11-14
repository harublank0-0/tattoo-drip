import { createFileRoute } from "@tanstack/react-router";
import { clientPageCacheHeaders } from "../studio/cache.ts";
import { loadReviewsPage } from "../studio/loaders.ts";
import { readReviewsSearch } from "../studio/reviews.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedReviewsPage } from "../studio/theme/registry.tsx";

/**
 * Reviews (Reviews and Fresh ink, slice 3): every review the studio's
 * clients allowed on its page, newest first. The address holds only the page
 * (`?cursor=`), checked by readReviewsSearch; "Show more" is a link that
 * works without JavaScript, and every page's canonical is the first, as
 * `/gallery`'s and `/flash`'s. Nothing to show (no review, reviews off, the
 * section hidden in Page look) or a refused cursor is the not-found page.
 * Cached for a shorter stale window than other pages (clientPageCacheHeaders),
 * so a takedown leaves it within 2 minutes; it holds nothing per visitor.
 */
export const Route = createFileRoute("/reviews")({
	validateSearch: readReviewsSearch,
	loaderDeps: ({ search }) => readReviewsSearch(search),
	loader: ({ context, deps }) => loadReviewsPage(context, deps),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => clientPageCacheHeaders(match.status),
	component: ReviewsRoute,
});

function ReviewsRoute() {
	return <ThemedReviewsPage data={Route.useLoaderData()} />;
}
