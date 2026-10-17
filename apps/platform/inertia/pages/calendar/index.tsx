import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { urlFor } from "~/client";
import {
	type CalendarDay,
	type CalendarPageProps,
	type CalendarSession,
	type CalendarView,
	nowIndex,
} from "~/components/calendar";
import Page from "~/components/page";
import {
	SESSION_KIND_LABELS,
	SESSION_STATUS_LABELS,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** A URL for this page with some of its state changed. */
type HrefFor = (change: { view?: CalendarView; date?: string }) => string;

/** The current time, moved on every minute: where the Now marker sits. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/**
 * A day or a week of sessions (TAT-50), for the whole studio or one artist:
 * owners pick, artists see their own. Read-only; a session opens its
 * project.
 */
export default function CalendarIndex({
	view,
	date,
	today,
	timezone,
	rangeText,
	previous,
	next,
	scope,
	artistFilter,
	days,
}: CalendarPageProps) {
	const tenant = useTenant();
	const now = useNow();
	const isOwner = tenant.role === "owner";
	const base = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const hrefFor: HrefFor = (change) => {
		const params = new URLSearchParams({
			view: change.view ?? view,
			date: change.date ?? date,
		});
		if (artistFilter?.selected) params.set("artist", artistFilter.selected);
		return `${base}?${params.toString()}`;
	};

	if (scope === "unlinked") {
		return (
			<Page title="Calendar" description="Your sessions">
				<p className="max-w-prose text-sm text-muted-foreground">
					Your calendar shows the sessions booked with your artist profile, and
					your account isn&apos;t linked to one yet.
				</p>
			</Page>
		);
	}

	const agenda = (day: CalendarDay) => (
		<DayAgenda
			day={day}
			isToday={day.date === today}
			now={now}
			timezone={timezone}
			showArtist={scope === "studio"}
			isOwner={isOwner}
			tenantSlug={tenant.slug}
		/>
	);

	return (
		<Page title="Calendar" description={isOwner ? undefined : "Your sessions"}>
			<div className="flex max-w-3xl flex-col gap-6">
				<Toolbar
					view={view}
					today={today}
					previous={previous}
					next={next}
					hrefFor={hrefFor}
				/>
				{artistFilter &&
					(artistFilter.artists.length > 0 ? (
						<ArtistPicker
							base={base}
							view={view}
							date={date}
							filter={artistFilter}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							Every session belongs to an artist.{" "}
							<Link
								href={urlFor("tenant.artists.create", { tenant: tenant.slug })}
								className="font-medium text-foreground underline"
							>
								Add an artist
							</Link>{" "}
							to start booking.
						</p>
					))}
				<h2
					aria-live="polite"
					className="flex flex-wrap items-center gap-2 text-lg font-semibold"
				>
					{rangeText}
					{view === "day" && date === today && (
						<Badge variant="secondary">Today</Badge>
					)}
				</h2>
				{view === "day"
					? agenda(days[0])
					: days.map((day) => (
							<section
								key={day.date}
								aria-labelledby={`day-${day.date}`}
								className="flex flex-col gap-2"
							>
								<h3
									id={`day-${day.date}`}
									className="flex items-center gap-2 text-sm font-semibold"
								>
									{day.label}
									{day.date === today && (
										<Badge variant="secondary">Today</Badge>
									)}
								</h3>
								{agenda(day)}
							</section>
						))}
			</div>
		</Page>
	);
}

CalendarIndex.layout = [AppLayout];

/** Day or week, and one step back, today, one step on. */
function Toolbar({
	view,
	today,
	previous,
	next,
	hrefFor,
}: {
	view: CalendarView;
	today: string;
	previous: string;
	next: string;
	hrefFor: HrefFor;
}) {
	const unit = view === "day" ? "day" : "week";
	const step = cn(
		buttonVariants({ variant: "outline", size: "icon" }),
		"size-11",
	);

	return (
		<nav
			aria-label="Calendar"
			className="flex flex-wrap items-center justify-between gap-2"
		>
			<div className="inline-flex overflow-hidden rounded-md border bg-background">
				{(["day", "week"] as const).map((option) => (
					<Link
						key={option}
						href={hrefFor({ view: option })}
						aria-current={option === view ? "page" : undefined}
						className={cn(
							buttonVariants({
								variant: option === view ? "secondary" : "ghost",
							}),
							"min-h-11 rounded-none px-4 aria-[current=page]:font-semibold",
						)}
					>
						{option === "day" ? "Day" : "Week"}
					</Link>
				))}
			</div>
			<div className="flex items-center gap-2">
				<Link
					href={hrefFor({ date: previous })}
					aria-label={`Previous ${unit}`}
					className={step}
				>
					<ChevronLeft aria-hidden="true" />
				</Link>
				<Link
					href={hrefFor({ date: today })}
					className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
				>
					Today
				</Link>
				<Link
					href={hrefFor({ date: next })}
					aria-label={`Next ${unit}`}
					className={step}
				>
					<ChevronRight aria-hidden="true" />
				</Link>
			</div>
		</nav>
	);
}

/** Owners: one artist or all. A GET form with a button, no change-to-submit. */
function ArtistPicker({
	base,
	view,
	date,
	filter,
}: {
	base: string;
	view: CalendarView;
	date: string;
	filter: NonNullable<CalendarPageProps["artistFilter"]>;
}) {
	return (
		<form method="get" action={base} className="flex flex-wrap items-end gap-2">
			<input type="hidden" name="view" value={view} />
			<input type="hidden" name="date" value={date} />
			<Field className="min-w-0 flex-1 basis-48">
				<FieldLabel htmlFor="artist">Artist</FieldLabel>
				<select
					key={filter.selected ?? "all"}
					id="artist"
					name="artist"
					defaultValue={filter.selected ?? ""}
					className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm"
				>
					<option value="">All artists</option>
					{filter.artists.map(({ id, name }) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			</Field>
			<Button type="submit" variant="outline" className="min-h-11">
				Show
			</Button>
		</form>
	);
}

/** One day's sessions in time order, with the Now marker on today. */
function DayAgenda({
	day,
	isToday,
	now,
	timezone,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	day: CalendarDay;
	isToday: boolean;
	now: number;
	timezone: string;
	showArtist: boolean;
	isOwner: boolean;
	tenantSlug: string;
}) {
	if (day.sessions.length === 0) {
		return <p className="text-sm text-muted-foreground">No sessions.</p>;
	}
	const marker = isToday ? nowIndex(day.sessions, now) : -1;

	return (
		<ul className="flex flex-col divide-y rounded-md border bg-card">
			{day.sessions.map((session, index) => (
				<Fragment key={session.id}>
					{index === marker && <NowMarker now={now} timezone={timezone} />}
					<SessionItem
						session={session}
						showArtist={showArtist}
						isOwner={isOwner}
						tenantSlug={tenantSlug}
					/>
				</Fragment>
			))}
			{marker === day.sessions.length && (
				<NowMarker now={now} timezone={timezone} />
			)}
		</ul>
	);
}

/** "Now 13:05" and a rule: text, not colour, says where now is. */
function NowMarker({ now, timezone }: { now: number; timezone: string }) {
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(now);

	return (
		<li className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold">
			<span>Now {time}</span>
			<span aria-hidden="true" className="h-px flex-1 bg-foreground" />
		</li>
	);
}

/**
 * One session: the times in a fixed column, then who, what and the brief.
 * A link to the project, unless this member can't open it.
 */
function SessionItem({
	session,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	session: CalendarSession;
	showArtist: boolean;
	isOwner: boolean;
	tenantSlug: string;
}) {
	const { project } = session;
	const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
	const hidden = isOwner ? "Project not available" : "Not assigned to you";
	const content = (
		<>
			<span className="flex w-18 shrink-0 flex-col tabular-nums">
				<span className="font-semibold">{session.startText}</span>
				<span className="sr-only">to</span>
				<span className="text-sm text-muted-foreground">{session.endText}</span>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-start justify-between gap-2">
					<span
						className={cn(
							"truncate font-medium",
							!project && "text-muted-foreground",
						)}
					>
						{project ? (project.clientName ?? "Unknown client") : hidden}
					</span>
					{session.status === "completed" && (
						<Badge variant="outline">{SESSION_STATUS_LABELS.completed}</Badge>
					)}
				</span>
				<span className="text-sm">
					{showArtist
						? `${kind} with ${session.artistName ?? "Unknown artist"}`
						: kind}
				</span>
				{project?.brief && (
					<span className="truncate text-sm text-muted-foreground">
						{project.brief}
					</span>
				)}
			</span>
		</>
	);

	return (
		<li>
			{project ? (
				<Link
					href={urlFor("tenant.projects.show", {
						tenant: tenantSlug,
						id: project.id,
					})}
					className="flex min-h-11 gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{content}
				</Link>
			) : (
				<div className="flex gap-3 px-4 py-3">{content}</div>
			)}
		</li>
	);
}
