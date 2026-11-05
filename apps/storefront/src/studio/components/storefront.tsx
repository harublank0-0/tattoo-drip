import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import { isAllowedHref } from "../links.ts";
import type { RequestLink } from "../request.ts";
import { logoSizes } from "../srcset.ts";
import type { ThemeConfig } from "../theme/config.ts";
import type { StudioView } from "../view-model.ts";
import { BrandLogo } from "./brand.tsx";
import { RouterAnchor } from "./router-anchor.tsx";

/**
 * Small pieces a theme's shell is built from. Presentation only: they take
 * view models as props and read nothing themselves.
 */

/**
 * The studio's mark: its checked logo on its tile (the site bar's box, 2rem
 * tall, so `logoSizes(…, "siteBar")` holds) and its name, which wraps rather
 * than widen the page. Put it inside the element that gives it a role (a
 * link home, a dialog's title).
 */
export function BrandIdentity({
	studio,
	theme,
}: {
	studio: StudioView;
	theme: ThemeConfig;
}) {
	return (
		<>
			{theme.logo ? (
				<BrandLogo
					image={theme.logo}
					className="site-bar-logo"
					sizes={logoSizes(theme.logo, "siteBar")}
				/>
			) : null}
			<span className="brand-name" dir="auto">
				{studio.name}
			</span>
		</>
	);
}

/**
 * The way to book: a link to /request (the studio's general form, or on an
 * open artist's page their own), from `requestLink` (src/studio/request.ts),
 * which is null when nobody takes new work: then nothing, so no button leads
 * to a refusal. The router takes the click over once the page has hydrated.
 */
export function BookingCta({
	link,
	className,
	onNavigate,
}: {
	link: RequestLink | null;
	className?: string;
	/** Called on a click, before the navigation (a menu closes itself). */
	onNavigate?: () => void;
}) {
	if (!link || !isAllowedHref(link.href)) return null;
	return (
		<RouterAnchor
			className={
				className
					? `action action-primary ${className}`
					: "action action-primary"
			}
			href={link.href}
			onClick={onNavigate}
		>
			{link.artistName === null ? (
				studioCopy.nav.requestSession
			) : (
				// One <span>: a link is a flex container, and text beside a <bdi> would become two items and lose the space.
				<span>
					<Fill
						template={studioCopy.request.barArtist}
						values={{ name: link.artistName }}
					/>
				</span>
			)}
		</RouterAnchor>
	);
}
