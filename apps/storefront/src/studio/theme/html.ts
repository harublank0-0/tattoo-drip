import {
	ATELIER_CLASS,
	ATELIER_SCHEME,
	ATELIER_THEME_COLOR,
} from "./atelier/theme.ts";
import type { Scheme } from "./branding.ts";
import {
	DEFAULT_THEME_KEY,
	type FontKey,
	studioFontKey,
	studioThemeKey,
	type ThemeKey,
} from "./config.ts";
import {
	FLASH_PARLOUR_CLASS,
	FLASH_PARLOUR_SCHEME,
	FLASH_PARLOUR_THEME_COLOR,
} from "./flash-parlour/theme.ts";
import {
	INK_NOIR_CLASS,
	INK_NOIR_SCHEME,
	INK_NOIR_THEME_COLOR,
} from "./ink-noir/theme.ts";
import {
	IREZUMI_CLASS,
	IREZUMI_DARK_SCHEME,
	IREZUMI_SCHEME,
	IREZUMI_THEME_COLORS,
} from "./irezumi/theme.ts";

/**
 * What a theme sets on the whole page, `<html>` and `<head>` included, which
 * the root route renders before any page's loader has run. Pure. A theme has
 * one fixed `scheme`, or none and then may name its own two (`schemes`):
 * never both.
 */
export type ThemeHtml = {
	/** The class on `<html>` that switches src/styles.css's tokens to the theme's; null keeps `:root`'s. */
	readonly className: string | null;
	/** `<meta name="theme-color">`: the browser's own UI around the page. */
	readonly themeColors: readonly {
		readonly content: string;
		readonly media?: string;
	}[];
} & (
	| {
			/**
			 * The one colour scheme the theme always uses, whatever the device
			 * prefers. The brand accent is checked against this scheme
			 * (branding.ts).
			 */
			readonly scheme: Scheme;
			readonly schemes?: undefined;
	  }
	| {
			/** None: the theme follows the device (light and dark). */
			readonly scheme: null;
			/**
			 * A theme with its own class that follows the device (Irezumi): its
			 * light and dark schemes, which the brand accent is checked against
			 * in each scheme's media query. Absent for Stencil & Ink, whose
			 * schemes are branding.ts's LIGHT and DARK.
			 */
			readonly schemes?: { readonly light: Scheme; readonly dark: Scheme };
	  }
);

export const THEME_HTML: Record<ThemeKey, ThemeHtml> = {
	"stencil-and-ink": {
		className: null,
		scheme: null,
		themeColors: [
			{ content: "#f7f3ee", media: "(prefers-color-scheme: light)" },
			{ content: "#14110f", media: "(prefers-color-scheme: dark)" },
		],
	},
	"ink-noir": {
		className: INK_NOIR_CLASS,
		scheme: INK_NOIR_SCHEME,
		themeColors: [{ content: INK_NOIR_THEME_COLOR }],
	},
	irezumi: {
		className: IREZUMI_CLASS,
		scheme: null,
		schemes: { light: IREZUMI_SCHEME, dark: IREZUMI_DARK_SCHEME },
		themeColors: IREZUMI_THEME_COLORS,
	},
	atelier: {
		className: ATELIER_CLASS,
		scheme: ATELIER_SCHEME,
		themeColors: [{ content: ATELIER_THEME_COLOR }],
	},
	"flash-parlour": {
		className: FLASH_PARLOUR_CLASS,
		scheme: FLASH_PARLOUR_SCHEME,
		themeColors: [{ content: FLASH_PARLOUR_THEME_COLOR }],
	},
};

/**
 * Routes that keep the default look whatever the studio's theme: the deposit
 * page (TAT-65b), a payment page that is not themable (its route adds no
 * brand style either).
 */
const UNTHEMED_ROUTES: ReadonlySet<string> = new Set(["/deposit", "/review"]);

/** Whether an unthemed route (the deposit or review page) is among the matches: it shows no theme and no preview. */
export function isUnthemedPage(
	matches: readonly { readonly routeId: string }[],
): boolean {
	return matches.some((match) => UNTHEMED_ROUTES.has(match.routeId));
}

/** The root route's id in TanStack Router (`rootRouteId`). */
const ROOT_ROUTE_ID = "__root__";

/**
 * The theme of the page the router has matched: the studio's (`Studio.
 * storefront.theme`, from the root loader's data, the studio this request's
 * host named), unless an unthemed route is among the matches; the default
 * while there is no studio (a failed read). Computed from the matches on the
 * server and again in the browser from the same dehydrated data, so both
 * render the same `<html>`, and never stored anywhere a second request could
 * see it.
 */
export function matchedThemeKey(
	matches: readonly {
		readonly routeId: string;
		readonly loaderData?: unknown;
	}[],
): ThemeKey {
	if (isUnthemedPage(matches)) {
		return DEFAULT_THEME_KEY;
	}
	const root = matches.find((match) => match.routeId === ROOT_ROUTE_ID);
	return studioThemeKey(root?.loaderData);
}

/** The heading font files a page can preload: one of each face's Latin subset. */
export type HeadingFontFile = "eczar" | "bodoni-moda" | "shrikhand";

/**
 * The one heading font file a page preloads: the theme's own face while the
 * studio keeps the default font (Atelier's Bodoni, Flash Parlour's
 * Shrikhand), else Eczar's (the default theme's face, and still preloaded
 * for a studio that picked Serif or Plain, which use system faces). Pure.
 */
export function headingFontFile(
	theme: ThemeKey,
	font: FontKey,
): HeadingFontFile {
	if (font !== "eczar") return "eczar";
	if (theme === "atelier") return "bodoni-moda";
	if (theme === "flash-parlour") return "shrikhand";
	return "eczar";
}

/**
 * The heading font file of the page the router has matched (the root route's
 * head): the matched theme (never an unthemed route's: `/deposit` is Eczar)
 * and the studio's font, both from the root loader's studio.
 */
export function matchedHeadingFont(
	matches: readonly {
		readonly routeId: string;
		readonly loaderData?: unknown;
	}[],
): HeadingFontFile {
	const root = matches.find((match) => match.routeId === ROOT_ROUTE_ID);
	return headingFontFile(
		matchedThemeKey(matches),
		studioFontKey(root?.loaderData),
	);
}
