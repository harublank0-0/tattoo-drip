import type {
	DiscoverArtistDetail,
	DiscoverReviewsPage,
	DiscoverStudioDetail,
	DiscoverTattooDetail,
} from "@tattoo-drip/sdk";
import type { ComponentProps } from "react";
import { safeSocialUrl } from "./booking.ts";
import type { Crumb } from "./breadcrumbs.ts";
import type { PublicSettings } from "./config.ts";
import { tattooProfile } from "./destinations.ts";
import { tattooAlt } from "./home.ts";
import { reviewsLd } from "./reviews.ts";
import { paths } from "./routes.ts";
import {
	BRAND_IMAGE,
	type HeadMatch,
	pageState,
	robotsValue,
	SITE_NAME,
	siteUrl,
} from "./seo.ts";

/**
 * Discover's structured data (D10; docs/discover/frontend.md, "Structured
 * data"): schema.org JSON-LD built only from what the page shows (the API's
 * public answer), never a price, opening hour or any field the page doesn't
 * have; ratings and reviews only on a studio's profile, from 3 reviews, as
 * the page shows them (Reviews and Fresh ink, ruling 10: `reviewsLd`). One script per page (`@graph`), rendered on the
 * server through the head (`"script:ld+json"`, which the router serialises
 * with `<`, `>` and `&` escaped), and only on an indexable 200 page.
 */

type Settings = Pick<PublicSettings, "siteUrl" | "indexing">;
export type JsonLd = Record<string, unknown>;

const SCHEMA = "https://schema.org";

/** `@id`s of the site's own nodes, so pages can refer to them. */
export function siteIds(settings: Settings) {
	const root = siteUrl(settings, "/");
	return { website: `${root}#website`, organization: `${root}#organization` };
}

/** Tattoo Drip itself: the organisation behind Discover, with its mark as the logo. */
export function organizationLd(settings: Settings): JsonLd {
	return {
		"@type": "Organization",
		"@id": siteIds(settings).organization,
		name: SITE_NAME,
		url: siteUrl(settings, "/"),
		logo: {
			"@type": "ImageObject",
			url: siteUrl(settings, BRAND_IMAGE.path),
			width: BRAND_IMAGE.width,
			height: BRAND_IMAGE.height,
		},
	};
}

/**
 * The site, with its search: the homepage's own search box submits a GET to
 * `/explore/studios?q=` (studio names), a page a crawler can load for any
 * term, so the SearchAction describes a real URL template.
 */
export function websiteLd(settings: Settings): JsonLd {
	const ids = siteIds(settings);
	return {
		"@type": "WebSite",
		"@id": ids.website,
		name: SITE_NAME,
		url: siteUrl(settings, "/"),
		publisher: { "@id": ids.organization },
		potentialAction: {
			"@type": "SearchAction",
			target: {
				"@type": "EntryPoint",
				urlTemplate: `${siteUrl(settings, paths.studios())}?q={search_term_string}`,
			},
			"query-input": "required name=search_term_string",
		},
	};
}

/** The page's visible breadcrumbs as a BreadcrumbList: the same labels, in order; the last is the page. */
export function breadcrumbLd(
	settings: Settings,
	items: readonly Crumb[],
	pagePath: string,
): JsonLd {
	return {
		"@type": "BreadcrumbList",
		itemListElement: items.map((crumb, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: crumb.label,
			item: siteUrl(
				settings,
				index === items.length - 1 ? pagePath : (crumb.to ?? pagePath),
			),
		})),
	};
}

/** The https social links a profile shows (the same rule as `SocialLinks`). */
function sameAs(links: readonly { url: string }[]): string[] | undefined {
	const urls = [
		...new Set(links.flatMap((link) => safeSocialUrl(link.url) ?? [])),
	];
	return urls.length > 0 ? urls : undefined;
}

/** Only the public place: locality, region and country from the listing, never a street. */
function addressOf(location: DiscoverStudioDetail["location"]) {
	if (!location) return undefined;
	return {
		"@type": "PostalAddress",
		addressLocality: location.name,
		...(location.region ? { addressRegion: location.region } : {}),
		addressCountry: location.country,
	};
}

/**
 * A studio's profile: a TattooParlor (a LocalBusiness), at its Discover
 * address; with its clients' `aggregateRating` and `review` only from 3
 * reviews (the page's first page of them, as shown).
 */
export function studioLd(
	settings: Settings,
	studio: DiscoverStudioDetail,
	reviews?: DiscoverReviewsPage,
): JsonLd {
	const url = siteUrl(settings, paths.studio(studio.slug));
	const images = [studio.cover?.url, studio.tattoos[0]?.image.url].filter(
		(each): each is string => Boolean(each),
	);
	return clean({
		"@type": "TattooParlor",
		"@id": `${url}#studio`,
		name: studio.name,
		url,
		image: images[0],
		logo: studio.logo?.url,
		address: addressOf(studio.location),
		sameAs: sameAs(studio.socialLinks),
		...reviewsLd(settings, studio.slug, reviews),
	});
}

/** An artist's profile: a Person; a studio's artist works for that studio (its Discover profile). */
export function artistLd(
	settings: Settings,
	artist: DiscoverArtistDetail,
): JsonLd {
	const url = siteUrl(
		settings,
		artist.independent
			? paths.independentArtist(artist.studio.slug)
			: paths.studioArtist(artist.studio.slug, artist.slug),
	);
	return clean({
		"@type": "Person",
		"@id": `${url}#artist`,
		name: artist.name,
		url,
		jobTitle: "Tattoo artist",
		image: artist.photo?.url,
		worksFor: artist.independent
			? undefined
			: {
					"@type": "TattooParlor",
					"@id": `${siteUrl(settings, paths.studio(artist.studio.slug))}#studio`,
					name: artist.studio.name,
					url: siteUrl(settings, paths.studio(artist.studio.slug)),
				},
		workLocation: artist.location
			? { "@type": "Place", address: addressOf(artist.location) }
			: undefined,
		sameAs: sameAs(artist.socialLinks),
	});
}

/** An artwork page: the photo as an ImageObject, credited to its artist (their Discover profile). */
export function artworkLd(
	settings: Settings,
	tattoo: DiscoverTattooDetail,
	/** The page's heading (`artworkTitle`). */
	title: string,
): JsonLd {
	const url = siteUrl(settings, paths.tattoo(tattoo.id));
	const profile = tattooProfile(tattoo);
	return clean({
		"@type": "ImageObject",
		"@id": `${url}#image`,
		url,
		contentUrl: tattoo.image.url,
		width: tattoo.image.width,
		height: tattoo.image.height,
		name: title,
		caption: tattooAlt(tattoo),
		creator: clean({
			"@type": "Person",
			name: tattoo.artist.name,
			url: profile ? siteUrl(settings, profile) : undefined,
		}),
	});
}

/** Drops undefined fields, so no empty key reaches the page. */
function clean(node: JsonLd): JsonLd {
	return Object.fromEntries(
		Object.entries(node).filter(([, value]) => value !== undefined),
	);
}

/** The head context a route's `head` receives, structurally. */
type HeadContext = {
	matches: readonly HeadMatch[];
	match: { context: { discover: { settings: Settings } } };
};

/**
 * A page's one JSON-LD script, as a head meta entry, or nothing: only on a
 * page that is indexable now (indexing on, an allowed path, no query, not
 * opted out, not a 404 or an error), the same decision as its robots tag.
 */
export function structuredData(
	{ matches, match }: HeadContext,
	nodes: readonly JsonLd[],
): ComponentProps<"meta">[] {
	const settings = match.context.discover.settings;
	const page = pageState(matches);
	if (nodes.length === 0 || robotsValue(settings, page.pathname, page))
		return [];
	const script = {
		"script:ld+json": { "@context": SCHEMA, "@graph": [...nodes] },
	};
	// The router's head renders this entry as the script (router-core's meta
	// type has it; React's meta props, which the route's head is typed with,
	// don't).
	return [script as ComponentProps<"meta">];
}

/** The JSON-LD a head entry from `structuredData` holds (tests). */
export function jsonLdOf(entry: unknown): JsonLd | undefined {
	return (entry as { "script:ld+json"?: JsonLd } | undefined)?.[
		"script:ld+json"
	];
}
