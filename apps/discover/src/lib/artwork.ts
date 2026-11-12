import { notFound, redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import type {
	DiscoverClient,
	DiscoverTattooDetail,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { crumbs } from "./breadcrumbs.ts";
import type { DiscoverContext } from "./context.ts";
import type { ResolvedCountry } from "./country.ts";
import { tattooAlt } from "./home.ts";
import { placeLine, rethrowMissing, summary } from "./profiles.ts";
import { paths } from "./routes.ts";
import { fitTitle } from "./seo.ts";
import { artworkLd, breadcrumbLd, type JsonLd } from "./structured-data.ts";

/**
 * The artwork page's address, reads and words (D09, `/tattoos/:slug`,
 * docs/discover/frontend.md, "Artwork pages").
 *
 * The slug is the API's photo id: the only stable public identifier a
 * photo has (it has no title; `alt` is alt text the studio may rewrite).
 * The canonical slug is the id in lower case. A readable prefix
 * (`koi-sleeve-<id>`) or an upper-case id still resolves, by the id part
 * only, and the page 301s to the canonical address; a slug without an id
 * is the 404 page without a request. Nothing is ever looked up by text.
 */

const ID_AT_END =
	/(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const READABLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
/** The longest slug read (an id is 36 characters). */
export const MAX_ARTWORK_SLUG = 200;

/** The photo id an address names, and whether the address is its canonical spelling. */
export function readArtworkSlug(
	param: unknown,
): { id: string; canonical: boolean } | undefined {
	if (typeof param !== "string" || param.length > MAX_ARTWORK_SLUG) return;
	const match = ID_AT_END.exec(param);
	const found = match?.[1];
	if (!found) return;
	const prefix = param.slice(0, param.length - found.length).replace(/-$/, "");
	if (prefix && !READABLE.test(prefix)) return;
	const id = found.toLowerCase();
	return { id, canonical: param === id };
}

/** How long a shared cache may keep an angle's redirect: a minute, like the API's reads. */
export const ANGLE_REDIRECT_CACHE = "public, max-age=60";

/**
 * Where an artwork address must go instead, or null to show it. Another
 * spelling of the same photo's id is a permanent 301 to its canonical one.
 * An id the API answered with another photo (angles: one of a tattoo's other
 * photos answers with the tattoo, whose id is its main photo's) is a
 * temporary 302, kept by a cache for a minute only: which photo leads a
 * tattoo can change (another made the main one, the photo taken out of the
 * tattoo), and a 301 kept forever could then send visitors in a loop. The
 * storefront's `/gallery/<id>` does the same.
 */
export function artworkRedirect(
	slug: { id: string; canonical: boolean },
	tattooId: string,
):
	| { href: string; statusCode: 301 }
	| { href: string; statusCode: 302; headers: Record<string, string> }
	| null {
	if (tattooId !== slug.id) {
		return {
			href: paths.tattoo(tattooId),
			statusCode: 302,
			headers: { "Cache-Control": ANGLE_REDIRECT_CACHE },
		};
	}
	if (!slug.canonical) return { href: paths.tattoo(tattooId), statusCode: 301 };
	return null;
}

/** The canonical slug of a photo (`paths.tattoo` builds its address from it). */
export function artworkSlug(id: string): string {
	return id.toLowerCase();
}

/**
 * An artwork's heading: the studio's own description (its alt text) when
 * it wrote one, else "Blackwork tattoo by Sita Rai" from its data. Never
 * invented.
 */
export function artworkTitle(tattoo: DiscoverTattooSummary): string {
	const own = tattoo.image.alt?.trim();
	if (own) return summary(own, 90);
	const style = tattoo.styles[0];
	return `${style ? `${style.name} tattoo` : "Tattoo"} by ${tattoo.artist.name}`;
}

/** Who made it and where: "Sita Rai at Black Needle", or the artist alone for an independent. */
export function artworkCredit(tattoo: DiscoverTattooSummary): string {
	return tattoo.studio.type === "independent"
		? tattoo.artist.name
		: `${tattoo.artist.name} at ${tattoo.studio.name}`;
}

export type ArtworkSeo = {
	title: string;
	description: string;
	image: { url: string; width: number; height: number; alt: string };
};

/**
 * The page's title, description and social card, from the API's answer
 * (server-rendered). A photo has no title (D09), so the title says what
 * the data says, most important first, shortened at whole parts
 * (`fitTitle`): the studio's own alt text (cut at a word) or its style,
 * then who made it, then the studio and the city.
 */
export function artworkSeo(tattoo: DiscoverTattooDetail): ArtworkSeo {
	const own = tattoo.image.alt?.trim();
	const style = tattoo.styles[0];
	const independent = tattoo.studio.type === "independent";
	const what = own
		? `${summary(own, 70)}, tattoo by ${artworkCredit(tattoo)}`
		: `${style ? `${style.name} tattoo` : "Tattoo"} by ${artworkCredit(tattoo)}`;
	const where = placeLine(tattoo.location);
	return {
		title: fitTitle([
			own
				? `${summary(own, 50)} — tattoo by ${tattoo.artist.name}`
				: `${style ? `${style.name} tattoo` : "Tattoo"} by ${tattoo.artist.name}`,
			...(independent ? [] : [` at ${tattoo.studio.name}`]),
			...(tattoo.location ? [`, ${tattoo.location.name}`] : []),
		]),
		description: summary(
			`${what}${where ? ` in ${where}` : ""}. See more of ${tattoo.artist.name}'s work on Tattoo Drip and request a similar tattoo on ${independent ? "their own site" : "the studio's own site"}.`,
		),
		image: {
			url: tattoo.image.url,
			width: tattoo.image.width,
			height: tattoo.image.height,
			alt: tattooAlt(tattoo),
		},
	};
}

/** The photos each related section shows, at most. */
export const RELATED_SHOWN = 8;
/** One more than shown, so the current photo can be left out. */
const RELATED_READ = RELATED_SHOWN + 1;

/**
 * The related reads, composed from the tattoos list's own filters (no
 * endpoint of their own): the artist's newest work (global, as their
 * profile), and the newest work in the photo's first style in the page's
 * country (D06.5: the address's `?country=`, else the visitor's).
 */
export function relatedQueries(
	client: DiscoverClient,
	tattoo: Pick<DiscoverTattooSummary, "artist" | "styles">,
	country: string,
) {
	const style = tattoo.styles[0]?.slug;
	return {
		byArtist: discoverQueries.tattoos(client, {
			artist: tattoo.artist.id,
			limit: RELATED_READ,
		}),
		byStyle: style
			? discoverQueries.tattoos(client, { style, country, limit: RELATED_READ })
			: undefined,
	};
}

/**
 * The two related sections: never the current photo, never one photo
 * twice (the style section leaves out what the artist's shows), each at
 * most `max`, in the API's order (newest first).
 */
export function relatedWork<T extends { id: string }>(
	currentId: string,
	byArtist: readonly T[] = [],
	byStyle: readonly T[] = [],
	max = RELATED_SHOWN,
): { byArtist: T[]; byStyle: T[] } {
	const seen = new Set([currentId]);
	const take = (list: readonly T[]) => {
		const out: T[] = [];
		for (const each of list) {
			if (out.length >= max) break;
			if (seen.has(each.id)) continue;
			seen.add(each.id);
			out.push(each);
		}
		return out;
	};
	const artist = take(byArtist);
	return { byArtist: artist, byStyle: take(byStyle) };
}

type LoaderContext = Pick<DiscoverContext, "queryClient" | "discover"> & {
	country: ResolvedCountry;
};

/**
 * `/tattoos/:slug`: the photo (required: the API's 404, for anything it
 * doesn't show, is the not-found page; a transient failure the error
 * page), then its related reads (optional: a failure hides a section). A
 * non-canonical slug of a shown photo is a 301 to its canonical address.
 */
export async function loadArtwork(
	context: LoaderContext,
	param: string,
): Promise<{ seo: ArtworkSeo; structured: JsonLd[] }> {
	const slug = readArtworkSlug(param);
	if (!slug) throw notFound();
	const { queryClient, discover } = context;
	const tattoo = await queryClient
		.ensureQueryData(discoverQueries.tattoo(discover.client, slug.id))
		.catch(rethrowMissing);
	const moved = artworkRedirect(slug, tattoo.id);
	if (moved) throw redirect(moved);
	const related = relatedQueries(
		discover.client,
		tattoo,
		context.country.country,
	);
	await Promise.all(
		[related.byArtist, related.byStyle].map((options) =>
			options
				? queryClient.ensureQueryData(options).catch((): undefined => undefined)
				: undefined,
		),
	);
	const { settings } = discover;
	const path = paths.tattoo(tattoo.id);
	return {
		seo: artworkSeo(tattoo),
		structured: [
			artworkLd(settings, tattoo, artworkTitle(tattoo)),
			breadcrumbLd(settings, crumbs.artwork(artworkTitle(tattoo)), path),
		],
	};
}

/** The history state a gallery card's link leaves, so the artwork page can go back to that gallery. */
export const FROM_GALLERY = { fromGallery: true } as const;

/** Whether this history entry came from the gallery (a card's link). */
export function cameFromGallery(state: unknown): boolean {
	return (state as { fromGallery?: unknown } | null)?.fromGallery === true;
}
