import { queryOptions } from "@tanstack/react-query";
import type {
	DiscoverArtistsListQuery,
	DiscoverClient,
	DiscoverStudiosListQuery,
	DiscoverTattoosListQuery,
} from "@tattoo-drip/sdk";

/**
 * Discover's query keys (D03). All of them start with
 * `["tattoo-drip", "discover"]`, apart from every studio key
 * (`["tattoo-drip", "tenant", …]`) and the studio client's platform-wide
 * styles and placements, so Discover's cross-studio data and a studio's own
 * never share a cache entry. A list's key holds its whole query (filters,
 * sort, cursor), so each filter and page is its own entry. A list's and a
 * detail's segments differ (`studios` / `studio`), so no key is another's
 * prefix by accident.
 */
export const discoverKeys = {
	all: ["tattoo-drip", "discover"] as const,
	studios: (query?: DiscoverStudiosListQuery) =>
		[...discoverKeys.all, "studios", query ?? {}] as const,
	studio: (slug: string) => [...discoverKeys.all, "studio", slug] as const,
	studioArtists: (slug: string) =>
		[...discoverKeys.studio(slug), "artists"] as const,
	studioArtist: (studioSlug: string, artistSlug: string) =>
		[...discoverKeys.studio(studioSlug), "artist", artistSlug] as const,
	artists: (query?: DiscoverArtistsListQuery) =>
		[...discoverKeys.all, "artists", query ?? {}] as const,
	independentArtist: (slug: string) =>
		[...discoverKeys.all, "independent-artist", slug] as const,
	tattoos: (query?: DiscoverTattoosListQuery) =>
		[...discoverKeys.all, "tattoos", query ?? {}] as const,
	tattoo: (id: string) => [...discoverKeys.all, "tattoo", id] as const,
	styles: () => [...discoverKeys.all, "styles"] as const,
	locations: () => [...discoverKeys.all, "locations"] as const,
};

/**
 * Query options for Discover's reads, for `useQuery` or for prefetching in
 * route loaders (`queryClient.query({ ...options, staleTime: "static" })`).
 * Each forwards TanStack Query's `signal`. A list answers one page
 * (`{ data, nextCursor }`): pass `nextCursor` back as `cursor` for the next.
 * Styles never change at runtime (`staleTime: Infinity`); the rest leave
 * `staleTime` and `retry` to the app's defaults.
 */
export const discoverQueries = {
	studios: (client: DiscoverClient, query?: DiscoverStudiosListQuery) =>
		queryOptions({
			queryKey: discoverKeys.studios(query),
			queryFn: ({ signal }) => client.studios.list(query, { signal }),
		}),
	studio: (client: DiscoverClient, slug: string) =>
		queryOptions({
			queryKey: discoverKeys.studio(slug),
			queryFn: ({ signal }) => client.studios.get(slug, { signal }),
		}),
	studioArtists: (client: DiscoverClient, slug: string) =>
		queryOptions({
			queryKey: discoverKeys.studioArtists(slug),
			queryFn: ({ signal }) => client.studios.artists(slug, { signal }),
		}),
	studioArtist: (
		client: DiscoverClient,
		studioSlug: string,
		artistSlug: string,
	) =>
		queryOptions({
			queryKey: discoverKeys.studioArtist(studioSlug, artistSlug),
			queryFn: ({ signal }) =>
				client.studios.artist(studioSlug, artistSlug, { signal }),
		}),
	artists: (client: DiscoverClient, query?: DiscoverArtistsListQuery) =>
		queryOptions({
			queryKey: discoverKeys.artists(query),
			queryFn: ({ signal }) => client.artists.list(query, { signal }),
		}),
	independentArtist: (client: DiscoverClient, slug: string) =>
		queryOptions({
			queryKey: discoverKeys.independentArtist(slug),
			queryFn: ({ signal }) => client.artists.independent(slug, { signal }),
		}),
	tattoos: (client: DiscoverClient, query?: DiscoverTattoosListQuery) =>
		queryOptions({
			queryKey: discoverKeys.tattoos(query),
			queryFn: ({ signal }) => client.tattoos.list(query, { signal }),
		}),
	tattoo: (client: DiscoverClient, id: string) =>
		queryOptions({
			queryKey: discoverKeys.tattoo(id),
			queryFn: ({ signal }) => client.tattoos.get(id, { signal }),
		}),
	styles: (client: DiscoverClient) =>
		queryOptions({
			queryKey: discoverKeys.styles(),
			queryFn: ({ signal }) => client.styles.list({ signal }),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	locations: (client: DiscoverClient) =>
		queryOptions({
			queryKey: discoverKeys.locations(),
			queryFn: ({ signal }) => client.locations.list({ signal }),
		}),
};
