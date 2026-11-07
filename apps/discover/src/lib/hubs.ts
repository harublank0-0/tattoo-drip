import { discoverQueries } from "@tattoo-drip/react";
import type { DiscoverClient } from "@tattoo-drip/sdk";

/**
 * The style and location pages' reads (D07, docs/discover/frontend.md,
 * "Style and location pages"): short previews in the API's own order
 * (newest first), never ranked, plus recent work, linking on to the full
 * directories. Built one way for the loader and the component.
 */
export const HUB_LIMITS = { studios: 6, artists: 8, tattoos: 12 } as const;

/**
 * A style's page: its studios, artists and recent photos in one country
 * (the page's: `?country=`, else the visitor's). The API filters all three
 * by `style`; a studio's styles are those its shown artists name.
 */
export function styleQueries(
	client: DiscoverClient,
	style: string,
	country: string,
) {
	return {
		studios: discoverQueries.studios(client, {
			country,
			style,
			limit: HUB_LIMITS.studios,
		}),
		artists: discoverQueries.artists(client, {
			country,
			style,
			limit: HUB_LIMITS.artists,
		}),
		tattoos: discoverQueries.tattoos(client, {
			country,
			style,
			limit: HUB_LIMITS.tattoos,
		}),
	};
}

/**
 * A location page: the studios, artists and recent photos of its own
 * country, or city, always from the address (never the visitor's
 * preference), so the page means the same thing for everyone.
 */
export function locationQueries(
	client: DiscoverClient,
	country: string,
	city?: string,
) {
	const where = city ? { country, city } : { country };
	return {
		studios: discoverQueries.studios(client, {
			...where,
			limit: HUB_LIMITS.studios,
		}),
		artists: discoverQueries.artists(client, {
			...where,
			limit: HUB_LIMITS.artists,
		}),
		tattoos: discoverQueries.tattoos(client, {
			...where,
			limit: HUB_LIMITS.tattoos,
		}),
	};
}
