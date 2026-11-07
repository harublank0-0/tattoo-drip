import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import {
	HubSection,
	LinkList,
	MoreLink,
	WorkColumns,
} from "#/components/directory/hub";
import { ArtistResults, StudioResults } from "#/components/directory/results";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { rethrowUnavailable } from "#/lib/api-errors";
import { countryName } from "#/lib/country";
import { HUB_LIMITS, styleQueries } from "#/lib/hubs";
import { paths } from "#/lib/routes";
import { readStyle } from "#/lib/search";
import { pageMeta } from "#/lib/seo";

/** Photos needed before the page leads with a work grid. */
const MIN_WORK = 3;

/**
 * `/styles/:slug` (D07): one style from the platform's list (`/styles`; an
 * unknown slug is the 404 page), with its studios, artists and recent work
 * in the page's country (D06.5: `?country=`, else the visitor's), each a
 * short newest-first preview linking on to the filtered directories. The
 * intro is generic: the API has no style descriptions, so none is made up.
 */
export const Route = createFileRoute("/styles/$slug")({
	loaderDeps: ({ search }) => ({ country: search.country }),
	loader: async ({ context, params }) => {
		const { queryClient, discover } = context;
		const slug = readStyle(params.slug);
		if (!slug) throw notFound();
		const styles = await queryClient
			.ensureQueryData(discoverQueries.styles(discover.client))
			.catch(rethrowUnavailable);
		const style = styles.find((each) => each.slug === slug);
		if (!style) throw notFound();
		const { country, source } = context.country;
		const queries = styleQueries(discover.client, style.slug, country);
		const [studios, artists] = await Promise.all([
			queryClient.ensureQueryData(queries.studios),
			queryClient.ensureQueryData(queries.artists),
			queryClient
				.ensureQueryData(queries.tattoos)
				.catch((): undefined => undefined),
		]).catch(rethrowUnavailable);
		return {
			style,
			country,
			// An explicit `?country=` travels on in this page's links.
			explicit: source === "url" ? country : undefined,
			empty: studios.data.length === 0 && artists.data.length === 0,
		};
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? pageMeta({
					title: `${loaderData.style.name} tattoo studios and artists in ${countryName(loaderData.country)}`,
					description: `${loaderData.style.name} tattoo studios and artists listed on Tattoo Drip in ${countryName(loaderData.country)}, with recent ${loaderData.style.name.toLowerCase()} work they have published.`,
					// Nothing listed: not a page worth indexing yet.
					noindex: loaderData.empty,
				})
			: [],
	}),
	component: StylePage,
});

function StylePage() {
	const { discover } = Route.useRouteContext();
	const { style, country, explicit } = Route.useLoaderData();
	const queries = styleQueries(discover.client, style.slug, country);
	const studios = useSuspenseQuery(queries.studios).data;
	const artists = useSuspenseQuery(queries.artists).data;
	const tattoos = useQuery(queries.tattoos).data?.data ?? [];
	const styles = useQuery(discoverQueries.styles(discover.client)).data ?? [];
	const where = countryName(country);
	const filter = { style: style.slug, country: explicit };
	const others = styles.filter((each) => each.slug !== style.slug);
	const empty = studios.data.length === 0 && artists.data.length === 0;

	return (
		<>
			<PageHeader
				eyebrow="Tattoo style"
				title={style.name}
				intro={`Studios and artists in ${where} who work in ${style.name.toLowerCase()}, and recent work they have tagged with it on Discover.`}
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: style.name },
				]}
			/>
			{empty ? (
				<PageContainer className="py-12">
					<EmptyState
						title={`Nothing is listed under ${style.name} in ${where} yet.`}
						action={
							<MoreLink to={paths.studios()} search={{ country: explicit }}>
								{`All studios in ${where}`}
							</MoreLink>
						}
					>
						Studios and artists appear here once they list on Discover and name
						this style. Try another style below.
					</EmptyState>
				</PageContainer>
			) : (
				<>
					{tattoos.length >= MIN_WORK && (
						<HubSection
							id="style-work-title"
							tone="night"
							eyebrow="Recent work"
							title={`${style.name} from the studios`}
							more={
								<MoreLink to={paths.tattoos()}>Tattoo inspiration</MoreLink>
							}
						>
							<WorkColumns
								tattoos={tattoos}
								artists={artists.data}
								studios={studios.data}
							/>
						</HubSection>
					)}
					{studios.data.length > 0 && (
						<HubSection
							id="style-studios-title"
							eyebrow="Studios"
							title={`${style.name} studios in ${where}`}
							intro="Recently listed first."
							more={
								<MoreLink to={paths.studios()} search={filter}>
									{`Browse all ${style.name} studios`}
								</MoreLink>
							}
						>
							<StudioResults studios={studios.data} works={tattoos} />
						</HubSection>
					)}
					{artists.data.length > 0 && (
						<HubSection
							id="style-artists-title"
							tone="sunk"
							eyebrow="Artists"
							title={`${style.name} artists in ${where}`}
							intro="At listed studios and independent, recently added first."
							more={
								<MoreLink to={paths.artists()} search={filter}>
									{`Browse all ${style.name} artists`}
								</MoreLink>
							}
						>
							<ArtistResults
								artists={artists.data.slice(0, HUB_LIMITS.artists)}
								works={tattoos}
							/>
						</HubSection>
					)}
				</>
			)}
			{others.length > 0 && (
				<HubSection
					id="other-styles-title"
					eyebrow="Browse by style"
					title="Other styles"
				>
					<LinkList
						label="Other styles"
						links={others.map((each) => ({
							key: each.slug,
							to: paths.style(each.slug),
							search: { country: explicit },
							text: each.name,
						}))}
					/>
				</HubSection>
			)}
		</>
	);
}
