import type { ReactNode } from "react";

/**
 * A group of content within a page, such as a group of form fields, with
 * an optional title and description. Stack several sections and they are
 * separated by a divider.
 */
export default function Section({
	id,
	title,
	description,
	children,
}: {
	/** An anchor a page's section links point at (it clears the top bar). */
	id?: string;
	title?: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			className="flex scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] flex-col gap-4 [section+&]:mt-8 [section+&]:border-t [section+&]:pt-8"
		>
			{(title || description) && (
				<header className="flex flex-col gap-1">
					{title && (
						<h2 className="text-base leading-snug font-semibold">{title}</h2>
					)}
					{description && (
						<p className="text-sm text-muted-foreground">{description}</p>
					)}
				</header>
			)}
			<div>{children}</div>
		</section>
	);
}
