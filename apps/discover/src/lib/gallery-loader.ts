import { redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { isTattooApiError } from "@tattoo-drip/sdk";
import { rethrowUnavailable } from "./api-errors.ts";
import { crumbs } from "./breadcrumbs.ts";
import type { PublicSettings } from "./config.ts";
import type { DiscoverContext } from "./context.ts";
import type { ResolvedCountry } from "./country.ts";
import {
	type GalleryFilters,
	type GalleryLabels,
	type GallerySearch,
	galleryLabels,
	galleryQuery,
	galleryTitle,
	resolveGallery,
} from "./gallery.ts";
import { placesIn } from "./home.ts";
import { summary } from "./profiles.ts";
import { paths } from "./routes.ts";
import { knownStyle } from "./search.ts";
import { type HeadMatch, pageMeta } from "./seo.ts";
import { breadcrumbLd, structuredData } from "./structured-data.ts";

type LoaderContext = DiscoverContext & { country: ResolvedCountry };

const optional = <T>(read: Promise<T>) =>
	read.catch((): undefined => undefined);

/**
 * The gallery's loader (D09), as the directories' (D07): the style list and
 * places beside the page (optional; only a `style` waits for the list,
 * which drops a style it doesn't have, as the API would 422 it), then the
 * page itself. A cursor the API refuses sends the visitor to the same
 * filters' first page. A search the API rate-limits (429: server renders
 * share one anonymous budget until D11's key, and typing reads often) is
 * `busy`: the page keeps its search and filters and says so, with no
 * results and nothing cached as an answer. Any other failure, and a 429
 * without a search, is the route's error state.
 */
export async function loadGallery(
	context: LoaderContext,
	search: GallerySearch,
): Promise<{
	filters: GalleryFilters;
	labels: GalleryLabels;
	styleUnchecked: boolean;
	busy?: true;
}> {
	const { queryClient, discover } = context;
	const client = discover.client;
	const places = optional(
		queryClient.ensureQueryData(discoverQueries.locations(client)),
	);
	const styles = optional(
		queryClient.ensureQueryData(discoverQueries.styles(client)),
	);
	const checked = search.style ? await styles : undefined;
	const style = checked ? knownStyle(search.style, checked) : undefined;
	const styleUnchecked = Boolean(search.style) && !checked;
	const filters = resolveGallery(search, context.country.country, style);
	let page: Awaited<ReturnType<typeof client.tattoos.list>> | undefined;
	try {
		page = await queryClient.ensureQueryData(
			discoverQueries.tattoos(client, galleryQuery(filters)),
		);
	} catch (error) {
		if (filters.cursor && isTattooApiError(error) && error.status === 422)
			throw redirect({
				to: paths.tattoos(),
				search: { ...search, cursor: undefined } as never,
			});
		if (!(filters.q && isTattooApiError(error) && error.status === 429))
			rethrowUnavailable(error);
	}
	const [placeList, styleList] = await Promise.all([places, styles]);
	return {
		filters,
		styleUnchecked,
		labels: galleryLabels(
			filters,
			{ styles: styleList, places: placeList },
			page?.data ?? [],
		),
		...(page ? {} : { busy: true as const }),
	};
}

/** The places of the gallery's country (none without one: then there is no city filter). */
export function galleryPlaces(
	places: Parameters<typeof placesIn>[0],
	country: string | undefined,
) {
	return country ? placesIn(places, country) : [];
}

/**
 * The gallery's title and description, server-rendered. Any parameter makes
 * the page noindex (the root's `pageState`: search, filters, cursor,
 * `?country=`); the bare page may be indexed (INDEXABLE_PATHS, with
 * DISCOVER_INDEXING on), with its breadcrumbs as structured data.
 */
export function galleryHead(context: {
	matches: readonly HeadMatch[];
	match: {
		context: { discover: { settings: PublicSettings } };
		loaderData?: { filters: GalleryFilters; labels: GalleryLabels };
	};
}) {
	const data = context.match.loaderData;
	// No data: the error page, whose title the root gives.
	if (!data) return { meta: [] };
	const title = galleryTitle(data.filters, data.labels);
	return {
		meta: [
			...pageMeta({
				title,
				// Cut at a word when a long search makes it long.
				description: summary(
					`${title}: the newest work by listed tattoo studios and independent artists on Tattoo Drip. Open a piece to see who made it and request something similar.`,
				),
			}),
			...structuredData(context, [
				breadcrumbLd(
					context.match.context.discover.settings,
					crumbs.gallery(),
					paths.tattoos(),
				),
			]),
		],
	};
}
