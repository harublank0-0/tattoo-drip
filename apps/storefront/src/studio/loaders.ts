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
import {
	type GalleryView,
	galleryView,
	type PortfolioSearch,
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
	artistPageSeo,
	type PageSeo,
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
	readonly inquiry: InquiryState;
	readonly channels: InquiryChannels;
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
}

export interface ArtistPageData {
	readonly studio: StudioView;
	readonly artist: ArtistView;
	readonly inquiry: InquiryState;
	readonly channels: InquiryChannels;
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
	readonly seo: PageSeo;
	/** The visible artists with at least one work photo, by name: the artist filter's choices. */
	readonly artists: readonly { readonly slug: string; readonly name: string }[];
	/** The address's filters, checked. */
	readonly search: WorkSearch;
	readonly gallery: GalleryView;
}

/**
 * The studio page's data. `imageOrigin` is the API's origin, the only one a
 * logo, cover or work photo may come from (TAT-54, TAT-116); null accepts
 * none.
 */
export function studioPageData(
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
	imageOrigin: string | null = null,
): StudioPageData {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const inquiry = inquiryState(studioView, artistViews, null);
	return {
		studio: studioView,
		artists: artistViews,
		inquiry,
		channels: channelsFor(studioView, inquiry),
		seo: studioPageSeo(studioView, artistViews, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
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
	const inquiry = inquiryState(studioView, artistViews, artist);
	return {
		studio: studioView,
		artist,
		inquiry,
		channels: channelsFor(studioView, inquiry),
		seo: artistPageSeo(studioView, artist, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		portfolio: {
			gallery: galleryView(portfolio.page, imageOrigin),
			search: portfolio.search,
		},
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
	return {
		studio: studioView,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		seo: workPageSeo(studioView, origin),
		artists: artistViewModels(artists, imageOrigin)
			.filter((artist) => artist.workPhotos.length > 0)
			.map(({ slug, name }) => ({ slug, name }))
			.sort((a, b) => a.name.localeCompare(b.name, "en")),
		search,
		gallery: galleryView(page, imageOrigin),
	};
}

/** `/`: the studio (already cached by the tenant middleware) and its artists. */
export async function loadStudioPage(
	context: PageContext,
): Promise<StudioPageData> {
	const [studio, artists] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
	]);
	return studioPageData(
		studio,
		artists,
		context.site.origin,
		context.tattoo.connection.apiUrl,
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
 * 404, a 5xx, the network) leaves the portfolio out and the page standing:
 * the artist page is how a client reaches an artist, and a gallery that won't
 * load is no reason to lose it.
 */
async function loadPortfolio(
	{ queryClient, tattoo }: ApiContext,
	slug: string,
	search: PortfolioSearch,
): Promise<PortfolioRead> {
	try {
		const page = await queryClient.query({
			...tattooQueries.work(
				tattoo.client,
				workQuery({ artist: slug, ...search }, WORK_PAGE_SIZE),
			),
			staleTime: "static",
		});
		return { page, search };
	} catch (error) {
		if (refusedTheAddress(error)) throw notFound();
		return NO_PORTFOLIO;
	}
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
