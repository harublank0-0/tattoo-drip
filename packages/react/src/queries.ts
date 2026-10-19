import {
	mutationOptions,
	queryOptions,
	skipToken,
} from "@tanstack/react-query";
import type {
	CreateInquiryInput,
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
 * Each forwards TanStack Query's `signal`, so a query nobody needs any more
 * cancels its request.
 */
export const tattooQueries = {
	studio: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.studio(client.tenant),
			queryFn: ({ signal }) => client.studio.get({ signal }),
		}),
	artists: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.artists(client.tenant),
			queryFn: ({ signal }) => client.artists.list({ signal }),
		}),
	artist: (client: TattooClient, slug: string) =>
		queryOptions({
			queryKey: tattooKeys.artist(client.tenant, slug),
			queryFn: ({ signal }) => client.artists.get(slug, { signal }),
		}),
	services: (client: TattooClient, query?: ListServicesQuery) =>
		queryOptions({
			queryKey: tattooKeys.services(client.tenant, query),
			queryFn: ({ signal }) => client.services.list(query, { signal }),
		}),
	portfolio: (client: TattooClient, query?: ListPortfolioQuery) =>
		queryOptions({
			queryKey: tattooKeys.portfolio(client.tenant, query),
			queryFn: ({ signal }) => client.portfolio.list(query, { signal }),
		}),
	availability: (client: TattooClient, query: ListAvailabilityQuery | null) =>
		queryOptions({
			queryKey: tattooKeys.availability(client.tenant, query),
			queryFn: query
				? ({ signal }) => client.availability.list(query, { signal })
				: skipToken,
			staleTime: 30_000,
		}),
	styles: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.styles(),
			queryFn: ({ signal }) => client.styles.list({ signal }),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	placements: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.placements(),
			queryFn: ({ signal }) => client.placements.list({ signal }),
			staleTime: Number.POSITIVE_INFINITY,
		}),
};

/**
 * Mutation options for each write. Use them with `useMutation`.
 * `createInquiry` never retries, whatever the app's `QueryClient` defaults
 * say: a retry after a timeout could send the inquiry (and its images) twice,
 * and each copy uses one of the phone's three open-inquiry slots.
 */
export const tattooMutations = {
	createInquiry: (client: TattooClient) =>
		mutationOptions({
			mutationFn: (input: CreateInquiryInput) => client.inquiries.create(input),
			retry: false,
		}),
};
