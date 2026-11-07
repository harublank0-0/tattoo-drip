import { Link } from "@tanstack/react-router";
import { cn } from "#/lib/utils";

/**
 * The Tattoo Drip name in the display face, linking home: the brand's
 * interim wordmark, as in Studio OS (its mark is still a placeholder,
 * TAT-67). Never redrawn as a different logo.
 */
export function Wordmark({
	className,
	size = "md",
}: {
	className?: string;
	size?: "md" | "lg";
}) {
	return (
		<Link
			to="/"
			className={cn(
				"inline-flex min-h-11 items-center font-display font-bold tracking-tight",
				size === "md" ? "text-xl" : "text-display-md",
				className,
			)}
		>
			Tattoo Drip
		</Link>
	);
}
