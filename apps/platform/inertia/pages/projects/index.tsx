import { Link } from "@inertiajs/react";
import { useLayoutEffect, useRef } from "react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import {
	ACTIVE_FILTERS,
	type ProjectListProps,
	STATUS_LABELS,
} from "~/components/projects";
import StatusBadge from "~/components/status_badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The studio's projects, filtered by status (TAT-46). Owners see every
 * project, artists the ones assigned to them; the server decides.
 */
export default function ProjectsIndex({
	filter,
	counts,
	projects,
	page,
}: ProjectListProps) {
	const tenant = useTenant();
	const chipRow = useRef<HTMLElement>(null);
	// The row scrolls on a phone: bring the chosen chip into view after a
	// load or a back step, so the current filter is never off-screen. Before
	// paint, so the first frame is already scrolled and the row doesn't jump.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the filter changes
	useLayoutEffect(() => {
		const row = chipRow.current;
		const chip = row?.querySelector<HTMLElement>("[aria-current=page]");
		if (!row || !chip) return;
		if (
			chip.offsetLeft < row.scrollLeft ||
			chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth
		) {
			row.scrollLeft =
				chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
		}
	}, [filter]);
	const base = urlFor("tenant.projects.index", { tenant: tenant.slug });
	const href = (status: string, pageNumber = 1) =>
		`${base}?status=${status}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;
	const chips = [
		{ value: "active", label: "Active", count: counts.active },
		...ACTIVE_FILTERS.map((status) => ({
			value: status,
			label: STATUS_LABELS[status] ?? status,
			count: counts.byStatus[status] ?? 0,
		})),
		{ value: "closed", label: "Closed", count: counts.closed },
	];

	return (
		<Page
			title="Projects"
			actions={
				<Link
					href={urlFor("tenant.projects.create", { tenant: tenant.slug })}
					className={buttonVariants({ className: "h-11" })}
				>
					Book session
				</Link>
			}
		>
			{/* One row that scrolls sideways below `lg`: it bleeds to the screen edge,
			    so a cut-off chip shows there is more, and its padding keeps the
			    focus rings from being clipped. From `lg` the chips wrap as before. */}
			<nav
				ref={chipRow}
				aria-label="Filter projects"
				className="relative -mx-4 -my-1 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:my-0 lg:flex-wrap lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden"
			>
				{chips.map((chip) => (
					<Link
						key={chip.value}
						href={href(chip.value)}
						preserveScroll
						aria-current={chip.value === filter ? "page" : undefined}
						className={buttonVariants({
							variant: chip.value === filter ? "default" : "outline",
							size: "sm",
							className: "snap-start",
						})}
					>
						{chip.label}
						<span className="tabular-nums opacity-70">{chip.count}</span>
					</Link>
				))}
			</nav>

			{projects.length === 0 ? (
				<p className="text-sm text-muted-foreground">No projects here.</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border">
					{projects.map((project) => (
						<li key={project.id}>
							<Link
								href={urlFor("tenant.projects.show", {
									tenant: tenant.slug,
									id: project.id,
								})}
								className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50"
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">
										{project.clientName ?? "Unknown client"}
									</span>
									<span className="flex flex-wrap items-center gap-2">
										<StatusBadge status={project.status} />
									</span>
								</span>
								<span className="text-sm text-muted-foreground">
									{project.piece}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link
							href={href(filter, page.current - 1)}
							preserveScroll
							className="-my-3 flex min-h-11 items-center"
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link
							href={href(filter, page.current + 1)}
							preserveScroll
							className="-my-3 flex min-h-11 items-center"
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

ProjectsIndex.layout = [AppLayout];
