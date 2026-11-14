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

// A tab: 56px tall, its label under its icon. The current one has full-strength
// text, a heavier label and the sidebar's red marker, here on the bar's top
// edge, so it never relies on colour alone.
const TAB =
	"relative flex min-h-14 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors duration-150 focus-visible:bg-accent before:absolute before:top-0 before:left-1/2 before:h-0.5 before:w-8 before:-translate-x-1/2 before:rounded-b-full before:bg-primary before:opacity-0";

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
				"fixed inset-x-0 bottom-0 z-40 border-t bg-sidebar pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden",
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
								className={`${TAB} aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:before:opacity-100`}
							>
								<span className="relative">
									<Icon className="size-5" aria-hidden="true" />
									{item.badge ? (
										<NavBadge
											count={item.badge}
											label={item.badgeLabel}
											className="absolute -top-1.5 left-3"
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
	// A count under More (Reviews' waiting Fresh ink) shows on the tab too, so it isn't hidden.
	const counted = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-current={open ? "true" : undefined}
					className={`${TAB} data-[state=open]:text-foreground aria-[current=true]:font-semibold aria-[current=true]:text-foreground aria-[current=true]:before:opacity-100`}
				>
					<span className="relative">
						<MoreIcon className="size-5" aria-hidden="true" />
						{counted > 0 ? (
							<NavBadge
								count={counted}
								label="waiting"
								className="absolute -top-1.5 left-3"
							/>
						) : null}
					</span>
					More
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="top"
				align="end"
				sideOffset={8}
				className="w-60"
			>
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
								{item.badge ? (
									<NavBadge
										count={item.badge}
										label={item.badgeLabel}
										className="ml-auto"
									/>
								) : null}
							</Link>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
