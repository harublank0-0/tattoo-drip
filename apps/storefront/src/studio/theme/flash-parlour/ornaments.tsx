import type { ReactNode } from "react";

/**
 * Flash Parlour's ornaments: a five-pointed star and a ribbon's two tails,
 * drawn here as inline SVG (original, plain geometry: no one's flash, no
 * brand's mark). Always decoration: `aria-hidden`, never focusable, never in
 * front of the work. Their colours are CSS (`fill` and `stroke` from the
 * theme's tokens), so a device forcing its own colours draws them in its
 * text colour or not at all (styles.css).
 */

/** The star's points, in a 24 x 24 box: five points, the inner ring at 0.43 of the outer. */
const STAR_POINTS =
	"12 1.6 14.76 8.8 22.46 9.2 16.47 14.05 18.47 21.5 12 17.3 5.53 21.5 7.53 14.05 1.54 9.2 9.24 8.8";

export type StarTone = "red" | "mustard" | "green" | "ink" | "paper";

/** A star in one of the flat flash colours, with the ink outline. Decoration. */
export function Star({
	tone = "mustard",
	className,
}: {
	tone?: StarTone;
	className?: string;
}) {
	return (
		<svg
			className={
				className
					? `fp-star fp-star-${tone} ${className}`
					: `fp-star fp-star-${tone}`
			}
			viewBox="0 0 24 24"
			aria-hidden="true"
			focusable="false"
		>
			<polygon points={STAR_POINTS} />
		</svg>
	);
}

/** One of a ribbon's tails: a notched end folded behind the band. */
function RibbonTail({ side }: { side: "start" | "end" }) {
	return (
		<svg
			className={`fp-ribbon-tail fp-ribbon-tail-${side}`}
			viewBox="0 0 28 32"
			preserveAspectRatio="none"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1.5 1.5 H26.5 V30.5 H1.5 L10 16 Z" />
		</svg>
	);
}

/**
 * A section's title on a ribbon: the words on a mustard band in ink (8.3:1),
 * outlined, with a notched tail folded behind each end. The band wraps with
 * a long title (a studio's words never are in it, only the theme's), and the
 * tails stay inside the page's margins.
 */
export function RibbonTitle({
	id,
	level = 2,
	className,
	children,
}: {
	id: string;
	level?: 1 | 2;
	className?: string;
	children: ReactNode;
}) {
	const Heading = level === 1 ? "h1" : "h2";
	return (
		<Heading
			id={id}
			className={className ? `fp-ribbon-title ${className}` : "fp-ribbon-title"}
		>
			<span className="fp-ribbon">
				<RibbonTail side="start" />
				<span className="fp-ribbon-band">{children}</span>
				<RibbonTail side="end" />
			</span>
		</Heading>
	);
}

/** Three stars in the three flash colours: a rule between parts of a page. Decoration. */
export function StarRow({ className }: { className?: string }) {
	return (
		<div
			className={className ? `fp-star-row ${className}` : "fp-star-row"}
			aria-hidden="true"
		>
			<Star tone="red" />
			<Star tone="mustard" />
			<Star tone="green" />
		</div>
	);
}
