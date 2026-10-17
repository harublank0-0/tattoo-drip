import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { NAV_ICONS } from "~/components/shell/nav_icons";
import type { ShellNavItem } from "~/components/shell/nav_items";

/**
 * The phone navigation (below 1024px): one tab per destination, fixed to
 * the bottom and padded clear of the iPhone home indicator. The layout
 * pads the page by the same height.
 */
export default function TabBar({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	return (
		<nav
			aria-label="Main"
			className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden"
		>
			<ul className="flex">
				{items.map((item) => {
					const Icon = NAV_ICONS[item.key];
					return (
						<li key={item.key} className="flex-1">
							<NavLink
								route={item.route}
								params={{ tenant: tenantSlug }}
								also={item.also}
								className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
							>
								<span className="relative">
									<Icon className="size-5" aria-hidden="true" />
									{item.badge ? (
										<NavBadge
											count={item.badge}
											className="absolute -top-2 left-3.5"
										/>
									) : null}
								</span>
								{item.label}
							</NavLink>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
