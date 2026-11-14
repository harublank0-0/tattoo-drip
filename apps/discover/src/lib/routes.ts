import { countrySlug } from "./country.ts";

/**
 * Discover's addresses (D05, docs/discover/frontend.md). Pages link with
 * these, never with hand-written strings. Every builder here has a route
 * (ROUTE_FILES, ROUTE_PATTERNS; a test checks).
 *
 * Never use the legacy Studio OS paths (/login, /signup, /dashboard, /t/…,
 * /sw.js…): on tattoodrip.app nginx redirects them to Studio OS
 * (docs/discover/domain-migration.md, "Legacy URLs").
 */
export const paths = {
	home: () => "/",
	studios: () => "/explore/studios",
	artists: () => "/explore/artists",
	/** The tattoo gallery (D09; `/explore/tattoos` is a 301 to it). */
	tattoos: () => "/tattoos",
	/** Reviews and Fresh ink (slice 4): clients' healed tattoos, newest first. */
	freshInk: () => "/fresh-ink",
	forStudios: () => "/for-studios",
	pricing: () => "/pricing",
	/** The country selector's form target (POST only; D06.5). */
	countryPreference: () => "/preferences/country",
	/** A style's page (D07): `slug` from `/styles`. */
	style: (slug: string) => `/styles/${encodeURIComponent(slug)}`,
	/** A market's location page (D07): the ISO code, spelt as its slug (`NP` → `/locations/nepal`). */
	location: (country: string) => `/locations/${countrySlug(country)}`,
	/** A city's page (D07): its country's ISO code and the API's place slug. */
	city: (country: string, city: string) =>
		`/locations/${countrySlug(country)}/${encodeURIComponent(city)}`,
	// Profiles (D08). Lists link to them through `profileDestination`
	// (src/lib/destinations.ts); a profile page links its own relations.
	studio: (slug: string) => `/studios/${encodeURIComponent(slug)}`,
	studioArtist: (studioSlug: string, artistSlug: string) =>
		`/studios/${encodeURIComponent(studioSlug)}/artists/${encodeURIComponent(artistSlug)}`,
	independentArtist: (tenantSlug: string) =>
		`/artists/${encodeURIComponent(tenantSlug)}`,
	/**
	 * An artwork's page (D09), by the API's photo id: its canonical slug is
	 * the id in lower case (src/lib/artwork.ts reads any other spelling and
	 * 301s to this one).
	 */
	tattoo: (id: string) => `/tattoos/${encodeURIComponent(id.toLowerCase())}`,
} as const;

/**
 * Addresses that only redirect (a 301 to their replacement, query kept):
 * routes exist for them, but no page links to them.
 */
export const REDIRECT_FILES = ["/explore/tattoos"] as const;

/** The paths that have a route today (checked against the route tree in a test). */
export const ROUTE_FILES = [
	paths.home(),
	paths.studios(),
	paths.artists(),
	paths.tattoos(),
	paths.freshInk(),
	paths.forStudios(),
	paths.pricing(),
	paths.countryPreference(),
] as const;

/**
 * The dynamic routes that exist (D07–D09), as the route tree spells them,
 * and a test for an address they serve (the shape only: the page itself
 * 404s an unknown style, a country that isn't a market, an unknown city or
 * a profile the API doesn't show).
 */
export const ROUTE_PATTERNS = [
	{ route: "/styles/$slug", matches: /^\/styles\/[^/]+$/ },
	{ route: "/locations/$country", matches: /^\/locations\/[^/]+$/ },
	{
		route: "/locations/$country/$city",
		matches: /^\/locations\/[^/]+\/[^/]+$/,
	},
	{ route: "/studios/$studioSlug", matches: /^\/studios\/[^/]+$/ },
	{
		route: "/studios/$studioSlug/artists/$artistSlug",
		matches: /^\/studios\/[^/]+\/artists\/[^/]+$/,
	},
	{ route: "/artists/$tenantSlug", matches: /^\/artists\/[^/]+$/ },
	// D09: an artwork, by its id (src/lib/artwork.ts).
	{ route: "/tattoos/$slug", matches: /^\/tattoos\/[^/]+$/ },
] as const;

/** Whether an internal path (no query) has a route today. */
export function hasRoute(path: string): boolean {
	return (
		(ROUTE_FILES as readonly string[]).includes(path) ||
		ROUTE_PATTERNS.some((pattern) => pattern.matches.test(path))
	);
}

export type InternalLink = { kind: "internal"; label: string; to: string };
export type ExternalLink = { kind: "external"; label: string; href: string };
export type NavLink = InternalLink | ExternalLink;

/** Studio OS's sign-in and sign-up pages, on its own origin (no shared session). */
export function studioOsLinks(studioOsUrl: string) {
	return {
		signIn: new URL("/login", studioOsUrl).toString(),
		getStarted: new URL("/signup", studioOsUrl).toString(),
	};
}

/** The header's discovery links, in order. */
export const PRIMARY_NAV: InternalLink[] = [
	{ kind: "internal", label: "Explore studios", to: paths.studios() },
	{ kind: "internal", label: "Find artists", to: paths.artists() },
	{ kind: "internal", label: "Tattoo inspiration", to: paths.tattoos() },
	{ kind: "internal", label: "Fresh ink", to: paths.freshInk() },
];

/** The business links: For studios, Pricing, then Studio OS's sign-in and sign-up. */
export function businessNav(studioOsUrl: string): {
	forStudios: InternalLink;
	pricing: InternalLink;
	signIn: ExternalLink;
	getStarted: ExternalLink;
} {
	const studioOs = studioOsLinks(studioOsUrl);
	return {
		forStudios: {
			kind: "internal",
			label: "For studios",
			to: paths.forStudios(),
		},
		pricing: { kind: "internal", label: "Pricing", to: paths.pricing() },
		signIn: { kind: "external", label: "Sign in", href: studioOs.signIn },
		getStarted: {
			kind: "external",
			label: "Get started",
			href: studioOs.getStarted,
		},
	};
}

/** The footer's groups: only destinations that exist. */
export function footerGroups(
	studioOsUrl: string,
): { title: string; links: NavLink[] }[] {
	const business = businessNav(studioOsUrl);
	return [
		{ title: "Explore", links: PRIMARY_NAV },
		{
			title: "For professionals",
			links: [
				business.forStudios,
				business.pricing,
				business.signIn,
				business.getStarted,
			],
		},
	];
}
