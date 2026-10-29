import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { useLayoutEffect, useRef } from "react";
import Logo from "~/components/logo";
import AccountMenu from "~/components/shell/account_menu";
import AlertsLink from "~/components/shell/alerts_link";
import TenantSwitcher from "~/components/tenant_switcher";

/**
 * The phone top bar (below 1024px): the studio, and the account menu. It
 * grows when a long studio name wraps, so it publishes its real height as
 * `--top-bar-height` on the page (0px from 1024px, where it is hidden): an
 * anchor's `scroll-mt` (the Payments card, TAT-88) clears the bar with
 * `var(--top-bar-height)` instead of a guess. On a page outside a studio
 * (the account page, TAT-95) there is no sidebar to hold the account menu,
 * so the bar stays at every width, with the wordmark where the studio
 * switcher was, and `--top-bar-height` is then its real height.
 */
export default function TopBar() {
	const { tenant } = usePage().props;
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

	return (
		<header
			ref={bar}
			className={cn(
				"sticky top-0 z-30 border-b bg-card pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
				tenant && "lg:hidden",
			)}
		>
			<div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
				<div className="min-w-0">{tenant ? <TenantSwitcher /> : <Logo />}</div>
				<div className="flex items-center gap-1">
					<AlertsLink variant="icon" />
					<AccountMenu />
				</div>
			</div>
		</header>
	);
}
