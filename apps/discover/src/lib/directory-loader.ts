import { useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { type DiscoverClient, isTattooApiError } from "@tattoo-drip/sdk";
import { rethrowUnavailable } from "./api-errors.ts";
import type { DiscoverContext } from "./context.ts";
import { countryName, type ResolvedCountry } from "./country.ts";
import {
	type DirectoryFilters,
	type DirectoryKind,
	type DirectorySearch,
	directoryQuery,
	directoryWorkQuery,
	hasSearchParams,
	placeName,
	resolveDirectory,
	styleName,
} from "./directory.ts";
import { placesIn } from "./home.ts";
import { paths } from "./routes.ts";
import { knownStyle } from "./search.ts";
import { pageMeta } from "./seo.ts";

type LoaderContext = DiscoverContext & { country: ResolvedCountry };

/** A read the page can do without: its failure is undefined, never an error page. */
const optional = <T>(read: Promise<T>) =>
	read.catch((): undefined => undefined);

/** The list query of a directory. */
export function directoryList(
	client: DiscoverClient,
	filters: DirectoryFilters,
	kind: DirectoryKind,
) {
	return kind === "studios"
		? discoverQueries.studios(client, directoryQuery(filters, kind))
		: discoverQueries.artists(client, directoryQuery(filters, kind));
}

/**
 * A directory's loader (D07). Reads the places and the style list beside
 * the page; only a `style` makes the page wait for the list, which drops a
 * style it doesn't have (the API answers an unknown one with a 422; a style
 * that can't be checked is dropped too, and `styleUnchecked` says so). The
 * page's recent photos (same country, city and style) are optional. A cursor the API refuses (a 422:
 * from another sort, edited by hand) sends the visitor to the first page
 * of the same filters; any other failure is the route's error state.
 * Returns the filters it read with (the component reads the same
 * queries) and the names the head uses.
 */
export async function loadDirectory(
	kind: DirectoryKind,
	context: LoaderContext,
	search: DirectorySearch,
) {
	const { queryClient, discover } = context;
	const client = discover.client;
	const places = optional(
		queryClient.ensureQueryData(discoverQueries.locations(client)),
	);
	const styles = optional(
		queryClient.ensureQueryData(discoverQueries.styles(client)),
	);
	// A style that can't be checked (no list) is dropped too, or the API
	// could answer a 422; the page says so (`styleUnchecked`).
	const checked = search.style ? await styles : undefined;
	const style = checked ? knownStyle(search.style, checked) : undefined;
	const styleUnchecked = Boolean(search.style) && !checked;
	// The address's country, else the visitor's: never no country.
	const filters = resolveDirectory(search, context.country.country, style);
	const works = optional(
		queryClient.ensureQueryData(
			discoverQueries.tattoos(client, directoryWorkQuery(filters)),
		),
	);
	try {
		await queryClient.ensureQueryData(
			directoryList(client, filters, kind) as ReturnType<
				typeof discoverQueries.studios
			>,
		);
	} catch (error) {
		if (filters.cursor && isTattooApiError(error) && error.status === 422)
			throw redirect({
				to: kind === "studios" ? paths.studios() : paths.artists(),
				search: { ...search, cursor: undefined } as never,
			});
		rethrowUnavailable(error);
	}
	const [placeList, styleList] = await Promise.all([places, styles, works]);
	return {
		filters,
		styleUnchecked,
		labels: {
			city: filters.city
				? placeName(placeList, filters.country, filters.city)
				: undefined,
			style: filters.style ? styleName(styleList, filters.style) : undefined,
		},
	};
}

/** The style list and the page's country's places, for the filters and chips. */
export function usePageLists(client: DiscoverClient, country: string) {
	return {
		styles: useQuery(discoverQueries.styles(client)).data,
		places: placesIn(useQuery(discoverQueries.locations(client)).data, country),
	};
}

/**
 * A directory's title and description, rendered on the server: what the
 * page lists ("Blackwork tattoo studios in Kathmandu"). Any parameter makes
 * the page noindex (filters, searches, sorts, cursors, `?country=`); the
 * bare page may be indexed (INDEXABLE_PATHS, with DISCOVER_INDEXING on).
 */
export function directoryTitle(
	kind: DirectoryKind,
	filters: DirectoryFilters,
	labels: { city?: string; style?: string },
): string {
	const noun = kind === "studios" ? "studios" : "artists";
	if (filters.q)
		return `${kind === "studios" ? "Studios" : "Artists"} matching "${filters.q}"`;
	const where = labels.city ?? countryName(filters.country);
	return labels.style
		? `${labels.style} tattoo ${noun} in ${where}`
		: `Tattoo ${noun} in ${where}`;
}

export function directoryHead(
	kind: DirectoryKind,
	match: {
		search: DirectorySearch;
		loaderData?: {
			filters: DirectoryFilters;
			labels: { city?: string; style?: string };
		};
	},
) {
	const data = match.loaderData;
	const title = data
		? directoryTitle(kind, data.filters, data.labels)
		: kind === "studios"
			? "Explore studios"
			: "Find artists";
	return {
		meta: pageMeta({
			title,
			description:
				kind === "studios"
					? `${title}, listed on Tattoo Drip: their recent work and styles, with a link to each studio's own site to send a request.`
					: `${title}, at studios and independent, listed on Tattoo Drip with their recent work and styles.`,
			noindex: hasSearchParams(match.search),
		}),
	};
}
