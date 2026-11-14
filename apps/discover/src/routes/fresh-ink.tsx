import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { FreshInkPage } from "#/components/gallery/fresh-ink-page";
import {
	type FreshInkSearch,
	freshInkQuery,
	readFreshInkSearch,
} from "#/lib/fresh-ink";
import { freshInkHead, loadFreshInk } from "#/lib/fresh-ink-loader";
import { galleryPlaces } from "#/lib/gallery-loader";

/**
 * `/fresh-ink` (Reviews and Fresh ink, slice 4): healed tattoos clients of
 * listed studios posted, that the studio approved and the client allowed on
 * Discover, newest first, in the page's country (D06.5), filtered by style
 * and city, paged by the API's cursor. Each opens its viewer; each links
 * its artist's and studio's profiles, and booking only through
 * `bookingLinks`. An empty page is its empty state, noindex.
 */
export const Route = createFileRoute("/fresh-ink")({
	validateSearch: (search: Record<string, unknown>): FreshInkSearch =>
		readFreshInkSearch(search),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => loadFreshInk(context, deps),
	head: (context) => freshInkHead(context),
	component: FreshInk,
});

function FreshInk() {
	const { discover } = Route.useRouteContext();
	const { filters, labels, styleUnchecked } = Route.useLoaderData();
	const search = Route.useSearch();
	const page = useQuery(
		discoverQueries.freshInk(discover.client, freshInkQuery(filters)),
	).data;
	const styles = useQuery(discoverQueries.styles(discover.client)).data;
	const places = galleryPlaces(
		useQuery(discoverQueries.locations(discover.client)).data,
		filters.country,
	);
	return (
		<FreshInkPage
			search={search}
			filters={filters}
			labels={labels}
			lists={{ styles, places }}
			markets={discover.settings.markets}
			posts={page?.data ?? []}
			nextCursor={page?.nextCursor ?? null}
			styleUnchecked={styleUnchecked}
		/>
	);
}
