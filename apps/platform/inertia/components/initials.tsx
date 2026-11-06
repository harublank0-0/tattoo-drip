import { cn } from "cn";
import { initialsOf } from "~/components/clients";

/** A client's initials in a quiet circle: decorative, the name is written beside it. */
export default function Initials({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-semibold text-muted-foreground",
				className,
			)}
		>
			{initialsOf(name)}
		</span>
	);
}
