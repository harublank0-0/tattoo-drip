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
import { countryFromSlug, countryName } from "#/lib/country";
import { stylesIn } from "#/lib/directory";
import { placesIn } from "#/lib/home";
import { locationQueries } from "#/lib/hubs";
import { paths } from "#/lib/routes";
import { readCity } from "#/lib/search";
import { pageMeta } from "#/lib/seo";

const MIN_WORK = 3;

/**
 * `/locations/:country/:city` (D07): a city's page
 * (`/locations/nepal/kathmandu`). The country must be a configured market
 * and the city one of its places in `/locations` (the places at least one
 * listed business is in); anything else is the 404 page, never a guess.
 * Like the country page it lists its own country and city, whatever the
 * visitor's preference. Studios, artists, the styles they name (each a
 * link to the city's filtered directory) and recent work.
 */
export const Route = createFileRoute("/locations/$country/$city")({
	loader: async ({ context, params }) => {
		const { queryClient, discover } = context;
		const country = countryFromSlug(params.country, discover.settings.markets);
		const slug = readCity(params.city);
		if (!country || !slug) throw notFound();
		// The places confirm the city; a failed read is an error page, not a 404.
		const places = await queryClient
			.ensureQueryData(discoverQueries.locations(discover.client))
			.catch(rethrowUnavailable);
		const place = placesIn(places, country)?.find((each) => each.slug === slug);
		if (!place) throw notFound();
		const queries = locationQueries(discover.client, country, place.slug);
		const [studios, artists] = await Promise.all([
			queryClient.ensureQueryData(queries.studios),
			queryClient.ensureQueryData(queries.artists),
			queryClient
				.ensureQueryData(queries.tattoos)
				.catch((): undefined => undefined),
			queryClient
				.ensureQueryData(discoverQueries.styles(discover.client))
				.catch((): undefined => undefined),
		]).catch(rethrowUnavailable);
		return {
			country,
			place,
			empty: studios.data.length === 0 && artists.data.length === 0,
		};
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? pageMeta({
					title: `Tattoo studios and artists in ${loaderData.place.name}, ${countryName(loaderData.country)}`,
					description: `Tattoo studios and artists listed on Tattoo Drip in ${loaderData.place.name}, ${countryName(loaderData.country)}, with the styles they work in and their recent work.`,
					noindex: loaderData.empty,
				})
			: [],
	}),
	component: CityPage,
});

function CityPage() {
	const { discover } = Route.useRouteContext();
	const { country, place } = Route.useLoaderData();
	const queries = locationQueries(discover.client, country, place.slug);
	const studios = useSuspenseQuery(queries.studios).data.data;
	const artists = useSuspenseQuery(queries.artists).data.data;
	const tattoos = useQuery(queries.tattoos).data?.data ?? [];
	const styles = useQuery(discoverQueries.styles(discover.client)).data;
	const places =
		placesIn(
			useQuery(discoverQueries.locations(discover.client)).data,
			country,
		) ?? [];
	const name = countryName(country);
	const here = { country, city: place.slug };
	const studioStyles = new Set(
		studios.flatMap((each) => each.styles.map((style) => style.slug)),
	);
	const cityStyles = stylesIn(styles, [...studios, ...artists]);
	const nearby = places.filter((each) => each.slug !== place.slug);

	return (
		<>
			<PageHeader
				eyebrow={place.region ? `${place.region}, ${name}` : name}
				title={place.name}
				intro={`Tattoo studios and artists listed on Discover in ${place.name}, ${name}.`}
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: name, to: paths.location(country) },
					{ label: place.name },
				]}
			/>
			{studios.length === 0 && artists.length === 0 ? (
				<PageContainer className="py-12">
					<EmptyState
						title={`No studios or artists are listed in ${place.name} right now.`}
						action={
							<MoreLink to={paths.location(country)}>
								{`Everywhere in ${name}`}
							</MoreLink>
						}
					>
						They appear here once they choose to list on Discover.
					</EmptyState>
				</PageContainer>
			) : (
				<>
					{studios.length > 0 && (
						<HubSection
							id="city-studios-title"
							eyebrow="Studios"
							title={`Studios in ${place.name}`}
							intro="Recently listed first."
							more={
								<MoreLink to={paths.studios()} search={here}>
									{`All studios in ${place.name}`}
								</MoreLink>
							}
						>
							<StudioResults studios={studios} works={tattoos} />
						</HubSection>
					)}
					{artists.length > 0 && (
						<HubSection
							id="city-artists-title"
							tone="sunk"
							eyebrow="Artists"
							title={`Artists in ${place.name}`}
							intro="At listed studios and independent, recently added first."
							more={
								<MoreLink to={paths.artists()} search={here}>
									{`All artists in ${place.name}`}
								</MoreLink>
							}
						>
							<ArtistResults artists={artists} works={tattoos} />
						</HubSection>
					)}
					{cityStyles.length > 0 && (
						<HubSection
							id="city-styles-title"
							eyebrow="Styles"
							title={`Styles in ${place.name}`}
							intro="The styles these studios and artists name."
						>
							<LinkList
								label={`Styles in ${place.name}`}
								links={cityStyles.map((style) => ({
									key: style.slug,
									to: studioStyles.has(style.slug)
										? paths.studios()
										: paths.artists(),
									search: { ...here, style: style.slug },
									text: style.name,
								}))}
							/>
						</HubSection>
					)}
					{tattoos.length >= MIN_WORK && (
						<HubSection
							id="city-work-title"
							tone="night"
							eyebrow="Recent work"
							title={`Fresh from ${place.name}`}
						>
							<WorkColumns
								tattoos={tattoos}
								artists={artists}
								studios={studios}
							/>
						</HubSection>
					)}
				</>
			)}
			{nearby.length > 0 && (
				<HubSection
					id="city-nearby-title"
					eyebrow="Places"
					title={`Elsewhere in ${name}`}
				>
					<LinkList
						label={`Elsewhere in ${name}`}
						links={nearby.map((each) => ({
							key: each.slug,
							to: paths.city(country, each.slug),
							text: each.name,
							note: each.region,
						}))}
					/>
				</HubSection>
			)}
		</>
	);
}
