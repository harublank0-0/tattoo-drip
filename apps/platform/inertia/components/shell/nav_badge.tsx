import { cn } from "cn";

/**
 * The count on a destination, e.g. new inquiries; read out as "3 new", or
 * with `label` ("2 to check"). Brand red: a count is the one thing in the
 * navigation that asks for attention.
 */
export default function NavBadge({
	count,
	label = "new",
	className,
}: {
	count: number;
	label?: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] leading-none font-semibold text-primary-foreground tabular-nums",
				className,
			)}
		>
			{count}
			<span className="sr-only"> {label}</span>
		</span>
	);
}
