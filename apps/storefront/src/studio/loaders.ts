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
import type { BookingArtwork, BookingContext } from "../booking/booking.ts";
import { fill } from "../intake/template.ts";
import type { SiteContext } from "../site/context.ts";
import {
	type ArtistsDirectory,
	type ArtistsSearch,
	artistsDirectory,
} from "./artists.ts";
import {
	type ArtworkView,
	artworkTitle,
	artworkView,
	RELATED_READ,
	relatedArtwork,
	similarRequest,
} from "./artwork.ts";
import { type ChatLinks, chatLinks } from "./chat.ts";
import { studioCopy } from "./copy.ts";
import {
	ARTIST_FLASH_COUNT,
	closedNoteFor,
	FLASH_ID,
	FLASH_PAGE_SIZE,
	type FlashDesignView,
	type FlashListView,
	type FlashLookup,
	type FlashRequestView,
	type FlashSearch,
	flashDesignView,
	flashListView,
	flashQuery,
	HOME_FLASH_COUNT,
} from "./flash.ts";
import {
	filterStyles,
	type GalleryPhotoView,
	type GalleryView,
	galleryPhotoView,
	galleryView,
	type PortfolioSearch,
	portfolioQuery,
	RECENT_WORK_COUNT,
	readPhotoId,
	WORK_PAGE_SIZE,
	type WorkSearch,
	workQuery,
} from "./gallery.ts";
import {
	type GoodToKnowView,
	goodToKnowView,
	type OpenNowView,
	openNowView,
} from "./good-to-know.ts";
import { readClosures, readWeek } from "./hours.ts";
import { type InfoContent, type InfoKind, infoContent } from "./info.ts";
import {
	flashInquiryState,
	type InquiryChannels,
	type InquiryState,
	inquiryChannels,
	inquiryState,
	similarInquiryState,
} from "./inquiry.ts";
import { galleryPhotoHref } from "./links.ts";
import {
	type RequestLink,
	type RequestSearch,
	requestLink,
} from "./request.ts";
import {
	artistPageSeo,
	artistsPageSeo,
	artworkPageSeo,
	flashDesignSeo,
	flashPageSeo,
	infoPageSeo,
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
	/**
	 * The studio's newest flash designs for the Flash section (TAT-129), at
	 * most HOME_FLASH_COUNT. Empty when there are none, the page hides Flash
	 * or the read failed, which leaves the section out.
	 */
	readonly flash: FlashListView;
	/** The Good to know section's parts (TAT-128); empty when the studio filled in nothing. */
	readonly goodToKnow: GoodToKnowView;
	/** The cover's state line (TAT-128), or null when the studio set no hours or closed days. */
	readonly openNow: OpenNowView | null;
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
	/**
	 * The artist's newest flash designs (TAT-129), at most ARTIST_FLASH_COUNT,
	 * and whether more follow (`nextCursor`). Empty when there are none or the
	 * read failed, which leaves the Flash section out.
	 */
	readonly flash: FlashListView;
	/**
	 * The styles the artist lists as the gallery's filter reads them (a checked
	 * slug and a one-line name, each slug once, at most five), so a theme can
	 * link each to the gallery filtered by it and this artist.
	 */
	readonly styles: readonly { readonly slug: string; readonly name: string }[];
	/** The artists before and after this one in the API's order (the directory's), or null at either end. */
	readonly neighbours: {
		readonly previous: NeighbourArtist | null;
		readonly next: NeighbourArtist | null;
	};
}

/** A neighbouring artist: enough for a link to their page. */
export interface NeighbourArtist {
	readonly name: string;
	readonly href: string;
}

/** `/artists`: every visible artist, filtered by the address's style. */
export interface ArtistsPageData {
	readonly studio: StudioView;
	readonly theme: ThemeConfig;
	/** The header's Request button: the studio's, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	/**
	 * The closing invitation's request: a lone artist's own while they take
	 * new work (the page is about them), else the header's.
	 */
	readonly ctaLink: RequestLink | null;
	/** The studio's own inquiry state, as on its home page (not a lone artist's): the invitation's words. */
	readonly inquiry: InquiryState;
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	readonly directory: ArtistsDirectory;
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

/** The most styles an artist lists (the contract's maxItems), as the views keep. */
const MAX_ARTIST_STYLES = 5;

/** `/work` (TAT-126): the whole studio's photos, filtered by the address. */
export interface WorkPageData {
	readonly studio: StudioView;
	/** Whether any artist is visible: the navigation's Artists link has somewhere to land. */
	readonly hasArtists: boolean;
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

/** One tattoo's page (`/gallery/$photo`, Prompt 5): the piece, its artist and related work. */
export interface ArtworkPageData {
	readonly studio: StudioView;
	/** Whether any artist is visible: the navigation's Artists link has somewhere to land. */
	readonly hasArtists: boolean;
	readonly theme: ThemeConfig;
	/** The header's Request button: the piece's artist's while they take new work, else the studio's, else none. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links; its message names the artist. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	readonly artwork: ArtworkView;
	/** "Request a similar tattoo" (similarRequest): where it goes and whom it asks, or null when nobody takes new work. */
	readonly similar: {
		readonly href: string;
		readonly artist: ArtistView | null;
	} | null;
	/** At most six other pieces (relatedArtwork): links to their pages. */
	readonly related: readonly GalleryPhotoView[];
}

/** An informational page (Prompt 7): About, Services, FAQ, Contact, Policies or Aftercare. */
export interface InfoPageData {
	readonly studio: StudioView;
	/** Whether any artist is visible: the navigation's Artists link has somewhere to land. */
	readonly hasArtists: boolean;
	readonly theme: ThemeConfig;
	/** The header's Request button: the studio's, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	readonly content: InfoContent;
}

/** `/flash` (TAT-129): every shown design of the visible artists, newest first, filtered by the address. */
export interface FlashPageData {
	readonly studio: StudioView;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
	/** The header's Request button (TAT-127): the studio's general one, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links; its message names the artist the address filters by. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	/** The visible artists, for the "closed" words under a design that can't be requested. */
	readonly artists: readonly ArtistView[];
	/** The address's filter, checked. */
	readonly search: FlashSearch;
	readonly list: FlashListView;
}

/** One flash design's page (TAT-129). */
export interface FlashDesignPageData {
	readonly studio: StudioView;
	/** Whether any artist is visible: the navigation's Artists link has somewhere to land. */
	readonly hasArtists: boolean;
	readonly theme: ThemeConfig;
	/** The header's Request button: the studio's general one, or none while it is closed. */
	readonly requestLink: RequestLink | null;
	/** The chat button's links; its message names this design. */
	readonly chat: ChatLinks | null;
	readonly seo: PageSeo;
	readonly design: FlashDesignView;
	/** Why the design can't be requested now (the artist's own words, else ours), or null while it can (and for a claimed design: its badge says it). */
	readonly closedNote: string | null;
	/**
	 * For a claimed design, where "something similar" goes: `artist` (their own
	 * request), `studio` (the general request, the artist's books being closed)
	 * or null (nobody takes work); null for any other design.
	 */
	readonly similar: "artist" | "studio" | null;
}

/**
 * `/book` (TAT-127, Prompt 6): the request flow on a page of its own. The address's
 * artist is picked when the list has them; any other address is the general
 * form.
 */
export interface RequestPageData {
	readonly studio: StudioView;
	/** Whether any artist is visible: the navigation's Artists link has somewhere to land. */
	readonly hasArtists: boolean;
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
	/**
	 * The flash design the address names (`?flash=<id>`, TAT-129) and what the
	 * page can do with it; null for any other address.
	 */
	readonly flash: FlashRequestView | null;
	/** What the booking flow knows of the studio, its artists and the piece asked about (Prompt 6). */
	readonly booking: BookingContext;
}

/**
 * The studio page's data. `imageOrigin` is MEDIA_URL's origin, the only one a
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
	flash: unknown = null,
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
		flash: flashListView(flash, imageOrigin),
		goodToKnow: goodToKnowView(studio),
		// No clock here (pure, deterministic): loadStudioPage sets the server's.
		openNow: openNowView(studio, null),
	};
}

/**
 * The artist page's data, or null when no visible artist has exactly `slug`.
 * `portfolio` is the gallery read for that artist (none: no Work section);
 * `flash` the flash read for them (TAT-129; none: no Flash section).
 */
export function artistPageData(
	studio: Studio,
	artists: readonly Artist[],
	slug: string,
	origin: string,
	imageOrigin: string | null = null,
	portfolio: PortfolioRead = NO_PORTFOLIO,
	flash: unknown = null,
): ArtistPageData | null {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const artist = findArtist(artistViews, slug);
	if (!artist) return null;
	const index = artistViews.indexOf(artist);
	const neighbour = (other: ArtistView | undefined): NeighbourArtist | null =>
		other ? { name: other.name, href: other.pageHref } : null;
	return {
		studio: studioView,
		artist,
		styles: filterStyles(
			artists.find((raw) => raw.slug === artist.slug)?.styles,
		).slice(0, MAX_ARTIST_STYLES),
		neighbours: {
			previous: neighbour(artistViews[index - 1]),
			next: neighbour(artistViews[index + 1]),
		},
		requestLink: requestLink(studioView, artist),
		chat: chatLinks(studioView, artist.name),
		seo: artistPageSeo(studioView, artist, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		portfolio: {
			gallery: galleryView(portfolio.page, imageOrigin),
			search: portfolio.search,
		},
		flash: flashListView(flash, imageOrigin),
	};
}

/**
 * The request page's data. The artist is `search.artist` when the list has
 * them (exact slug, as the artist page finds one); none found is the general
 * form, never a not-found: a client with an old or mistyped link must still
 * reach the studio. An open artist's page works while the studio as a whole is
 * closed (each artist has their own switch, as `inquiryState` says), and a
 * closed one says so and offers the studio's general request.
 *
 * With a design (`flash`, TAT-129, what the loader read for `?flash=<id>`):
 * a requestable one is a flash request for its artist, whatever their books
 * say (the artist is found in the list by the design's slug); one whose artist
 * takes no flash requests is shown with the artist's own words, else ours, and
 * the artist's own request state below it, so their books decide; a claimed
 * design (one of a kind, taken) is shown marked Claimed and asks the artist for
 * something similar as a custom request (`similarInquiryState`); a design
 * the page can't show, an artist who is not in the list, one the API doesn't
 * know or a read that failed is the general form with a note, never a
 * not-found.
 */
export function requestPageData(
	studio: Studio,
	artists: readonly Artist[],
	search: RequestSearch,
	origin: string,
	imageOrigin: string | null = null,
	flash: FlashLookup | null = null,
	artworkPhoto: unknown = null,
): RequestPageData {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const artwork =
		search.artwork === undefined
			? null
			: bookingArtworkOf(artworkPhoto, search.artwork, origin, imageOrigin);
	const found = flash
		? flashRequestView(flash, artistViews, imageOrigin)
		: null;
	const named =
		found?.owner &&
		(found.view.kind === "requestable" ||
			found.view.kind === "claimed" ||
			found.view.kind === "closed")
			? { view: found.view, owner: found.owner }
			: null;
	const theme = parseThemeConfig(storefrontInput(studio), imageOrigin);
	if (named) {
		const { view, owner } = named;
		const design = view.design;
		const requestable = view.kind === "requestable";
		// A claimed design is not asked for: the artist is asked for something similar.
		const inquiry = requestable
			? flashInquiryState(studioView, design, owner)
			: view.kind === "claimed"
				? similarInquiryState(studioView, design, owner, artistViews)
				: inquiryState(studioView, artistViews, owner);
		return {
			studio: studioView,
			hasArtists: artistViews.length > 0,
			inquiry,
			channels: channelsFor(studioView, inquiry, design.name),
			chat: chatLinks(
				studioView,
				fill(studioCopy.chat.flash, { name: design.name }),
			),
			seo: requestPageSeo(
				studioView,
				owner,
				origin,
				inquiry.kind === "open",
				requestable ? design : null,
			),
			theme,
			flash: view,
			booking: bookingContextOf(studio, artistViews, null),
		};
	}
	// The artist asked for, else the piece's own while they take new work
	// (Prompt 6: "inspired by" keeps its artist; a closed one's piece is the
	// studio's general request, as its "Request a similar tattoo" link says).
	const ofPiece =
		artwork?.artistSlug === undefined
			? null
			: findArtist(artistViews, artwork.artistSlug);
	const artist =
		search.artist !== undefined
			? findArtist(artistViews, search.artist)
			: ofPiece?.accepting
				? ofPiece
				: null;
	const asked = inquiryState(studioView, artistViews, artist);
	// "Request a similar tattoo" (Prompt 5): the idea starts with a link to the
	// piece the API showed, which the client edits or keeps; the form sends only
	// what it shows. A piece the API doesn't show starts nothing.
	const inquiry =
		asked.kind === "open" && artwork
			? {
					...asked,
					start: {
						idea: fill(studioCopy.artwork.similarStart, { url: artwork.url }),
						approximateSize: "",
					},
				}
			: asked;
	return {
		studio: studioView,
		hasArtists: artistViews.length > 0,
		inquiry,
		channels: channelsFor(studioView, inquiry, null),
		chat: chatLinks(studioView, artist?.name ?? null),
		seo: requestPageSeo(studioView, artist, origin, inquiry.kind === "open"),
		theme,
		flash: found ? found.view : null,
		booking: bookingContextOf(studio, artistViews, artwork),
	};
}

/**
 * The booking flow's context (Prompt 6): the artists who take new work, with
 * their portrait and first style; the styles the studio's artists list; the
 * studio's published week and closures for the preference calendar; and the
 * piece asked about. All from the reads the page already makes.
 */
function bookingContextOf(
	studio: Studio,
	artists: readonly ArtistView[],
	artwork: (BookingArtwork & { artistSlug?: string }) | null,
): BookingContext {
	const styles: string[] = [];
	for (const artist of artists) {
		for (const style of artist.styles) {
			if (!styles.includes(style)) styles.push(style);
		}
	}
	const { artistSlug: _slug, ...piece } = artwork ?? { artistSlug: undefined };
	return {
		artists: artists
			.filter((artist) => artist.accepting)
			.map((artist) => ({
				id: artist.id,
				slug: artist.slug,
				name: artist.name,
				specialty: artist.styles[0] ?? null,
				photo: artist.photo,
			})),
		styles,
		calendar: {
			week: readWeek(studio.openingHours),
			closures: readClosures(studio.closedDays),
			timeZone: typeof studio.timezone === "string" ? studio.timezone : "UTC",
		},
		artwork: artwork ? (piece as BookingArtwork) : null,
	};
}

/** The piece the address names, when the API showed exactly it (getWorkPhoto), as the flow shows it. */
function bookingArtworkOf(
	photo: unknown,
	id: string,
	origin: string,
	imageOrigin: string | null,
): (BookingArtwork & { artistSlug?: string }) | null {
	const view = galleryPhotoView(photo, imageOrigin);
	if (!view?.id || view.id !== id || !view.href) return null;
	const slug = view.artist?.href.slice("/artists/".length);
	return {
		id: view.id,
		title: artworkTitle(view),
		href: view.href,
		url: `${origin}${galleryPhotoHref(view.id)}`,
		src: view.src,
		width: view.width,
		height: view.height,
		artistName: view.artist?.name ?? null,
		...(slug ? { artistSlug: slug } : {}),
	};
}

/**
 * What the request page makes of the read of the design its address names.
 * `owner` is the design's artist, from the list, when the design is shown.
 */
function flashRequestView(
	flash: FlashLookup,
	artists: readonly ArtistView[],
	imageOrigin: string | null,
): { view: FlashRequestView; owner: ArtistView | null } {
	if (flash.kind !== "found") {
		return { view: { kind: flash.kind }, owner: null };
	}
	const design = flashDesignView(flash.design, imageOrigin);
	const owner = design?.artist ? findArtist(artists, design.artist.slug) : null;
	if (!design || !owner) return { view: { kind: "gone" }, owner: null };
	// Claimed first: a claimed design is never requestable, whatever the API says.
	if (design.claimed) return { view: { kind: "claimed", design }, owner };
	if (design.requestable) {
		return { view: { kind: "requestable", design }, owner };
	}
	return {
		view: {
			kind: "closed",
			design,
			note:
				owner.closedMessage ??
				fill(studioCopy.flash.closedNamed, { name: owner.name }),
		},
		owner,
	};
}

/**
 * `/flash`'s data (TAT-129). `page` is the flash read for `search`, as the API
 * sent it. The chat names the artist the address filters by when the list
 * offers them; any other address is the general message.
 */
export function flashPageData(
	studio: Studio,
	artists: readonly Artist[],
	page: unknown,
	search: FlashSearch,
	origin: string,
	imageOrigin: string | null = null,
): FlashPageData {
	const studioView = studioViewModel(studio);
	const list = flashListView(page, imageOrigin);
	const filtered = list.artists.find(({ slug }) => slug === search.artist);
	return {
		studio: studioView,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		requestLink: requestLink(studioView, null),
		chat: chatLinks(studioView, filtered?.name ?? null),
		seo: flashPageSeo(studioView, origin),
		artists: artistViewModels(artists, imageOrigin),
		search,
		list,
	};
}

/**
 * One flash design's data (TAT-129), or null when the API's design can't be
 * shown (flashDesignView refuses it). The chat's message names the design.
 */
export function flashDesignPageData(
	studio: Studio,
	artists: readonly Artist[],
	design: unknown,
	origin: string,
	imageOrigin: string | null = null,
): FlashDesignPageData | null {
	const studioView = studioViewModel(studio);
	const view = flashDesignView(design, imageOrigin);
	if (!view) return null;
	const artistViews = artistViewModels(artists, imageOrigin);
	return {
		studio: studioView,
		hasArtists: artistViews.length > 0,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		requestLink: requestLink(studioView, null),
		chat: chatLinks(
			studioView,
			fill(studioCopy.chat.flash, { name: view.name }),
		),
		seo: flashDesignSeo(studioView, view, origin),
		design: view,
		closedNote: closedNoteFor(view, artistViews),
		similar: similarFor(studioView, view, artistViews),
	};
}

/**
 * Where a claimed design's page sends a client who wants something like it:
 * to the artist's own request while they take new work, else to the studio's
 * general request while the studio takes any, else nowhere. Null for a design
 * that is not claimed (its page has the Request button).
 */
function similarFor(
	studio: StudioView,
	design: FlashDesignView,
	artists: readonly ArtistView[],
): "artist" | "studio" | null {
	if (!design.claimed) return null;
	const owner = design.artist ? findArtist(artists, design.artist.slug) : null;
	if (owner?.accepting) return "artist";
	return studio.accepting ? "studio" : null;
}

/**
 * One tattoo's data (Prompt 5), or null when the API's photo can't be shown
 * (galleryPhotoView refuses it). `reads` are the related reads as the API sent
 * them (by style, by artist, newest; null for one not made or failed). Pure.
 */
export function artworkPageData(
	studio: Studio,
	artists: readonly Artist[],
	photo: unknown,
	reads: readonly unknown[],
	origin: string,
	imageOrigin: string | null = null,
): ArtworkPageData | null {
	const view = galleryPhotoView(photo, imageOrigin);
	if (!view?.id) return null;
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const artwork = artworkView({ ...view, id: view.id }, artistViews);
	return {
		studio: studioView,
		hasArtists: artistViews.length > 0,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		requestLink: requestLink(studioView, artwork.artist),
		chat: chatLinks(studioView, artwork.artist?.name ?? null),
		seo: artworkPageSeo(studioView, artwork, origin),
		artwork,
		similar: similarRequest(studioView, artwork),
		related: relatedArtwork(
			artwork.id,
			reads.map((read, index) =>
				read === null
					? null
					: galleryView(read, imageOrigin, index * RELATED_READ),
			),
		),
	};
}

/**
 * An informational page's data (Prompt 7), or null when the studio has
 * nothing of its own for it (infoContent): the route's not-found. Pure.
 */
export function infoPageData(
	kind: InfoKind,
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
	imageOrigin: string | null = null,
): InfoPageData | null {
	const studioView = studioViewModel(studio);
	const artistViews = artistViewModels(artists, imageOrigin);
	const theme = parseThemeConfig(storefrontInput(studio), imageOrigin);
	const content = infoContent(
		kind,
		studio,
		studioView,
		artists,
		artistViews,
		theme.sections,
	);
	if (!content) return null;
	return {
		studio: studioView,
		hasArtists: artistViews.length > 0,
		theme,
		requestLink: requestLink(studioView, null),
		chat: chatLinks(studioView, null),
		seo: infoPageSeo(studioView, content, origin),
		content,
	};
}

/**
 * `/gallery`'s data (TAT-126). `page` is the gallery read for `search`, as the
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
	const visible = artistViewModels(artists, imageOrigin);
	const withWork = visible
		.filter((artist) => artist.workPhotos.length > 0)
		.map(({ slug, name }) => ({ slug, name }))
		.sort((a, b) => a.name.localeCompare(b.name, "en"));
	// An artist the address filters by who is not listed (hidden, renamed, no
	// work photo) is the general message, never an error.
	const filtered = withWork.find(({ slug }) => slug === search.artist);
	return {
		studio: studioView,
		hasArtists: visible.length > 0,
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
 * `/artists`'s data: the studio and its visible artists, the directory
 * filtered by `search` (artistsDirectory). Pure. The header asks the studio;
 * the closing invitation (`ctaLink`) asks a lone artist by name while they
 * take new work, as their own page does, else the studio while it does, else
 * nobody. `inquiry` is the studio's own state, as on its home page.
 */
export function artistsPageData(
	studio: Studio,
	artists: readonly Artist[],
	search: ArtistsSearch,
	origin: string,
	imageOrigin: string | null = null,
): ArtistsPageData {
	const studioView = studioViewModel(studio);
	const views = artistViewModels(artists, imageOrigin);
	const directory = artistsDirectory(artists, views, search);
	const lone = views.length === 1 ? views[0] : null;
	return {
		studio: studioView,
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
		requestLink: requestLink(studioView, null),
		ctaLink: requestLink(studioView, lone),
		// The studio's own state, as on its home page: the invitation's words.
		inquiry: inquiryState(studioView, views, null),
		chat: chatLinks(studioView, lone?.name ?? null),
		seo: artistsPageSeo(
			studioView,
			views,
			directory.styles.map((style) => style.name),
			origin,
		),
		directory,
	};
}

/**
 * `/artists`: the studio (cached by the tenant middleware) and the artist
 * list, the same cached read every page makes, so moving between filters
 * re-runs only the pure filter and asks the API nothing. A failed artists
 * read is the error page, as everywhere.
 */
export async function loadArtistsPage(
	context: PageContext,
	search: ArtistsSearch,
): Promise<ArtistsPageData> {
	const [studio, artists] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
	]);
	return artistsPageData(
		studio,
		artists,
		search,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
	);
}

/**
 * `/`: the studio (already cached by the tenant middleware), then its artists
 * and, only when the studio's sections include Recent work, its newest photos
 * (loadRecentWork: a failed read leaves the section out, never the page), and
 * likewise, when they include Flash, its newest 6 flash designs
 * (loadHomeFlash). A studio that hid Recent work costs the API no `/work`
 * read, and one that hid Flash no `/flash` read.
 */
export async function loadStudioPage(
	context: PageContext,
): Promise<StudioPageData> {
	const studio = await loadStudio(context);
	const imageOrigin = context.tattoo.connection.mediaUrl;
	const theme = parseThemeConfig(storefrontInput(studio), imageOrigin);
	const [artists, recentWork, flash] = await Promise.all([
		loadArtists(context),
		theme.sections.includes("work") ? loadRecentWork(context) : null,
		theme.sections.includes("flash") ? loadHomeFlash(context) : null,
	]);
	const data = studioPageData(
		studio,
		artists,
		context.site.origin,
		imageOrigin,
		recentWork,
		flash,
		theme,
	);
	// Today's state at this server's clock, only when it holds for the page's
	// cache life (TAT-128); the browser recomputes the rest. The studio it is
	// computed from is fresh: the render's reads ask every cache for a fresh
	// answer (tenancy/revalidate.ts), so a closure added minutes ago is in it
	// and the page's 11 minutes are not added to an API answer's own age.
	return { ...data, openNow: openNowView(studio, new Date()) };
}

/**
 * `/artists/$slug`: the artist from the same list. A slug that can't be an
 * artist's is a not-found before any API call; hidden, deleted, renamed and
 * unknown artists aren't in the list, so they are the same not-found. The
 * artist's portfolio (their newest 24 photos, `search`'s filters) is read at
 * the same time (loadPortfolio), and so are their newest 12 flash designs
 * (loadArtistFlash).
 */
export async function loadArtistPage(
	context: PageContext,
	slug: string,
	search: PortfolioSearch,
): Promise<ArtistPageData> {
	if (!ARTIST_SLUG.test(slug)) throw notFound();
	const [studio, artists, portfolio, flash] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadPortfolio(context, slug, search),
		loadArtistFlash(context, slug),
	]);
	const data = artistPageData(
		studio,
		artists,
		slug,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
		portfolio,
		flash,
	);
	if (!data) throw notFound();
	return data;
}

/**
 * `/book`: the studio (from the cache) and its artists, read together; no
 * work read. With `?flash=` (TAT-129) the design is read at the same time,
 * and never throws: see loadFlashLookup. `search` is what `readRequestSearch` gave (the route's
 * `loaderDeps` re-reads the merged search through it, so a stray key never
 * reaches here). The artists are read as on the other pages: a failure is an
 * error page, a list the API does not know the not-found.
 */
export async function loadRequestPage(
	context: PageContext,
	search: RequestSearch,
): Promise<RequestPageData> {
	const [studio, artists, flash, artwork] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		search.flash === undefined ? null : loadFlashLookup(context, search.flash),
		search.artwork === undefined || search.flash !== undefined
			? null
			: loadArtworkLookup(context, search.artwork),
	]);
	return requestPageData(
		studio,
		artists,
		search,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
		flash,
		artwork,
	);
}

/**
 * The piece a booking is "inspired by" (`?artwork=`, Prompt 6), checked with
 * the API: the photo, or null when the API doesn't show it (a 404) or the read
 * failed (logged). Never throws: the request page stands without the piece.
 */
async function loadArtworkLookup(
	context: ApiContext,
	id: string,
): Promise<unknown> {
	try {
		return await context.queryClient.query({
			...tattooQueries.workPhoto(context.tattoo.client, id),
			staleTime: "static",
		});
	} catch (error) {
		if (!(isTattooApiError(error) && error.status === 404)) {
			logReadFailed("Artwork", context, error);
		}
		return null;
	}
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
		context.tattoo.connection.mediaUrl,
	);
}

/**
 * An informational page (Prompt 7): the studio (from the cache) and its
 * artists, the reads every page makes; nothing else. A page the studio has no
 * content for is the not-found.
 */
export async function loadInfoPage(
	context: PageContext,
	kind: InfoKind,
): Promise<InfoPageData> {
	const [studio, artists] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
	]);
	const data = infoPageData(
		kind,
		studio,
		artists,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
	);
	if (!data) throw notFound();
	return data;
}

/**
 * `/flash` (TAT-129): the studio, its artists and the first page of flash
 * with the address's filter. The API refusing the address (a hand-edited
 * cursor is a 422 `validation_failed`) or not knowing the read (a 404) is the
 * router's not-found; any other failure is an error, as for the other pages.
 */
export async function loadFlashPage(
	context: PageContext,
	search: FlashSearch,
): Promise<FlashPageData> {
	const [studio, artists, page] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadFlash(context, search),
	]);
	return flashPageData(
		studio,
		artists,
		page,
		search,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
	);
}

/**
 * `/flash/<id>` (TAT-129): the studio, its artists and the design, read
 * together. An id that can't be a design's is a not-found before any API
 * call; the API not knowing the design (hidden, an artist hidden, unknown) is
 * the same not-found, and so is a design the page can't show.
 */
export async function loadFlashDesignPage(
	context: PageContext,
	id: string,
): Promise<FlashDesignPageData> {
	if (!FLASH_ID.test(id)) throw notFound();
	const [studio, artists, design] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadFlashDesign(context, id),
	]);
	const data = flashDesignPageData(
		studio,
		artists,
		design,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
	);
	if (!data) throw notFound();
	return data;
}

/**
 * `/gallery/<id>` (Prompt 5): the studio, its artists and the photo, read
 * together, then the related reads (its first style's, its artist's and the
 * newest, seven each, together). An id that can't be a photo's is a not-found
 * before any API call; the API not knowing the photo (a hidden artist's,
 * removed, unknown, an older platform without the read) is the same
 * not-found, and so is a photo the page can't show. A related read that
 * fails is logged and leaves fewer related pieces: the piece itself stands.
 */
export async function loadArtworkPage(
	context: PageContext,
	id: string,
): Promise<ArtworkPageData> {
	if (readPhotoId(id) === null) throw notFound();
	const [studio, artists, photo] = await Promise.all([
		loadStudio(context),
		loadArtists(context),
		loadWorkPhoto(context, id),
	]);
	const view = galleryPhotoView(photo, context.tattoo.connection.mediaUrl);
	if (!view) throw notFound();
	const style = view.styleRefs[0]?.slug;
	const slug = view.artist?.href.slice("/artists/".length);
	const reads = await Promise.all([
		style ? loadRelated(context, { style }) : null,
		slug ? loadRelated(context, { artist: slug }) : null,
		loadRelated(context, {}),
	]);
	const data = artworkPageData(
		studio,
		artists,
		photo,
		reads,
		context.site.origin,
		context.tattoo.connection.mediaUrl,
	);
	if (!data) throw notFound();
	return data;
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
 * The studio's newest flash designs for the home page's Flash section, as the
 * API sent them (null when the read failed). Any failure is logged and leaves
 * the section out and the page standing, like Recent work (it also makes the
 * deploy order safe: this storefront can run against a platform without
 * `/flash`).
 */
async function loadHomeFlash(context: ApiContext): Promise<unknown> {
	try {
		return await context.queryClient.query({
			...tattooQueries.flash(
				context.tattoo.client,
				// Claimed designs stay out of the home's Flash section.
				flashQuery({}, HOME_FLASH_COUNT, true),
			),
			staleTime: "static",
		});
	} catch (error) {
		logReadFailed("Flash", context, error);
		return null;
	}
}

/**
 * An artist's newest flash designs for their page, as the API sent them (null
 * when the read failed). Any failure (an older platform's 404, a 422, a 5xx,
 * the network) is logged and leaves the Flash section out and the page
 * standing (it also makes the deploy order safe: this storefront can run
 * against a platform without `/flash`).
 */
async function loadArtistFlash(
	context: ApiContext,
	slug: string,
): Promise<unknown> {
	try {
		return await context.queryClient.query({
			...tattooQueries.flash(
				context.tattoo.client,
				flashQuery({ artist: slug }, ARTIST_FLASH_COUNT),
			),
			staleTime: "static",
		});
	} catch (error) {
		logReadFailed("Flash", context, error);
		return null;
	}
}

/**
 * The flash design the request page's address names. The API's 404 (hidden,
 * its artist hidden, unknown) is `gone`; any other failure (a platform without
 * `/flash/<id>`, a 5xx, the network) is logged and is `failed`. Either way the
 * request page stands with the general form: a client with an old link must
 * still reach the studio.
 */
async function loadFlashLookup(
	context: ApiContext,
	id: string,
): Promise<FlashLookup> {
	try {
		const design = await context.queryClient.query({
			...tattooQueries.flashDesign(context.tattoo.client, id),
			staleTime: "static",
		});
		return { kind: "found", design };
	} catch (error) {
		if (
			isTattooApiError(error) &&
			error.status === 404 &&
			error.code === "not_found"
		) {
			return { kind: "gone" };
		}
		logReadFailed("Flash design", context, error);
		return { kind: "failed" };
	}
}

async function loadFlash(
	{ queryClient, tattoo }: ApiContext,
	search: FlashSearch,
): Promise<unknown> {
	try {
		return await queryClient.query({
			...tattooQueries.flash(
				tattoo.client,
				flashQuery(search, FLASH_PAGE_SIZE),
			),
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

async function loadWorkPhoto(
	{ queryClient, tattoo }: ApiContext,
	id: string,
): Promise<unknown> {
	try {
		return await queryClient.query({
			...tattooQueries.workPhoto(tattoo.client, id),
			staleTime: "static",
		});
	} catch (error) {
		return rethrowAsNotFound(error);
	}
}

/** A related read (loadArtworkPage): seven of the newest with these filters, or null after a logged failure. */
async function loadRelated(
	context: ApiContext,
	search: WorkSearch,
): Promise<unknown> {
	try {
		return await context.queryClient.query({
			...tattooQueries.work(
				context.tattoo.client,
				workQuery(search, RELATED_READ),
			),
			staleTime: "static",
		});
	} catch (error) {
		logReadFailed("Related work", context, error);
		return null;
	}
}

async function loadFlashDesign(
	{ queryClient, tattoo }: ApiContext,
	id: string,
): Promise<unknown> {
	try {
		return await queryClient.query({
			...tattooQueries.flashDesign(tattoo.client, id),
			staleTime: "static",
		});
	} catch (error) {
		return rethrowAsNotFound(error);
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
	flashName: string | null,
): InquiryChannels {
	return inquiryChannels(
		studio,
		inquiry.kind === "open" ? inquiry.preferredArtist : null,
		// The design's name while the inquiry is a flash request.
		inquiry.kind === "open" && inquiry.flashDesignId !== undefined
			? flashName
			: null,
	);
}
