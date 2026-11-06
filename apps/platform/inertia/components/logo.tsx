import { Link } from "@adonisjs/inertia/react";
import { cn } from "cn";

/**
 * The Tattoo Drip name, linking home, set in the display face. An interim
 * wordmark: the mark in public/icons is still the placeholder (TAT-67), so
 * the name stands alone until a real one exists (replace
 * resources/brand/mark.svg and regenerate the icons). `size="sm"` is the
 * sidebar's, quieter than the studio it sits above.
 */
export default function Logo({ size = "md" }: { size?: "sm" | "md" }) {
	return (
		<Link
			route="home"
			className={cn(
				"rounded-sm font-display leading-tight font-bold text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				size === "md" ? "text-xl" : "text-base",
			)}
		>
			Tattoo Drip
		</Link>
	);
}
