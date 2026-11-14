import type {
	DiscoverArtistDetail,
	DiscoverArtistSummary,
	DiscoverArtistsPage,
	DiscoverArtistsQuery,
	DiscoverFreshInkPage,
	DiscoverFreshInkQuery,
	DiscoverLocation,
	DiscoverProfilePageQuery,
	DiscoverReviewsPage,
	DiscoverSitemapArtist,
	DiscoverSitemapPage,
	DiscoverSitemapQuery,
	DiscoverSitemapStudio,
	DiscoverSitemapTattoo,
	DiscoverStudioDetail,
	DiscoverStudiosPage,
	DiscoverStudiosQuery,
	DiscoverStyle,
	DiscoverTattooDetail,
	DiscoverTattoosPage,
	DiscoverTattoosQuery,
} from "@tattoo-drip/types";
import {
	createTransport,
	type RequestOptions,
	type TransportOptions,
	withQuery,
} from "./transport.js";

/**
 * Options of the Discover client (Discover D03): the API's origin and, on a
 * server, its key. There is no tenant: Discover reads every listed studio,
 * under no studio and with no session.
 */
export interface DiscoverClientOptions extends TransportOptions {
	/** API origin, e.g. `https://api.example.com`. The client appends `/api/v1/discover`. */
	baseUrl: string;
	/**
	 * Secret server key, server-side only, for rate limiting; grants no extra
	 * data access. Rejected in browsers.
	 */
	key?: string;
	/** Custom fetch for tests, edge runtimes or request forwarding. */
	fetch?: typeof fetch;
	/** Milliseconds before a call gives up with a `timeout` TattooApiError. Defaults to 10 000. */
	timeoutMs?: number;
}

/**
 * The studio and artist lists' query, with `query` for the API's `q` (the
 * name search). Every other parameter is the API's own.
 */
export type DiscoverStudiosListQuery = Omit<DiscoverStudiosQuery, "q"> & {
	query?: string;
};
export type DiscoverArtistsListQuery = Omit<DiscoverArtistsQuery, "q"> & {
	query?: string;
};
/**
 * The tattoo photos' query (D09: `query` searches alt text and the artist's,
 * studio's and style's names, as the API's `q`).
 */
export type DiscoverTattoosListQuery = Omit<DiscoverTattoosQuery, "q"> & {
	query?: string;
};

export type DiscoverClient = ReturnType<typeof createDiscoverClient>;

/** `query` travels as the API's `q` (studios, artists and, since D09, tattoos). */
function searchQuery<T extends { query?: string }>(input?: T) {
	if (!input) return undefined;
	const { query, ...rest } = input;
	return { ...rest, q: query };
}

/**
 * Discover's public API (`/api/v1/discover`): listed studios, their artists,
 * independent artists, tattoo photos, styles and places, and (Reviews and
 * Fresh ink) profiles' reviews and Fresh ink and the Fresh ink feed. The same transport
 * as the studio client (no cookies, a timeout, `{ signal }` to cancel,
 * TattooApiError), and no studio of its own.
 *
 * Lists answer `{ data, nextCursor }`: pass `nextCursor` back as `cursor`,
 * with the same filters and sort, for the next page. Anything Discover does
 * not show is a 404 TattooApiError (`not_found`); a malformed filter, sort
 * or cursor is a 422 (`validation_failed`).
 */
export function createDiscoverClient(options: DiscoverClientOptions) {
	const { apiRoot, request, getData } = createTransport(options);
	const root = `${apiRoot}/discover`;
	const segment = encodeURIComponent;

	return {
		studios: {
			/** A page of listed studios (`newest` first unless `sort` says otherwise). */
			list: (query?: DiscoverStudiosListQuery, call?: RequestOptions) =>
				request<DiscoverStudiosPage>(
					withQuery(`${root}/studios`, searchQuery(query)),
					{},
					call,
				),
			/** One listed studio by its current or an old slug, with its artists and newest photos. */
			get: (slug: string, call?: RequestOptions) =>
				getData<DiscoverStudioDetail>(`${root}/studios/${segment(slug)}`, call),
			/** A listed studio's artists by name. */
			artists: (slug: string, call?: RequestOptions) =>
				getData<DiscoverArtistSummary[]>(
					`${root}/studios/${segment(slug)}/artists`,
					call,
				),
			/** One artist at a listed studio (an artist's slug is unique per studio only). */
			artist: (studioSlug: string, artistSlug: string, call?: RequestOptions) =>
				getData<DiscoverArtistDetail>(
					`${root}/studios/${segment(studioSlug)}/artists/${segment(artistSlug)}`,
					call,
				),
			/**
			 * A page of a listed studio's reviews on Discover, newest first
			 * (Reviews and Fresh ink): `{ data, nextCursor, rating }`, `rating`
			 * null below 3 reviews. Empty while reviews are off on the platform.
			 */
			reviews: (
				slug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverReviewsPage>(
					withQuery(`${root}/studios/${segment(slug)}/reviews`, query),
					{},
					call,
				),
			/** A page of a listed studio's Fresh ink on Discover, newest published first. */
			freshInk: (
				slug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverFreshInkPage>(
					withQuery(`${root}/studios/${segment(slug)}/fresh-ink`, query),
					{},
					call,
				),
			/** A page of an artist's reviews at a listed studio (the artist's own rating). */
			artistReviews: (
				studioSlug: string,
				artistSlug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverReviewsPage>(
					withQuery(
						`${root}/studios/${segment(studioSlug)}/artists/${segment(artistSlug)}/reviews`,
						query,
					),
					{},
					call,
				),
			/** A page of an artist's Fresh ink at a listed studio. */
			artistFreshInk: (
				studioSlug: string,
				artistSlug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverFreshInkPage>(
					withQuery(
						`${root}/studios/${segment(studioSlug)}/artists/${segment(artistSlug)}/fresh-ink`,
						query,
					),
					{},
					call,
				),
		},
		artists: {
			/** A page of shown artists, studios' and independent ones. */
			list: (query?: DiscoverArtistsListQuery, call?: RequestOptions) =>
				request<DiscoverArtistsPage>(
					withQuery(`${root}/artists`, searchQuery(query)),
					{},
					call,
				),
			/** One listed independent artist, by their business's slug. */
			independent: (slug: string, call?: RequestOptions) =>
				getData<DiscoverArtistDetail>(`${root}/artists/${segment(slug)}`, call),
			/** A page of a listed independent artist's reviews, by their business's slug. */
			independentReviews: (
				slug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverReviewsPage>(
					withQuery(`${root}/artists/${segment(slug)}/reviews`, query),
					{},
					call,
				),
			/** A page of a listed independent artist's Fresh ink, by their business's slug. */
			independentFreshInk: (
				slug: string,
				query?: DiscoverProfilePageQuery,
				call?: RequestOptions,
			) =>
				request<DiscoverFreshInkPage>(
					withQuery(`${root}/artists/${segment(slug)}/fresh-ink`, query),
					{},
					call,
				),
		},
		freshInk: {
			/**
			 * A page of Discover's Fresh ink feed (clients' healed tattoos),
			 * newest published first, filtered by `country`, `city` and
			 * `style`. Empty while reviews are off on the platform.
			 */
			list: (query?: DiscoverFreshInkQuery, call?: RequestOptions) =>
				request<DiscoverFreshInkPage>(
					withQuery(`${root}/fresh-ink`, query),
					{},
					call,
				),
		},
		tattoos: {
			/** A page of published tattoo photos, newest first (`query`: the gallery's search, D09). */
			list: (query?: DiscoverTattoosListQuery, call?: RequestOptions) =>
				request<DiscoverTattoosPage>(
					withQuery(`${root}/tattoos`, searchQuery(query)),
					{},
					call,
				),
			/** One published photo by its id. */
			get: (id: string, call?: RequestOptions) =>
				getData<DiscoverTattooDetail>(`${root}/tattoos/${segment(id)}`, call),
		},
		styles: {
			/** The styles Discover filters by, in the list's order. */
			list: (call?: RequestOptions) =>
				getData<DiscoverStyle[]>(`${root}/styles`, call),
		},
		locations: {
			/** The places at least one listed business is in. */
			list: (call?: RequestOptions) =>
				getData<DiscoverLocation[]>(`${root}/locations`, call),
		},
		/**
		 * The sitemap lists (D10): every shown studio's, artist profile's and
		 * photo's canonical identifiers, keyset-paged by id (up to 5,000 a
		 * page; pass `nextCursor` back as `cursor`). For Discover's server.
		 */
		sitemap: {
			studios: (query?: DiscoverSitemapQuery, call?: RequestOptions) =>
				request<DiscoverSitemapPage<DiscoverSitemapStudio>>(
					withQuery(`${root}/sitemap/studios`, query),
					{},
					call,
				),
			artists: (query?: DiscoverSitemapQuery, call?: RequestOptions) =>
				request<DiscoverSitemapPage<DiscoverSitemapArtist>>(
					withQuery(`${root}/sitemap/artists`, query),
					{},
					call,
				),
			tattoos: (query?: DiscoverSitemapQuery, call?: RequestOptions) =>
				request<DiscoverSitemapPage<DiscoverSitemapTattoo>>(
					withQuery(`${root}/sitemap/tattoos`, query),
					{},
					call,
				),
		},
	};
}
