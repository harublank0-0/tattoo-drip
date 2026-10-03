import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import ThemeToggle from "~/components/theme_toggle";
import { Button } from "~/components/ui/button";

export default function MarketingLayout({ children }: { children: ReactNode }) {
	const { props } = usePage();
	return (
		<>
			<header className="absolute inset-x-0 top-0 z-10 py-5">
				<div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
					<Logo size={28} />
					<div className="flex items-center gap-2">
						<ThemeToggle />
						{props.user ? (
							<Button asChild size="sm">
								<Link route="dashboard">Dashboard</Link>
							</Button>
						) : (
							<>
								<Button asChild variant="ghost" size="sm">
									<Link route="session.create">Sign in</Link>
								</Button>
								<Button asChild size="sm">
									<Link route="new_account.create">Get started</Link>
								</Button>
							</>
						)}
					</div>
				</div>
			</header>
			{children}
			<FlashToasts />
		</>
	);
}
