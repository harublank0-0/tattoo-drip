import { rootRouteId } from "@tanstack/react-router";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import type { FlashDesignView } from "./flash.ts";
import { flashDesignHref, requestHref } from "./links.ts";
import { trimDescription } from "./text.ts";
import type { ArtistPhoto, ArtistView, StudioView } from "./view-model.ts";

/**
 * Each page's head (TAT-48): title, description, canonical URL, Open Graph
 * and, on the studio page, minimal JSON-LD of what the page shows.
 */

export interface PageSeo {
	readonly title: string;
	readonly description: string;
	/** Absolute, from the site origin (src/site/). */
	readonly canonical: string;
	readonly type: "website" | "profile";
	readonly siteName: string;
	readonly image: ArtistPhoto | null;
	readonly jsonLd: Record<string, unknown> | null;
}

export type HeadMeta =
	| { title: string }
	| { name: string; content: string }
	| { property: string; content: string };

/** The shape a route's `head` returns. */
export interface HeadTags {
	meta: HeadMeta[];
	links: { rel: string; href: string }[];
	scripts: { type: string; children: string }[];
}

export function studioPageSeo(
	studio: StudioView,
	artists: readonly ArtistView[],
	origin: string,
): PageSeo {
	const canonical = `${origin}/`;
	const description = studio.intro
		? trimDescription(studio.intro)
		: studio.type === "independent"
			? `${studio.name}, independent tattoo artist. Send an inquiry.`
			: `${studio.name}, tattoo studio. See the artists and send an inquiry.`;
	// A studio's only artist is the studio's face; among several, no one is.
	const image = artists.length === 1 ? artists[0].photo : null;
	return {
		title: studio.name,
		description,
		canonical,
		type: "website",
		siteName: studio.name,
		image,
		jsonLd: studioJsonLd(studio, canonical, description, image),
	};
}

export function artistPageSeo(
	studio: StudioView,
	artist: ArtistView,
	origin: string,
): PageSeo {
	const sameName = artist.name === studio.name;
	const description = artist.bio
		? trimDescription(artist.bio)
		: sameName
			? `${artist.name} is a tattoo artist. Send an inquiry.`
			: `${artist.name} is a tattoo artist at ${studio.name}. Send an inquiry.`;
	return {
		title: sameName ? artist.name : `${artist.name} at ${studio.name}`,
		description,
		canonical: `${origin}${artist.pageHref}`,
		type: "profile",
		siteName: studio.name,
		image: artist.photo,
		jsonLd: null,
	};
}

/**
 * The All work page's head (TAT-126). One canonical address whatever the
 * filters or page, so a search engine indexes the page and not each filter;
 * no image (the page has many) and no JSON-LD.
 */
export function workPageSeo(studio: StudioView, origin: string): PageSeo {
	const independent = studio.type === "independent";
	return {
		title: `${studioCopy.work.pageTitle} ${independent ? "by" : "at"} ${studio.name}`,
		description: `Tattoos by ${independent ? studio.name : `the artists of ${studio.name}`}, newest first.`,
		canonical: `${origin}/work`,
		type: "website",
		siteName: studio.name,
		image: null,
		jsonLd: null,
	};
}

/**
 * The flash page's head (TAT-129). One canonical address whatever the filter
 * or page, so a search engine indexes the page and not each filter; no image
 * (the page has many) and no JSON-LD.
 */
export function flashPageSeo(studio: StudioView, origin: string): PageSeo {
	const independent = studio.type === "independent";
	return {
		title: `${studioCopy.flash.pageTitle} ${independent ? "by" : "at"} ${studio.name}`,
		description: `Flash designs by ${independent ? studio.name : `the artists of ${studio.name}`}: pick one and ask for it.`,
		canonical: `${origin}/flash`,
		type: "website",
		siteName: studio.name,
		image: null,
		jsonLd: null,
	};
}

/**
 * One flash design's head (TAT-129): its name and artist (one name when the
 * studio is named like the artist, as the artist page does), what it is and
 * how to ask. No image (the picture is not the artist's photo) and no JSON-LD.
 */
export function flashDesignSeo(
	studio: StudioView,
	design: FlashDesignView,
	origin: string,
): PageSeo {
	const artist = design.artist;
	const sameName = artist?.name === studio.name;
	const by = artist ? `, flash by ${artist.name}` : ", flash";
	const price = design.priceText ? `, ${design.priceText}` : "";
	return {
		title: `${design.name}${by}${artist && sameName ? "" : ` at ${studio.name}`}`,
		description: trimDescription(
			`A flash design${artist ? ` by ${artist.name}` : ""}, ${design.size}${price}. Ask ${studio.name} for it.`,
		),
		canonical: `${origin}${flashDesignHref(design.id)}`,
		type: "website",
		siteName: studio.name,
		image: null,
		jsonLd: null,
	};
}

/**
 * The request page's head (TAT-127). While the page invites (`open`), with an
 * artist the title and description name them, as the artist page's do (one
 * name when they are named like their studio). While it declines (a closed
 * artist or studio: the page says "Inquiries" and that no one is taking new
 * ones) the head says the same, so the tab, the search snippet and the share
 * card never advertise an invitation the page refuses. The canonical address
 * keeps the artist (`/request?artist=<slug>`) either way, because Facebook keys
 * a shared link by its canonical `og:url`; a page for the general form is
 * `/request`, whatever else the address carried.
 */
export function requestPageSeo(
	studio: StudioView,
	artist: ArtistView | null,
	origin: string,
	open: boolean,
): PageSeo {
	const sameName = artist?.name === studio.name;
	const who = artist?.name ?? studio.name;
	const named = artist && !sameName ? artist : null;
	const title = open
		? named
			? `${studioCopy.sendIdea} to ${named.name} at ${studio.name}`
			: `${studioCopy.sendIdea} to ${who}`
		: named
			? fill(studioCopy.request.closedTitleArtist, {
					name: named.name,
					studio: studio.name,
				})
			: fill(studioCopy.request.closedTitle, { studio: studio.name });
	return {
		title,
		description: open
			? `Tell ${who} about the tattoo you'd like: the idea, where it goes and the dates that suit you.`
			: fill(studioCopy.request.closedDescription, { who }),
		canonical: `${origin}${requestHref(artist ? { artist: artist.slug } : {})}`,
		type: "website",
		siteName: studio.name,
		image: artist?.photo ?? null,
		jsonLd: null,
	};
}

/** schema.org TattooParlor with only the public fields the page shows. */
export function studioJsonLd(
	studio: StudioView,
	canonical: string,
	description: string,
	image: ArtistPhoto | null,
): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "TattooParlor",
		name: studio.name,
		url: canonical,
		description,
		...(studio.phone ? { telephone: studio.phone } : {}),
		...(studio.email ? { email: studio.email } : {}),
		...(studio.address
			? { address: studio.address.text.replace(/\n+/g, ", ") }
			: {}),
		...(studio.socialUrls.length > 0 ? { sameAs: [...studio.socialUrls] } : {}),
		...(image ? { image: image.src } : {}),
	};
}

const SCRIPT_ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

/**
 * JSON for a `<script type="application/ld+json">`. The router inserts head
 * script children as raw HTML, so nothing here may close the element: the
 * characters that could are written as JSON escapes (still the same JSON).
 */
export function serializeJsonLd(value: unknown): string {
	return JSON.stringify(value).replace(
		/[<>&\u2028\u2029]/g,
		(character) => SCRIPT_ESCAPES[character] ?? character,
	);
}

export function headTags(seo: PageSeo): HeadTags {
	const meta: HeadMeta[] = [
		{ title: seo.title },
		{ name: "description", content: seo.description },
		{ property: "og:type", content: seo.type },
		{ property: "og:site_name", content: seo.siteName },
		{ property: "og:title", content: seo.title },
		{ property: "og:description", content: seo.description },
		{ property: "og:url", content: seo.canonical },
	];
	if (seo.image) {
		meta.push(
			{ property: "og:image", content: seo.image.src },
			{ property: "og:image:width", content: String(seo.image.width) },
			{ property: "og:image:height", content: String(seo.image.height) },
			{ property: "og:image:alt", content: seo.image.alt },
		);
	}
	meta.push({
		name: "twitter:card",
		content: seo.image ? "summary_large_image" : "summary",
	});
	return {
		meta,
		links: [{ rel: "canonical", href: seo.canonical }],
		scripts: seo.jsonLd
			? [{ type: "application/ld+json", children: serializeJsonLd(seo.jsonLd) }]
			: [],
	};
}

/** The head of a page that failed: `notFound`, or anything else (an error). */
export function statusHead(status: string): HeadTags {
	return {
		meta: [
			{ title: status === "notFound" ? "Page not found" : "Please try again" },
			{ name: "robots", content: "noindex" },
		],
		links: [],
		scripts: [],
	};
}

/**
 * The root route's title and robots tags (src/routes/__root.tsx). A page
 * route sets its own head and wins over this one; this is what a path no page
 * route matches (the prototype's /admin/*) and a failed studio read
 * show: the not-found or error head, noindex, never the studio's name as the
 * title of a page that isn't the studio's page. Otherwise the studio's name,
 * the title of a page that sets none. (A root loader's `notFound()` leaves
 * the match's status "success" and sets its `_notFound` flag, so the flag is
 * read too.)
 */
export function rootMeta({
	loaderData,
	match,
	matches,
}: {
	loaderData: { name: string } | undefined;
	match: { status: string; _notFound?: boolean };
	matches: readonly { routeId: string }[];
}): HeadMeta[] {
	const pageMatched = matches.some(
		(candidate) => candidate.routeId !== rootRouteId,
	);
	if (!pageMatched || match._notFound) return statusHead("notFound").meta;
	return loaderData
		? [{ title: loaderData.name }]
		: statusHead(match.status).meta;
}
