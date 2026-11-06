import { Link } from "@inertiajs/react";
import { cn } from "cn";
import {
	type CalendarDay,
	type CalendarSession,
	gridHours,
	layoutLanes,
	minuteOfDay,
} from "~/components/calendar";
import {
	SESSION_KIND_LABELS,
	SESSION_STATUS_LABELS,
} from "~/components/projects";

/** One hour's height on the time grid, in px. */
const HOUR = 52;
/** The shortest a session block is drawn, in px, so a short one stays tappable. */
const MIN_BLOCK = 22;

const minuteOf = (time: string) => {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
};

/** A session's accessible name: who, when, what and its status. */
export function sessionLabel(
	session: CalendarSession,
	{ showArtist, isOwner }: { showArtist: boolean; isOwner: boolean },
): string {
	const who = session.project
		? (session.project.clientName ?? "Unknown client")
		: isOwner
			? "Project not available"
			: "Not assigned to you";
	const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
	const artist =
		showArtist && session.artistName ? ` with ${session.artistName}` : "";
	return `${who}, ${session.startText} to ${session.endText}, ${kind}${artist}, ${SESSION_STATUS_LABELS[session.status] ?? session.status}`;
}

/**
 * The day and week views from `lg` (Studio OS): a time axis, one column per
 * day, each session a block at its real time and length (the server's
 * minutes on that day, so a session past midnight shows on both days),
 * overlapping ones side by side (`layoutLanes`). The opening hours are the
 * plain part of a column, the rest is shaded; a closed day says so. Today's
 * column has the Now line. Each block opens the session drawer.
 */
export function TimeGrid({
	days,
	today,
	now,
	timezone,
	showArtist,
	isOwner,
	hrefFor,
}: {
	days: CalendarDay[];
	today: string;
	now: number;
	timezone: string;
	showArtist: boolean;
	isOwner: boolean;
	hrefFor: (session: CalendarSession) => string;
}) {
	const { first, last } = gridHours(days);
	const hours = Array.from(
		{ length: last - first },
		(_, index) => first + index,
	);
	const height = (last - first) * HOUR;
	const top = (minute: number) => ((minute - first * 60) / 60) * HOUR;
	const week = days.length > 1;

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			{week && (
				<div
					className="grid border-b bg-card"
					style={{
						gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
					}}
				>
					<div aria-hidden="true" />
					{days.map((day) => {
						const isToday = day.date === today;
						return (
							<div
								key={day.date}
								className="flex items-baseline gap-1.5 border-l px-2 py-2 text-sm"
							>
								<span className="text-muted-foreground">
									{day.label.split(" ")[0]}
								</span>
								<span
									className={cn(
										"font-semibold tabular-nums",
										isToday &&
											"rounded-sm bg-primary px-1.5 text-primary-foreground",
									)}
								>
									{day.label.split(" ")[1]}
								</span>
								{isToday && <span className="sr-only">(today)</span>}
							</div>
						);
					})}
				</div>
			)}
			<div
				className="grid"
				style={{
					gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
				}}
			>
				<div aria-hidden="true" className="relative" style={{ height }}>
					{hours.map((hour) => (
						<span
							key={hour}
							className="absolute right-2 -translate-y-1/2 text-[0.6875rem] text-muted-foreground tabular-nums first:translate-y-0"
							style={{ top: top(hour * 60) }}
						>
							{String(hour).padStart(2, "0")}:00
						</span>
					))}
				</div>
				{days.map((day) => (
					<DayColumn
						key={day.date}
						day={day}
						height={height}
						hours={hours}
						top={top}
						first={first}
						last={last}
						isToday={day.date === today}
						now={now}
						timezone={timezone}
						showArtist={showArtist}
						isOwner={isOwner}
						hrefFor={hrefFor}
						labelled={week}
					/>
				))}
			</div>
		</div>
	);
}

function DayColumn({
	day,
	height,
	hours,
	top,
	first,
	last,
	isToday,
	now,
	timezone,
	showArtist,
	isOwner,
	hrefFor,
	labelled,
}: {
	day: CalendarDay;
	height: number;
	hours: number[];
	top: (minute: number) => number;
	first: number;
	last: number;
	isToday: boolean;
	now: number;
	timezone: string;
	showArtist: boolean;
	isOwner: boolean;
	hrefFor: (session: CalendarSession) => string;
	labelled: boolean;
}) {
	const placed = layoutLanes(day.sessions);
	const opens = day.hours ? minuteOf(day.hours.opens) : null;
	const closes = day.hours ? minuteOf(day.hours.closes) : null;
	const closedAllDay = day.closure !== null && day.closure !== undefined;
	const nowMinute = isToday ? minuteOfDay(now, timezone) : null;
	const showNow =
		nowMinute !== null && nowMinute >= first * 60 && nowMinute <= last * 60;

	return (
		<section
			aria-label={labelled ? day.label : undefined}
			className="relative border-l"
			style={{ height }}
		>
			{hours.map((hour) => (
				<div
					key={hour}
					aria-hidden="true"
					className="absolute inset-x-0 border-t border-border/70 first:border-t-0"
					style={{ top: top(hour * 60) }}
				/>
			))}
			{/* Outside opening hours, or a closed day: shaded, in words for a closure. */}
			{closedAllDay || opens === null || closes === null ? (
				<div aria-hidden="true" className="absolute inset-0 bg-muted/45" />
			) : (
				<>
					<div
						aria-hidden="true"
						className="absolute inset-x-0 top-0 bg-muted/45"
						style={{ height: Math.max(0, top(opens)) }}
					/>
					<div
						aria-hidden="true"
						className="absolute inset-x-0 bottom-0 bg-muted/45"
						style={{ top: Math.min(height, top(closes)) }}
					/>
				</>
			)}
			{closedAllDay && (
				<p className="absolute inset-x-2 top-2 text-xs font-medium text-muted-foreground">
					Closed{day.closure?.note ? `: ${day.closure.note}` : ""}
				</p>
			)}
			{showNow && nowMinute !== null && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
					style={{ top: top(nowMinute) }}
				>
					<span className="-ml-1 size-2 rounded-full bg-brand-text" />
					<span className="h-px flex-1 bg-brand-text" />
				</div>
			)}
			<ol className="absolute inset-0">
				{placed.map(({ item: session, lane, lanes }) => {
					const blockTop = top(session.startMinute);
					const blockHeight = Math.max(
						MIN_BLOCK,
						top(session.endMinute) - blockTop - 2,
					);
					const inChair =
						isToday &&
						session.status === "scheduled" &&
						session.startsAt <= now &&
						session.endsAt > now;
					const quiet = session.status !== "scheduled";
					return (
						<li
							key={session.id}
							className="absolute px-0.5"
							style={{
								top: blockTop + 1,
								height: blockHeight,
								left: `${(lane / lanes) * 100}%`,
								width: `${100 / lanes}%`,
							}}
						>
							<Link
								href={hrefFor(session)}
								preserveScroll
								preserveState
								aria-label={sessionLabel(session, { showArtist, isOwner })}
								className={cn(
									"flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-l-[3px] px-2 py-1 text-left text-xs outline-none transition-colors duration-150 focus-visible:z-30 focus-visible:ring-[3px] focus-visible:ring-ring/50",
									inChair
										? "border-l-brand bg-accent text-foreground"
										: session.status === "completed"
											? "border-l-muted-foreground/50 bg-muted text-muted-foreground hover:border-foreground/30"
											: quiet
												? "border-dashed border-l-muted-foreground/50 bg-card text-muted-foreground [&_[data-who]]:line-through hover:border-foreground/30"
												: "border-l-foreground/70 bg-accent text-foreground hover:border-foreground/40",
								)}
							>
								<span className="font-semibold tabular-nums">
									{session.startText}
									<span className="font-normal text-muted-foreground">
										{" "}
										– {session.endText}
									</span>
								</span>
								<span data-who className="font-medium wrap-anywhere">
									{session.project
										? (session.project.clientName ?? "Unknown client")
										: isOwner
											? "Project not available"
											: "Not assigned to you"}
								</span>
								<span className="text-muted-foreground">
									{SESSION_KIND_LABELS[session.kind] ?? session.kind}
									{showArtist && session.artistName
										? ` with ${session.artistName}`
										: ""}
								</span>
							</Link>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

/**
 * The month view (Studio OS): whole weeks, Sunday first. Each day is a link
 * to its day view (its number, and "+N more" when it has more than the few
 * it lists); each listed session opens the drawer. Days outside the month
 * are quieter, today's number is the brand's, and a closed day says so. On a
 * phone a cell shows the number of sessions instead of their names.
 */
export function MonthGrid({
	days,
	today,
	dayHref,
	hrefFor,
	showArtist,
	isOwner,
}: {
	days: CalendarDay[];
	today: string;
	dayHref: (date: string) => string;
	hrefFor: (session: CalendarSession) => string;
	showArtist: boolean;
	isOwner: boolean;
}) {
	const weeks = Array.from({ length: days.length / 7 }, (_, index) =>
		days.slice(index * 7, index * 7 + 7),
	);
	const heads = days.slice(0, 7).map((day) => day.label.split(" ")[0]);

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<table className="w-full table-fixed border-collapse">
				<thead>
					<tr>
						{heads.map((head) => (
							<th
								key={head}
								scope="col"
								className="border-b px-2 py-2 text-left text-xs font-medium text-muted-foreground"
							>
								{head}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{weeks.map((week) => (
						<tr key={week[0].date}>
							{week.map((day) => {
								const isToday = day.date === today;
								const count = day.count ?? day.sessions.length;
								const more = count - day.sessions.length;
								const number = Number(day.date.slice(8));
								return (
									<td
										key={day.date}
										className={cn(
											"h-20 border-t border-l align-top first:border-l-0 sm:h-28",
											day.inMonth === false && "bg-muted/35",
										)}
									>
										<div className="flex h-full flex-col gap-1 p-1 sm:p-1.5">
											<Link
												href={dayHref(day.date)}
												aria-label={`${day.label}${isToday ? ", today" : ""}: ${count === 0 ? "no sessions" : `${count} session${count === 1 ? "" : "s"}`}. Open the day.`}
												className={cn(
													"inline-flex size-7 items-center justify-center self-start rounded-sm text-xs font-semibold tabular-nums outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:size-11",
													day.inMonth === false && "text-muted-foreground",
													isToday &&
														"bg-primary text-primary-foreground hover:bg-primary",
												)}
											>
												{number}
											</Link>
											{day.closure && (
												<span className="text-[0.6875rem] text-muted-foreground">
													Closed
												</span>
											)}
											{count > 0 && (
												<span
													aria-hidden="true"
													className="text-[0.6875rem] font-medium text-muted-foreground sm:hidden"
												>
													{count}
												</span>
											)}
											<ul className="hidden min-w-0 flex-col gap-0.5 sm:flex">
												{day.sessions.map((session) => (
													<li key={session.id} className="min-w-0">
														<Link
															href={hrefFor(session)}
															preserveScroll
															preserveState
															aria-label={sessionLabel(session, {
																showArtist,
																isOwner,
															})}
															className={cn(
																"flex min-w-0 gap-1 rounded-sm px-1 py-0.5 text-[0.6875rem] leading-snug outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
																session.status !== "scheduled" &&
																	"text-muted-foreground",
															)}
														>
															<span className="shrink-0 font-semibold tabular-nums">
																{session.startText}
															</span>
															<span className="min-w-0 wrap-anywhere">
																{session.project?.clientName ??
																	SESSION_KIND_LABELS[session.kind] ??
																	session.kind}
															</span>
														</Link>
													</li>
												))}
											</ul>
											{more > 0 && (
												<Link
													href={dayHref(day.date)}
													className="hidden items-center rounded-sm px-1 text-[0.6875rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11 sm:inline-flex"
												>
													+{more} more
												</Link>
											)}
										</div>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
