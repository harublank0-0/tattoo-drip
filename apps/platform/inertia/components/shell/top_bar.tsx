import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Plus } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { urlFor } from "~/client";
import Logo from "~/components/logo";
import AccountMenu from "~/components/shell/account_menu";
import AlertsLink from "~/components/shell/alerts_link";
import Breadcrumbs from "~/components/shell/breadcrumb_trail";
import { isCurrentPath, type ShellNavItem } from "~/components/shell/nav_items";
import TenantSwitcher from "~/components/tenant_switcher";
import { buttonVariants } from "~/components/ui/button";

/**
 * The top bar, sticky above every page. On a studio page: below 1024px the
 * studio, the bell and the account menu (the sidebar holds them from
 * 1024px); from 1024px the breadcrumbs, "Book a session" and the bell. On a
 * page outside a studio (the account page, TAT-95) it is the wordmark and the
 * account menu at every width.
 *
 * It grows when a long studio name wraps, so it publishes its real height as
 * `--top-bar-height` on the page: an anchor's `scroll-mt` (the Payments card,
 * TAT-88) clears the bar with `var(--top-bar-height)` instead of a guess.
 */
export default function TopBar({ items }: { items: ShellNavItem[] }) {
	const page = usePage();
	const { tenant } = page.props;
	const bar = useRef<HTMLElement>(null);

	useLayoutEffect(() => {
		const element = bar.current;
		if (!element) return;
		const root = document.documentElement;
		const publish = () =>
			root.style.setProperty(
				"--top-bar-height",
				`${element.getBoundingClientRect().height}px`,
			);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(element);
		return () => {
			observer.disconnect();
			root.style.removeProperty("--top-bar-height");
		};
	}, []);

	const book = tenant
		? urlFor("tenant.projects.create", { tenant: tenant.slug })
		: null;
	const booking = book ? isCurrentPath(page.url, book) : false;

	return (
		<header
			ref={bar}
			className="sticky top-0 z-30 border-b bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
		>
			<div className="flex min-h-14 items-center justify-between gap-3 px-4 py-1.5 sm:px-6 lg:px-8">
				{tenant ? (
					<>
						<div className="min-w-0 lg:hidden">
							<TenantSwitcher variant="bar" />
						</div>
						<div className="hidden min-w-0 flex-1 lg:block">
							<Breadcrumbs items={items} tenantSlug={tenant.slug} />
						</div>
						<div className="flex shrink-0 items-center gap-1 lg:gap-2">
							{book && !booking && (
								<Link
									href={book}
									className={cn(
										buttonVariants({ size: "sm" }),
										"hidden lg:inline-flex",
									)}
								>
									<Plus aria-hidden="true" />
									Book a session
								</Link>
							)}
							<AlertsLink />
							<div className="lg:hidden">
								<AccountMenu variant="bar" />
							</div>
						</div>
					</>
				) : (
					<>
						<Logo />
						<AccountMenu variant="bar" />
					</>
				)}
			</div>
		</header>
	);
}
