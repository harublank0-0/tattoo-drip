import type { ReactNode } from "react";

/**
 * A group of content within a page, such as a group of form fields, with
 * an optional title and description. Stack several sections and they are
 * separated by a divider.
 */
export default function Section({
	title,
	description,
	children,
}: {
	title?: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4 [section+&]:mt-6 [section+&]:border-t [section+&]:pt-6">
			{(title || description) && (
				<header className="flex flex-col gap-1">
					{title && <h2 className="text-sm font-semibold">{title}</h2>}
					{description && (
						<p className="text-sm text-muted-foreground">{description}</p>
					)}
				</header>
			)}
			<div>{children}</div>
		</section>
	);
}
