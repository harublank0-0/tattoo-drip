import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { buttonVariants } from "#/components/ui/button";

const subscribe = () => () => {};
/** False on the server and while hydrating, true after: for what only the browser knows. */
export function useMounted(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}

/** The cursors of the pages before this one, kept in the history entry (never the URL). */
function readTrail(state: unknown): string[] | undefined {
	const trail = (state as { directoryTrail?: unknown } | null)?.directoryTrail;
	return Array.isArray(trail) && trail.every((each) => typeof each === "string")
		? trail
		: undefined;
}

/**
 * Cursor paging (the API's contract: an opaque `nextCursor`, no page
 * numbers, no totals). "Next page" is a real link to `?cursor=` (SSR,
 * shareable, back/forward). On a later page, "First page" is always a
 * link; "Previous page" appears when this tab came here by "Next page" (the
 * earlier cursors ride in the history entry's state, so a shared link has
 * First page only). Rendered after hydration only, since the server can't
 * see that state.
 */
export function Pagination({
	action,
	search,
	nextCursor,
	noun,
}: {
	action: string;
	/** The address (a directory's or, D09, the gallery's): only its cursor is read. */
	search: { cursor?: string };
	nextCursor: string | null;
	noun: string;
}) {
	const mounted = useMounted();
	const state = useRouterState({ select: (each) => each.location.state });
	const trail = mounted ? readTrail(state) : undefined;
	const previous = search.cursor && trail?.length ? trail.at(-1) : undefined;
	if (!search.cursor && !nextCursor) return null;
	return (
		<nav
			aria-label={`More ${noun}`}
			className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6"
		>
			<div className="flex flex-wrap gap-3">
				{previous !== undefined && (
					<Link
						to={action}
						search={{ ...search, cursor: previous || undefined } as never}
						state={{ directoryTrail: trail?.slice(0, -1) } as never}
						className={buttonVariants({ variant: "outline" })}
					>
						<ArrowLeftIcon aria-hidden="true" />
						Previous page
					</Link>
				)}
				{search.cursor && previous !== "" && (
					<Link
						to={action}
						search={{ ...search, cursor: undefined } as never}
						className={buttonVariants({ variant: "ghost" })}
					>
						First page
					</Link>
				)}
			</div>
			{nextCursor && (
				<Link
					to={action}
					search={{ ...search, cursor: nextCursor } as never}
					state={
						{
							directoryTrail: [...(trail ?? []), search.cursor ?? ""],
						} as never
					}
					className={buttonVariants({ variant: "primary" })}
				>
					Next page
					<ArrowRightIcon aria-hidden="true" />
				</Link>
			)}
		</nav>
	);
}
