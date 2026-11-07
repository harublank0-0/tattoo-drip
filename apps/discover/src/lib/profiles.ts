import { notFound, redirect } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import {
	type DiscoverArtistDetail,
	type DiscoverClient,
	type DiscoverStudioDetail,
	isTattooApiError,
} from "@tattoo-drip/sdk";
import { rethrowUnavailable } from "./api-errors.ts";
import type { DiscoverContext } from "./context.ts";
import { countryName } from "./country.ts";
import { paths } from "./routes.ts";

/**
 * The profile pages' reads and rules (D08, docs/discover/frontend.md,
 * "Profiles"): one detail read per page from the public API, by the
 * address's identifiers, plus (for a studio's artist) the studio's other
 * artists, read in parallel and optional. Profiles never depend on the
 * visitor's country: no country is sent and nothing is hidden or
 * redirected by it; the location shown is the profile's own.
 */

/** A studio's (tenant's) slug as the API checks it: 3–63, lower case, digits, inner hyphens. */
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** An artist's slug as the API checks it: 2–63. */
const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export function readTenantSlug(value: unknown): string | undefined {
	return typeof value === "string" && TENANT_SLUG.test(value)
		? value
		: undefined;
}

export function readArtistSlug(value: unknown): string | undefined {
	return typeof value === "string" && ARTIST_SLUG.test(value)
		? value
		: undefined;
}

/** The most other artists an artist's page shows from their studio. */
export const MORE_ARTISTS = 4;

export function studioProfileQueries(client: DiscoverClient, slug: string) {
	return { studio: discoverQueries.studio(client, slug) };
}

export function studioArtistQueries(
	client: DiscoverClient,
	studioSlug: string,
	artistSlug: string,
) {
	return {
		artist: discoverQueries.studioArtist(client, studioSlug, artistSlug),
		colleagues: discoverQueries.studioArtists(client, studioSlug),
	};
}

export function independentQueries(client: DiscoverClient, slug: string) {
	return { artist: discoverQueries.independentArtist(client, slug) };
}

/**
 * For a profile read's `.catch`: the API's 404 (unknown, never listed,
 * opted out, hidden, taken down, deleted, another studio's, the wrong kind:
 * all the same answer) is the router's not-found, with no hint of which; a
 * transient failure is the marked error (RouteErrorState); anything else
 * stays itself.
 */
export function rethrowMissing(error: unknown): never {
	if (isTattooApiError(error) && (error.status === 404 || error.status === 422))
		throw notFound();
	rethrowUnavailable(error);
}

/** Collapses whitespace and cuts plain text to a meta description's length, at a word. */
export function summary(text: string | null | undefined, max = 155): string {
	const flat = (text ?? "").replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const cut = flat.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** "Kathmandu, Nepal", "Kathmandu, Bagmati, Nepal" (long), or null. */
export function placeLine(
	location: DiscoverStudioDetail["location"],
	long = false,
): string | null {
	if (!location) return null;
	return [
		location.name,
		long ? location.region : null,
		countryName(location.country),
	]
		.filter(Boolean)
		.join(", ");
}

export type ProfileSeo = {
	title: string;
	description: string;
	/** The social card's picture: a cover or a published photo, absolute from the API. */
	image?: string;
	imageAlt?: string;
};

export function studioSeo(studio: DiscoverStudioDetail): ProfileSeo {
	const where = placeLine(studio.location);
	const lead = studio.tattoos[0];
	return {
		title: where ? `${studio.name}, tattoo studio in ${where}` : studio.name,
		description:
			summary(studio.intro) ||
			summary(
				`${studio.name} is a tattoo studio${where ? ` in ${where}` : ""} listed on Tattoo Drip. See recent work by its artists and request a session on the studio's own site.`,
			),
		...(studio.cover
			? { image: studio.cover.url, imageAlt: `${studio.name}'s studio` }
			: lead
				? { image: lead.image.url, imageAlt: `Tattoo by ${lead.artist.name}` }
				: {}),
	};
}

export function artistSeo(artist: DiscoverArtistDetail): ProfileSeo {
	const where = artist.location?.name;
	const role = artist.independent
		? `independent tattoo artist${where ? ` in ${where}` : ""}`
		: `tattoo artist at ${artist.studio.name}${where ? `, ${where}` : ""}`;
	const lead = artist.tattoos[0];
	const image = lead?.image ?? artist.photo;
	return {
		title: `${artist.name}, ${role}`,
		description:
			summary(artist.bio) ||
			summary(
				`${artist.name} is an ${role}, listed on Tattoo Drip. See their recent work and request a session on ${artist.independent ? "their own site" : "the studio's own site"}.`,
			),
		...(image
			? {
					image: image.url,
					imageAlt: lead
						? `Tattoo by ${artist.name}`
						: `${artist.name}, tattoo artist`,
				}
			: {}),
	};
}

type LoaderContext = Pick<DiscoverContext, "queryClient" | "discover">;

/**
 * `/studios/:slug`: the studio, by its current or an old slug. An old slug
 * is a 301 to the current one (the API names it), so a profile has one
 * address and one canonical. A listed independent artist's slug is a 301 to
 * `/artists/:slug` (one more read, only after the studio read's 404).
 */
export async function loadStudioProfile(
	context: LoaderContext,
	param: string,
): Promise<{ seo: ProfileSeo }> {
	const slug = readTenantSlug(param);
	if (!slug) throw notFound();
	const { queryClient, discover } = context;
	const studio = await queryClient
		.ensureQueryData(studioProfileQueries(discover.client, slug).studio)
		.catch(async (error: unknown) => {
			// An independent artist's business is not a studio (blueprint H):
			// its slug here is a 301 to their profile, when the API shows them.
			if (isTattooApiError(error) && error.status === 404) {
				const artist = await queryClient
					.ensureQueryData(independentQueries(discover.client, slug).artist)
					.catch((second: unknown) => {
						// Only a 404 means "no such artist either"; a transient
						// failure is the error page (Try again), never a 404.
						if (isTattooApiError(second) && second.status === 404) return null;
						return rethrowMissing(second);
					});
				if (artist)
					throw redirect({
						href: paths.independentArtist(artist.studio.slug),
						statusCode: 301,
					});
			}
			return rethrowMissing(error);
		});
	if (studio.slug !== slug)
		throw redirect({ href: paths.studio(studio.slug), statusCode: 301 });
	return { seo: studioSeo(studio) };
}

/**
 * `/studios/:studioSlug/artists/:artistSlug`: the artist (required) and the
 * studio's other artists (optional: a failure hides that section), in
 * parallel. An old studio slug is a 301 to the current address.
 */
export async function loadStudioArtistProfile(
	context: LoaderContext,
	studioParam: string,
	artistParam: string,
): Promise<{ seo: ProfileSeo }> {
	const studioSlug = readTenantSlug(studioParam);
	const artistSlug = readArtistSlug(artistParam);
	if (!studioSlug || !artistSlug) throw notFound();
	const { queryClient, discover } = context;
	const queries = studioArtistQueries(discover.client, studioSlug, artistSlug);
	// Both start now; only the artist is awaited first, so a slow optional
	// read never delays the page's answer (or its 404).
	const colleagues = queryClient
		.ensureQueryData(queries.colleagues)
		.catch((): undefined => undefined);
	const artist = await queryClient
		.ensureQueryData(queries.artist)
		.catch(rethrowMissing);
	await colleagues;
	if (artist.studio.slug !== studioSlug || artist.slug !== artistSlug)
		throw redirect({
			href: paths.studioArtist(artist.studio.slug, artist.slug),
			statusCode: 301,
		});
	return { seo: artistSeo(artist) };
}

/** `/artists/:tenantSlug`: an independent artist by their business's current or old slug. */
export async function loadIndependentProfile(
	context: LoaderContext,
	param: string,
): Promise<{ seo: ProfileSeo }> {
	const slug = readTenantSlug(param);
	if (!slug) throw notFound();
	const { queryClient, discover } = context;
	const artist = await queryClient
		.ensureQueryData(independentQueries(discover.client, slug).artist)
		.catch(rethrowMissing);
	if (artist.studio.slug !== slug)
		throw redirect({
			href: paths.independentArtist(artist.studio.slug),
			statusCode: 301,
		});
	return { seo: artistSeo(artist) };
}

/** "Black Needle's": whose site a profile's links open. */
export function possessive(name: string): string {
	return `${name}'s`;
}

/**
 * Where "more near here" goes from a profile: the profile's own place (never
 * the visitor's country). A market has location pages (D07): the city's and
 * the country's; another country goes to the directory filtered to it.
 */
export function nearbyLinks(
	location: DiscoverStudioDetail["location"],
	markets: readonly string[],
	kind: "studios" | "artists",
): {
	key: string;
	to: string;
	search?: Record<string, string>;
	text: string;
}[] {
	if (!location) return [];
	const what = kind === "studios" ? "studios" : "artists";
	const country = countryName(location.country);
	if (markets.includes(location.country))
		return [
			{
				key: "city",
				to: paths.city(location.country, location.slug),
				text: `Tattoo studios and artists in ${location.name}`,
			},
			{
				key: "country",
				to: paths.location(location.country),
				text: `Everywhere in ${country}`,
			},
		];
	return [
		{
			key: "city",
			to: kind === "studios" ? paths.studios() : paths.artists(),
			search: { country: location.country, city: location.slug },
			text: `More ${what} in ${location.name}`,
		},
	];
}
