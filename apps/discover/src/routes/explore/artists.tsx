import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { DirectoryPage } from "#/components/directory/directory-page";
import { ArtistResults } from "#/components/directory/results";
import {
	type DirectorySearch,
	directoryQuery,
	directoryWorkQuery,
	readDirectorySearch,
} from "#/lib/directory";
import {
	directoryHead,
	loadDirectory,
	usePageLists,
} from "#/lib/directory-loader";

/**
 * `/explore/artists` (D06; D07 the directory): shown artists of every listed
 * business, studios' and independent, in the page's country (D06.5),
 * searched by name (`q`), filtered by city, style and who (`independent`),
 * sorted and paged by the API's own sort and cursor. Same address contract
 * and loader as `/explore/studios`; work-first cards linking through
 * `profileDestination` (tenant-scoped artist slugs).
 */
export const Route = createFileRoute("/explore/artists")({
	// Every key, undefined when malformed: the router merges this over the
	// raw search, so leaving a key out would let a bad value through.
	validateSearch: (search: Record<string, unknown>): DirectorySearch =>
		readDirectorySearch(search, "artists"),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => loadDirectory("artists", context, deps),
	head: (context) => directoryHead("artists", context),
	// No pendingComponent: a new search on this page keeps the page mounted
	// (the results dim, aria-busy) instead of Suspense hiding it after
	// pendingMs, which took focus from the control that applied it.
	component: Artists,
});

function Artists() {
	const { discover } = Route.useRouteContext();
	const { filters, styleUnchecked } = Route.useLoaderData();
	const search = Route.useSearch();
	const { data } = useSuspenseQuery(
		discoverQueries.artists(
			discover.client,
			directoryQuery(filters, "artists"),
		),
	);
	const works =
		useQuery(
			discoverQueries.tattoos(discover.client, directoryWorkQuery(filters)),
		).data?.data ?? [];
	const lists = usePageLists(discover.client, filters.country);
	return (
		<DirectoryPage
			kind="artists"
			search={search}
			filters={filters}
			lists={lists}
			markets={discover.settings.markets}
			rows={data.data.length}
			nextCursor={data.nextCursor}
			styleUnchecked={styleUnchecked}
		>
			<ArtistResults artists={data.data} works={works} />
		</DirectoryPage>
	);
}
