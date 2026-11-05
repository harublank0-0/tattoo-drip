import type { ComponentProps, ComponentType } from "react";
import { InfoPage } from "../components/info.tsx";
import {
	ArtistPage,
	ArtistsPage,
	ArtworkPage,
	FlashDesignPage,
	FlashPage,
	RequestPage,
	StudioPage,
	WorkPage,
} from "../components/pages.tsx";
import { type Shell, StencilShell } from "../components/shell.tsx";
import { DEFAULT_THEME_KEY, type ThemeKey } from "./config.ts";
import { InkNoirArtistPage } from "./ink-noir/artist/artist-page.tsx";
import { InkNoirArtistsPage } from "./ink-noir/artists/artists-page.tsx";
import { InkNoirBookPage } from "./ink-noir/book/book-page.tsx";
import { InkNoirArtworkPage } from "./ink-noir/gallery/artwork-page.tsx";
import { InkNoirGalleryPage } from "./ink-noir/gallery/gallery-page.tsx";
import { InkNoirStudioPage } from "./ink-noir/home/home-page.tsx";
import { InkNoirInfoPage } from "./ink-noir/info/info-page.tsx";
import { InkNoirShell } from "./ink-noir/shell.tsx";

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
	readonly RequestPage: ComponentType<ComponentProps<typeof RequestPage>>;
	/** `/about`, `/services`, `/faq`, `/contact`, `/policies`, `/aftercare` (Prompt 7). */
	readonly InfoPage: ComponentType<ComponentProps<typeof InfoPage>>;
}

/**
 * Every theme, by key. Stencil & Ink is the page TAT-97 and TAT-105 built;
 * Ink Noir (theme/ink-noir/) is the same pages in its own dark shell, with a
 * site navigation and a full footer, and its own home page, artists
 * directory and artist page (theme/ink-noir/home/, artists/ and artist/: the
 * same data, laid out as an editorial portfolio). Its colours come from the `<html>`
 * class the root route sets (theme/html.ts), not from here.
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
		RequestPage: InkNoirBookPage,
		InfoPage: InkNoirInfoPage,
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
