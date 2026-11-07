import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { DirectoryPage } from "#/components/directory/directory-page";
import { ResultsSkeleton, StudioResults } from "#/components/directory/results";
import { PageContainer } from "#/components/discovery/layout";
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
 * `/explore/studios` (D05; D06 filters; D07 the directory): listed studios
 * in the page's country (D06.5: the address's `country`, else the
 * visitor's), searched by name (`q`), filtered by city and style, sorted
 * by the API's sorts, paged by its cursor. Every control writes the
 * address; the loader reads the API with exactly what it says
 * (`src/lib/directory.ts`). Rows link through `profileDestination`.
 */
export const Route = createFileRoute("/explore/studios")({
	// Every key, undefined when malformed: the router merges this over the
	// raw search, so leaving a key out would let a bad value through.
	validateSearch: (search: Record<string, unknown>): DirectorySearch =>
		readDirectorySearch(search, "studios"),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => loadDirectory("studios", context, deps),
	head: ({ match }) => directoryHead("studios", match),
	pendingComponent: () => (
		<PageContainer className="py-16">
			<ResultsSkeleton kind="studios" />
		</PageContainer>
	),
	component: Studios,
});

function Studios() {
	const { discover } = Route.useRouteContext();
	const { filters } = Route.useLoaderData();
	const search = Route.useSearch();
	const { data } = useSuspenseQuery(
		discoverQueries.studios(
			discover.client,
			directoryQuery(filters, "studios"),
		),
	);
	const works =
		useQuery(
			discoverQueries.tattoos(discover.client, directoryWorkQuery(filters)),
		).data?.data ?? [];
	const lists = usePageLists(discover.client, filters.country);
	return (
		<DirectoryPage
			kind="studios"
			search={search}
			filters={filters}
			lists={lists}
			markets={discover.settings.markets}
			rows={data.data.length}
			nextCursor={data.nextCursor}
		>
			<StudioResults studios={data.data} works={works} />
		</DirectoryPage>
	);
}
