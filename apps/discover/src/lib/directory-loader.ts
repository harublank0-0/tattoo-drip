import { useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { type DiscoverClient, isTattooApiError } from "@tattoo-drip/sdk";
import { rethrowUnavailable } from "./api-errors.ts";
import { crumbs } from "./breadcrumbs.ts";
import type { PublicSettings } from "./config.ts";
import type { DiscoverContext } from "./context.ts";
import { countryName, type ResolvedCountry } from "./country.ts";
import {
	type DirectoryFilters,
	type DirectoryKind,
	type DirectorySearch,
	directoryQuery,
	directoryWorkQuery,
	placeName,
	resolveDirectory,
	styleName,
} from "./directory.ts";
import { placesIn } from "./home.ts";
import { summary } from "./profiles.ts";
import { paths } from "./routes.ts";
import { knownStyle } from "./search.ts";
import { type HeadMatch, pageMeta } from "./seo.ts";
import { breadcrumbLd, structuredData } from "./structured-data.ts";

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
 * the page noindex (the root's `pageState`: filters, searches, sorts,
 * cursors, `?country=`); the bare page may be indexed (INDEXABLE_PATHS,
 * with DISCOVER_INDEXING on), with its breadcrumbs as structured data.
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
	context: {
		matches: readonly HeadMatch[];
		match: {
			context: { discover: { settings: PublicSettings } };
			loaderData?: {
				filters: DirectoryFilters;
				labels: { city?: string; style?: string };
			};
		};
	},
) {
	const data = context.match.loaderData;
	// No data: the error page, whose title the root gives.
	if (!data) return { meta: [] };
	const title = directoryTitle(kind, data.filters, data.labels);
	const settings = context.match.context.discover.settings;
	return {
		meta: [
			...pageMeta({
				title,
				// Cut at a word when a long search makes it long.
				description: summary(
					kind === "studios"
						? `${title}, listed on Tattoo Drip: their recent work and styles, with a link to each studio's own site to send a request.`
						: `${title}, at studios and independent, listed on Tattoo Drip with their recent work and styles.`,
				),
			}),
			...structuredData(context, [
				breadcrumbLd(
					settings,
					crumbs.directory(kind),
					kind === "studios" ? paths.studios() : paths.artists(),
				),
			]),
		],
	};
}
