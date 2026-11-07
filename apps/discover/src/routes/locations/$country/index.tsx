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
import { placesIn } from "#/lib/home";
import { locationQueries } from "#/lib/hubs";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

const MIN_WORK = 3;

/**
 * `/locations/:country` (D07): a market's page (`/locations/nepal`). The
 * segment is the market's slug (`countrySlug`); a country that isn't a
 * configured market is the 404 page. Its own country, always: the
 * visitor's cookie, geolocation or `?country=` never change what it lists.
 * Its places (from `/locations`, optional) link to their city pages;
 * studios and artists are short previews linking on to the country's
 * directories.
 */
export const Route = createFileRoute("/locations/$country/")({
	loader: async ({ context, params }) => {
		const { queryClient, discover } = context;
		const country = countryFromSlug(params.country, discover.settings.markets);
		if (!country) throw notFound();
		const queries = locationQueries(discover.client, country);
		// Its places are optional: without `/locations` the page has no
		// Cities section (the city page needs them, to confirm its city).
		const [, studios, artists] = await Promise.all([
			queryClient
				.ensureQueryData(discoverQueries.locations(discover.client))
				.catch((): undefined => undefined),
			queryClient.ensureQueryData(queries.studios),
			queryClient.ensureQueryData(queries.artists),
			queryClient
				.ensureQueryData(queries.tattoos)
				.catch((): undefined => undefined),
		]).catch(rethrowUnavailable);
		return {
			country,
			empty: studios.data.length === 0 && artists.data.length === 0,
		};
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? pageMeta({
					title: `Tattoo studios and artists in ${countryName(loaderData.country)}`,
					description: `Tattoo studios and artists listed on Tattoo Drip in ${countryName(loaderData.country)}, by city, with their recent work.`,
					noindex: loaderData.empty,
				})
			: [],
	}),
	component: CountryPage,
});

function CountryPage() {
	const { discover } = Route.useRouteContext();
	const { country } = Route.useLoaderData();
	const queries = locationQueries(discover.client, country);
	const places =
		placesIn(
			useQuery(discoverQueries.locations(discover.client)).data,
			country,
		) ?? [];
	const studios = useSuspenseQuery(queries.studios).data.data;
	const artists = useSuspenseQuery(queries.artists).data.data;
	const tattoos = useQuery(queries.tattoos).data?.data ?? [];
	const name = countryName(country);
	const others = discover.settings.markets.filter((code) => code !== country);
	const inCountry = { country };

	return (
		<>
			<PageHeader
				eyebrow="Location"
				title={name}
				intro={`Tattoo studios and artists listed on Discover in ${name}, by city.`}
				breadcrumbs={[{ label: "Discover", to: paths.home() }, { label: name }]}
			/>
			{studios.length === 0 && artists.length === 0 ? (
				<PageContainer className="py-12">
					<EmptyState
						title={`No studios or artists are listed in ${name} yet.`}
						action={
							others.length > 0 ? (
								<div className="flex flex-col gap-1">
									{others.map((code) => (
										<MoreLink key={code} to={paths.location(code)}>
											{`Studios and artists in ${countryName(code)}`}
										</MoreLink>
									))}
								</div>
							) : undefined
						}
					>
						They appear here once they choose to list on Discover.
					</EmptyState>
				</PageContainer>
			) : (
				<>
					{places.length > 0 && (
						<HubSection
							id="country-places-title"
							eyebrow="Places"
							title={`Cities in ${name}`}
							intro="Where listed studios and artists are."
						>
							<LinkList
								label={`Cities in ${name}`}
								links={places.map((place) => ({
									key: place.slug,
									to: paths.city(country, place.slug),
									text: place.name,
									note: place.region,
								}))}
							/>
						</HubSection>
					)}
					{studios.length > 0 && (
						<HubSection
							id="country-studios-title"
							tone="sunk"
							eyebrow="Studios"
							title={`Recently listed studios in ${name}`}
							more={
								<MoreLink to={paths.studios()} search={inCountry}>
									{`All studios in ${name}`}
								</MoreLink>
							}
						>
							<StudioResults studios={studios} works={tattoos} />
						</HubSection>
					)}
					{artists.length > 0 && (
						<HubSection
							id="country-artists-title"
							eyebrow="Artists"
							title={`Recently added artists in ${name}`}
							more={
								<MoreLink to={paths.artists()} search={inCountry}>
									{`All artists in ${name}`}
								</MoreLink>
							}
						>
							<ArtistResults artists={artists} works={tattoos} />
						</HubSection>
					)}
					{tattoos.length >= MIN_WORK && (
						<HubSection
							id="country-work-title"
							tone="night"
							eyebrow="Recent work"
							title={`Fresh from ${name}`}
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
		</>
	);
}
