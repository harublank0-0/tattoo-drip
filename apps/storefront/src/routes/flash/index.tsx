import { createFileRoute } from "@tanstack/react-router";
import { pageCacheHeaders } from "../../studio/cache.ts";
import { readFlashSearch } from "../../studio/flash.ts";
import { loadFlashPage } from "../../studio/loaders.ts";
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedFlashPage } from "../../studio/theme/registry.tsx";

/**
 * Flash (TAT-129): every visible artist's shown designs, newest first. The
 * address holds the filter (`?artist=`) and the page (`&cursor=`): each is
 * checked (readFlashSearch), a refused one is the not-found page, and "Show
 * more" is a link that works without JavaScript. Like `/request`, the router
 * merges the raw search under the checked one, so `loaderDeps` reads it
 * through `readFlashSearch` again and a stray key (`fbclid`) never reaches the
 * loader.
 */
export const Route = createFileRoute("/flash/")({
	validateSearch: readFlashSearch,
	loaderDeps: ({ search }) => readFlashSearch(search),
	loader: ({ context, deps }) => loadFlashPage(context, deps),
	head: ({ loaderData, match }) =>
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
	headers: ({ match }) => pageCacheHeaders(match.status),
	component: FlashRoute,
});

function FlashRoute() {
	return <ThemedFlashPage data={Route.useLoaderData()} />;
}
