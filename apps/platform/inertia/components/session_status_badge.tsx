import { cn } from "cn";
import { CalendarCheck, CalendarX, CircleCheck, UserX } from "lucide-react";
import { SESSION_STATUS_LABELS } from "~/components/projects";
import { Badge } from "~/components/ui/badge";

/**
 * A session's status (Studio OS) in StatusBadge's language: the word, a mark
 * and the status tokens, so nothing relies on colour alone. Scheduled is the
 * "booked" green with a calendar tick; done, no-show and cancelled are the
 * closed grey, each with its own mark. Project statuses stay StatusBadge's.
 */
const STYLE: Record<string, { className: string; Icon: typeof CalendarCheck }> =
	{
		scheduled: {
			className: "bg-status-booked-bg text-status-booked-fg",
			Icon: CalendarCheck,
		},
		completed: {
			className: "bg-status-closed-bg text-status-closed-fg",
			Icon: CircleCheck,
		},
		no_show: {
			className: "bg-status-closed-bg text-status-closed-fg",
			Icon: UserX,
		},
		cancelled: {
			className: "bg-status-closed-bg text-status-closed-fg",
			Icon: CalendarX,
		},
	};

export default function SessionStatusBadge({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	const { className: tone, Icon } = STYLE[status] ?? STYLE.cancelled;
	return (
		<Badge
			variant="ghost"
			className={cn(
				"gap-1.5 px-2 py-0.5 text-xs font-medium ring-1 ring-current/20 ring-inset [&>svg]:size-3",
				tone,
				className,
			)}
		>
			<Icon aria-hidden="true" />
			{SESSION_STATUS_LABELS[status] ?? status}
		</Badge>
	);
}
