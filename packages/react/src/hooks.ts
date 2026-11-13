import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	ListAvailabilityQuery,
	ListFlashQuery,
	ListServicesQuery,
	ListWorkQuery,
} from "@tattoo-drip/sdk";
import { useTattooClient } from "./provider.js";
import { tattooMutations, tattooQueries } from "./queries.js";

export function useStudio() {
	return useQuery(tattooQueries.studio(useTattooClient()));
}

export function useArtists() {
	return useQuery(tattooQueries.artists(useTattooClient()));
}

export function useArtist(slug: string) {
	return useQuery(tattooQueries.artist(useTattooClient(), slug));
}

export function useServices(query?: ListServicesQuery) {
	return useQuery(tattooQueries.services(useTattooClient(), query));
}

/** A page of the studio's work photos (`client.work.list`). */
export function useWork(query?: ListWorkQuery) {
	return useQuery(tattooQueries.work(useTattooClient(), query));
}

/** One photo of the studio's work by id (`client.work.get`). */
export function useWorkPhoto(id: string) {
	return useQuery(tattooQueries.workPhoto(useTattooClient(), id));
}

/** A page of the studio's flash designs (`client.flash.list`). */
export function useFlash(query?: ListFlashQuery) {
	return useQuery(tattooQueries.flash(useTattooClient(), query));
}

/** One shown flash design by id (`client.flash.get`). */
export function useFlashDesign(id: string) {
	return useQuery(tattooQueries.flashDesign(useTattooClient(), id));
}

/** Pass `null` until both an artist and a service are chosen. */
export function useAvailability(query: ListAvailabilityQuery | null) {
	return useQuery(tattooQueries.availability(useTattooClient(), query));
}

export function useStyles() {
	return useQuery(tattooQueries.styles(useTattooClient()));
}

export function usePlacements() {
	return useQuery(tattooQueries.placements(useTattooClient()));
}

/**
 * Sends an inquiry with its reference images (`client.inquiries.create`).
 * Never retried, even if the app's `QueryClient` retries mutations by
 * default (`tattooMutations.createInquiry` sets `retry: false`): a retry
 * after a timeout could send it twice. Nothing cached changes, so nothing is
 * invalidated.
 */
export function useCreateInquiry() {
	return useMutation(tattooMutations.createInquiry(useTattooClient()));
}

/** A deposit page by its link's token (the fragment of the link the studio sent). */
export function useDeposit(token: string) {
	return useQuery(tattooQueries.deposit(useTattooClient(), token));
}

/**
 * Sends the payment screenshot (`client.deposits.submitProof`). Never
 * retried, like `useCreateInquiry`; on success `useDeposit(token)` shows the
 * answer (`submitted`).
 */
export function useSubmitDepositProof(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.submitDepositProof(client, queryClient, token),
	);
}

/** The client's review page by its link's token (the fragment of the link the studio sent). */
export function useReview(token: string) {
	return useQuery(tattooQueries.review(useTattooClient(), token));
}

/** Writes the review, the post or both (`client.reviews.submit`); the answer replaces `useReview(token)`'s page. Never retried. */
export function useSubmitReview(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(tattooMutations.submitReview(client, queryClient, token));
}

/** Deletes the client's review. */
export function useDeleteReview(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(tattooMutations.deleteReview(client, queryClient, token));
}

/** Deletes the client's Fresh ink post with its photos and videos. */
export function useDeleteReviewPost(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.deleteReviewPost(client, queryClient, token),
	);
}

/** Adds one photo to the post. */
export function useAddReviewPhoto(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.addReviewPhoto(client, queryClient, token),
	);
}

/** Adds an uploaded video (its upload token) to the post. */
export function useAddReviewVideo(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.addReviewVideo(client, queryClient, token),
	);
}

/** Removes one photo or video from the post. */
export function useRemoveReviewMedia(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.removeReviewMedia(client, queryClient, token),
	);
}

/** Where to upload a video (`client.reviews.signVideo`). */
export function useSignReviewVideo(token: string) {
	return useMutation(tattooMutations.signReviewVideo(useTattooClient(), token));
}
