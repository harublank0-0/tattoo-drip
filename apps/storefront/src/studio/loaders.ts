import { notFound } from "@tanstack/react-router";
import { tattooQueries } from "@tattoo-drip/react";
import {
	type Artist,
	isTattooApiError,
	type ListWorkQuery,
	type Studio,
} from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio, rethrowAsNotFound } from "../api/loaders.ts";
import type { SiteContext } from "../site/context.ts";
import { type ChatLinks, chatLinks } from "./chat.ts";
import {
	type GalleryView,
	galleryView,
	type PortfolioSearch,
	portfolioQuery,
	RECENT_WORK_COUNT,
	WORK_PAGE_SIZE,
	type WorkSearch,
	workQuery,
} from "./gallery.ts";
import {
	type InquiryChannels,
	type InquiryState,
	inquiryChannels,
	inquiryState,
} from "./inquiry.ts";
import {
	type RequestLink,
	type RequestSearch,
	requestLink,
} from "./request.ts";
import {
	artistPageSeo,
	type PageSeo,
	requestPageSeo,
	studioPageSeo,
	workPageSeo,
} from "./seo.ts";
import { parseThemeConfig, type ThemeConfig } from "./theme/config.ts";
import { storefrontInput } from "./theme/source.ts";
import {
	ARTIST_SLUG,
	type ArtistView,
	artistViewModels,
	findArtist,
	type StudioView,
	studioViewModel,
} from "./view-model.ts";

/**
 * The studio page's loaders (TAT-48). They read through TAT-23's cache
 * (`query` with staleTime "static": cached data, else one fetch) and return
 * view models, so components need no query hooks and a CDN-aged page never
 * refetches in the browser. Loader data is serialized into the page: only
 * public, already-shown data goes in it.
 */

export type PageContext = ApiContext & SiteContext;

export interface StudioPageData {
	readonly studio: StudioView;
	readonly artists: readonly ArtistView[];
	/** Whether the "Got an idea?" invitation invites (TAT-127); the form itself is on /request. */
	readonly inquiry: InquiryState;
	/** The header's Request button (TAT-127): the studio's, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links (TAT-127), or none without a valid phone. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
	/**
	 * The studio's newest photos for the Recent work section (TAT-126), at most
	 * RECENT_WORK_COUNT. Empty when there are none or the read failed, which
	 * leaves the section out.
	 */
	readonly recentWork: GalleryView;
}

export interface ArtistPageData {
	readonly studio: StudioView;
	readonly artist: ArtistView;
	/** The header's Request button (TAT-127): this artist's while they take new work, else the studio's. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links (TAT-127); its message names this artist. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
	/**
	 * The artist's whole portfolio, a page at a time (TAT-126), and the
	 * address's filters it was read with. Empty when the read failed, which
	 * leaves the Work section out.
	 */
	readonly portfolio: {
		readonly gallery: GalleryView;
		readonly search: PortfolioSearch;
	};
}

/**
 * What a portfolio read gave: the API's page as it came (galleryView checks
 * it) and the address's filters it answers. Nothing when it failed.
 */
export interface PortfolioRead {
	readonly page: unknown;
	readonly search: PortfolioSearch;
}

const NO_PORTFOLIO: PortfolioRead = { page: null, search: {} };

/** `/work` (TAT-126): the whole studio's photos, filtered by the address. */
export interface WorkPageData {
	readonly studio: StudioView;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
	/** The header's Request button (TAT-127): the studio's, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links (TAT-127); its message names the artist the address filters by. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	/** The visible artists with at least one work photo, by name: the artist filter's choices. */
	readonly artists: readonly { readonly slug: string; readonly name: string }[];
	/** The address's filters, checked. */
	readonly search: WorkSearch;
	readonly gallery: GalleryView;
}

/**
 * `/request` (TAT-127): the intake form on a page of its own. The address's
 * artist is picked when the list has them; any other address is the general
 * form.
 */
export interface RequestPageData {
	readonly studio: StudioView;
	readonly inquiry: InquiryState;
	readonly channels: InquiryChannels;
	/**
	 * The chat button's links (TAT-127); its message names the picked artist,
	 * open or closed. The page has no Request button: it is where they lead.
	 */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
}

/**
 * The studio page's data. `imageOrigin` is the API's origin, the only one a
 * logo, cover or work photo may come from (TAT-54, TAT-116); null accepts
 * none. `recentWork` is the gallery read for the newest photos, as the API
 * sent it (galleryView checks it); none is an empty Recent work. `theme` is
 * the studio's parsed theme when the caller already has it (loadStudioPage
 * parses it to see whether the page shows Recent work at all).
 */
export function studioPageData(
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
	imageOrigin: string | null = null,
	recentWork: unknown = null,
	theme: ThemeConfig = parseThemeConfig(storefrontInput(studio), imageOrigin),
): StudioPageData {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	return {
		studio: studioView,
		artists: artistViews,
		inquiry: inquiryState(studioView, artistViews, null),
		requestLink: requestLink(studioView, null),
		chat: chatLinks(studioView, null),
		seo: studioPageSeo(studioView, artistViews, origin),
		theme,
		recentWork: galleryView(recentWork, imageOrigin),
	};
}

/**
 * The artist page's data, or null when no visible artist has exactly `slug`.
 * `portfolio` is the gallery read for that artist (none: no Work section).
 */
export function artistPageData(
	studio: Studio,
	artists: readonly Artist[],
	slug: string,
	origin: string,
	imageOrigin: string | null = null,
	portfolio: PortfolioRead = NO_PORTFOLIO,
): ArtistPageData | null {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const artist = findArtist(artistViews, slug);
	if (!artist) return null;
	return {
		studio: studioView,
		artist,
		requestLink: requestLink(studioView, artist),
		chat: chatLinks(studioView, artist.name),
		seo: artistPageSeo(studioView, artist, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		portfolio: {
			gallery: galleryView(portfolio.page, imageOrigin),
			search: portfolio.search,
		},
	};
}

/**
 * The request page's data. The artist is `search.artist` when the list has
 * them (exact slug, as the artist page finds one); none found is the general
 * form, never a not-found: a client with an old or mistyped link must still
 * reach the studio. An open artist's page works while the studio as a whole is
 * closed (each artist has their own switch, as `inquiryState` says), and a
 * closed one says so and offers the studio's general request.
 */
export function requestPageData(
	studio: Studio,
	artists: readonly Artist[],
	search: RequestSearch,
	origin: string,
	imageOrigin: string | null = null,
): RequestPageData {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const artist =
		search.artist === undefined ? null : findArtist(artistViews, search.artist);
	const inquiry = inquiryState(studioView, artistViews, artist);
	return {
		studio: studioView,
		inquiry,
		channels: channelsFor(studioView, inquiry),
		chat: chatLinks(studioView, artist?.name ?? null),
		seo: requestPageSeo(studioView, artist, origin, inquiry.kind === "open"),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
	};
}

/**
 * `/work`'s data (TAT-126). `page` is the gallery read for `search`, as the
 * API sent it. The artist filter offers the visible artists who have a work
 * photo, by name.
 */
export function workPageData(
	studio: Studio,
	artists: readonly Artist[],
	page: unknown,
	search: WorkSearch,
	origin: string,
	imageOrigin: string | null = null,
): WorkPageData {
	const studioView = studioViewModel(studio);
	const withWork = artistViewModels(artists, imageOrigin)
		.filter((artist) => artist.workPhotos.length > 0)
		.map(({ slug, name }) => ({ slug, name }))
		.sort((a, b) => a.name.localeCompare(b.name, "en"));
	// An artist the address filters by who is not listed (hidden, renamed, no
	// work photo) is the general message, never an error.
	const filtered = withWork.find(({ slug }) => slug === search.artist);
	return {
		studio: studioView,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		requestLink: requestLink(studioView, null),
		chat: chatLinks(studioView, filtered?.name ?? null),
		seo: workPageSeo(studioView, origin),
		artists: withWork,
		search,
		gallery: galleryView(page, imageOrigin),
	};
}

/**
 * `/`: the studio (already cached by the tenant middleware), then its artists
 * and, only when the studio's sections include Recent work, its newest photos
 * (loadRecentWork: a failed read leaves the section out, never the page). A
 * studio that hid Recent work costs the API no `/work` read.
 */
export async function loadStudioPage(
	context: PageContext,
): Promise<StudioPageData> {
	const studio = await loadStudio(context);
	const imageOrigin = context.tattoo.connection.apiUrl;
	const theme = parseThemeConfig(storefrontInput(studio), imageOrigin);
	const [artists, recentWork] = await Promise.all([
		loadArtists(context),
		theme.sections.includes("work") ? loadRecentWork(context) : null,
	]);
	return studioPageData(
		studio,
		artists,
		context.site.origin,
		imageOrigin,
		recentWork,
		theme,
	);
}

/**
 * `/artists/$slug`: the artist from the same list. A slug that can't be an
 * artist's is a not-found before any API call; hidden, deleted, renamed and
 * unknown artists aren't in the list, so they are the same not-found. The
 * artist's portfolio (their newest 24 photos, `search`'s filters) is read at
 * the same time (loadPortfolio).
 */
export async function loadArtistPage(
	context: PageContext,
	slug: string,
	search: PortfolioSearch,
): Promise<ArtistPageData> {
	if (!ARTIST_SLUG.test(slug)) throw notFound();
	const [studio, artists, portfolio] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadPortfolio(context, slug, search),
	]);
	const data = artistPageData(
		studio,
		artists,
		slug,
		context.site.origin,
		context.tattoo.connection.apiUrl,
		portfolio,
	);
	if (!data) throw notFound();
	return data;
}

/**
 * `/request`: the studio (from the cache) and its artists, read together; no
 * work read. `search` is what `readRequestSearch` gave (the route's
 * `loaderDeps` re-reads the merged search through it, so a stray key never
 * reaches here). The artists are read as on the other pages: a failure is an
 * error page, a list the API does not know the not-found.
 */
export async function loadRequestPage(
	context: PageContext,
	search: RequestSearch,
): Promise<RequestPageData> {
	const [studio, artists] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
	]);
	return requestPageData(
		studio,
		artists,
		search,
		context.site.origin,
		context.tattoo.connection.apiUrl,
	);
}

/**
 * `/work`: the studio, its artists and the first page of the gallery with the
 * address's filters. The API refusing the address (a hand-edited cursor is a
 * 422 `validation_failed`) or not knowing the read (a 404) is the router's
 * not-found; any other failure is an error, as for the other pages.
 */
export async function loadWorkPage(
	context: PageContext,
	search: WorkSearch,
): Promise<WorkPageData> {
	const [studio, artists, page] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadWork(context, search),
	]);
	return workPageData(
		studio,
		artists,
		page,
		search,
		context.site.origin,
		context.tattoo.connection.apiUrl,
	);
}

/**
 * The browser's "Show more" (TAT-126): the page after `cursor` with the same
 * filters, as photos numbered on from `offset`. A failure is thrown, for the
 * button to say so.
 */
export async function moreWork(
	{ queryClient, tattoo }: ApiContext,
	query: ListWorkQuery,
	cursor: string,
	offset: number,
	imageOrigin: string | null,
): Promise<GalleryView> {
	const { cursor: _opened, limit, ...filters } = query;
	const page = await queryClient.fetchQuery(
		tattooQueries.work(tattoo.client, { ...filters, cursor, limit }),
	);
	return galleryView(page, imageOrigin, offset);
}

/** The API refused the address's own `cursor` or `healed`: a link someone edited by hand. */
function refusedTheAddress(error: unknown): boolean {
	return (
		isTattooApiError(error) &&
		error.status === 422 &&
		error.code === "validation_failed" &&
		(Object.hasOwn(error.fields, "cursor") ||
			Object.hasOwn(error.fields, "healed"))
	);
}

/**
 * The artist's portfolio: their newest 24 photos, narrowed by the address.
 * A refused address is the not-found. Any other failure (an older platform's
 * 404, a 5xx, the network) is logged and leaves the portfolio out and the page
 * standing: the artist page is how a client reaches an artist, and a gallery
 * that won't load is no reason to lose it.
 */
async function loadPortfolio(
	context: ApiContext,
	slug: string,
	search: PortfolioSearch,
): Promise<PortfolioRead> {
	try {
		const page = await context.queryClient.query({
			...tattooQueries.work(
				context.tattoo.client,
				portfolioQuery(slug, search, WORK_PAGE_SIZE),
			),
			staleTime: "static",
		});
		return { page, search };
	} catch (error) {
		if (refusedTheAddress(error)) throw notFound();
		logReadFailed("Portfolio", context, error);
		return NO_PORTFOLIO;
	}
}

/**
 * The studio's newest photos for the home page's Recent work, as the API sent
 * them (null when the read failed). Any failure (an older platform's 404, a
 * 422, a 5xx, the network) is logged and leaves Recent work out and the page
 * standing: the studio page is how a client reaches the studio, and a gallery
 * that won't load is no reason to lose it (it also makes the deploy order
 * safe: this storefront can run against a platform without `/work`).
 */
async function loadRecentWork(context: ApiContext): Promise<unknown> {
	try {
		return await context.queryClient.query({
			...tattooQueries.work(
				context.tattoo.client,
				workQuery({}, RECENT_WORK_COUNT),
			),
			staleTime: "static",
		});
	} catch (error) {
		logReadFailed("Recent work", context, error);
		return null;
	}
}

/**
 * Says where an operator looks that a page is standing without a read: a
 * platform without `/work`, a timeout or a bug here would otherwise leave
 * every page without its photos, all of them 200s. Like the tenant lookup's
 * line (src/tenancy/handle.ts): the studio, the status and the code, never
 * the error, the address, a cursor or a key. Exported so any other read that
 * lets its page stand without its data says it the same way.
 */
export function logReadFailed(
	what: string,
	{ tattoo }: ApiContext,
	error: unknown,
): void {
	console.error(`${what} read failed`, {
		slug: tattoo.connection.tenant,
		status: isTattooApiError(error) ? error.status : undefined,
		code: isTattooApiError(error) ? error.code : undefined,
	});
}

async function loadWork(
	{ queryClient, tattoo }: ApiContext,
	search: WorkSearch,
): Promise<unknown> {
	try {
		return await queryClient.query({
			...tattooQueries.work(tattoo.client, workQuery(search, WORK_PAGE_SIZE)),
			staleTime: "static",
		});
	} catch (error) {
		if (
			isTattooApiError(error) &&
			error.status === 422 &&
			error.code === "validation_failed"
		) {
			throw notFound();
		}
		return rethrowAsNotFound(error);
	}
}

async function loadArtists({
	queryClient,
	tattoo,
}: ApiContext): Promise<Artist[]> {
	try {
		return await queryClient.query({
			...tattooQueries.artists(tattoo.client),
			staleTime: "static",
		});
	} catch (error) {
		return rethrowAsNotFound(error);
	}
}

function channelsFor(
	studio: StudioView,
	inquiry: InquiryState,
): InquiryChannels {
	return inquiryChannels(
		studio,
		inquiry.kind === "open" ? inquiry.preferredArtist : null,
	);
}
