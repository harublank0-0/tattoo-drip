import { cn } from "cn";
import { Fragment } from "react";
import NavLink from "~/components/nav_link";
import AccountMenu from "~/components/shell/account_menu";
import AlertsLink from "~/components/shell/alerts_link";
import NavBadge from "~/components/shell/nav_badge";
import { NAV_ICONS } from "~/components/shell/nav_icons";
import type { ShellNavItem } from "~/components/shell/nav_items";
import TenantSwitcher from "~/components/tenant_switcher";
import { buttonVariants } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

/**
 * The desktop navigation (from 1024px): the studio at the top, every
 * destination (a rule before the ones the phone keeps under More), and the
 * bell and the account menu at the bottom.
 */
export default function SideNav({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	return (
		<aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-4 border-r bg-card p-3 lg:flex">
			<div className="px-1 pt-1">
				<TenantSwitcher />
			</div>
			<nav aria-label="Main" className="flex flex-col gap-1">
				{items.map((item, index) => {
					const Icon = NAV_ICONS[item.key];
					const firstMore =
						item.place === "more" && items[index - 1]?.place === "bar";
					return (
						<Fragment key={item.key}>
							{firstMore && <Separator className="my-1" />}
							<NavLink
								route={item.route}
								params={{ tenant: tenantSlug }}
								also={item.also}
								className={cn(
									buttonVariants({ variant: "ghost" }),
									"justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
								)}
							>
								<Icon data-icon="inline-start" />
								<span className="flex-1 text-left">{item.label}</span>
								{item.badge ? (
									<NavBadge count={item.badge} label={item.badgeLabel} />
								) : null}
							</NavLink>
						</Fragment>
					);
				})}
			</nav>
			<div className="mt-auto flex flex-col gap-1">
				<AlertsLink variant="row" />
				<AccountMenu showName />
			</div>
		</aside>
	);
}
