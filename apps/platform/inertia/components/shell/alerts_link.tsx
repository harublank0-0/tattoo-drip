import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Bell } from "lucide-react";
import { alertsLabel } from "~/components/alerts";
import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { buttonVariants } from "~/components/ui/button";

/**
 * The way to the member's alerts (TAT-52), with the unread count no tab
 * counts (`alertCount`, TAT-107: the Inbox and Today count an owner's, so an
 * owner's bell shows no number): a bell in the phone's top bar, a row above
 * the account menu in the desktop sidebar. Not a tab: the tab bar keeps its
 * destinations. Screen readers hear "Alerts, 3 unread".
 */
export default function AlertsLink({ variant }: { variant: "icon" | "row" }) {
	const { tenant, alertCount } = usePage().props;
	if (!tenant) return null;
	const count = alertCount ?? 0;
	const params = { tenant: tenant.slug };

	if (variant === "icon") {
		return (
			<NavLink
				route="tenant.alerts.index"
				params={params}
				label={alertsLabel(count)}
				className={cn(
					buttonVariants({ variant: "ghost", size: "icon" }),
					"relative size-11 rounded-full aria-[current=page]:bg-accent",
				)}
			>
				<Bell aria-hidden="true" />
				{count > 0 && (
					<span aria-hidden="true">
						<NavBadge
							count={count}
							label="unread"
							className="absolute top-1 right-0.5"
						/>
					</span>
				)}
			</NavLink>
		);
	}

	return (
		<NavLink
			route="tenant.alerts.index"
			params={params}
			label={alertsLabel(count)}
			className={cn(
				buttonVariants({ variant: "ghost" }),
				"w-full justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
			)}
		>
			<Bell data-icon="inline-start" />
			<span className="flex-1 text-left">Alerts</span>
			{count > 0 && (
				<span aria-hidden="true">
					<NavBadge count={count} label="unread" />
				</span>
			)}
		</NavLink>
	);
}
