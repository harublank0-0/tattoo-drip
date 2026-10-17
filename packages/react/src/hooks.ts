import { useMutation, useQuery } from "@tanstack/react-query";
import type {
	CreateInquiryInput,
	ListAvailabilityQuery,
	ListPortfolioQuery,
	ListServicesQuery,
} from "@tattoo-drip/sdk";
import { useTattooClient } from "./provider.js";
import { tattooQueries } from "./queries.js";

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

export function usePortfolio(query?: ListPortfolioQuery) {
	return useQuery(tattooQueries.portfolio(useTattooClient(), query));
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
 * Never retried: a retry after a timeout could send it twice. Nothing
 * cached changes, so nothing is invalidated.
 */
export function useCreateInquiry() {
	const client = useTattooClient();
	return useMutation({
		mutationFn: (input: CreateInquiryInput) => client.inquiries.create(input),
	});
}
