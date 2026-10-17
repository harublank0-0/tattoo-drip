import { cn } from "cn";

/** The count on a destination, e.g. new inquiries; read out as "3 new". */
export default function NavBadge({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums",
				className,
			)}
		>
			{count}
			<span className="sr-only"> new</span>
		</span>
	);
}
