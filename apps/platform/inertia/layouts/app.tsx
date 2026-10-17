import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import { navItems, showTabBar } from "~/components/shell/nav_items";
import OfflineBar from "~/components/shell/offline_bar";
import SideNav from "~/components/shell/side_nav";
import TabBar from "~/components/shell/tab_bar";
import TopBar from "~/components/shell/top_bar";

/**
 * The dashboard shell (TAT-67) for every tenant page. Below 1024px: a top
 * bar (studio switcher, account menu) and a bottom tab bar; from 1024px:
 * a left sidebar. Both list the destinations from `navItems`; add new
 * areas there.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
	const { tenant, inboxCount } = usePage().props;
	const items = tenant ? navItems(tenant, inboxCount) : [];
	const tabs = showTabBar(items);

	return (
		<div className="flex min-h-svh">
			{tenant && <SideNav items={items} tenantSlug={tenant.slug} />}
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar />
				<OfflineBar />
				<main
					className={cn(
						"flex flex-1 bg-muted/40",
						tabs && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0",
					)}
				>
					{children}
				</main>
			</div>
			{tenant && tabs && <TabBar items={items} tenantSlug={tenant.slug} />}
			<FlashToasts />
		</div>
	);
}
