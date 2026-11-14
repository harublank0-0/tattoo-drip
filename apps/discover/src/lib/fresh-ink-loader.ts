import { redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { isTattooApiError } from "@tattoo-drip/sdk";
import { rethrowUnavailable } from "./api-errors.ts";
import { crumbs } from "./breadcrumbs.ts";
import type { PublicSettings } from "./config.ts";
import type { DiscoverContext } from "./context.ts";
import type { ResolvedCountry } from "./country.ts";
import {
	type FreshInkFilters,
	type FreshInkLabels,
	type FreshInkSearch,
	freshInkLabels,
	freshInkQuery,
	freshInkTitle,
	resolveFreshInk,
} from "./fresh-ink.ts";
import { summary } from "./profiles.ts";
import { paths } from "./routes.ts";
import { knownStyle } from "./search.ts";
import { type HeadMatch, pageMeta } from "./seo.ts";
import { breadcrumbLd, structuredData } from "./structured-data.ts";

type LoaderContext = DiscoverContext & { country: ResolvedCountry };

const optional = <T>(read: Promise<T>) =>
	read.catch((): undefined => undefined);

/**
 * The Fresh ink feed's loader (slice 4), as the gallery's (D09): the style
 * list and places beside the page (optional; only a `style` waits for the
 * list), then the page in the page's country. A cursor the API refuses
 * goes to the same filters' first page; any other failure is the route's
 * error state. An empty page (nothing posted, nothing matching, or reviews
 * switched off on the platform) says `noindex` (thin content).
 */
export async function loadFreshInk(
	context: LoaderContext,
	search: FreshInkSearch,
): Promise<{
	filters: FreshInkFilters;
	labels: FreshInkLabels;
	styleUnchecked: boolean;
	noindex?: true;
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
	const filters = resolveFreshInk(search, context.country.country, style);
	const page = await queryClient
		.ensureQueryData(discoverQueries.freshInk(client, freshInkQuery(filters)))
		.catch((error: unknown) => {
			if (filters.cursor && isTattooApiError(error) && error.status === 422)
				throw redirect({
					to: paths.freshInk(),
					search: { ...search, cursor: undefined } as never,
				});
			return rethrowUnavailable(error);
		});
	const [placeList, styleList] = await Promise.all([places, styles]);
	return {
		filters,
		styleUnchecked: Boolean(search.style) && !checked,
		labels: freshInkLabels(filters, { styles: styleList, places: placeList }),
		...(page.data.length === 0 ? { noindex: true as const } : {}),
	};
}

/**
 * The feed's title and description. Any parameter makes it noindex (the
 * root's `pageState`), and so does an empty page (its loader). Breadcrumbs
 * are its only structured data: never a rating or review (no aggregate
 * over many studios is a fact about any one of them).
 */
export function freshInkHead(context: {
	matches: readonly HeadMatch[];
	match: {
		context: { discover: { settings: PublicSettings } };
		loaderData?: { filters: FreshInkFilters; labels: FreshInkLabels };
	};
}) {
	const data = context.match.loaderData;
	if (!data) return { meta: [] };
	const title = freshInkTitle(data.filters, data.labels);
	return {
		meta: [
			...pageMeta({
				title,
				description: summary(
					`${title}: healed tattoos posted by clients of listed studios on Tattoo Drip, with the studio's approval. See who made each one and request a session.`,
				),
			}),
			...structuredData(context, [
				breadcrumbLd(
					context.match.context.discover.settings,
					crumbs.freshInk(),
					paths.freshInk(),
				),
			]),
		],
	};
}
