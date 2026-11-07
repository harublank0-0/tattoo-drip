import { paths } from "./routes.ts";

/**
 * Where a studio or an artist links (D07, docs/discover/frontend.md,
 * "Profile destinations"): one helper, so D08 changes every link at once.
 *
 * Discover's own profile pages don't exist yet, so today every destination
 * is the page the API names on the studio's own site (`storefrontUrl`).
 * `profile` is the Discover path D08 will serve, built from the API's
 * authoritative identifiers: a studio by its (current) slug; a studio's
 * artist by the studio's slug and the artist's slug, which is unique within
 * that studio only (two studios may each have a `maya`); an independent
 * artist by their business's (tenant's) slug, never by the artist's own.
 * D08 sets `PROFILE_PAGES` to true once those routes exist.
 */
export const PROFILE_PAGES = false;

export type StudioLike = {
	slug: string;
	storefrontUrl: string;
};

export type ArtistLike = {
	slug: string;
	independent: boolean;
	studio: { slug: string };
	storefrontUrl: string;
};

export type Destination = {
	/** Where the link goes now. */
	href: string;
	/** Whether it leaves Discover (the studio's own site). */
	external: boolean;
	/** Discover's own profile path (D08); not linked while `PROFILE_PAGES` is false. */
	profile: string;
};

function isArtist(entity: StudioLike | ArtistLike): entity is ArtistLike {
	return "independent" in entity && "studio" in entity;
}

/** Discover's (planned) profile path for a studio or an artist. */
export function profilePath(entity: StudioLike | ArtistLike): string {
	if (!isArtist(entity)) return paths.studio(entity.slug);
	return entity.independent
		? paths.independentArtist(entity.studio.slug)
		: paths.studioArtist(entity.studio.slug, entity.slug);
}

/** A studio's or an artist's link: the storefront page now, Discover's profile from D08. */
export function profileDestination(
	entity: StudioLike | ArtistLike,
	profilePages: boolean = PROFILE_PAGES,
): Destination {
	const profile = profilePath(entity);
	return profilePages
		? { href: profile, external: false, profile }
		: { href: entity.storefrontUrl, external: true, profile };
}
