import { useLayoutEffect, useRef } from "react";
import AccountMenu from "~/components/shell/account_menu";
import AlertsLink from "~/components/shell/alerts_link";
import TenantSwitcher from "~/components/tenant_switcher";

/**
 * The phone top bar (below 1024px): the studio, and the account menu. It
 * grows when a long studio name wraps, so it publishes its real height as
 * `--top-bar-height` on the page (0px from 1024px, where it is hidden): an
 * anchor's `scroll-mt` (the Payments card, TAT-88) clears the bar with
 * `var(--top-bar-height)` instead of a guess.
 */
export default function TopBar() {
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
			className="sticky top-0 z-30 border-b bg-card pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:hidden"
		>
			<div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
				<div className="min-w-0">
					<TenantSwitcher />
				</div>
				<div className="flex items-center gap-1">
					<AlertsLink variant="icon" />
					<AccountMenu />
				</div>
			</div>
		</header>
	);
}
