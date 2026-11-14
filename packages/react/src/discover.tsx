import { useQuery } from "@tanstack/react-query";
import type {
	DiscoverArtistsListQuery,
	DiscoverClient,
	DiscoverFreshInkQuery,
	DiscoverProfilePageQuery,
	DiscoverStudiosListQuery,
	DiscoverTattoosListQuery,
} from "@tattoo-drip/sdk";
import { createContext, type ReactNode, useContext } from "react";
import { discoverQueries } from "./discover_queries.js";

const DiscoverClientContext = createContext<DiscoverClient | null>(null);

export interface DiscoverProviderProps {
	client: DiscoverClient;
	children: ReactNode;
}

/**
 * Makes a Discover client (`createDiscoverClient`) available to the
 * `useDiscover*` hooks. Separate from `<TattooProvider>`, which holds one
 * studio's client; render it inside the app's `QueryClientProvider`.
 */
export function DiscoverProvider({ client, children }: DiscoverProviderProps) {
	return (
		<DiscoverClientContext.Provider value={client}>
			{children}
		</DiscoverClientContext.Provider>
	);
}

export function useDiscoverClient(): DiscoverClient {
	const client = useContext(DiscoverClientContext);
	if (!client) {
		throw new Error(
			"useDiscoverClient must be used inside <DiscoverProvider>.",
		);
	}
	return client;
}

/** A page of listed studios (`client.studios.list`). */
export function useDiscoverStudios(query?: DiscoverStudiosListQuery) {
	return useQuery(discoverQueries.studios(useDiscoverClient(), query));
}

/** One listed studio by slug (`client.studios.get`). */
export function useDiscoverStudio(slug: string) {
	return useQuery(discoverQueries.studio(useDiscoverClient(), slug));
}

/** A listed studio's artists (`client.studios.artists`). */
export function useDiscoverStudioArtists(slug: string) {
	return useQuery(discoverQueries.studioArtists(useDiscoverClient(), slug));
}

/** One artist at a listed studio (`client.studios.artist`). */
export function useDiscoverStudioArtist(
	studioSlug: string,
	artistSlug: string,
) {
	return useQuery(
		discoverQueries.studioArtist(useDiscoverClient(), studioSlug, artistSlug),
	);
}

/** A page of shown artists (`client.artists.list`). */
export function useDiscoverArtists(query?: DiscoverArtistsListQuery) {
	return useQuery(discoverQueries.artists(useDiscoverClient(), query));
}

/** One listed independent artist by their business's slug (`client.artists.independent`). */
export function useDiscoverIndependentArtist(slug: string) {
	return useQuery(discoverQueries.independentArtist(useDiscoverClient(), slug));
}

/** A page of published tattoo photos, newest first (`client.tattoos.list`). */
export function useDiscoverTattoos(query?: DiscoverTattoosListQuery) {
	return useQuery(discoverQueries.tattoos(useDiscoverClient(), query));
}

/** One published photo by id (`client.tattoos.get`). */
export function useDiscoverTattoo(id: string) {
	return useQuery(discoverQueries.tattoo(useDiscoverClient(), id));
}

export function useDiscoverStyles() {
	return useQuery(discoverQueries.styles(useDiscoverClient()));
}

export function useDiscoverLocations() {
	return useQuery(discoverQueries.locations(useDiscoverClient()));
}

/** A page of a listed studio's reviews on Discover, with its rating from 3 (`client.studios.reviews`). */
export function useDiscoverStudioReviews(
	slug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.studioReviews(useDiscoverClient(), slug, query),
	);
}

/** A page of a listed studio's Fresh ink (`client.studios.freshInk`). */
export function useDiscoverStudioFreshInk(
	slug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.studioFreshInk(useDiscoverClient(), slug, query),
	);
}

/** A page of an artist's reviews at a listed studio (`client.studios.artistReviews`). */
export function useDiscoverStudioArtistReviews(
	studioSlug: string,
	artistSlug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.studioArtistReviews(
			useDiscoverClient(),
			studioSlug,
			artistSlug,
			query,
		),
	);
}

/** A page of an artist's Fresh ink at a listed studio (`client.studios.artistFreshInk`). */
export function useDiscoverStudioArtistFreshInk(
	studioSlug: string,
	artistSlug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.studioArtistFreshInk(
			useDiscoverClient(),
			studioSlug,
			artistSlug,
			query,
		),
	);
}

/** A page of a listed independent artist's reviews (`client.artists.independentReviews`). */
export function useDiscoverIndependentArtistReviews(
	slug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.independentArtistReviews(useDiscoverClient(), slug, query),
	);
}

/** A page of a listed independent artist's Fresh ink (`client.artists.independentFreshInk`). */
export function useDiscoverIndependentArtistFreshInk(
	slug: string,
	query?: DiscoverProfilePageQuery,
) {
	return useQuery(
		discoverQueries.independentArtistFreshInk(useDiscoverClient(), slug, query),
	);
}

/** A page of Discover's Fresh ink feed (`client.freshInk.list`). */
export function useDiscoverFreshInk(query?: DiscoverFreshInkQuery) {
	return useQuery(discoverQueries.freshInk(useDiscoverClient(), query));
}
