import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ArrowDown, ArrowUpDown } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import {
	backLink,
	cardLine,
	cardMeta,
	emptyListText,
	listHref,
	ON_CLIENT_TITLE,
	SORT_LABELS,
	tableCaption,
} from "~/components/project_list";
import {
	ACTIVE_FILTERS,
	type ProjectListProps,
	type ProjectRow,
	STATUS_LABELS,
} from "~/components/projects";
import StatusBadge from "~/components/status_badge";
import { GROUP_TITLES, type TodayGroupKey } from "~/components/today";
import { buttonVariants } from "~/components/ui/button";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** The ring a keyboard user sees on a row's link (the same as Today's rows). */
const ROW_FOCUS =
	"outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The studio's projects (TAT-46, TAT-109). Owners see every project, artists
 * the ones assigned to them; the server decides the rows, their order and
 * every word of a row (what waits first), and this lays them out: cards below
 * `lg`, a table that sorts from `lg`.
 */
export default function ProjectsIndex({
	filter,
	waiting,
	sort,
	counts,
	projects,
	page,
}: ProjectListProps) {
	const tenant = useTenant();
	const isOwner = tenant.role === "owner";
	const chipRow = useRef<HTMLElement>(null);
	// The row scrolls on a phone: bring the chosen chip into view after a
	// load or a back step, so the current filter is never off-screen. Before
	// paint, so the first frame is already scrolled and the row doesn't jump.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the view changes
	useLayoutEffect(() => {
		const row = chipRow.current;
		const chip = row?.querySelector<HTMLElement>("[aria-current]");
		if (!row || !chip) return;
		if (
			chip.offsetLeft < row.scrollLeft ||
			chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth
		) {
			row.scrollLeft =
				chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
		}
	}, [filter, waiting]);
	const base = urlFor("tenant.projects.index", { tenant: tenant.slug });
	// A line that names a card opens the project there, as Today's rows do.
	const projectHref = (project: ProjectRow) => {
		const hash = cardLine(project)?.hash;
		return `${urlFor("tenant.projects.show", { tenant: tenant.slug, id: project.id })}${hash ? `#${hash}` : ""}`;
	};
	const chips = [
		{ value: "active", label: "Active", count: counts.active },
		{ value: "needs_you", label: "Needs you", count: counts.needsYou },
		...ACTIVE_FILTERS.map((status) => ({
			value: status,
			label: STATUS_LABELS[status] ?? status,
			count: counts.byStatus[status] ?? 0,
		})),
		{ value: "closed", label: "Closed", count: counts.closed },
	];
	const title = waiting
		? waiting === "on_client"
			? ON_CLIENT_TITLE
			: GROUP_TITLES[waiting as TodayGroupKey]
		: null;
	const back = waiting ? backLink(waiting) : null;
	const pageHref = (pageNumber: number) =>
		listHref(base, { status: filter, waiting, sort, page: pageNumber });

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
			<div className="flex flex-col gap-3">
				{/* One row that scrolls sideways below `lg`: it bleeds to the screen edge,
				    so a cut-off chip shows there is more, and its padding keeps the
				    focus rings from being clipped. From `lg` the chips wrap as before.
				    In a waiting view the parent chip is current (`aria-current="true"`). */}
				<nav
					ref={chipRow}
					aria-label="Filter projects"
					className="relative -mx-4 -my-1 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:my-0 lg:flex-wrap lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden"
				>
					{chips.map((chip) => (
						<Link
							key={chip.value}
							href={listHref(base, { status: chip.value, sort })}
							preserveScroll
							aria-current={
								chip.value === filter ? (waiting ? "true" : "page") : undefined
							}
							className={buttonVariants({
								variant: chip.value === filter ? "default" : "outline",
								size: "sm",
								className: "snap-start",
							})}
						>
							{chip.value === "needs_you" && (
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-full bg-marigold"
								/>
							)}
							{chip.label}
							<span className="tabular-nums opacity-70">{chip.count}</span>
						</Link>
					))}
				</nav>

				{title && back && (
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
						<h2 className="text-base font-semibold wrap-anywhere">
							{title}{" "}
							<span className="font-normal text-muted-foreground tabular-nums">
								{page.total}
							</span>
						</h2>
						<Link
							href={listHref(base, { status: back.status })}
							className={cn(
								buttonVariants({ variant: "link", size: "sm" }),
								"px-0",
							)}
						>
							{back.label}
						</Link>
					</div>
				)}

				{sort !== null && (
					<nav
						aria-label="Sort projects"
						className="flex items-center gap-4 text-sm lg:hidden"
					>
						<span className="text-muted-foreground">Sort:</span>
						{(["needs", "contact"] as const).map((key) =>
							key === sort ? (
								<span key={key} aria-current="true" className="font-semibold">
									{SORT_LABELS[key]}
								</span>
							) : (
								<Link
									key={key}
									href={listHref(base, { status: filter, sort: key })}
									preserveScroll
									preserveState
									className="-my-3 flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
								>
									{SORT_LABELS[key]}
								</Link>
							),
						)}
					</nav>
				)}
			</div>

			{projects.length === 0 ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">
						{emptyListText({ filter, waiting, isOwner, page })}
					</p>
					{page.current > page.last && (
						<Link
							href={listHref(base, { status: filter, waiting, sort })}
							className="-my-3 flex min-h-11 items-center self-start text-sm text-primary underline-offset-4 hover:underline"
						>
							Back to the first page
						</Link>
					)}
				</div>
			) : (
				<>
					<ul className="flex flex-col divide-y rounded-md border bg-card lg:hidden">
						{projects.map((project) => {
							const line = cardLine(project);
							const meta = cardMeta(project, { isOwner, sort });
							return (
								<li key={project.id}>
									<Link
										href={projectHref(project)}
										className={cn(
											"flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-muted/50",
											ROW_FOCUS,
										)}
									>
										<span className="flex items-start justify-between gap-3">
											<span className="font-medium wrap-anywhere leading-normal">
												{project.clientName ?? "Unknown client"}
											</span>
											<StatusBadge
												status={project.status}
												className="shrink-0"
											/>
										</span>
										{project.piece && (
											<span className="text-sm text-muted-foreground wrap-anywhere leading-normal">
												{project.piece}
											</span>
										)}
										{line && (
											<span className="flex items-start gap-2 text-sm leading-normal">
												<LineText line={line} />
											</span>
										)}
										{meta && (
											<span className="text-sm text-muted-foreground wrap-anywhere leading-normal">
												{meta}
											</span>
										)}
									</Link>
								</li>
							);
						})}
					</ul>

					<div className="hidden rounded-md border bg-card lg:block">
						<Table>
							<TableCaption className="sr-only">
								{tableCaption({ filter, waiting, sort }, title)}
							</TableCaption>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[34%] whitespace-normal">
										Client and piece
									</TableHead>
									<TableHead>Status</TableHead>
									<SortHead
										word="Waiting"
										className="w-[26%]"
										sorted={sort === "needs"}
										sortable={sort !== null}
										ariaSort="descending"
										href={listHref(base, { status: filter, sort: "needs" })}
									/>
									<TableHead>Next session</TableHead>
									{isOwner && <TableHead>Artist</TableHead>}
									<SortHead
										word="Last contact"
										className="w-[18%]"
										sorted={sort === "contact"}
										sortable={sort !== null}
										ariaSort="ascending"
										href={listHref(base, { status: filter, sort: "contact" })}
									/>
								</TableRow>
							</TableHeader>
							<TableBody>
								{projects.map((project) => (
									<TableRow key={project.id}>
										<TableCell className="align-top whitespace-normal">
											<Link
												href={projectHref(project)}
												className={cn(
													"block rounded-sm font-medium wrap-anywhere leading-normal",
													ROW_FOCUS,
												)}
											>
												{project.clientName ?? "Unknown client"}
											</Link>
											{project.piece && (
												<span className="block text-sm text-muted-foreground wrap-anywhere leading-normal">
													{project.piece}
												</span>
											)}
										</TableCell>
										<TableCell className="align-top">
											<StatusBadge status={project.status} />
										</TableCell>
										<TableCell className="align-top whitespace-normal">
											{project.line ? (
												<span className="flex items-start gap-2 leading-normal">
													<LineText line={project.line} />
												</span>
											) : (
												<Dash />
											)}
										</TableCell>
										<TableCell className="align-top">
											{project.nextSessionText ?? <Dash />}
										</TableCell>
										{isOwner && (
											<TableCell className="align-top whitespace-normal">
												{project.artistName ? (
													<span className="wrap-anywhere">
														{project.artistName}
													</span>
												) : (
													<span className="whitespace-nowrap text-muted-foreground">
														No artist yet
													</span>
												)}
											</TableCell>
										)}
										<TableCell className="align-top whitespace-normal">
											{project.contactedText ?? <Dash />}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link
							// From a page past the last, Previous goes to the last real one.
							href={pageHref(Math.min(page.current - 1, page.last))}
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
							href={pageHref(page.current + 1)}
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

/** A row's line: the marigold dot and a screen-reader "Needs you:" when it needs you, then the words. */
function LineText({ line }: { line: { text: string; needsYou: boolean } }) {
	return (
		<>
			{line.needsYou && (
				<span
					aria-hidden="true"
					className="mt-1.5 size-2 shrink-0 rounded-full bg-marigold"
				/>
			)}
			<span className="min-w-0 wrap-anywhere">
				{line.needsYou && <span className="sr-only">Needs you: </span>}
				{line.text}
			</span>
		</>
	);
}

/** An empty cell: a dash to the eye, "None" to a screen reader. */
function Dash(): ReactNode {
	return (
		<>
			<span aria-hidden="true">–</span>
			<span className="sr-only">None</span>
		</>
	);
}

/**
 * A table header that sorts: a real link (sorting is a visit), with `aria-sort`
 * on the sorted column only. The visit keeps the page's state (`preserveState`)
 * so the link stays mounted and keeps keyboard focus. Where the view has its own order (`sortable`
 * false) it is plain text.
 */
function SortHead({
	word,
	className,
	href,
	sorted,
	sortable,
	ariaSort,
}: {
	word: string;
	className: string;
	href: string;
	sorted: boolean;
	sortable: boolean;
	ariaSort: "ascending" | "descending";
}) {
	const Icon = sorted ? ArrowDown : ArrowUpDown;
	return (
		<TableHead
			aria-sort={sorted ? ariaSort : undefined}
			className={cn("whitespace-normal", className)}
		>
			{sortable ? (
				<Link
					href={href}
					preserveScroll
					preserveState
					className={cn(
						buttonVariants({ variant: "ghost", size: "sm" }),
						"-ml-3",
					)}
				>
					{word}
					<Icon aria-hidden="true" />
				</Link>
			) : (
				word
			)}
		</TableHead>
	);
}
