import {
	createRootRouteWithContext,
	HeadContent,
	rootRouteId,
	Scripts,
} from "@tanstack/react-router";
import { DiscoverProvider } from "@tattoo-drip/react";
import type { ReactNode } from "react";
import displayLatin from "../assets/fonts/eczar-latin-700-normal.woff2?url";
import uiLatin from "../assets/fonts/geist-latin-wght-normal.woff2?url";
import { SiteFooter } from "../components/layout/site-footer.tsx";
import { SiteHeader } from "../components/layout/site-header.tsx";
import { isUnavailable } from "../lib/api-errors.ts";
import type { DiscoverContext } from "../lib/context.ts";
import { normalizeCountry, pageCountry } from "../lib/country.ts";
import {
	HTML_CACHE_HEADERS,
	headTags,
	pageState,
	robotsValue,
} from "../lib/seo.ts";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<DiscoverContext>()({
	// Every page may name its country (`?country=NP`, D06.5): an assigned ISO
	// code, else undefined. Returned on every route, so a malformed value
	// never reaches a loader.
	validateSearch: (search: Record<string, unknown>): { country?: string } => ({
		country: normalizeCountry(search.country),
	}),
	// This page's country: its address's, else the visitor's preference
	// (cookie, trusted geolocation, default; resolved per request on the
	// server, kept per tab in the browser). Every loader reads
	// `context.country`; the result is dehydrated with the matches.
	beforeLoad: ({ context, search }) => ({
		country: pageCountry(search.country, context.preference.current),
	}),
	head: ({ match, matches }) => {
		// The canonical URL is the page's own path on DISCOVER_URL, whatever host
		// the request came in on; pages add their title, description and
		// picture. Robots are decided here, once, from every match (`pageState`:
		// a 404, an error, any query such as `?country=` or a filter, or a page
		// that opts out in its loader data or staticData), so a page has one
		// robots tag and its X-Robots-Tag header (below) always agrees.
		const page = pageState(matches, rootRouteId);
		const failed = matches.find((each) => each.status === "error");
		const { meta, links } = headTags(
			match.context.discover.settings,
			page.pathname,
			page.notFound
				? { title: "Page not found", noindex: true, canonical: false }
				: failed
					? {
							// The error page's own heading (RouteErrorState).
							title: isUnavailable(failed.error)
								? "Discover is unavailable for a moment"
								: "Something went wrong",
							noindex: true,
							// Not this address's content: no canonical.
							canonical: false,
						}
					: { noindex: page.noindex },
		);
		return {
			meta: [
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				// The paper token's value: a meta tag can't read a CSS variable.
				{ name: "theme-color", content: "#f5f2ec" },
				...meta,
			],
			links: [
				// The Latin files only: the others load when a page holds their characters.
				{
					rel: "preload",
					href: uiLatin,
					as: "font",
					type: "font/woff2",
					crossOrigin: "anonymous",
				},
				{
					rel: "preload",
					href: displayLatin,
					as: "font",
					type: "font/woff2",
					crossOrigin: "anonymous",
				},
				{ rel: "stylesheet", href: appCss },
				{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
				...links,
			],
		};
	},
	// Every page shows the visitor's country (the header's selector, the
	// lists), so no shared cache may keep one visitor's page for another
	// (HTML_CACHE_HEADERS). Every page that isn't indexable also says so in a
	// header, the same value as its robots meta: `noindex, nofollow` while
	// DISCOVER_INDEXING is off, `noindex, follow` for a variant, empty, 404
	// or error page while it is on. A crawler that ignores robots.txt still
	// sees it.
	headers: ({ match, matches }): Record<string, string> => {
		const page = pageState(matches, rootRouteId);
		const robots = robotsValue(
			match.context.discover.settings,
			page.pathname,
			page,
		);
		return {
			...HTML_CACHE_HEADERS,
			...(robots ? { "X-Robots-Tag": robots } : {}),
		};
	},
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	// This request's (server) or this tab's (browser) Discover client, for the
	// @tattoo-drip/react hooks; the QueryClientProvider comes from
	// setupRouterSsrQueryIntegration (src/router.tsx).
	const { discover, country } = Route.useRouteContext();
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<a className="skip-link" href="#main">
					Skip to content
				</a>
				<DiscoverProvider client={discover.client}>
					<div className="flex min-h-dvh flex-col">
						<SiteHeader
							studioOsUrl={discover.settings.studioOsUrl}
							country={country}
							markets={discover.settings.markets}
						/>
						<main id="main" tabIndex={-1} className="flex-1 outline-none">
							{children}
						</main>
						<SiteFooter studioOsUrl={discover.settings.studioOsUrl} />
					</div>
				</DiscoverProvider>
				<Scripts />
			</body>
		</html>
	);
}
