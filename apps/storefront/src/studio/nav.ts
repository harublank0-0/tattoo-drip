import { studioCopy } from "./copy.ts";
import { artistsHref, flashHref, infoHref, workHref } from "./links.ts";
import type { SectionKey } from "./theme/config.ts";
import type { StudioPages } from "./view-model.ts";

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
	| "reviews"
	| "fresh-ink"
	| "request"
	| "about"
	| "services"
	| "faq"
	| "contact"
	| "policies"
	| "aftercare";

export type NavKey =
	| "home"
	| "artists"
	| "gallery"
	| "flash"
	| "services"
	| "about"
	| "contact"
	| "faq"
	| "policies"
	| "aftercare";

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
	pages: StudioPages | null = null,
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
	// The informational pages (Prompt 7), each only where it has content:
	// Services and About always have something true to say (Services needs an
	// artist), Contact needs a way to reach the studio.
	if (pages !== null) {
		// The same checks as infoContent's, so no link leads to a not-found.
		if (hasArtists && (pages.takingWork || sections.includes("flash"))) {
			items.push(link("services", page));
		}
		if (pages.about || hasArtists) items.push(link("about", page));
		if (pages.contact) items.push(link("contact", page));
	}
	return items;
}

/**
 * The footer's further pages (Prompt 7): the FAQ always, Policies and
 * Aftercare only where the studio wrote them and shows its Good to know.
 */
export function moreNavItems(
	sections: readonly SectionKey[],
	page: ShellPage,
	pages: StudioPages,
): NavItem[] {
	const shown = sections.includes("info");
	return [
		link("faq", page),
		...(shown && pages.policies ? [link("policies", page)] : []),
		...(shown && pages.aftercare ? [link("aftercare", page)] : []),
	];
}

function link(
	key: "services" | "about" | "contact" | "faq" | "policies" | "aftercare",
	page: ShellPage,
): NavItem {
	return {
		key,
		label: studioCopy.nav[key],
		href: infoHref(key),
		current: page === key ? "page" : undefined,
	};
}
