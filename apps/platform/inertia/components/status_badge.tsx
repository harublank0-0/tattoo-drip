import { cn } from "cn";
import { Archive, CalendarCheck, Clock, PenLine } from "lucide-react";
import {
	STATUS_GROUP_LABELS,
	STATUS_LABELS,
	type StatusGroup,
	statusGroup,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";

/** A group's colours, from the status tokens in app.css. */
const GROUP_STYLE: Record<StatusGroup, string> = {
	studio: "bg-status-studio-bg text-status-studio-fg",
	client: "bg-status-client-bg text-status-client-fg",
	booked: "bg-status-booked-bg text-status-booked-fg",
	chair: "bg-status-chair-bg text-status-chair-fg",
	closed: "bg-status-closed-bg text-status-closed-fg",
};

/** A group's mark. The studio's is the marigold dot: it is the one that needs you. */
const GROUP_ICON: Record<
	Exclude<StatusGroup, "studio">,
	typeof Clock | undefined
> = {
	client: Clock,
	booked: CalendarCheck,
	chair: PenLine,
	closed: Archive,
};

/**
 * A project's, an inquiry's or a screenshot flag's status as a pill (TAT-98):
 * always the word, in the colour and with the mark of its group (see
 * STATUS_GROUPS), so nothing relies on colour alone. The group's name is the
 * tooltip.
 */
export default function StatusBadge({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	const group = statusGroup(status);
	const Icon = group === "studio" ? undefined : GROUP_ICON[group];

	return (
		<Badge
			variant="ghost"
			data-group={group}
			title={STATUS_GROUP_LABELS[group]}
			className={cn(
				"gap-1.5 px-2.5 py-1 text-sm font-medium ring-1 ring-current/20 ring-inset [&>svg]:size-3.5",
				GROUP_STYLE[group],
				className,
			)}
		>
			{Icon ? (
				<Icon aria-hidden="true" />
			) : (
				<span
					aria-hidden="true"
					className="size-2 shrink-0 rounded-full bg-marigold"
				/>
			)}
			{STATUS_LABELS[status] ?? status}
		</Badge>
	);
}
