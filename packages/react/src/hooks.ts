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
