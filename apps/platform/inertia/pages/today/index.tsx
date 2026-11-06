import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { CalendarDays, Plus } from "lucide-react";
import { urlFor } from "~/client";
import { studioDate } from "~/components/calendar";
import { DayAgenda, useNow } from "~/components/day_agenda";
import {
	AttentionQueue,
	MetricsStrip,
	moreHref,
	OverviewSection,
	QuietEmpty,
	RowList,
	UpcomingList,
} from "~/components/overview";
import Page from "~/components/page";
import PilotMetricsCard from "~/components/pilot_metrics_card";
import SetupChecklist from "~/components/setup_checklist";
import {
	attentionTotal,
	emptyText,
	moreText,
	setupFirst,
	type TodayPageProps,
} from "~/components/today";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * Today (TAT-107, Studio OS): every member's home, answering three things in
 * order. What is happening today (the summary strip and the day's
 * timeline), what needs the member (one queue with an action per row), and
 * how the studio is doing (the next seven days, the clients being waited
 * on, and for owners the last 30 days' numbers). The server decides every
 * group, row, count, word and target; this only lays them out. A new studio
 * sees its setup checklist in place of the numbers.
 *
 * From `lg` it is two columns, the day's work at the left and what comes
 * next at the right; a phone reads the same order top to bottom.
 */
export default function TodayIndex({
	greeting,
	metrics,
	upcoming,
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
	const calendar = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const checklist =
		setup && studioPage ? (
			<SetupChecklist setup={setup} studioUrl={studioPage.url} />
		) : null;
	const checklistFirst = setupFirst({ setup, needsYou });
	// Once something needs the owner, the checklist moves below the sections.
	const lateChecklist = checklist && !checklistFirst;
	const attention = attentionTotal(needsYou);

	return (
		<Page title="Today" hideTitle>
			<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="text-[1.625rem] leading-[1.35] font-semibold text-balance wrap-anywhere sm:text-[1.75rem]">
						{greeting}
					</h1>
					<p className="text-sm text-muted-foreground">
						<time dateTime={date}>{dateText}</time>
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Link
						href={`${calendar}?view=week`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<CalendarDays aria-hidden="true" />
						This week
					</Link>
					{/* From `lg` the top bar holds it. */}
					<Link
						href={urlFor("tenant.projects.create", { tenant: tenant.slug })}
						className={cn(buttonVariants({ size: "sm" }), "lg:hidden")}
					>
						<Plus aria-hidden="true" />
						Book a session
					</Link>
				</div>
			</header>

			{checklistFirst ? checklist : <MetricsStrip metrics={metrics} />}

			<div className="grid grid-cols-1 items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
				<div className="flex min-w-0 flex-col gap-10">
					<OverviewSection
						id="today-sessions"
						title="Today's schedule"
						count={sessions.rows.length}
						action={{ href: calendar, label: "Calendar" }}
					>
						{sessions.rows.length === 0 ? (
							<QuietEmpty>
								{emptyText("sessions", tenant.role, sessions.scope)}
							</QuietEmpty>
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
					</OverviewSection>

					<OverviewSection id="today-needs" title="Needs you" count={attention}>
						{needsYou.length === 0 ? (
							<QuietEmpty>{emptyText("needsYou", tenant.role)}</QuietEmpty>
						) : (
							<AttentionQueue groups={needsYou} slug={tenant.slug} />
						)}
					</OverviewSection>
				</div>

				<div className="flex min-w-0 flex-col gap-10">
					<OverviewSection
						id="today-upcoming"
						title={`Next ${upcoming.days} days`}
						count={upcoming.count}
						action={
							upcoming.count > 0
								? {
										href: `${calendar}?view=week&date=${upcoming.from}`,
										label: "Calendar",
									}
								: undefined
						}
					>
						{upcoming.rows.length === 0 ? (
							<QuietEmpty>
								{emptyText(
									"upcoming",
									tenant.role,
									sessions.scope,
									upcoming.days,
								)}
							</QuietEmpty>
						) : (
							<UpcomingList
								rows={upcoming.rows}
								showArtist={isOwner}
								isOwner={isOwner}
								slug={tenant.slug}
							/>
						)}
						{upcoming.count > upcoming.rows.length && (
							<p className="text-xs text-muted-foreground">
								{upcoming.rows.length} of {upcoming.count} shown. The calendar
								has the rest.
							</p>
						)}
					</OverviewSection>

					<OverviewSection
						id="today-waiting"
						title="Waiting on clients"
						count={waiting.count}
						action={
							waiting.more
								? {
										href: moreHref(tenant.slug, waiting.more),
										label: moreText({
											count: waiting.count,
											more: waiting.more,
										}),
									}
								: undefined
						}
					>
						{waiting.rows.length === 0 ? (
							<QuietEmpty>{emptyText("waiting", tenant.role)}</QuietEmpty>
						) : (
							<div className="overflow-hidden rounded-lg border bg-card [&>ul]:border-t-0">
								<RowList rows={waiting.rows} slug={tenant.slug} />
							</div>
						)}
					</OverviewSection>

					{lateChecklist && checklist}
					{pilotMetrics && <PilotMetricsCard metrics={pilotMetrics} />}
				</div>
			</div>
		</Page>
	);
}

TodayIndex.layout = [AppLayout];
