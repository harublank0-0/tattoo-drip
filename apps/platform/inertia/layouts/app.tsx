import { Form } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { House, LogOut, Settings } from "lucide-react";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import NavLink, { type NavItem } from "~/components/nav_link";
import TenantSwitcher from "~/components/tenant_switcher";
import ThemeToggle from "~/components/theme_toggle";
import { Button, buttonVariants } from "~/components/ui/button";

/**
 * Navigation inside a tenant. Add an entry here for every new area of the
 * dashboard; links point at the current tenant (/t/:tenant/...).
 */
function tenantNav(tenant: { slug: string; role: string }): NavItem[] {
	const params = { tenant: tenant.slug };
	const items: NavItem[] = [
		{
			label: "Dashboard",
			route: "tenant.dashboard",
			params,
			exact: true,
			icon: House,
		},
	];
	// Owners only; the server 404s anyone else.
	if (tenant.role === "owner") {
		items.push({
			label: "Settings",
			route: "tenant.settings",
			params,
			icon: Settings,
		});
	}
	return items;
}

export default function AppLayout({ children }: { children: ReactNode }) {
	const { tenant } = usePage().props;
	const nav = tenant ? tenantNav(tenant) : [];

	return (
		<div className="flex min-h-svh flex-col">
			<header className="border-b bg-background">
				<div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
					<div className="flex min-w-0 items-center gap-3">
						<Logo size={28} />
						<TenantSwitcher />
					</div>
					<div className="flex items-center gap-2">
						<ThemeToggle />
						<Form route="session.destroy">
							<Button type="submit" variant="outline" size="sm">
								<LogOut data-icon="inline-start" />
								Log out
							</Button>
						</Form>
					</div>
				</div>
				<nav className="mx-auto flex w-full max-w-6xl gap-1 px-2 pb-2 sm:px-6">
					{nav.map(({ label, route, params, exact, icon: Icon }) => (
						<NavLink
							key={label}
							route={route}
							params={params}
							exact={exact}
							className={cn(
								buttonVariants({ variant: "ghost", size: "sm" }),
								"text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
							)}
						>
							{Icon && <Icon data-icon="inline-start" />}
							{label}
						</NavLink>
					))}
				</nav>
			</header>

			<main className="flex flex-1 bg-muted/40">{children}</main>
			<FlashToasts />
		</div>
	);
}
