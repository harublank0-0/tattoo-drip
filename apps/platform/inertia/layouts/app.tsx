import { Form } from "@adonisjs/inertia/react";
import { cn } from "cn";
import { House, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import NavLink, { type NavItem } from "~/components/nav_link";
import ThemeToggle from "~/components/theme_toggle";
import { Button, buttonVariants } from "~/components/ui/button";

/**
 * Top-level app navigation. Add an entry here for every new area of your
 * app, and it shows up in the navigation bar with its active state handled.
 */
const nav: NavItem[] = [
	{ label: "Dashboard", route: "dashboard", icon: House },
];

export default function AppLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col">
			<header className="border-b bg-background">
				<div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
					<Logo size={28} />
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
					{nav.map(({ label, route, icon: Icon }) => (
						<NavLink
							key={label}
							route={route}
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
