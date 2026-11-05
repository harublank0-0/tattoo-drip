import type { ComponentType, ReactNode } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import type { ChatLinks } from "../chat.ts";
import { studioCopy } from "../copy.ts";
import { isAllowedHref } from "../links.ts";
import type { ShellPage } from "../nav.ts";
import type { RequestLink } from "../request.ts";
import { logoSizes } from "../srcset.ts";
import type { ThemeConfig } from "../theme/config.ts";
import type { StudioView } from "../view-model.ts";
import { BrandLogo } from "./brand.tsx";
import { ChatButton } from "./chat.tsx";

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
	mainClassName = "page",
	children,
}: ShellProps) {
	return (
		<>
			<SiteBar studio={studio} theme={theme} requestLink={requestLink} />
			<main className={mainClassName}>{children}</main>
			<SiteFooter studioName={studio.name} />
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
export function SiteFooter({ studioName }: { studioName: string }) {
	return (
		<footer className="site-footer">
			<p dir="auto">{studioName}</p>
			<p>{studioCopy.nav.credit}</p>
		</footer>
	);
}
