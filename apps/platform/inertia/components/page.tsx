import { Head } from "@inertiajs/react";
import type { ReactNode, Ref } from "react";

/**
 * The frame for an app page: sets the document title and renders the page
 * heading, an optional description and optional actions (buttons, links)
 * aligned to the right. Pass `hideTitle` to only set the document title.
 * Pass `titleRef` when the page moves focus to its heading after something
 * on it goes away (the heading then takes focus from code, not from Tab).
 * `details` is anything under the description in the same column: the
 * project page's status, artist and progress line (TAT-108).
 *
 * Studio OS: the title is Geist semibold at 26 to 28px, no letter-spacing
 * (it can hold a client's name), over a 16 / 24 / 32px gutter by width; the
 * column stops at 80rem, so calendars and tables get the room on a desktop.
 */
export default function Page({
	title,
	titleRef,
	hideTitle = false,
	description,
	details,
	actions,
	children,
}: {
	title: string;
	titleRef?: Ref<HTMLHeadingElement>;
	hideTitle?: boolean;
	description?: ReactNode;
	details?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	const hasHeader = !hideTitle || description || details || actions;

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-6 pb-12 sm:px-6 sm:pt-8 sm:pb-16 lg:px-8">
			<Head title={title} />
			{hasHeader && (
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						{!hideTitle && (
							<h1
								ref={titleRef}
								tabIndex={titleRef ? -1 : undefined}
								className="text-[1.625rem] leading-[1.35] font-semibold text-balance wrap-anywhere outline-none sm:text-[1.75rem]"
							>
								{title}
							</h1>
						)}
						{description && (
							<p className="text-sm text-muted-foreground">{description}</p>
						)}
						{details}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</header>
			)}
			{children}
		</div>
	);
}
