import type { ComponentType } from "react";
import { ArtistPage, StudioPage } from "../components/pages.tsx";
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import { DEFAULT_THEME_KEY, type ThemeKey } from "./config.ts";

/** What a theme's pages take: the loader's data and the intake form's site key. */
export interface ThemePageProps<Data> {
	data: Data;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}

/**
 * A theme (TAT-54): the studio page's two pages as React components of this
 * app. A studio picks one by key and fills in its options; it never sends
 * markup. Every theme renders the inquiry section (InquirySection, with the
 * intake form) as it is, and never the deposit page.
 */
export interface Theme {
	readonly StudioPage: ComponentType<ThemePageProps<StudioPageData>>;
	readonly ArtistPage: ComponentType<ThemePageProps<ArtistPageData>>;
}

/** Every theme, by key. Stencil & Ink is the page TAT-97 and TAT-105 built. */
export const THEMES: Record<ThemeKey, Theme> = {
	"stencil-and-ink": { StudioPage, ArtistPage },
};

/** The theme with this key, else the default. */
export function themeFor(key: string): Theme {
	return Object.hasOwn(THEMES, key)
		? THEMES[key as ThemeKey]
		: THEMES[DEFAULT_THEME_KEY];
}

/** `/` in the studio's theme. */
export function ThemedStudioPage(props: ThemePageProps<StudioPageData>) {
	const Page = themeFor(props.data.theme.key).StudioPage;
	return <Page {...props} />;
}

/** `/artists/$slug` in the studio's theme. */
export function ThemedArtistPage(props: ThemePageProps<ArtistPageData>) {
	const Page = themeFor(props.data.theme.key).ArtistPage;
	return <Page {...props} />;
}
