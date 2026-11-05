import { studioCopy } from "./copy.ts";
import { artistsHref, flashHref, workHref } from "./links.ts";
import type { SectionKey } from "./theme/config.ts";

/**
 * The site navigation of a theme that has one (Ink Noir's header, menu and
 * footer). Pure: every item is a page this app already serves, and its href
 * comes from links.ts like every other link. Artists is the directory
 * (`/artists`). The page a theme's shell wraps
 * says which item is current, so nothing reads the address.
 */

/** The page a shell wraps: which nav item is current follows from it. */
export type ShellPage =
	| "home"
	| "artists"
	| "artist"
	| "work"
	| "flash"
	| "flash-design"
	| "request";

export type NavKey = "home" | "artists" | "gallery" | "flash";

export interface NavItem {
	readonly key: NavKey;
	readonly label: string;
	readonly href: string;
	/**
	 * `aria-current`: "page" on the link to this very page, "true" on the one
	 * whose section this page belongs to (an artist's page under Artists, a
	 * flash design under Flash), else undefined.
	 */
	readonly current: "page" | "true" | undefined;
}

/**
 * The navigation for `page`, given the sections the studio shows. Artists
 * links to the directory and Flash to /flash, each only while the
 * studio shows that section on its page (a studio that hides its roster or
 * its flash has nothing to point at there), and Artists only while an artist
 * is visible (with none the directory only says so); Home and Gallery
 * (/gallery) always.
 */
export function navItems(
	sections: readonly SectionKey[],
	page: ShellPage,
	hasArtists: boolean,
): NavItem[] {
	const items: NavItem[] = [
		{
			key: "home",
			label: studioCopy.nav.home,
			href: "/",
			current: page === "home" ? "page" : undefined,
		},
	];
	if (sections.includes("artists") && hasArtists) {
		items.push({
			key: "artists",
			label: studioCopy.nav.artists,
			href: artistsHref({}),
			current:
				page === "artists" ? "page" : page === "artist" ? "true" : undefined,
		});
	}
	items.push({
		key: "gallery",
		label: studioCopy.nav.gallery,
		href: workHref({}),
		current: page === "work" ? "page" : undefined,
	});
	if (sections.includes("flash")) {
		items.push({
			key: "flash",
			label: studioCopy.nav.flash,
			href: flashHref({}),
			current:
				page === "flash"
					? "page"
					: page === "flash-design"
						? "true"
						: undefined,
		});
	}
	return items;
}
