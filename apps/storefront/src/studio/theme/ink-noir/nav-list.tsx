import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { NavItem } from "../../nav.ts";

/**
 * The navigation's links as a list, the current one marked with
 * `aria-current` (the stylesheet draws the mark from it). Used by the header,
 * the phone's menu and the footer, each with its own class.
 */
export function NavList({
	items,
	className,
	onNavigate,
}: {
	items: readonly NavItem[];
	className: string;
	/** Called on a click, before the navigation (the menu closes itself). */
	onNavigate?: () => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className={className} role="list">
			{items.map((item) => (
				<li key={item.key}>
					<RouterAnchor
						href={item.href}
						aria-current={item.current}
						onClick={onNavigate}
					>
						{item.label}
					</RouterAnchor>
				</li>
			))}
		</ul>
	);
}
