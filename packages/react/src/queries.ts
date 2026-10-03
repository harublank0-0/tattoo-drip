import { queryOptions, skipToken } from "@tanstack/react-query";
import type {
	ListAvailabilityQuery,
	ListPortfolioQuery,
	ListServicesQuery,
	TattooClient,
} from "@tattoo-drip/sdk";

/**
 * Query keys. Every tenant-scoped key starts with the tenant slug so cached
 * data from one tenant can never be served for another.
 */
export const tattooKeys = {
	all: ["tattoo-drip"] as const,
	tenant: (tenant: string) => [...tattooKeys.all, "tenant", tenant] as const,
	studio: (tenant: string) => [...tattooKeys.tenant(tenant), "studio"] as const,
	artists: (tenant: string) =>
		[...tattooKeys.tenant(tenant), "artists"] as const,
	artist: (tenant: string, slug: string) =>
		[...tattooKeys.artists(tenant), slug] as const,
	services: (tenant: string, query?: ListServicesQuery) =>
		[...tattooKeys.tenant(tenant), "services", query ?? {}] as const,
	portfolio: (tenant: string, query?: ListPortfolioQuery) =>
		[...tattooKeys.tenant(tenant), "portfolio", query ?? {}] as const,
	availability: (tenant: string, query: ListAvailabilityQuery | null) =>
		[...tattooKeys.tenant(tenant), "availability", query] as const,
	styles: () => [...tattooKeys.all, "styles"] as const,
	placements: () => [...tattooKeys.all, "placements"] as const,
};

/**
 * Query options for each resource. Use them with `useQuery`, or with
 * `queryClient.ensureQueryData` in route loaders to prefetch during SSR.
 */
export const tattooQueries = {
	studio: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.studio(client.tenant),
			queryFn: () => client.studio.get(),
		}),
	artists: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.artists(client.tenant),
			queryFn: () => client.artists.list(),
		}),
	artist: (client: TattooClient, slug: string) =>
		queryOptions({
			queryKey: tattooKeys.artist(client.tenant, slug),
			queryFn: () => client.artists.get(slug),
		}),
	services: (client: TattooClient, query?: ListServicesQuery) =>
		queryOptions({
			queryKey: tattooKeys.services(client.tenant, query),
			queryFn: () => client.services.list(query),
		}),
	portfolio: (client: TattooClient, query?: ListPortfolioQuery) =>
		queryOptions({
			queryKey: tattooKeys.portfolio(client.tenant, query),
			queryFn: () => client.portfolio.list(query),
		}),
	availability: (client: TattooClient, query: ListAvailabilityQuery | null) =>
		queryOptions({
			queryKey: tattooKeys.availability(client.tenant, query),
			queryFn: query ? () => client.availability.list(query) : skipToken,
			staleTime: 30_000,
		}),
	styles: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.styles(),
			queryFn: () => client.styles.list(),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	placements: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.placements(),
			queryFn: () => client.placements.list(),
			staleTime: Number.POSITIVE_INFINITY,
		}),
};
