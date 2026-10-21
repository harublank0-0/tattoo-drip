import { Link } from "@adonisjs/inertia/react";

/**
 * The Tattoo Drip name, linking home, set in the display face. An interim
 * wordmark: the mark in public/icons is still the placeholder (TAT-67), so
 * the name stands alone until a real one exists (replace
 * resources/brand/mark.svg and regenerate the icons).
 */
export default function Logo() {
	return (
		<Link
			route="home"
			className="font-display text-xl leading-tight font-bold text-foreground"
		>
			Tattoo Drip
		</Link>
	);
}
