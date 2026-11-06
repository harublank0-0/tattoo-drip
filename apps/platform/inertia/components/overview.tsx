import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { urlFor } from "~/client";
import { SESSION_KIND_LABELS } from "~/components/projects";
import StatusBadge from "~/components/status_badge";
import {
	GROUP_ACTIONS,
	GROUP_TITLES,
	moreText,
	type TodayGroup,
	type TodayMetric,
	type TodayMore,
	type TodayRow,
	type UpcomingSession,
} from "~/components/today";

/**
 * The pieces of Today's overview (Studio OS). The server words everything
 * (TodayController, #modules/reports/overview); these only lay it out.
 */

/** A row's address: the page it opens, and the card on it where the member acts. */
export function rowHref(slug: string, { route, id, hash }: TodayRow["target"]) {
	return `${urlFor(route, { tenant: slug, id })}${hash ? `#${hash}` : ""}`;
}

/** "See all" opens the Inbox, or the Projects view that holds exactly the group (`?waiting=`). */
export function moreHref(slug: string, more: TodayMore) {
	const base = urlFor(more.route, { tenant: slug });
	return more.waiting ? `${base}?waiting=${more.waiting}` : base;
}

/**
 * The summary strip: a few numbers in a row, split by hairlines, no boxes.
 * Two across on a phone, all in one row from `sm`. A `dl`, so a screen
 * reader hears each label with its number and its detail.
 */
export function MetricsStrip({ metrics }: { metrics: TodayMetric[] }) {
	return (
		<dl
			className={cn(
				"grid grid-cols-2 border-y",
				metrics.length === 3 && "sm:grid-cols-3",
				metrics.length === 4 && "sm:grid-cols-4",
			)}
		>
			{metrics.map((metric, index) => (
				<div
					key={metric.key}
					className={cn(
						"flex min-w-0 flex-col gap-1 py-4",
						index % 2 === 1 ? "border-l pl-4" : "pr-4",
						index >= 2 && "border-t",
						// One row from `sm`: a rule between each, none above.
						"sm:border-t-0 sm:pr-4",
						index > 0 ? "sm:border-l sm:pl-5" : "sm:border-l-0 sm:pl-0",
					)}
				>
					<dt className="text-sm text-muted-foreground">{metric.label}</dt>
					<dd className="order-first text-[1.75rem] leading-tight font-semibold tabular-nums">
						{metric.value}
					</dd>
					<dd className="text-xs text-muted-foreground">{metric.detail}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * A titled section of the overview: its heading, an optional count after it
 * and an optional link at the right, then its content. No box of its own:
 * the content decides whether it needs one.
 */
export function OverviewSection({
	id,
	title,
	count,
	action,
	className,
	children,
}: {
	id: string;
	title: string;
	count?: number;
	action?: { href: string; label: string };
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className={cn("flex min-w-0 flex-col gap-3", className)}
		>
			<header className="flex min-h-8 items-center gap-2">
				<h2
					id={id}
					className="flex items-baseline gap-2 text-base leading-snug font-semibold"
				>
					{title}
					{count !== undefined && count > 0 && (
						<span className="text-sm font-normal text-muted-foreground tabular-nums">
							<span className="sr-only">, </span>
							{count}
						</span>
					)}
				</h2>
				{action && (
					<Link
						href={action.href}
						className="-my-2 ml-auto inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8"
					>
						{action.label}
						<ChevronRight aria-hidden="true" className="size-3.5" />
					</Link>
				)}
			</header>
			{children}
		</section>
	);
}

/** A quiet sentence where a section has nothing: what will show up there. */
export function QuietEmpty({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
			{children}
		</p>
	);
}

/**
 * "Needs you": one list, its groups as quiet headings inside it (a marigold
 * dot, the title, the count), each row the request or project and, at its
 * right, what the member does there. Each row is one link to the card where
 * they act; "See all" goes on where a group has more.
 */
export function AttentionQueue({
	groups,
	slug,
}: {
	groups: TodayGroup[];
	slug: string;
}) {
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			{groups.map((group) => {
				const headingId = `today-group-${group.key}`;
				return (
					<section
						key={group.key}
						aria-labelledby={headingId}
						className="border-t first:border-t-0"
					>
						<h3
							id={headingId}
							className="flex items-center gap-2 bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground"
						>
							<span
								aria-hidden="true"
								className="size-1.5 shrink-0 rounded-full bg-marigold"
							/>
							<span className="text-foreground">{GROUP_TITLES[group.key]}</span>
							<span className="ml-auto tabular-nums">{group.count}</span>
						</h3>
						<RowList
							rows={group.rows}
							slug={slug}
							action={GROUP_ACTIONS[group.key]}
						/>
						{group.more && (
							<SeeAll
								href={moreHref(slug, group.more)}
								text={moreText({ count: group.count, more: group.more })}
							/>
						)}
					</section>
				);
			})}
		</div>
	);
}

/**
 * Rows of a list: each one a link that opens the card where the member acts.
 * With `action`, its word sits at the right from `sm` ("Review"); a phone
 * keeps the chevron, and the row's whole width is the target.
 */
export function RowList({
	rows,
	slug,
	action,
}: {
	rows: TodayRow[];
	slug: string;
	action?: string;
}) {
	return (
		<ul className="flex flex-col divide-y border-t">
			{rows.map((row) => (
				<li key={`${row.target.route}-${row.id}`}>
					<Link
						href={rowHref(slug, row.target)}
						className="group/row flex min-h-11 items-start gap-3 px-4 py-3 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
					>
						<span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-normal">
							<span className="font-medium wrap-anywhere">{row.name}</span>
							<span className="text-sm wrap-anywhere">{row.detail}</span>
							{row.meta && (
								<span className="text-sm text-muted-foreground wrap-anywhere">
									{row.meta}
								</span>
							)}
						</span>
						<span className="mt-0.5 flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors group-hover/row:text-foreground">
							{action && <span className="hidden sm:inline">{action}</span>}
							<ChevronRight aria-hidden="true" className="size-4" />
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

/** "See all 7 in the Inbox": a link under a group that has more rows than are shown. */
function SeeAll({ href, text }: { href: string; text: string }) {
	return (
		<div className="border-t px-4">
			<Link
				href={href}
				className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-brand-text outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-10"
			>
				{text}
				<ChevronRight aria-hidden="true" className="size-3.5" />
			</Link>
		</div>
	);
}

/**
 * The sessions after today, under their day ("Sat 8 Nov"): the time, the
 * client and what the session is. A link to the project's Sessions card,
 * unless this member can't open it.
 */
export function UpcomingList({
	rows,
	showArtist,
	isOwner,
	slug,
}: {
	rows: UpcomingSession[];
	showArtist: boolean;
	isOwner: boolean;
	slug: string;
}) {
	const days = rows.reduce<
		{ date: string; dayText: string; rows: UpcomingSession[] }[]
	>((list, row) => {
		const last = list[list.length - 1];
		if (last?.date === row.date) last.rows.push(row);
		else list.push({ date: row.date, dayText: row.dayText, rows: [row] });
		return list;
	}, []);

	return (
		<div className="flex flex-col gap-4">
			{days.map((day) => (
				<div key={day.date} className="flex flex-col">
					<h3 className="pb-1 text-xs font-medium text-muted-foreground">
						<time dateTime={day.date}>{day.dayText}</time>
					</h3>
					<ul className="flex flex-col divide-y border-y">
						{day.rows.map((session) => {
							const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
							const who = session.project
								? (session.project.clientName ?? "Unknown client")
								: isOwner
									? "Project not available"
									: "Not assigned to you";
							const content = (
								<>
									<span className="w-12 shrink-0 pt-px text-sm font-semibold tabular-nums">
										{session.startText}
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span
											className={cn(
												"text-sm font-medium wrap-anywhere",
												!session.project && "text-muted-foreground",
											)}
										>
											{who}
										</span>
										<span className="text-xs text-muted-foreground">
											{showArtist
												? `${kind} with ${session.artistName ?? "Unknown artist"}`
												: kind}
										</span>
									</span>
									{session.status === "completed" && (
										<StatusBadge status="completed" />
									)}
								</>
							);
							return (
								<li key={session.id}>
									{session.project ? (
										<Link
											href={`${urlFor("tenant.projects.show", {
												tenant: slug,
												id: session.project.id,
											})}#sessions`}
											className="-mx-2 flex min-h-11 items-start gap-3 rounded-md px-2 py-2.5 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											{content}
										</Link>
									) : (
										<div className="flex items-start gap-3 py-2.5">
											{content}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}
