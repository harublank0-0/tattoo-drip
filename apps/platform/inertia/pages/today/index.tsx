import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { urlFor } from "~/client";
import { studioDate } from "~/components/calendar";
import { DayAgenda, useNow } from "~/components/day_agenda";
import Page from "~/components/page";
import PilotMetricsCard from "~/components/pilot_metrics_card";
import SetupChecklist from "~/components/setup_checklist";
import {
	emptyText,
	GROUP_TITLES,
	moreText,
	setupFirst,
	type TodayGroup,
	type TodayMore,
	type TodayPageProps,
	type TodayRow,
} from "~/components/today";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** A row's address: the page it opens, and the card on it where the member acts. */
function rowHref(slug: string, { route, id, hash }: TodayRow["target"]) {
	return `${urlFor(route, { tenant: slug, id })}${hash ? `#${hash}` : ""}`;
}

/** "See all" opens the Inbox, or Projects in the one status that holds the whole group. */
function moreHref(slug: string, more: TodayMore) {
	const base = urlFor(more.route, { tenant: slug });
	return more.status ? `${base}?status=${more.status}` : base;
}

/**
 * Today (TAT-107): what needs you right now, who is in the chair today and
 * which clients you are waiting on. Every member's home. The server decides
 * every group, row, count, word and target; this only lays them out. A new
 * studio sees its setup checklist first.
 */
export default function TodayIndex({
	dateText,
	date,
	timezone,
	needsYou,
	sessions,
	waiting,
	setup,
	studioPage,
	pilotMetrics,
}: TodayPageProps) {
	const tenant = useTenant();
	const now = useNow();
	const isOwner = tenant.role === "owner";
	const checklist =
		setup && studioPage ? (
			<SetupChecklist setup={setup} studioUrl={studioPage.url} />
		) : null;
	const checklistFirst = setupFirst({ setup, needsYou });
	// Once something needs the owner, the checklist moves below the sections.
	const lateChecklist = checklist && !checklistFirst;

	return (
		<Page title="Today" description={dateText}>
			{checklistFirst && checklist}
			<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
				<TodaySection
					id="today-needs"
					title="Needs you"
					className="lg:col-span-7"
				>
					{needsYou.length === 0 ? (
						<CardContent className="py-4 text-sm text-muted-foreground">
							{emptyText("needsYou", tenant.role)}
						</CardContent>
					) : (
						needsYou.map((group) => (
							<NeedsYouGroup key={group.key} group={group} slug={tenant.slug} />
						))
					)}
				</TodaySection>

				<TodaySection
					id="today-sessions"
					title="Today's sessions"
					className={cn(
						"lg:col-span-5",
						lateChecklist ? "lg:row-span-3" : "lg:row-span-2",
					)}
				>
					<CardContent className="flex flex-col gap-4 py-4">
						{sessions.rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{emptyText("sessions", tenant.role, sessions.scope)}
							</p>
						) : (
							<DayAgenda
								day={{ date, label: "", sessions: sessions.rows }}
								isToday={studioDate(now, timezone) === date}
								now={now}
								timezone={timezone}
								showArtist={isOwner}
								isOwner={isOwner}
								tenantSlug={tenant.slug}
							/>
						)}
						<Link
							href={urlFor("tenant.calendar.index", { tenant: tenant.slug })}
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"self-start",
							)}
						>
							Open the calendar
						</Link>
					</CardContent>
				</TodaySection>

				<TodaySection
					id="today-waiting"
					title="Waiting on clients"
					count={waiting.count}
					className="lg:col-span-7"
				>
					{waiting.rows.length === 0 ? (
						<CardContent className="py-4 text-sm text-muted-foreground">
							{emptyText("waiting", tenant.role)}
						</CardContent>
					) : (
						<>
							<RowList rows={waiting.rows} slug={tenant.slug} />
							{waiting.more && (
								<SeeAll
									href={moreHref(tenant.slug, waiting.more)}
									text={moreText({ count: waiting.count, more: waiting.more })}
								/>
							)}
						</>
					)}
				</TodaySection>

				{lateChecklist && <div className="lg:col-span-7">{checklist}</div>}
			</div>
			{pilotMetrics && <PilotMetricsCard metrics={pilotMetrics} />}
		</Page>
	);
}

TodayIndex.layout = [AppLayout];

/**
 * A titled section: a labelled region whose card has no padding of its
 * own, so its rows reach the card's edges. The count, when given, sits
 * at the right of the title.
 */
function TodaySection({
	id,
	title,
	count,
	className,
	children,
}: {
	id: string;
	title: string;
	count?: number;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={id} className={className}>
			<Card className="gap-0 py-0">
				<CardHeader className="px-4 pt-4">
					<CardTitle className="flex items-center gap-2">
						<h2 id={id}>{title}</h2>
						{count !== undefined && count > 0 && (
							<span className="ml-auto text-sm font-normal text-muted-foreground tabular-nums">
								{count}
							</span>
						)}
					</CardTitle>
				</CardHeader>
				{children}
			</Card>
		</section>
	);
}

/** One group of "Needs you": its title with a marigold dot and its count, its rows, and where to see the rest. */
function NeedsYouGroup({ group, slug }: { group: TodayGroup; slug: string }) {
	const headingId = `today-group-${group.key}`;

	return (
		<section aria-labelledby={headingId} className="border-t first:border-t-0">
			<h3
				id={headingId}
				className="flex items-center gap-2 px-4 pt-4 text-sm font-semibold"
			>
				<span
					aria-hidden="true"
					className="size-2 shrink-0 rounded-full bg-marigold"
				/>
				{GROUP_TITLES[group.key]}
				<span className="ml-auto font-normal text-muted-foreground tabular-nums">
					{group.count}
				</span>
			</h3>
			<RowList rows={group.rows} slug={slug} />
			{group.more && (
				<SeeAll
					href={moreHref(slug, group.more)}
					text={moreText({ count: group.count, more: group.more })}
				/>
			)}
		</section>
	);
}

/** The rows of a group: each one a link that opens the card where the member acts. */
function RowList({ rows, slug }: { rows: TodayRow[]; slug: string }) {
	return (
		<ul className="flex flex-col divide-y">
			{rows.map((row) => (
				<li key={`${row.target.route}-${row.id}`}>
					<Link
						href={rowHref(slug, row.target)}
						className="flex min-h-11 items-start gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
						<ChevronRight
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						/>
					</Link>
				</li>
			))}
		</ul>
	);
}

/** "See all 7 in the Inbox": a quiet link under a group that has more rows than are shown. */
function SeeAll({ href, text }: { href: string; text: string }) {
	return (
		<div className="px-4 pb-3">
			<Link
				href={href}
				className={cn(
					buttonVariants({ variant: "ghost", size: "sm" }),
					"-ml-3",
				)}
			>
				{text}
			</Link>
		</div>
	);
}
