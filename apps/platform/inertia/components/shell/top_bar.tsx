import AccountMenu from "~/components/shell/account_menu";
import TenantSwitcher from "~/components/tenant_switcher";

/** The phone top bar (below 1024px): the studio, and the account menu. */
export default function TopBar() {
	return (
		<header className="sticky top-0 z-30 border-b bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:hidden">
			<div className="flex h-14 items-center justify-between gap-3 px-4">
				<div className="min-w-0">
					<TenantSwitcher />
				</div>
				<AccountMenu />
			</div>
		</header>
	);
}
