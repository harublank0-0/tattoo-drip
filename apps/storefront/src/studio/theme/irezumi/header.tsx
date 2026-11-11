import { NavList } from "../../components/nav-list.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import { BookingCta, BrandIdentity } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import { IrezumiMobileNav } from "./mobile-nav.tsx";

/**
 * Irezumi's header: a quiet paper band with a hairline under it. The
 * studio's mark (home) at the start; from 64rem the pages sit beside it in
 * small spaced capitals; the way to book closes the line. Below 64rem the
 * pages move into the menu (IrezumiMobileNav) and the bar keeps the mark,
 * the booking link and the menu's button, so booking is one tap away on
 * every page. Sticky, with no script.
 */
export function IrezumiHeader({
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
		<header className="irz-header">
			<div className="irz-container irz-header-inner">
				<RouterAnchor className="irz-brand" href="/">
					<BrandIdentity studio={studio} theme={theme} />
				</RouterAnchor>
				<nav className="irz-nav" aria-label={studioCopy.nav.label}>
					<NavList items={items} className="irz-nav-list" />
				</nav>
				<BookingCta link={requestLink} className="irz-header-cta" />
				<IrezumiMobileNav
					studio={studio}
					theme={theme}
					items={items}
					requestLink={requestLink}
				/>
			</div>
		</header>
	);
}
