import type { Studio } from "@tattoo-drip/sdk";
import { type BrandImage, parseThemeConfig } from "./theme/config.ts";
import { storefrontInput } from "./theme/source.ts";

/** A `<link>` of the root head. */
export interface IconLink {
	readonly rel: string;
	readonly href: string;
	readonly sizes?: string;
}

/** No icon: a stop, so the browser does not ask for /favicon.ico. */
const NO_ICON: IconLink[] = [{ rel: "icon", href: "data:," }];

/**
 * The browser tab's and home screen's icon (TAT-123): the logo's square icon,
 * checked by parseThemeConfig (the API's origin, square). Its narrowest copy
 * (the 32 px one) for the tab, the icon itself for larger screens and as the
 * Apple touch icon; without an icon, the stop. Pure.
 */
export function iconLinks(icon: BrandImage | null): IconLink[] {
	if (!icon) return NO_ICON;
	const links: IconLink[] = [];
	const first = icon.srcSet?.split(", ")[0]?.split(" ");
	const width = first ? Number.parseInt(first[1] ?? "", 10) : Number.NaN;
	if (first && Number.isInteger(width) && width < icon.width) {
		links.push({ rel: "icon", sizes: `${width}x${width}`, href: first[0] });
	}
	links.push(
		{ rel: "icon", sizes: `${icon.width}x${icon.height}`, href: icon.src },
		{ rel: "apple-touch-icon", href: icon.src },
	);
	return links;
}

/** The root head's icon links for the studio the root loader read, if it read one. */
export function studioIconLinks(
	studio: Studio | undefined,
	imageOrigin: string | null,
): IconLink[] {
	return iconLinks(
		studio ? parseThemeConfig(storefrontInput(studio), imageOrigin).icon : null,
	);
}
