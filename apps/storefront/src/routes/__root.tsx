import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useLocation,
	useMatches,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TattooProvider } from "@tattoo-drip/react";

import type { ApiContext } from "../api/context.ts";
import bodoniLatin from "../assets/fonts/bodoni-moda/bodoni-moda-latin-500-normal.woff2?url";
import eczarLatin from "../assets/fonts/eczar/eczar-latin-700-normal.woff2?url";
import shrikhandLatin from "../assets/fonts/shrikhand/shrikhand-latin-400-normal.woff2?url";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import type { SiteContext } from "../site/context.ts";
import {
	PreviewBanner,
	PreviewNotice,
} from "../studio/components/preview-banner.tsx";
import { studioIconLinks } from "../studio/icon.ts";
import { loadPageStudio } from "../studio/loaders.ts";
import { PreviewLinks } from "../studio/preview-links.tsx";
import { rootMeta } from "../studio/seo.ts";
import {
	type HeadingFontFile,
	isUnthemedPage,
	matchedHeadingFont,
	matchedThemeKey,
	THEME_HTML,
} from "../studio/theme/html.ts";
import { previewExitHref } from "../studio/theme/preview.ts";
import appCss from "../styles.css?url";

/** Each heading font file's address in the build. */
const HEADING_FONT_URLS: Record<HeadingFontFile, string> = {
	eczar: eczarLatin,
	"bodoni-moda": bodoniLatin,
	shrikhand: shrikhandLatin,
};

/** The heading font file this page preloads (theme/html.ts, matchedHeadingFont). */
function preloadedFont(file: HeadingFontFile) {
	return {
		rel: "preload",
		href: HEADING_FONT_URLS[file],
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous" as const,
	};
}

export const Route = createRootRouteWithContext<ApiContext & SiteContext>()({
	// Every page needs its studio: on the server from the cache the tenant
	// middleware filled, after that from the API (TAT-23).
	// With this visit's theme preview over the saved theme (src/studio/theme/preview.ts).
	loader: ({ context }) => loadPageStudio(context),
	head: ({ loaderData, match, matches }) => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			// The studio's name for a page that sets no title; the not-found or
			// error head (noindex) for a path no page matches (src/studio/seo.ts).
			...rootMeta({ loaderData, match, matches }),
			// A theme preview is never indexed (the answer's X-Robots-Tag says so too, src/studio/theme/preview.ts).
			...(loaderData && match.context.site.previewTheme
				? [{ name: "robots", content: "noindex, nofollow" }]
				: []),
		],
		links: [
			// One heading font is preloaded, the one the page's headings use: Atelier's
			// Bodoni (src/studio/theme/atelier/styles.css) or Flash Parlour's Shrikhand
			// (src/studio/theme/flash-parlour/styles.css) while such a studio keeps
			// the default font, else Eczar's Latin subset (the others load when a page
			// holds their characters; font-display: optional, src/styles.css). No
			// other theme ever loads Bodoni or Shrikhand.
			preloadedFont(matchedHeadingFont(matches)),
			{
				rel: "stylesheet",
				href: appCss,
			},
			// The studio's icon, made from its logo at upload (TAT-123); without one,
			// a stop for the /favicon.ico request. Its image origin (MEDIA_URL) is
			// connected once the root loader has read the studio.
			...studioIconLinks(
				loaderData,
				loaderData ? match.context.tattoo.connection.mediaUrl : null,
			),
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// This request's (server) or this tab's (browser) SDK client, for the
	// @tattoo-drip/react hooks. The QueryClientProvider around the whole
	// router comes from setupRouterSsrQueryIntegration (src/router.tsx).
	const { tattoo, site } = Route.useRouteContext();
	// The studio's theme sets the page's colours on <html> (src/studio/theme/html.ts):
	// read from this request's matches, so the server and the browser agree.
	const html = THEME_HTML[useMatches({ select: matchedThemeKey })];
	// A theme preview (src/studio/theme/preview.ts): from this visit's site, on
	// every page but an unthemed one; the same on the server and in the browser.
	const unthemed = useMatches({ select: isUnthemedPage });
	const here = useLocation({
		select: (location) => `${location.pathname}${location.searchStr}`,
	});
	const preview = unthemed ? null : site.previewTheme;

	return (
		<html lang="en" className={html.className ?? undefined}>
			<head>
				<HeadContent />
				{/* The router's head keeps one meta per name, so the theme's colours are written here. */}
				{html.themeColors.map((color) => (
					<meta
						key={color.media ?? "all"}
						name="theme-color"
						content={color.content}
						media={color.media}
					/>
				))}
			</head>
			<body>
				<TattooProvider client={tattoo.client}>
					{/* Said first to a screen reader, without a stop for the keyboard: the skip link stays first. */}
					{preview ? (
						<p className="sr-only">
							<PreviewNotice theme={preview} />
						</p>
					) : null}
					{children}
					{preview ? (
						<>
							<PreviewBanner theme={preview} exitHref={previewExitHref(here)} />
							<PreviewLinks theme={preview} />
						</>
					) : null}
					{import.meta.env.DEV ? (
						<TanStackDevtools
							config={{
								position: "bottom-right",
							}}
							plugins={[
								{
									name: "Tanstack Router",
									render: <TanStackRouterDevtoolsPanel />,
								},
								TanStackQueryDevtools,
							]}
						/>
					) : null}
				</TattooProvider>
				<Scripts />
			</body>
		</html>
	);
}
