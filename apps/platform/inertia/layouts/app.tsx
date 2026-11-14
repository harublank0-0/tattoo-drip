import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import { navItems, showTabBar } from "~/components/shell/nav_items";
import OfflineBar from "~/components/shell/offline_bar";
import SideNav from "~/components/shell/side_nav";
import TabBar from "~/components/shell/tab_bar";
import TopBar from "~/components/shell/top_bar";
import VerifyEmailBar from "~/components/shell/verify_email_bar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useSidebarCollapsed } from "~/hooks/use-sidebar";

/**
 * The Studio OS shell (TAT-67) for every tenant page. Below 1024px: a top
 * bar (studio switcher, bell, account menu) and a bottom tab bar with a More
 * menu; from 1024px: a sidebar that collapses to an icon rail, and a top bar
 * with the breadcrumbs. The page scrolls the window, so the sidebar and the
 * top bar are sticky rather than scroll boxes of their own. Every list of
 * destinations comes from `navItems`; add new areas there.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
	const { tenant, inboxCount, todayCount, reviewsCount } = usePage().props;
	const [collapsed, setCollapsed] = useSidebarCollapsed();
	const items = tenant
		? navItems(tenant, {
				inbox: inboxCount,
				today: todayCount,
				reviews: reviewsCount,
			})
		: [];
	const tabs = showTabBar(items);

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex min-h-svh bg-background">
				{tenant && (
					<SideNav
						items={items}
						tenantSlug={tenant.slug}
						collapsed={collapsed}
						onCollapsedChange={setCollapsed}
					/>
				)}
				<div className="flex min-w-0 flex-1 flex-col">
					<TopBar items={items} />
					<OfflineBar />
					<VerifyEmailBar />
					<main
						className={cn(
							"flex flex-1 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
							tabs &&
								"pb-[calc(var(--shell-tab-bar)+env(safe-area-inset-bottom))] lg:pb-0",
						)}
					>
						{children}
					</main>
				</div>
				{tenant && tabs && <TabBar items={items} tenantSlug={tenant.slug} />}
				<FlashToasts />
			</div>
		</TooltipProvider>
	);
}
