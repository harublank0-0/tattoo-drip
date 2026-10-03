import { Form } from "@adonisjs/inertia/react";
import { House, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import NavLink, { type NavItem } from "~/components/nav_link";
import ThemeToggle from "~/components/theme_toggle";

/**
 * Top-level app navigation. Add an entry here for every new area of your
 * app, and it shows up in the navigation bar with its active state handled.
 */
const nav: NavItem[] = [
	{ label: "Dashboard", route: "dashboard", icon: House },
];

export default function AppLayout({ children }: { children: ReactNode }) {
	return (
		<>
			<header className="header header--bar">
				<div className="header__inner">
					<Logo size={28} />
					<div className="header__right">
						<ThemeToggle />
						<Form route="session.destroy">
							<button type="submit" className="btn btn--secondary btn--sm">
								<LogOut size={15} /> Log out
							</button>
						</Form>
					</div>
				</div>
			</header>

			<nav className="subnav">
				<div className="subnav__inner">
					{nav.map(({ label, route, icon: Icon }) => (
						<NavLink key={label} route={route} className="subnav__item">
							{Icon && <Icon size={14} />}
							{label}
						</NavLink>
					))}
				</div>
			</nav>

			<div className="app-main">{children}</div>
			<FlashToasts />
		</>
	);
}
