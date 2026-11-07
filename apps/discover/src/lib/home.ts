import { discoverQueries } from "@tattoo-drip/react";
import type {
	DiscoverArtistSummary,
	DiscoverClient,
	DiscoverStudioSummary,
	DiscoverStyle,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";

/**
 * The homepage's reads (D06, docs/discover/frontend.md): modest first pages,
 * each the API's own order (newest first). The loader prefetches exactly
 * these and the sections read the same options, so nothing is asked twice.
 */
export const HOME_LIMITS = { tattoos: 24, studios: 8, artists: 8 } as const;

/**
 * The homepage's five query options, built one way for the loader and the
 * sections. Studios and artists come in the API's default order (`newest`:
 * most recently listed, or added), which is deterministic (ties by id): no
 * ranking, featuring or paid placement.
 */
export function homeQueries(client: DiscoverClient) {
	return {
		tattoos: discoverQueries.tattoos(client, { limit: HOME_LIMITS.tattoos }),
		studios: discoverQueries.studios(client, { limit: HOME_LIMITS.studios }),
		artists: discoverQueries.artists(client, { limit: HOME_LIMITS.artists }),
		styles: discoverQueries.styles(client),
		locations: discoverQueries.locations(client),
	};
}

export type HomeRead = keyof ReturnType<typeof homeQueries>;

/**
 * How much real data a section needs before it shows. Below it the section
 * is left out entirely: never an empty box, never a "0".
 */
export const HOME_THRESHOLDS = {
	/** Recent photos for the hero's collage; fewer and the hero is typographic. */
	heroCollage: 4,
	/** Styles that have a photo of their own. */
	styles: 3,
	/** One studio reads as a deliberate short list. */
	studios: 1,
	artists: 2,
	/** Photos for the inspiration grid. */
	inspiration: 6,
	locations: 2,
} as const;

/** The most tiles or rows each section shows. */
export const HOME_CAPS = {
	styles: 6,
	inspiration: 12,
	locations: 12,
} as const;

/** The hero's collage: the newest photos, only when there are enough of them. */
export function heroPhotos(
	tattoos: readonly DiscoverTattooSummary[],
): DiscoverTattooSummary[] {
	return tattoos.length >= HOME_THRESHOLDS.heroCollage
		? tattoos.slice(0, HOME_THRESHOLDS.heroCollage)
		: [];
}

/**
 * Each style of the platform's list (in its order) with the newest recent
 * photo tagged with it, a different photo for each style; a style with no
 * photo of its own left over is left out. No request per style: the photos
 * come from the homepage's one recent-work read.
 */
export function pairStylesWithPhotos(
	styles: readonly DiscoverStyle[],
	tattoos: readonly DiscoverTattooSummary[],
): { style: DiscoverStyle; tattoo: DiscoverTattooSummary }[] {
	const used = new Set<string>();
	const pairs: { style: DiscoverStyle; tattoo: DiscoverTattooSummary }[] = [];
	for (const style of styles) {
		const tattoo = tattoos.find(
			(each) =>
				!used.has(each.id) &&
				each.styles.some((tag) => tag.slug === style.slug),
		);
		if (!tattoo) continue;
		used.add(tattoo.id);
		pairs.push({ style, tattoo });
		if (pairs.length === HOME_CAPS.styles) break;
	}
	return pairs.length >= HOME_THRESHOLDS.styles ? pairs : [];
}

/**
 * The inspiration grid: the photos the hero didn't show when at least 6
 * remain, else every photo when there are 6; else none.
 */
export function inspirationPhotos(
	tattoos: readonly DiscoverTattooSummary[],
	shownInHero: readonly DiscoverTattooSummary[],
): DiscoverTattooSummary[] {
	const hero = new Set(shownInHero.map((each) => each.id));
	const rest = tattoos.filter((each) => !hero.has(each.id));
	const pool = rest.length >= HOME_THRESHOLDS.inspiration ? rest : tattoos;
	return pool.length >= HOME_THRESHOLDS.inspiration
		? pool.slice(0, HOME_CAPS.inspiration)
		: [];
}

/** Whether a list has enough rows for its section. */
export function enough<T>(
	items: readonly T[] | undefined,
	threshold: number,
): items is readonly T[] {
	return (items?.length ?? 0) >= threshold;
}

/** An artist's newest photo among the recent work, so their tile leads with their work. */
export function artistWork(
	artist: Pick<DiscoverArtistSummary, "id">,
	tattoos: readonly DiscoverTattooSummary[],
): DiscoverTattooSummary | undefined {
	return tattoos.find((each) => each.artist.id === artist.id);
}

/**
 * Where a photo's tile may link: the artist's page, else the studio's page,
 * when the homepage's own data holds it. A photo has no public page of its
 * own on Discover yet (D09), so with neither the tile is not a link.
 */
export function tattooDestination(
	tattoo: DiscoverTattooSummary,
	artists: readonly DiscoverArtistSummary[] | undefined,
	studios: readonly DiscoverStudioSummary[] | undefined,
): string | undefined {
	return (
		artists?.find((each) => each.id === tattoo.artist.id)?.storefrontUrl ??
		studios?.find((each) => each.slug === tattoo.studio.slug)?.storefrontUrl
	);
}

/** Who made a photo: "artist · studio", or the artist alone for an independent. */
export function tattooCredit(tattoo: DiscoverTattooSummary): string {
	return tattoo.studio.type === "independent"
		? tattoo.artist.name
		: `${tattoo.artist.name} · ${tattoo.studio.name}`;
}

/**
 * A photo's alt text from its data: the studio's own description when it
 * wrote one, else "Blackwork tattoo by X at Y" (the first style; "by X"
 * alone for an independent artist).
 */
export function tattooAlt(
	tattoo: DiscoverTattooSummary,
	style?: DiscoverStyle,
): string {
	const own = tattoo.image.alt?.trim();
	if (own) return own;
	const kind = style ?? tattoo.styles[0];
	const what = kind ? `${kind.name} tattoo` : "Tattoo";
	return tattoo.studio.type === "independent"
		? `${what} by ${tattoo.artist.name}`
		: `${what} by ${tattoo.artist.name} at ${tattoo.studio.name}`;
}

/** An artist's place in the world: "at Studio · City", or "Independent · City". */
export function artistAffiliation(artist: DiscoverArtistSummary): string {
	const who = artist.independent ? "Independent" : `at ${artist.studio.name}`;
	return artist.location ? `${who} · ${artist.location.name}` : who;
}
