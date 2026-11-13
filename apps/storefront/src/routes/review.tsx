import { createFileRoute } from "@tanstack/react-router";
import { ReviewScreen } from "../review/components/review-screen.tsx";
import { loadReviewShell } from "../review/loader.ts";
import { REVIEW_PAGE_HEADERS, reviewHead } from "../review/seo.ts";

/**
 * The client's review page (Reviews and Fresh ink, slice 1): `/review#<token>`,
 * the link a studio sends once the tattoo is done. Like the deposit page
 * (src/routes/deposit.tsx): the server renders only the shell, from the
 * studio the lookup cached; the page loads in the browser (ReviewScreen),
 * because the token is in the fragment, which no server sees. Unthemed,
 * never stored, never indexed, no Referer.
 */
export const Route = createFileRoute("/review")({
	loader: ({ context }) => loadReviewShell(context),
	head: ({ loaderData }) => reviewHead(loaderData?.studioName ?? null),
	headers: () => ({ ...REVIEW_PAGE_HEADERS }),
	component: ReviewRoute,
});

function ReviewRoute() {
	const connection = Route.useRouteContext({
		select: (context) => ({
			apiUrl: context.tattoo.connection.apiUrl,
			mediaUrl: context.tattoo.connection.mediaUrl,
			challengeSiteKey: context.site.challengeSiteKey,
		}),
	});
	return <ReviewScreen shell={Route.useLoaderData()} connection={connection} />;
}
