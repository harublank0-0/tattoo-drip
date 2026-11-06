import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { Fragment, useEffect, useState } from "react";
import { urlFor } from "~/client";
import { type CalendarDay, nowIndex } from "~/components/calendar";
import { SESSION_KIND_LABELS } from "~/components/projects";
import StatusBadge from "~/components/status_badge";

/** The current time, moved on every minute: where the Now marker sits. */
export function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

type Session = CalendarDay["sessions"][number];

/**
 * One day's sessions in time order, as a timeline (Studio OS): the times in
 * a fixed column, a rail with a mark per session, then who and what. On
 * today the Now marker sits between what has started and what has not, and
 * a session in progress says "In the chair" (in words, its mark in red).
 * The calendar's rows (TAT-50) and Today's (TAT-107) are this one list.
 */
export function DayAgenda({
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
		<ol className="flex flex-col">
			{day.sessions.map((session, index) => (
				<Fragment key={session.id}>
					{index === marker && <NowMarker now={now} timezone={timezone} />}
					<SessionItem
						session={session}
						inChair={
							isToday &&
							session.status === "scheduled" &&
							session.startsAt <= now &&
							session.endsAt > now
						}
						ended={isToday && session.endsAt <= now}
						showArtist={showArtist}
						isOwner={isOwner}
						tenantSlug={tenantSlug}
					/>
				</Fragment>
			))}
			{marker === day.sessions.length && (
				<NowMarker now={now} timezone={timezone} />
			)}
		</ol>
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
		<li className="flex items-center gap-3 py-1.5 text-xs font-semibold tabular-nums">
			<span className="w-20 shrink-0 text-brand-text">Now {time}</span>
			<span aria-hidden="true" className="h-px flex-1 bg-brand-text/60" />
		</li>
	);
}

/**
 * One session: the times in a fixed column (80 px, never wrapped: it fits
 * "Mon 22:30" on one line at 375 px, TAT-84), its mark on the rail, then
 * who, what and the brief. A link to the project's Sessions card, unless
 * this member can't open it. The client's name wraps (a Devanagari name is
 * never cut off).
 */
function SessionItem({
	session,
	inChair,
	ended,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	session: Session;
	inChair: boolean;
	/** Over by now (today only): drawn quieter, whatever its outcome. */
	ended: boolean;
	showArtist: boolean;
	isOwner: boolean;
	tenantSlug: string;
}) {
	const { project } = session;
	const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
	const hidden = isOwner ? "Project not available" : "Not assigned to you";
	const done = session.status === "completed";
	const quiet = done || ended;
	const content = (
		<>
			<span className="flex w-20 shrink-0 flex-col pt-0.5 whitespace-nowrap tabular-nums">
				<span
					data-done={quiet}
					className="text-sm font-semibold data-[done=true]:text-muted-foreground"
				>
					{session.startText}
				</span>
				<span className="sr-only">to</span>
				<span className="text-xs text-muted-foreground">{session.endText}</span>
			</span>
			<span
				aria-hidden="true"
				className="relative flex w-3 shrink-0 justify-center self-stretch"
			>
				<span className="absolute inset-y-0 w-px bg-border" />
				<span
					className={cn(
						"relative mt-1.5 size-2.5 rounded-full border-2",
						inChair
							? "border-brand bg-brand"
							: quiet
								? "border-muted-foreground/40 bg-muted"
								: "border-foreground bg-background",
					)}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5 pb-1">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span
						className={cn(
							"min-w-0 font-medium wrap-anywhere",
							!project && "text-muted-foreground",
						)}
					>
						{project ? (project.clientName ?? "Unknown client") : hidden}
					</span>
					{inChair && (
						<span className="text-xs font-semibold text-brand-text">
							In the chair
						</span>
					)}
					{done && <StatusBadge status="completed" />}
				</span>
				<span className="text-sm text-muted-foreground">
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
					href={`${urlFor("tenant.projects.show", {
						tenant: tenantSlug,
						id: project.id,
					})}#sessions`}
					className="-mx-2 flex min-h-11 gap-3 rounded-md px-2 py-2.5 outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{content}
				</Link>
			) : (
				<div className="flex gap-3 py-2.5">{content}</div>
			)}
		</li>
	);
}
