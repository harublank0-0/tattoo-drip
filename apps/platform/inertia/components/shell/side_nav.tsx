import { cn } from "cn";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Logo from "~/components/logo";
import NavLink from "~/components/nav_link";
import AccountMenu from "~/components/shell/account_menu";
import NavBadge from "~/components/shell/nav_badge";
import { NAV_ICONS } from "~/components/shell/nav_icons";
import { navGroups, type ShellNavItem } from "~/components/shell/nav_items";
import TenantSwitcher from "~/components/tenant_switcher";
import { Button } from "~/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * The desktop navigation (from 1024px), sticky beside the page: the wordmark
 * and the collapse button, the studio, the destinations in two groups
 * (`navGroups`: the day's work, then the studio's set-up) and the account
 * menu at the foot. Collapsed, it is an icon rail: every destination keeps
 * its icon, its current-page marker and its name (a tooltip, and the
 * accessible name), and a count becomes a dot.
 *
 * The current item has three cues, so none is colour alone: a raised row,
 * full-strength text and a red line at the sidebar's edge.
 */
export default function SideNav({
	items,
	tenantSlug,
	collapsed,
	onCollapsedChange,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}) {
	const groups = navGroups(items);

	return (
		<aside
			className={cn(
				"sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-shell lg:flex",
				collapsed ? "w-shell-sidebar-collapsed" : "w-shell-sidebar",
			)}
		>
			<div
				className={cn(
					"flex h-14 shrink-0 items-center gap-2",
					collapsed ? "justify-center px-3" : "justify-between pr-3 pl-5",
				)}
			>
				{!collapsed && <Logo size="sm" />}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground hover:text-foreground"
							aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
							aria-expanded={!collapsed}
							aria-controls="studio-sidebar"
							onClick={() => onCollapsedChange(!collapsed)}
						>
							{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">
						{collapsed ? "Expand sidebar" : "Collapse sidebar"}
					</TooltipContent>
				</Tooltip>
			</div>

			<div
				id="studio-sidebar"
				className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-1 pb-3"
			>
				<div className={cn(collapsed && "flex justify-center")}>
					<TenantSwitcher variant={collapsed ? "rail" : "sidebar"} />
				</div>

				<nav aria-label="Main" className="flex flex-col gap-5">
					{groups.map((group, index) => (
						<div key={group.key} className="flex flex-col gap-0.5">
							{collapsed ? (
								index > 0 && (
									<div aria-hidden="true" className="mx-2 mb-2 border-t" />
								)
							) : (
								<h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
									{group.label}
								</h2>
							)}
							<ul className="flex flex-col gap-0.5">
								{group.items.map((item) => (
									<li key={item.key}>
										<SideNavLink
											item={item}
											tenantSlug={tenantSlug}
											collapsed={collapsed}
										/>
									</li>
								))}
							</ul>
						</div>
					))}
				</nav>
			</div>

			<div
				className={cn(
					"shrink-0 border-t p-3",
					collapsed && "flex justify-center",
				)}
			>
				<AccountMenu variant={collapsed ? "rail" : "sidebar"} />
			</div>
		</aside>
	);
}

function SideNavLink({
	item,
	tenantSlug,
	collapsed,
}: {
	item: ShellNavItem;
	tenantSlug: string;
	collapsed: boolean;
}) {
	const Icon = NAV_ICONS[item.key];
	const link = (
		<NavLink
			route={item.route}
			params={{ tenant: tenantSlug }}
			also={item.also}
			className={cn(
				"group/nav relative flex h-9 items-center gap-2.5 rounded-md text-sm font-medium text-muted-foreground outline-none transition-colors duration-150",
				"hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground",
				// The marker: a short red line on the sidebar's edge, beside the current row.
				"before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-0.5 before:rounded-r-full before:bg-primary before:opacity-0 before:transition-opacity before:duration-150 aria-[current=page]:before:opacity-100",
				collapsed ? "w-11 justify-center" : "px-2.5",
			)}
		>
			<span className="relative flex">
				<Icon
					aria-hidden="true"
					className="size-4 shrink-0 group-aria-[current=page]/nav:text-foreground"
				/>
				{collapsed && item.badge ? (
					<span
						aria-hidden="true"
						className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar"
					/>
				) : null}
			</span>
			{collapsed ? (
				<span className="sr-only">
					{item.label}
					{item.badge ? `, ${item.badge} ${item.badgeLabel ?? "new"}` : ""}
				</span>
			) : (
				<>
					<span className="min-w-0 flex-1 truncate">{item.label}</span>
					{item.badge ? (
						<NavBadge count={item.badge} label={item.badgeLabel} />
					) : null}
				</>
			)}
		</NavLink>
	);

	if (!collapsed) return link;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{link}</TooltipTrigger>
			<TooltipContent side="right">
				{item.label}
				{item.badge ? `, ${item.badge} ${item.badgeLabel ?? "new"}` : ""}
			</TooltipContent>
		</Tooltip>
	);
}
