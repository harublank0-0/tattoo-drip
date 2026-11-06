import type { ComponentType, ReactNode } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import type { ChatLinks } from "../chat.ts";
import { studioCopy } from "../copy.ts";
import { isAllowedHref } from "../links.ts";
import {
	moreNavItems,
	type NavItem,
	navItems,
	type ShellPage,
} from "../nav.ts";
import type { RequestLink } from "../request.ts";
import { logoSizes } from "../srcset.ts";
import type { ThemeConfig } from "../theme/config.ts";
import type { StudioView } from "../view-model.ts";
import { BrandLogo } from "./brand.tsx";
import { ChatButton } from "./chat.tsx";
import { infoWords } from "./info.tsx";

/**
 * What a theme puts around a page: its header, the `<main>` the page's
 * content goes in, its footer and the chat button. The page components
 * (pages.tsx) hold the content and pass the shell what it needs; a theme
 * (theme/registry.tsx) picks the shell, so two themes can frame the same
 * pages differently while the data, links and booking stay the same.
 */
export interface ShellProps {
	readonly studio: StudioView;
	readonly theme: ThemeConfig;
	/** The header's Request button, or null for none (a closed studio, or the request page itself). */
	readonly requestLink: RequestLink | null;
	/** The chat button's links, or null for no button. */
	readonly chat: ChatLinks | null;
	/** Which page this is: the navigation's current item follows from it. */
	readonly page: ShellPage;
	/** Whether any artist is visible, so a navigation's Artists link has a roster to land on. */
	readonly artistsShown: boolean;
	/** The `<main>` element's class: "page" unless the page needs more. */
	readonly mainClassName?: string;
	readonly children: ReactNode;
}

export type Shell = ComponentType<ShellProps>;

/**
 * Stencil & Ink's shell (TAT-127): the site bar, the page, the one-line
 * footer and the chat button, exactly the markup the pages had before themes
 * could change it (test/studio/default-theme.snapshot.json pins it).
 */
export function StencilShell({
	studio,
	theme,
	requestLink,
	chat,
	page,
	artistsShown,
	mainClassName = "page",
	children,
}: ShellProps) {
	// The informational pages that have content, by the rules Ink Noir's
	// navigation uses, so no link leads to a not-found.
	const info = new Set(["services", "about", "contact"]);
	const links = [
		...navItems(theme.sections, page, artistsShown, studio.pages).filter(
			(item) => info.has(item.key),
		),
		...moreNavItems(theme.sections, page, studio.pages),
	];
	return (
		<>
			<SiteBar studio={studio} theme={theme} requestLink={requestLink} />
			<main className={mainClassName}>{children}</main>
			<SiteFooter studioName={studio.name} links={links} />
			<ChatButton chat={chat} studioName={studio.name} />
		</>
	);
}

/**
 * The header at the top of the studio, artist, work and request pages
 * (TAT-127): the studio's name (and logo), back to its page, and the Request button, which
 * stays on screen as the page scrolls (it is `position: sticky`; no script).
 * `requestLink` is the button, null for none (a closed studio, or the request
 * page itself, where the button would lead to where the client is): on an
 * artist's page it names them, otherwise it asks the studio.
 */
function SiteBar({
	studio,
	theme,
	requestLink,
}: {
	studio: StudioView;
	theme: ThemeConfig;
	requestLink: RequestLink | null;
}) {
	return (
		<header className="site-bar">
			<div className="site-bar-inner">
				<a className="site-bar-home" href="/" dir="auto">
					{theme.logo ? (
						<>
							<BrandLogo
								image={theme.logo}
								className="site-bar-logo"
								sizes={logoSizes(theme.logo, "siteBar")}
							/>
							<span>{studio.name}</span>
						</>
					) : (
						studio.name
					)}
				</a>
				{requestLink && isAllowedHref(requestLink.href) ? (
					<a
						className="action action-primary site-bar-request"
						href={requestLink.href}
					>
						{requestLink.artistName === null ? (
							studioCopy.request.bar
						) : (
							// One <span>: a link is a flex container, and text beside a <bdi> would become two items and lose the space.
							<span>
								<Fill
									template={studioCopy.request.barArtist}
									values={{ name: requestLink.artistName }}
								/>
							</span>
						)}
					</a>
				) : null}
			</div>
		</header>
	);
}

/** Who runs the page clients' details go through (no link until a marketing site exists). */
export function SiteFooter({
	studioName,
	links = [],
}: {
	studioName: string;
	/** The studio's informational pages to link, in order; none for no list. */
	links?: readonly NavItem[];
}) {
	return (
		<footer className="site-footer">
			{links.length > 0 ? (
				<nav
					className="site-footer-nav"
					aria-label={fill(infoWords.more, { studio: studioName })}
				>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{links.map((link) =>
							isAllowedHref(link.href) ? (
								<li key={link.key}>
									<a href={link.href} aria-current={link.current}>
										{link.label}
									</a>
								</li>
							) : null,
						)}
					</ul>
				</nav>
			) : null}
			<p dir="auto">{studioName}</p>
			<p>{studioCopy.nav.credit}</p>
		</footer>
	);
}
