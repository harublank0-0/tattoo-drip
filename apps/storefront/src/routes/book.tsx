import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../studio/cache.ts";
import { loadRequestPage } from "../studio/loaders.ts";
import { readRequestSearch } from "../studio/request.ts";
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedRequestPage } from "../studio/theme/registry.tsx";

/**
 * The booking page (TAT-127; `/book` since Prompt 6, where `/request`
 * redirects): the session request flow on a page of its own, which every
 * Request button leads to. `?artist=<slug>`
 * picks that artist; `?ref=` (Discover's referral, D08) is kept and sent with
 * the inquiry; anything else in the address (an ad's `fbclid`, `utm_*`,
 * a renamed artist's old slug, a repeated `artist`) is the general form or the
 * right artist, never a not-found. The router merges the raw search under the
 * checked one, so `loaderDeps` reads it through `readRequestSearch` again and
 * the loader sees only what the reader keeps: a stray key neither changes the
 * artist nor makes a page of its own.
 */
export const Route = createFileRoute("/book")({
	validateSearch: readRequestSearch,
	loaderDeps: ({ search }) => readRequestSearch(search),
	loader: ({ context, deps }) => loadRequestPage(context, deps),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	// The address may carry Discover's referral (`?ref=`, Discover D08): other
	// sites (the bot challenge's frame, a chat link) get the origin only.
	headers: ({ match }) => ({
		...pageCacheHeaders(match.status),
		"Referrer-Policy": "strict-origin-when-cross-origin",
	}),
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
