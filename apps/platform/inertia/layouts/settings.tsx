import { cn } from "cn";
import type { ReactNode } from "react";
import NavLink, { type NavItem } from "~/components/nav_link";
import Page from "~/components/page";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * The pages of the settings area, listed in the sidebar. Register a route
 * for each page and add it here, for example:
 *
 * `{ label: 'Profile', route: 'settings.profile', icon: User }`
 */
const items: NavItem[] = [];

/**
 * Renders the settings heading, a sidebar of links and a card holding the
 * current page. Nest it under the app layout from each settings page:
 *
 * `Profile.layout = [AppLayout, SettingsLayout]`
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<Page
			title="Settings"
			description="Manage your account settings and preferences."
		>
			<div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6">
				<nav
					className="flex gap-1 overflow-x-auto md:flex-col"
					aria-label="Settings"
				>
					{items.map(({ label, route, icon: Icon }) => (
						<NavLink
							key={label}
							route={route}
							exact
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
