import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Store, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import NavLink, { type NavItem } from "~/components/nav_link";
import Page from "~/components/page";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * The studio settings pages, listed in the sidebar. Add an entry for each
 * new settings page; links point at the current tenant.
 */
function settingsNav(tenantSlug: string): NavItem[] {
	const params = { tenant: tenantSlug };
	return [
		{
			label: "Studio profile",
			route: "tenant.settings.profile",
			params,
			icon: Store,
		},
		{
			label: "Payments",
			route: "tenant.settings.payments",
			params,
			icon: Wallet,
		},
	];
}

/**
 * Renders the settings heading, a sidebar of links and a card holding the
 * current page. Nest it under the app layout from each settings page:
 *
 * `Profile.layout = [AppLayout, SettingsLayout]`
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	const { tenant } = usePage().props;
	const items = tenant ? settingsNav(tenant.slug) : [];

	return (
		<Page
			title="Studio settings"
			description="Your studio's public details and how clients pay you."
		>
			<div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6">
				<nav
					className="flex gap-1 overflow-x-auto md:flex-col"
					aria-label="Settings"
				>
					{items.map(({ label, route, params, icon: Icon }) => (
						<NavLink
							key={label}
							route={route}
							params={params}
							className={cn(
								buttonVariants({ variant: "ghost", size: "sm" }),
								"justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
							)}
						>
							{Icon && <Icon data-icon="inline-start" />}
							{label}
						</NavLink>
					))}
				</nav>
				<Card>
					<CardContent>{children}</CardContent>
				</Card>
			</div>
		</Page>
	);
}
