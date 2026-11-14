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
	type ListFlashQuery,
	type ListFreshInkQuery,
	type ListReviewsQuery,
	type ListServicesQuery,
	type ListWorkQuery,
	type SubmitDepositProofInput,
	type SubmitReviewInput,
	type TattooClient,
} from "@tattoo-drip/sdk";
import type {
	DepositPage,
	ReviewPage,
	ReviewVideoSignInput,
} from "@tattoo-drip/types";

/** The first wait between reads while a video is processing. */
export const REVIEW_PROCESSING_POLL_MS = 5000;

/**
 * How long the page keeps reading itself while a video processes: after
 * that it stops, and the page says to come back later.
 */
export const REVIEW_POLL_GIVE_UP_MS = 15 * 60_000;

/**
 * The wait before the next read, `elapsedMs` after the page first saw a
 * video processing: 5 s for the first half minute, then 10 s, 20 s from a
 * minute and a half, 60 s from five minutes, and none from fifteen. One
 * open page reads itself about 35 times in all, far below the review
 * page's limits.
 */
export function reviewPollDelay(elapsedMs: number): number | false {
	if (elapsedMs >= REVIEW_POLL_GIVE_UP_MS) return false;
	if (elapsedMs < 30_000) return 5_000;
	if (elapsedMs < 90_000) return 10_000;
	if (elapsedMs < 300_000) return 20_000;
	return 60_000;
}

/** A failed read's wait: Retry-After for a 429 (a minute without one), else the backoff's steps. */
export function reviewRetryDelay(attempt: number, error: unknown): number {
	if (isTattooApiError(error) && error.status === 429) {
		return (error.retryAfter ?? 60) * 1000;
	}
	return [5_000, 10_000, 20_000][attempt] ?? 60_000;
}

/** When each review query first saw a video processing (by the query, so a remount keeps it). */
const processingSince = new WeakMap<object, number>();

/**
 * The review query's refetch interval: none after a 4xx but a 429 (whose
 * Retry-After it waits), the backoff of reviewPollDelay while a video is
 * processing (a 5xx keeps the same backoff, never a fast retry), none once
 * nothing is processing or after REVIEW_POLL_GIVE_UP_MS.
 */
export function reviewRefetchInterval(
	query: { state: { data: ReviewPage | undefined; error: unknown } },
	now: number = Date.now(),
): number | false {
	const { error, data } = query.state;
	if (isTattooApiError(error) && error.status >= 400 && error.status < 500) {
		if (error.status !== 429 || !reviewProcessing(data)) return false;
		return (error.retryAfter ?? 60) * 1000;
	}
	if (!reviewProcessing(data)) {
		processingSince.delete(query);
		return false;
	}
	const since = processingSince.get(query) ?? now;
	processingSince.set(query, since);
	return reviewPollDelay(now - since);
}

/** How long the page has watched a video processing, in ms (0 when none is). */
export function reviewProcessingFor(
	query: object,
	now: number = Date.now(),
): number {
	const since = processingSince.get(query);
	return since === undefined ? 0 : now - since;
}

/** Whether the review page holds a video the API is still making. */
export function reviewProcessing(page: ReviewPage | undefined): boolean {
	return page?.post?.media.some((item) => item.state === "processing") ?? false;
}

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
	workPhotos: (tenant: string) =>
		[...tattooKeys.tenant(tenant), "work-photo"] as const,
	workPhoto: (tenant: string, id: string) =>
		[...tattooKeys.workPhotos(tenant), id] as const,
	flash: (tenant: string, query?: ListFlashQuery) =>
		[...tattooKeys.tenant(tenant), "flash", query ?? {}] as const,
	flashDesigns: (tenant: string) =>
		[...tattooKeys.tenant(tenant), "flash-design"] as const,
	flashDesign: (tenant: string, id: string) =>
		[...tattooKeys.flashDesigns(tenant), id] as const,
	studioReviews: (tenant: string, query?: ListReviewsQuery) =>
		[...tattooKeys.tenant(tenant), "studio-reviews", query ?? {}] as const,
	freshInk: (tenant: string, query?: ListFreshInkQuery) =>
		[...tattooKeys.tenant(tenant), "fresh-ink", query ?? {}] as const,
	availability: (tenant: string, query: ListAvailabilityQuery | null) =>
		[...tattooKeys.tenant(tenant), "availability", query] as const,
	deposit: (tenant: string, token: string) =>
		[...tattooKeys.tenant(tenant), "deposit", token] as const,
	review: (tenant: string, token: string) =>
		[...tattooKeys.tenant(tenant), "review", token] as const,
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
 * `studio`, `artists`, `artist`, `work`, `workPhoto`, `flash`, `flashDesign`, `studioReviews` and `freshInk` set no `staleTime` or `retry`: the app's defaults decide (TAT-44).
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
	workPhoto: (client: TattooClient, id: string) =>
		queryOptions({
			queryKey: tattooKeys.workPhoto(client.tenant, id),
			queryFn: ({ signal }) => client.work.get(id, { signal }),
		}),
	flash: (client: TattooClient, query?: ListFlashQuery) =>
		queryOptions({
			queryKey: tattooKeys.flash(client.tenant, query),
			queryFn: ({ signal }) => client.flash.list(query, { signal }),
		}),
	flashDesign: (client: TattooClient, id: string) =>
		queryOptions({
			queryKey: tattooKeys.flashDesign(client.tenant, id),
			queryFn: ({ signal }) => client.flash.get(id, { signal }),
		}),
	studioReviews: (client: TattooClient, query?: ListReviewsQuery) =>
		queryOptions({
			queryKey: tattooKeys.studioReviews(client.tenant, query),
			queryFn: ({ signal }) => client.studioReviews.list(query, { signal }),
		}),
	freshInk: (client: TattooClient, query?: ListFreshInkQuery) =>
		queryOptions({
			queryKey: tattooKeys.freshInk(client.tenant, query),
			queryFn: ({ signal }) => client.freshInk.list(query, { signal }),
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
	/**
	 * The client's review page by its link's token (Reviews and Fresh ink).
	 * Like the deposit page: always stale, a 4xx never retried (a 429 after
	 * its Retry-After). While a video is processing it reads itself again with
	 * a backoff (reviewRefetchInterval), and stops once none is, or after
	 * REVIEW_POLL_GIVE_UP_MS.
	 */
	review: (client: TattooClient, token: string) =>
		queryOptions({
			queryKey: tattooKeys.review(client.tenant, token),
			queryFn: ({ signal }) => client.reviews.get(token, { signal }),
			staleTime: 0,
			// A 4xx won't change by asking again: a 429 is shown at once (the
			// page says when to try again, and polling waits its Retry-After); a
			// 5xx or a network error is asked twice more, never fast.
			retry: (failures, error) =>
				failures < 2 &&
				!(isTattooApiError(error) && error.status >= 400 && error.status < 500),
			retryDelay: reviewRetryDelay,
			refetchInterval: (query) => reviewRefetchInterval(query),
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
	/**
	 * The review page's writes (Reviews and Fresh ink). Never retried (a
	 * submit's challenge token is single-use, an upload could land twice).
	 * Each answers with the page as it now is, which replaces the cached
	 * page; a read still in flight is cancelled first.
	 */
	submitReview: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		reviewWrite(client, queryClient, token, (input: SubmitReviewInput) =>
			client.reviews.submit(token, input),
		),
	deleteReview: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		// biome-ignore lint/suspicious/noConfusingVoidType: a delete takes no input, so `mutate()` needs no argument.
		reviewWrite(client, queryClient, token, (_: void) =>
			client.reviews.deleteReview(token),
		),
	deleteReviewPost: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		// biome-ignore lint/suspicious/noConfusingVoidType: a delete takes no input, so `mutate()` needs no argument.
		reviewWrite(client, queryClient, token, (_: void) =>
			client.reviews.deletePost(token),
		),
	addReviewPhoto: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		reviewWrite(client, queryClient, token, (photo: Blob) =>
			client.reviews.addPhoto(token, photo),
		),
	addReviewVideo: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		reviewWrite(client, queryClient, token, (upload: string) =>
			client.reviews.addVideo(token, upload),
		),
	removeReviewMedia: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		reviewWrite(client, queryClient, token, (mediaId: string) =>
			client.reviews.removeMedia(token, mediaId),
		),
	/** The post's order alone; the answer replaces the cached page. */
	reorderReviewPost: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) =>
		reviewWrite(client, queryClient, token, (order: string[]) =>
			client.reviews.reorder(token, order),
		),
	/** Where to upload a video; changes nothing cached. Never retried. */
	signReviewVideo: (client: TattooClient, token: string) =>
		mutationOptions({
			mutationFn: (input: ReviewVideoSignInput) =>
				client.reviews.signVideo(token, input),
			retry: false,
		}),
};

/** A review page write whose answer (the page) replaces the cached page. */
function reviewWrite<Input>(
	client: TattooClient,
	queryClient: QueryClient,
	token: string,
	write: (input: Input) => Promise<ReviewPage>,
) {
	return mutationOptions({
		mutationFn: write,
		retry: false,
		onSuccess: async (page: ReviewPage) => {
			const queryKey = tattooKeys.review(client.tenant, token);
			await queryClient.cancelQueries({ queryKey });
			queryClient.setQueryData(queryKey, page);
		},
	});
}
