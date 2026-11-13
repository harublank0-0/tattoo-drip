import { NavList } from "../../components/nav-list.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import { BookingCta, BrandIdentity } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import { FlashParlourMobileNav } from "./mobile-nav.tsx";

/**
 * Flash Parlour's header: a cream shop sign under a heavy ink rule. The
 * studio's mark (home) in the display face at the start; from 64rem the
 * pages sit beside it in bold capitals, the current one on a mustard bar; the
 * way to book, a red button, closes the line. Below 64rem the
 * pages move into the menu (FlashParlourMobileNav) and the bar keeps the mark,
 * the booking link and the menu's button, so booking is one tap away on
 * every page. Sticky, with no script.
 */
export function FlashParlourHeader({
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
		<header className="fp-header">
			<div className="fp-container fp-header-inner">
				<RouterAnchor className="fp-brand" href="/">
					<BrandIdentity studio={studio} theme={theme} />
				</RouterAnchor>
				<nav className="fp-nav" aria-label={studioCopy.nav.label}>
					<NavList items={items} className="fp-nav-list" />
				</nav>
				<BookingCta link={requestLink} className="fp-header-cta" />
				<FlashParlourMobileNav
					studio={studio}
					theme={theme}
					items={items}
					requestLink={requestLink}
				/>
			</div>
		</header>
	);
}
