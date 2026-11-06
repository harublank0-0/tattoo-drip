import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Bell } from "lucide-react";
import { alertsLabel } from "~/components/alerts";
import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { buttonVariants } from "~/components/ui/button";

/**
 * The way to the member's alerts (TAT-52), a bell in the top bar at every
 * width, with the unread count no tab counts (`alertCount`, TAT-107: the
 * Inbox and Today count an owner's, so an owner's bell shows no number). Not
 * a destination: the sidebar and the tab bar keep theirs. Screen readers
 * hear "Alerts, 3 unread".
 */
export default function AlertsLink() {
	const { tenant, alertCount } = usePage().props;
	if (!tenant) return null;
	const count = alertCount ?? 0;

	return (
		<NavLink
			route="tenant.alerts.index"
			params={{ tenant: tenant.slug }}
			label={alertsLabel(count)}
			className={cn(
				buttonVariants({ variant: "ghost", size: "icon" }),
				"relative rounded-full text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
			)}
		>
			<Bell aria-hidden="true" />
			{count > 0 && (
				<span aria-hidden="true">
					<NavBadge
						count={count}
						label="unread"
						className="absolute -top-0.5 -right-0.5 lg:-top-1 lg:-right-1"
					/>
				</span>
			)}
		</NavLink>
	);
}
