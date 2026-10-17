import { Link } from "@adonisjs/inertia/react";

/**
 * The Tattoo Drip mark and name, linking home. The mark is the
 * placeholder in public/icons (TAT-67); replace resources/brand/mark.svg
 * and regenerate the icons to change it.
 */
export default function Logo({ size = 26 }: { size?: number }) {
	return (
		<Link
			route="home"
			className="inline-flex items-center gap-2 font-semibold text-foreground"
		>
			<img
				src="/icons/favicon.svg"
				width={size}
				height={size}
				alt=""
				className="rounded-md"
			/>
			<span>Tattoo Drip</span>
		</Link>
	);
}
