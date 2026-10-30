import {
	mutationOptions,
	type QueryClient,
	queryOptions,
	skipToken,
} from "@tanstack/react-query";
import {
	type CreateInquiryInput,
	isTattooApiError,
	type ListAvailabilityQuery,
	type ListServicesQuery,
	type ListWorkQuery,
	type SubmitDepositProofInput,
	type TattooClient,
} from "@tattoo-drip/sdk";
import type { DepositPage } from "@tattoo-drip/types";

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
	work: (tenant: string, query?: ListWorkQuery) =>
		[...tattooKeys.tenant(tenant), "work", query ?? {}] as const,
	availability: (tenant: string, query: ListAvailabilityQuery | null) =>
		[...tattooKeys.tenant(tenant), "availability", query] as const,
	deposit: (tenant: string, token: string) =>
		[...tattooKeys.tenant(tenant), "deposit", token] as const,
	styles: () => [...tattooKeys.all, "styles"] as const,
	placements: () => [...tattooKeys.all, "placements"] as const,
};

/**
 * Query options for each resource. Use them with `useQuery`, or in route
 * loaders to prefetch during SSR with
 * `queryClient.query({ ...options, staleTime: "static" })` (cached data, else
 * one fetch: TanStack Query 5.104's replacement for `ensureQueryData`).
 * Each forwards TanStack Query's `signal`, so a query nobody needs any more
 * cancels its request.
 * `studio`, `artists`, `artist` and `work` set no `staleTime` or `retry`: the app's defaults decide (TAT-44).
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
	work: (client: TattooClient, query?: ListWorkQuery) =>
		queryOptions({
			queryKey: tattooKeys.work(client.tenant, query),
			queryFn: ({ signal }) => client.work.list(query, { signal }),
		}),
	availability: (client: TattooClient, query: ListAvailabilityQuery | null) =>
		queryOptions({
			queryKey: tattooKeys.availability(client.tenant, query),
			queryFn: query
				? ({ signal }) => client.availability.list(query, { signal })
				: skipToken,
			staleTime: 30_000,
		}),
	/**
	 * A deposit page by its link's token. A 4xx (a link that doesn't work,
	 * a rate limit) won't change by asking again at once, so only network
	 * errors and 5xx are retried. Always stale (`staleTime: 0`, whatever the
	 * app's default), so it is refetched when the window regains focus:
	 * coming back from the payment app shows the latest state.
	 */
	deposit: (client: TattooClient, token: string) =>
		queryOptions({
			queryKey: tattooKeys.deposit(client.tenant, token),
			queryFn: ({ signal }) => client.deposits.get(token, { signal }),
			staleTime: 0,
			retry: (failures, error) =>
				!(
					isTattooApiError(error) &&
					error.status >= 400 &&
					error.status < 500
				) && failures < 3,
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
 * and each copy uses one of the phone's three open-inquiry slots; and its
 * bot-challenge token is single-use, so a retry would send a spent one.
 */
export const tattooMutations = {
	createInquiry: (client: TattooClient) =>
		mutationOptions({
			mutationFn: (input: CreateInquiryInput) => client.inquiries.create(input),
			retry: false,
		}),
	/**
	 * Sends a deposit proof. Never retried: a retry after a timeout could
	 * send it twice (the API answers a second one with `deposit_not_due`).
	 * The answer, the page in `submitted`, replaces the cached deposit page.
	 * A read still in flight is cancelled first: it was asked before the
	 * upload landed and would otherwise answer `due` over the top of it.
	 */
	submitDepositProof: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		mutationOptions({
			mutationFn: (input: SubmitDepositProofInput) =>
				client.deposits.submitProof(token, input),
			retry: false,
			onSuccess: async (page: DepositPage) => {
				const queryKey = tattooKeys.deposit(client.tenant, token);
				await queryClient.cancelQueries({ queryKey });
				queryClient.setQueryData(queryKey, page);
			},
		}),
};
