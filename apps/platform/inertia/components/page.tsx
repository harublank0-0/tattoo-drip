import { Head } from "@inertiajs/react";
import type { ReactNode, Ref } from "react";

/**
 * The frame for an app page: sets the document title and renders the page
 * heading, an optional description and optional actions (buttons, links)
 * aligned to the right. Pass `hideTitle` to only set the document title.
 * Pass `titleRef` when the page moves focus to its heading after something
 * on it goes away (the heading then takes focus from code, not from Tab).
 */
export default function Page({
	title,
	titleRef,
	hideTitle = false,
	description,
	actions,
	children,
}: {
	title: string;
	titleRef?: Ref<HTMLHeadingElement>;
	hideTitle?: boolean;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	const hasHeader = !hideTitle || description || actions;

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-7 pb-12 sm:px-8 sm:pt-10 sm:pb-16">
			<Head title={title} />
			{hasHeader && (
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						{!hideTitle && (
							<h1
								ref={titleRef}
								tabIndex={titleRef ? -1 : undefined}
								className="font-display text-[1.75rem] leading-snug font-bold text-balance wrap-anywhere outline-none"
							>
								{title}
							</h1>
						)}
						{description && (
							<p className="text-sm text-muted-foreground">{description}</p>
						)}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</header>
			)}
			{children}
		</div>
	);
}
