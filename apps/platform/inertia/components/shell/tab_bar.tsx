import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";
import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { MORE_ICON, NAV_ICONS } from "~/components/shell/nav_icons";
import {
	isCurrentPath,
	type ShellNavItem,
	tabBarItems,
} from "~/components/shell/nav_items";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useTyping } from "~/hooks/use-typing";

const TAB =
	"flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground";

/**
 * The phone navigation (below 1024px): one tab per main destination, fixed
 * to the bottom and padded clear of the iPhone home indicator, and for owners
 * a last "More" tab that opens Clients, Artists and Settings (TAT-107). The
 * layout pads the page by the same height. On a touch screen it hides while a
 * field takes typing (TAT-84): Android lifts fixed bars above the keyboard,
 * where the bar would cover the field.
 */
export default function TabBar({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	const { tabs, more } = tabBarItems(items);
	const typing = useTyping();

	return (
		<nav
			aria-label="Main"
			className={cn(
				"fixed inset-x-0 bottom-0 z-40 border-t bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden",
				typing && "pointer-coarse:hidden",
			)}
		>
			<ul className="flex">
				{tabs.map((item) => {
					const Icon = NAV_ICONS[item.key];
					return (
						<li key={item.key} className="flex-1">
							<NavLink
								route={item.route}
								params={{ tenant: tenantSlug }}
								also={item.also}
								className={`${TAB} aria-[current=page]:font-semibold aria-[current=page]:text-foreground`}
							>
								<span className="relative">
									<Icon className="size-5" aria-hidden="true" />
									{item.badge ? (
										<NavBadge
											count={item.badge}
											label={item.badgeLabel}
											className="absolute -top-2 left-3.5"
										/>
									) : null}
								</span>
								{item.label}
							</NavLink>
						</li>
					);
				})}
				{more.length > 0 && (
					<li className="flex-1">
						<MoreMenu items={more} tenantSlug={tenantSlug} />
					</li>
				)}
			</ul>
		</nav>
	);
}

/**
 * "More": a menu that opens upwards with the destinations that have no tab.
 * The tab is current when one of its pages is open, and so is that row.
 * Radix moves focus to the first row on open and back to the tab on Escape.
 */
function MoreMenu({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	const { url } = usePage();
	const MoreIcon = MORE_ICON;
	const hrefOf = (item: ShellNavItem) =>
		urlFor(item.route, { tenant: tenantSlug });
	const isCurrent = (item: ShellNavItem) =>
		isCurrentPath(url, hrefOf(item), { also: item.also });
	const open = items.some(isCurrent);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-current={open ? "true" : undefined}
					className={`${TAB} aria-[current=true]:font-semibold aria-[current=true]:text-foreground`}
				>
					<MoreIcon className="size-5" aria-hidden="true" />
					More
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="end" className="w-56">
				{items.map((item) => {
					const Icon = NAV_ICONS[item.key];
					return (
						<DropdownMenuItem key={item.key} asChild>
							<Link
								href={hrefOf(item)}
								aria-current={isCurrent(item) ? "page" : undefined}
								className="aria-[current=page]:font-semibold"
							>
								<Icon aria-hidden="true" />
								{item.label}
							</Link>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
