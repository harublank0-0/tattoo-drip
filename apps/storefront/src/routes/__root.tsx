import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TattooProvider } from "@tattoo-drip/react";

import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import eczarLatin from "../assets/fonts/eczar/eczar-latin-700-normal.woff2?url";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import type { SiteContext } from "../site/context.ts";
import { rootMeta } from "../studio/seo.ts";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<ApiContext & SiteContext>()({
	// Every page needs its studio: on the server from the cache the tenant
	// middleware filled, after that from the API (TAT-23).
	loader: ({ context }) => loadStudio(context),
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
		],
		links: [
			// Only the Latin subset is preloaded; the others load when a page
			// holds their characters (font-display: optional, src/styles.css).
			{
				rel: "preload",
				href: eczarLatin,
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
			// No favicon until branding (TAT-56): this stops the /favicon.ico request.
			{
				rel: "icon",
				href: "data:,",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// This request's (server) or this tab's (browser) SDK client, for the
	// @tattoo-drip/react hooks. The QueryClientProvider around the whole
	// router comes from setupRouterSsrQueryIntegration (src/router.tsx).
	const { tattoo } = Route.useRouteContext();

	return (
		<html lang="en">
			<head>
				<HeadContent />
				{/* The router's head keeps one meta per name, so the two theme colours are written here. */}
				<meta
					name="theme-color"
					content="#f5f6f8"
					media="(prefers-color-scheme: light)"
				/>
				<meta
					name="theme-color"
					content="#14121d"
					media="(prefers-color-scheme: dark)"
				/>
			</head>
			<body>
				<TattooProvider client={tattoo.client}>
					{children}
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
