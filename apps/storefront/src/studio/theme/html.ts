import {
	ATELIER_CLASS,
	ATELIER_SCHEME,
	ATELIER_THEME_COLOR,
} from "./atelier/theme.ts";
import type { Scheme } from "./branding.ts";
import { DEFAULT_THEME_KEY, studioThemeKey, type ThemeKey } from "./config.ts";
import {
	INK_NOIR_CLASS,
	INK_NOIR_SCHEME,
	INK_NOIR_THEME_COLOR,
} from "./ink-noir/theme.ts";
import {
	IREZUMI_CLASS,
	IREZUMI_SCHEME,
	IREZUMI_THEME_COLOR,
} from "./irezumi/theme.ts";

/**
 * What a theme sets on the whole page, `<html>` and `<head>` included, which
 * the root route renders before any page's loader has run. Pure.
 */
export interface ThemeHtml {
	/** The class on `<html>` that switches src/styles.css's tokens to the theme's; null keeps `:root`'s. */
	readonly className: string | null;
	/**
	 * The one colour scheme the theme always uses, whatever the device
	 * prefers, or null when it follows the device (light and dark). The brand
	 * accent is checked against this scheme's paper (branding.ts).
	 */
	readonly scheme: Scheme | null;
	/** `<meta name="theme-color">`: the browser's own UI around the page. */
	readonly themeColors: readonly {
		readonly content: string;
		readonly media?: string;
	}[];
}

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
		scheme: IREZUMI_SCHEME,
		themeColors: [{ content: IREZUMI_THEME_COLOR }],
	},
	atelier: {
		className: ATELIER_CLASS,
		scheme: ATELIER_SCHEME,
		themeColors: [{ content: ATELIER_THEME_COLOR }],
	},
};

/**
 * Routes that keep the default look whatever the studio's theme: the deposit
 * page (TAT-65b), a payment page that is not themable (its route adds no
 * brand style either).
 */
const UNTHEMED_ROUTES: ReadonlySet<string> = new Set(["/deposit"]);

/** Whether an unthemed route (the deposit page) is among the matches: it shows no theme and no preview. */
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
