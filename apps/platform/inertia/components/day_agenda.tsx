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

/**
 * One day's sessions in time order, with the Now marker on today. The
 * calendar's rows (TAT-50) and Today's (TAT-107) are this one list.
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
 * A link to the project's Sessions card, unless this member can't open it.
 * The client's name wraps (a Devanagari name is never cut off).
 */
function SessionItem({
	session,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	session: CalendarDay["sessions"][number];
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
							"min-w-0 font-medium wrap-anywhere",
							!project && "text-muted-foreground",
						)}
					>
						{project ? (project.clientName ?? "Unknown client") : hidden}
					</span>
					{session.status === "completed" && <StatusBadge status="completed" />}
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
					href={`${urlFor("tenant.projects.show", {
						tenant: tenantSlug,
						id: project.id,
					})}#sessions`}
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
