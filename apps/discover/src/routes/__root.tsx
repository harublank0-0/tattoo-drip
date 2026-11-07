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
import type { DiscoverContext } from "../lib/context.ts";
import { headTags, NOINDEX } from "../lib/seo.ts";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<DiscoverContext>()({
	head: ({ match, matches }) => {
		// The canonical URL is the page's own path on DISCOVER_URL, whatever host
		// the request came in on; pages add their title and description.
		const page = matches[matches.length - 1] ?? match;
		// No page matched (only the root), or a page's loader threw notFound()
		// (its match is then "notFound" before the root's head runs).
		const notFound =
			!matches.some((each) => each.routeId !== rootRouteId) ||
			matches.some((each) => each.status === "notFound");
		const { meta, links } = headTags(
			match.context.discover.settings,
			page.pathname,
			notFound ? { title: "Page not found", noindex: true } : {},
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
	// While DISCOVER_INDEXING is off, every answer also says so in a header:
	// a crawler that ignores robots.txt still sees noindex.
	headers: ({ match }): Record<string, string> | undefined =>
		match.context.discover.settings.indexing
			? undefined
			: { "X-Robots-Tag": NOINDEX },
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	// This request's (server) or this tab's (browser) Discover client, for the
	// @tattoo-drip/react hooks; the QueryClientProvider comes from
	// setupRouterSsrQueryIntegration (src/router.tsx).
	const { discover } = Route.useRouteContext();
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
						<SiteHeader studioOsUrl={discover.settings.studioOsUrl} />
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
