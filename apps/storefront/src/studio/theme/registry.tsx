import type { ComponentProps, ComponentType } from "react";
import { InfoPage } from "../components/info.tsx";
import {
	ArtistPage,
	ArtistsPage,
	ArtworkPage,
	FlashDesignPage,
	FlashPage,
	FreshInkPage,
	RequestPage,
	ReviewsPage,
	StudioPage,
	WorkPage,
} from "../components/pages.tsx";
import { type Shell, StencilShell } from "../components/shell.tsx";
import { AtelierArtistPage } from "./atelier/artist-page.tsx";
import { AtelierArtistsPage } from "./atelier/artists-page.tsx";
import { AtelierArtworkPage } from "./atelier/artwork-page.tsx";
import { AtelierBookPage } from "./atelier/book-page.tsx";
import { AtelierFreshInkPage, AtelierReviewsPage } from "./atelier/clients.tsx";
import { AtelierGalleryPage } from "./atelier/gallery-page.tsx";
import { AtelierStudioPage } from "./atelier/home-page.tsx";
import { AtelierShell } from "./atelier/shell.tsx";
import { DEFAULT_THEME_KEY, type ThemeKey } from "./config.ts";
import { FlashParlourArtistPage } from "./flash-parlour/artist-page.tsx";
import { FlashParlourArtistsPage } from "./flash-parlour/artists-page.tsx";
import { FlashParlourArtworkPage } from "./flash-parlour/artwork-page.tsx";
import { FlashParlourBookPage } from "./flash-parlour/book-page.tsx";
import {
	FlashParlourFreshInkPage,
	FlashParlourReviewsPage,
} from "./flash-parlour/clients.tsx";
import { FlashParlourFlashDesignPage } from "./flash-parlour/flash-design-page.tsx";
import { FlashParlourFlashPage } from "./flash-parlour/flash-page.tsx";
import { FlashParlourGalleryPage } from "./flash-parlour/gallery-page.tsx";
import { FlashParlourStudioPage } from "./flash-parlour/home-page.tsx";
import { FlashParlourShell } from "./flash-parlour/shell.tsx";
import { InkNoirArtistPage } from "./ink-noir/artist/artist-page.tsx";
import { InkNoirArtistsPage } from "./ink-noir/artists/artists-page.tsx";
import { InkNoirBookPage } from "./ink-noir/book/book-page.tsx";
import { InkNoirArtworkPage } from "./ink-noir/gallery/artwork-page.tsx";
import { InkNoirGalleryPage } from "./ink-noir/gallery/gallery-page.tsx";
import {
	InkNoirFreshInkPage,
	InkNoirReviewsPage,
} from "./ink-noir/home/fresh-ink.tsx";
import { InkNoirStudioPage } from "./ink-noir/home/home-page.tsx";
import { InkNoirInfoPage } from "./ink-noir/info/info-page.tsx";
import { InkNoirShell } from "./ink-noir/shell.tsx";
import { IrezumiArtistPage } from "./irezumi/artist-page.tsx";
import { IrezumiArtistsPage } from "./irezumi/artists-page.tsx";
import { IrezumiArtworkPage } from "./irezumi/artwork-page.tsx";
import { IrezumiBookPage } from "./irezumi/book-page.tsx";
import { IrezumiFreshInkPage, IrezumiReviewsPage } from "./irezumi/clients.tsx";
import { IrezumiGalleryPage } from "./irezumi/gallery-page.tsx";
import { IrezumiStudioPage } from "./irezumi/home-page.tsx";
import { IrezumiShell } from "./irezumi/shell.tsx";

/**
 * A theme (TAT-54): the studio page's pages as React components of this
 * app. A studio picks one by key and fills in its options; it never sends
 * markup. Every theme renders the inquiry section as it is (the invitation
 * to /request on the studio page, InquirySection with the intake form on
 * /request), and never the deposit page.
 *
 * `Shell` is what the theme puts around every page (header, footer, chat
 * button; components/shell.tsx). A theme that only frames the shared pages
 * differently, like Ink Noir, lists the shared page components and its own
 * shell; one that lays a page out differently gives its own component for it.
 * Data, links and booking stay the same whichever is picked.
 */
export interface Theme {
	readonly Shell: Shell;
	readonly StudioPage: ComponentType<ComponentProps<typeof StudioPage>>;
	readonly ArtistPage: ComponentType<ComponentProps<typeof ArtistPage>>;
	/** `/artists`, the directory. */
	readonly ArtistsPage: ComponentType<ComponentProps<typeof ArtistsPage>>;
	readonly WorkPage: ComponentType<ComponentProps<typeof WorkPage>>;
	/** `/gallery/$photo`, one tattoo (Prompt 5). */
	readonly ArtworkPage: ComponentType<ComponentProps<typeof ArtworkPage>>;
	readonly FlashPage: ComponentType<ComponentProps<typeof FlashPage>>;
	readonly FlashDesignPage: ComponentType<
		ComponentProps<typeof FlashDesignPage>
	>;
	/** `/reviews` (Reviews and Fresh ink, slice 3): the shared page in every theme's shell. */
	readonly ReviewsPage: ComponentType<ComponentProps<typeof ReviewsPage>>;
	/** `/fresh-ink` (slice 3): the shared page in every theme's shell. */
	readonly FreshInkPage: ComponentType<ComponentProps<typeof FreshInkPage>>;
	readonly RequestPage: ComponentType<ComponentProps<typeof RequestPage>>;
	/** `/about`, `/services`, `/faq`, `/contact`, `/policies`, `/aftercare` (Prompt 7). */
	readonly InfoPage: ComponentType<ComponentProps<typeof InfoPage>>;
}

/**
 * Every theme, by key. Stencil & Ink is the page TAT-97 and TAT-105 built;
 * Ink Noir (theme/ink-noir/) is the same pages in its own dark shell, with a
 * site navigation and a full footer, and its own home page, artists
 * directory and artist page (theme/ink-noir/home/, artists/ and artist/: the
 * same data, laid out as an editorial portfolio). Irezumi (theme/irezumi/) is
 * a light editorial look on warm paper with its own shell, home, artists,
 * artist, gallery, tattoo and booking pages; the flash and informational
 * pages are the shared ones in its shell. Atelier (theme/atelier/) is a
 * quiet-luxury catalogue on stone paper, with the same set of its own pages.
 * Flash Parlour (theme/flash-parlour/) is a traditional walk-in shop's wall
 * of flash on cream, with its own pages including the flash page and a
 * design's page, since there flash is the point. A theme's colours come from
 * the `<html>` class the root route sets (theme/html.ts), not from here.
 */
export const THEMES: Record<ThemeKey, Theme> = {
	"stencil-and-ink": {
		Shell: StencilShell,
		StudioPage,
		ArtistPage,
		ArtistsPage,
		WorkPage,
		ArtworkPage,
		FlashPage,
		FlashDesignPage,
		ReviewsPage,
		FreshInkPage,
		RequestPage,
		InfoPage,
	},
	"ink-noir": {
		Shell: InkNoirShell,
		StudioPage: InkNoirStudioPage,
		ArtistPage: InkNoirArtistPage,
		ArtistsPage: InkNoirArtistsPage,
		WorkPage: InkNoirGalleryPage,
		ArtworkPage: InkNoirArtworkPage,
		FlashPage,
		FlashDesignPage,
		ReviewsPage: InkNoirReviewsPage,
		FreshInkPage: InkNoirFreshInkPage,
		RequestPage: InkNoirBookPage,
		InfoPage: InkNoirInfoPage,
	},
	irezumi: {
		Shell: IrezumiShell,
		StudioPage: IrezumiStudioPage,
		ArtistPage: IrezumiArtistPage,
		ArtistsPage: IrezumiArtistsPage,
		WorkPage: IrezumiGalleryPage,
		ArtworkPage: IrezumiArtworkPage,
		FlashPage,
		FlashDesignPage,
		ReviewsPage: IrezumiReviewsPage,
		FreshInkPage: IrezumiFreshInkPage,
		RequestPage: IrezumiBookPage,
		InfoPage,
	},
	atelier: {
		Shell: AtelierShell,
		StudioPage: AtelierStudioPage,
		ArtistPage: AtelierArtistPage,
		ArtistsPage: AtelierArtistsPage,
		WorkPage: AtelierGalleryPage,
		ArtworkPage: AtelierArtworkPage,
		FlashPage,
		FlashDesignPage,
		ReviewsPage: AtelierReviewsPage,
		FreshInkPage: AtelierFreshInkPage,
		RequestPage: AtelierBookPage,
		InfoPage,
	},
	"flash-parlour": {
		Shell: FlashParlourShell,
		StudioPage: FlashParlourStudioPage,
		ArtistPage: FlashParlourArtistPage,
		ArtistsPage: FlashParlourArtistsPage,
		WorkPage: FlashParlourGalleryPage,
		ArtworkPage: FlashParlourArtworkPage,
		FlashPage: FlashParlourFlashPage,
		FlashDesignPage: FlashParlourFlashDesignPage,
		ReviewsPage: FlashParlourReviewsPage,
		FreshInkPage: FlashParlourFreshInkPage,
		RequestPage: FlashParlourBookPage,
		InfoPage,
	},
};

/** The theme with this key, else the default. */
export function themeFor(key: string): Theme {
	return Object.hasOwn(THEMES, key)
		? THEMES[key as ThemeKey]
		: THEMES[DEFAULT_THEME_KEY];
}

/** `/` in the studio's theme. */
export function ThemedStudioPage(props: ComponentProps<typeof StudioPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.StudioPage {...props} Shell={theme.Shell} />;
}

/** `/artists/$slug` in the studio's theme. */
export function ThemedArtistPage(props: ComponentProps<typeof ArtistPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.ArtistPage {...props} Shell={theme.Shell} />;
}

/** `/artists` in the studio's theme. */
export function ThemedArtistsPage(props: ComponentProps<typeof ArtistsPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.ArtistsPage {...props} Shell={theme.Shell} />;
}

/** `/gallery` in the studio's theme. */
export function ThemedWorkPage(props: ComponentProps<typeof WorkPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.WorkPage {...props} Shell={theme.Shell} />;
}

/** `/flash` in the studio's theme (TAT-129). */
export function ThemedArtworkPage(props: ComponentProps<typeof ArtworkPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.ArtworkPage {...props} Shell={theme.Shell} />;
}

export function ThemedFlashPage(props: ComponentProps<typeof FlashPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.FlashPage {...props} Shell={theme.Shell} />;
}

/** `/flash/$id` in the studio's theme (TAT-129). */
export function ThemedFlashDesignPage(
	props: ComponentProps<typeof FlashDesignPage>,
) {
	const theme = themeFor(props.data.theme.key);
	return <theme.FlashDesignPage {...props} Shell={theme.Shell} />;
}

/** `/about`, `/services`, `/faq`, `/contact`, `/policies` and `/aftercare` in the studio's theme. */
export function ThemedInfoPage(props: ComponentProps<typeof InfoPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.InfoPage {...props} Shell={theme.Shell} />;
}

/** `/book` in the studio's theme. */
export function ThemedRequestPage(props: ComponentProps<typeof RequestPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.RequestPage {...props} Shell={theme.Shell} />;
}

/** `/reviews` in the studio's theme (Reviews and Fresh ink, slice 3). */
export function ThemedReviewsPage(props: ComponentProps<typeof ReviewsPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.ReviewsPage {...props} Shell={theme.Shell} />;
}

/** `/fresh-ink` in the studio's theme (slice 3). */
export function ThemedFreshInkPage(props: ComponentProps<typeof FreshInkPage>) {
	const theme = themeFor(props.data.theme.key);
	return <theme.FreshInkPage {...props} Shell={theme.Shell} />;
}
