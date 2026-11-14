import { countryName } from "./country.ts";
import { paths } from "./routes.ts";

/**
 * Every page's breadcrumbs (D10), built once: the page renders them
 * (`Breadcrumbs`) and its BreadcrumbList (src/lib/structured-data.ts) is
 * made from the same list, so the two can never differ. The last crumb is
 * the page itself (no link).
 */
export type Crumb = { label: string; to?: string };

const HOME: Crumb = { label: "Discover", to: paths.home() };

export const crumbs = {
	directory: (kind: "studios" | "artists"): Crumb[] => [
		HOME,
		{ label: kind === "studios" ? "Studios" : "Find artists" },
	],
	gallery: (): Crumb[] => [HOME, { label: "Tattoo inspiration" }],
	/** Reviews and Fresh ink (slice 4): the feed. */
	freshInk: (): Crumb[] => [HOME, { label: "Fresh ink" }],
	style: (name: string): Crumb[] => [HOME, { label: name }],
	country: (code: string): Crumb[] => [HOME, { label: countryName(code) }],
	city: (code: string, place: { name: string }): Crumb[] => [
		HOME,
		{ label: countryName(code), to: paths.location(code) },
		{ label: place.name },
	],
	studio: (name: string): Crumb[] => [
		HOME,
		{ label: "Studios", to: paths.studios() },
		{ label: name },
	],
	artist: (artist: {
		name: string;
		independent: boolean;
		studio: { slug: string; name: string };
	}): Crumb[] =>
		artist.independent
			? [
					HOME,
					{ label: "Artists", to: paths.artists() },
					{ label: artist.name },
				]
			: [
					HOME,
					{ label: "Studios", to: paths.studios() },
					{ label: artist.studio.name, to: paths.studio(artist.studio.slug) },
					{ label: artist.name },
				],
	artwork: (title: string): Crumb[] => [
		HOME,
		{ label: "Tattoo inspiration", to: paths.tattoos() },
		{ label: title },
	],
};
