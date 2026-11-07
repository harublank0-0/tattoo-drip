import { paths } from "./routes.ts";

/**
 * Where a studio or an artist links (D07, docs/discover/frontend.md,
 * "Profile destinations"): one helper, so every link moved at once.
 *
 * Since D08 every destination is Discover's own profile, built from the
 * API's authoritative identifiers: a studio by its (current) slug; a
 * studio's artist by the studio's slug and the artist's slug, which is
 * unique within that studio only (two studios may each have a `maya`); an
 * independent artist by their business's (tenant's) slug, never by the
 * artist's own. The studio's own site (`storefrontUrl`) stays the profile's
 * "Visit studio site" and booking action (src/lib/booking.ts). With
 * `PROFILE_PAGES` false (D07) every link went to the storefront instead.
 */
export const PROFILE_PAGES = true;

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
	/** Discover's own profile path (D08). */
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

/** A studio's or an artist's link: Discover's profile (D08; the storefront page while `PROFILE_PAGES` is false). */
export function profileDestination(
	entity: StudioLike | ArtistLike,
	profilePages: boolean = PROFILE_PAGES,
): Destination {
	const profile = profilePath(entity);
	return profilePages
		? { href: profile, external: false, profile }
		: { href: entity.storefrontUrl, external: true, profile };
}

/**
 * The profile of the artist who made a photo, from the photo's own data:
 * the independent artist's (by their business's slug), else the studio
 * artist's (studio slug and artist slug). The API shows a photo only while
 * its artist is shown, so the profile exists. Undefined while
 * `PROFILE_PAGES` is false (photos had no destination of their own then).
 */
export function tattooProfile(
	tattoo: {
		artist: { slug: string };
		studio: { slug: string; type: "studio" | "independent" };
	},
	profilePages: boolean = PROFILE_PAGES,
): string | undefined {
	if (!profilePages) return undefined;
	return tattoo.studio.type === "independent"
		? paths.independentArtist(tattoo.studio.slug)
		: paths.studioArtist(tattoo.studio.slug, tattoo.artist.slug);
}

/**
 * Where an artist's link leaves Discover for, for screen readers: an
 * independent artist's own site, else their page on their studio's.
 */
export function artistSiteNote(artist: { independent: boolean }): string {
	return artist.independent
		? "their own site"
		: "their page on the studio's site";
}
