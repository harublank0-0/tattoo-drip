import { cn } from "cn";
import { monogram } from "~/components/shell/studio";

/**
 * A studio's square mark in the shell: its logo icon (TAT-123, already drawn
 * on its light or dark tile) or, without one, its monogram on an ink tile.
 * Decorative: the studio's name is always written next to it or given to
 * the control that holds it.
 */
export default function StudioMark({
	name,
	logoUrl,
	className,
}: {
	name: string;
	logoUrl?: string | null;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground text-[0.6875rem] font-semibold text-background select-none",
				className,
			)}
		>
			{logoUrl ? (
				<img src={logoUrl} alt="" className="size-full object-cover" />
			) : (
				monogram(name)
			)}
		</span>
	);
}
