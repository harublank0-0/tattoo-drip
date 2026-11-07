import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { GalleryPage } from "#/components/gallery/gallery-page";
import {
	type GallerySearch,
	galleryLabels,
	galleryQuery,
	readGallerySearch,
} from "#/lib/gallery";
import { galleryHead, galleryPlaces, loadGallery } from "#/lib/gallery-loader";

/**
 * `/tattoos` (D09): the tattoo gallery. Published photos in the page's
 * country (D06.5: the address's `country`, else the visitor's; one
 * artist's or studio's work is global unless the address names a country),
 * searched (`q`), filtered by style, city, artist or studio, newest first,
 * paged by the API's cursor. Every control writes the address
 * (`src/lib/gallery.ts`); the loader reads the API with exactly what it
 * says. `/explore/tattoos` is a 301 here.
 */
export const Route = createFileRoute("/tattoos/")({
	// Every key, undefined when malformed (the router merges this over the raw search).
	validateSearch: (search: Record<string, unknown>): GallerySearch =>
		readGallerySearch(search),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => loadGallery(context, deps),
	head: ({ match }) => galleryHead(match),
	// No pendingComponent: a new search keeps the page (and the search box's
	// focus) mounted; the photos dim and the section is aria-busy.
	component: Gallery,
});

function Gallery() {
	const { discover } = Route.useRouteContext();
	const { filters, styleUnchecked } = Route.useLoaderData();
	const search = Route.useSearch();
	const { data } = useSuspenseQuery(
		discoverQueries.tattoos(discover.client, galleryQuery(filters)),
	);
	const styles = useQuery(discoverQueries.styles(discover.client)).data;
	const places = galleryPlaces(
		useQuery(discoverQueries.locations(discover.client)).data,
		filters.country,
	);
	return (
		<GalleryPage
			search={search}
			filters={filters}
			labels={galleryLabels(filters, { styles, places }, data.data)}
			lists={{ styles, places }}
			markets={discover.settings.markets}
			tattoos={data.data}
			nextCursor={data.nextCursor}
			styleUnchecked={styleUnchecked}
		/>
	);
}
