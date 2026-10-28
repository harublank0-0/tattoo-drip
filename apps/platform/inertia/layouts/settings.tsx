import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import {
	MessageSquareText,
	Palette,
	Store,
	UserPlus,
	Users,
	Wallet,
} from "lucide-react";
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
			label: "Page look",
			route: "tenant.settings.look",
			params,
			icon: Palette,
		},
		{
			label: "Payments",
			route: "tenant.settings.payments",
			params,
			icon: Wallet,
		},
		{
			label: "Messages",
			route: "tenant.settings.messages",
			params,
			icon: MessageSquareText,
		},
		{
			label: "Artists",
			route: "tenant.artists",
			params,
			icon: Users,
		},
		{
			label: "Members",
			route: "tenant.settings.members",
			params,
			icon: UserPlus,
		},
	];
}

/**
 * Renders the settings heading, a sidebar of links and a card holding the
 * current page. Nest it under the app layout from each settings page:
 *
 * `Profile.layout = [AppLayout, SettingsLayout]`
 *
 * A non-owner (an artist on their own profile, TAT-30) gets the card alone.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	const { tenant } = usePage().props;
	// An artist reaches only their own profile here (TAT-30): no settings
	// sidebar, whose links are all owners only.
	if (tenant && tenant.role !== "owner") {
		return (
			<Page
				title="Your artist profile"
				description="What clients see about you on the studio page."
			>
				<Card>
					<CardContent>{children}</CardContent>
				</Card>
			</Page>
		);
	}
	const items = tenant ? settingsNav(tenant.slug) : [];

	return (
		<Page
			title="Studio settings"
			description="Your studio's public details, its artists and members, how clients pay you and the messages you send them."
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
