import { RouterAnchor } from "../../components/router-anchor.tsx";
import { BookingCta, BrandIdentity } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import { MobileNav } from "./mobile-nav.tsx";
import { NavList } from "./nav-list.tsx";

/**
 * Ink Noir's header: the studio's mark (home), the navigation and the way to
 * book. Sticky; it sits clear over the page at the top and settles onto the
 * raised surface with a line under it as the page scrolls (CSS only, where
 * the browser supports scroll-driven animation; elsewhere it is always
 * settled). From 60rem the links are in the bar; below that they are in the
 * menu (MobileNav), and the bar keeps the mark, the booking link and the
 * menu's button, so booking stays one tap away at any depth.
 */
export function InkNoirHeader({
	studio,
	theme,
	items,
	requestLink,
}: {
	studio: StudioView;
	theme: ThemeConfig;
	items: readonly NavItem[];
	requestLink: RequestLink | null;
}) {
	return (
		<header className="ink-header">
			<div className="ink-container ink-header-inner">
				<RouterAnchor className="ink-brand" href="/">
					<BrandIdentity studio={studio} theme={theme} />
				</RouterAnchor>
				<nav className="ink-nav" aria-label={studioCopy.nav.label}>
					<NavList items={items} className="ink-nav-list" />
				</nav>
				<BookingCta link={requestLink} className="ink-header-cta" />
				<MobileNav
					studio={studio}
					theme={theme}
					items={items}
					requestLink={requestLink}
				/>
			</div>
		</header>
	);
}
