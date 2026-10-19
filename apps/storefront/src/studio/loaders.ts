import { notFound } from "@tanstack/react-router";
import { tattooQueries } from "@tattoo-drip/react";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio, rethrowAsNotFound } from "../api/loaders.ts";
import type { SiteContext } from "../site/context.ts";
import {
	type InquiryChannels,
	type InquiryState,
	inquiryChannels,
	inquiryState,
} from "./inquiry.ts";
import { artistPageSeo, type PageSeo, studioPageSeo } from "./seo.ts";
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
}

export interface ArtistPageData {
	readonly studio: StudioView;
	readonly artist: ArtistView;
	readonly inquiry: InquiryState;
	readonly channels: InquiryChannels;
	readonly seo: PageSeo;
}

export function studioPageData(
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
): StudioPageData {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists);
	const inquiry = inquiryState(studioView, artistViews, null);
	return {
		studio: studioView,
		artists: artistViews,
		inquiry,
		channels: channelsFor(studioView, inquiry),
		seo: studioPageSeo(studioView, artistViews, origin),
	};
}

/** The artist page's data, or null when no visible artist has exactly `slug`. */
export function artistPageData(
	studio: Studio,
	artists: readonly Artist[],
	slug: string,
	origin: string,
): ArtistPageData | null {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists);
	const artist = findArtist(artistViews, slug);
	if (!artist) return null;
	const inquiry = inquiryState(studioView, artistViews, artist);
	return {
		studio: studioView,
		artist,
		inquiry,
		channels: channelsFor(studioView, inquiry),
		seo: artistPageSeo(studioView, artist, origin),
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
	return studioPageData(studio, artists, context.site.origin);
}

/**
 * `/artists/$slug`: the artist from the same list. A slug that can't be an
 * artist's is a not-found before any API call; hidden, deleted, renamed and
 * unknown artists aren't in the list, so they are the same not-found.
 */
export async function loadArtistPage(
	context: PageContext,
	slug: string,
): Promise<ArtistPageData> {
	if (!ARTIST_SLUG.test(slug)) throw notFound();
	const [studio, artists] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
	]);
	const data = artistPageData(studio, artists, slug, context.site.origin);
	if (!data) throw notFound();
	return data;
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
