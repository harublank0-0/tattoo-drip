/**
 * Discover's addresses (D05, docs/discover/frontend.md). Pages link with
 * these, never with hand-written strings. Planned pages (D06–D09) are listed
 * so later prompts reuse one shape; only the ones in ROUTE_FILES exist yet.
 *
 * Never use the legacy Studio OS paths (/login, /signup, /dashboard, /t/…,
 * /sw.js…): on tattoodrip.app nginx redirects them to Studio OS
 * (docs/discover/domain-migration.md, "Legacy URLs").
 */
export const paths = {
	home: () => "/",
	studios: () => "/explore/studios",
	artists: () => "/explore/artists",
	tattoos: () => "/explore/tattoos",
	forStudios: () => "/for-studios",
	pricing: () => "/pricing",
	// Planned (D07–D09): not routes yet.
	studio: (slug: string) => `/studios/${encodeURIComponent(slug)}`,
	studioArtist: (studioSlug: string, artistSlug: string) =>
		`/studios/${encodeURIComponent(studioSlug)}/artists/${encodeURIComponent(artistSlug)}`,
	independentArtist: (tenantSlug: string) =>
		`/artists/${encodeURIComponent(tenantSlug)}`,
	tattoo: (id: string) => `/tattoos/${encodeURIComponent(id)}`,
	style: (slug: string) => `/styles/${encodeURIComponent(slug)}`,
	location: (slug: string) => `/locations/${encodeURIComponent(slug)}`,
} as const;

/** The paths that have a route today (checked against the route tree in a test). */
export const ROUTE_FILES = [
	paths.home(),
	paths.studios(),
	paths.artists(),
	paths.tattoos(),
	paths.forStudios(),
	paths.pricing(),
] as const;

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
