import type { ReactNode } from "react";

/**
 * A section's opening: the needle line and a short label (what the section
 * is about, in the theme's small caps) above its `h2`. The label is a
 * paragraph, not part of the heading, so the outline reads the heading alone.
 */
export function SectionHead({
	id,
	label,
	children,
	className,
}: {
	/** The h2's id, which the section's aria-labelledby names. */
	id: string;
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<header className={className ? `ink-head ${className}` : "ink-head"}>
			<p className="ink-label">{label}</p>
			<h2 id={id} className="ink-title">
				{children}
			</h2>
		</header>
	);
}

/** A headline set on deliberate lines: each line its own block, read as one sentence. */
export function Lines({ lines }: { lines: readonly string[] }) {
	return (
		<>
			{lines.map((line, index) => (
				<span key={line} className="ink-line">
					{line}
					{index < lines.length - 1 ? " " : null}
				</span>
			))}
		</>
	);
}
