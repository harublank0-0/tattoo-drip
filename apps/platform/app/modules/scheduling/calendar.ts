import { DateTime } from "luxon";
import type { SessionStatus } from "#modules/scheduling/models/project_session";
import type { CalendarEntry } from "#modules/scheduling/services/calendar_service";

/**
 * The calendar's dates (TAT-50). A calendar date is a plain yyyy-MM-dd,
 * computed in UTC so date arithmetic never meets a clock change; only
 * `dayBounds` turns a date into instants, in the studio's timezone. Weeks
 * run Sunday to Saturday (the launch market's week).
 */

/**
 * The calendar's views (Studio OS): a day or a week on a time grid, a month
 * of whole weeks (Sunday before the 1st to Saturday after the last), and a
 * list of the AGENDA_DAYS days from the date.
 */
export const CALENDAR_VIEWS = ["day", "week", "month", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** How many days the list view covers from its date. */
export const AGENDA_DAYS = 14;

/** How many sessions a month cell lists before "+N more". */
export const MONTH_CELL_ROWS = 3;

/**
 * `?status=`: which sessions the calendar shows (Studio OS). The default is
 * the active ones (scheduled or completed: the time they take), as before;
 * "cancelled" lists the cancelled and the no-shows, whose time is free.
 */
export const CALENDAR_STATUSES = [
	"active",
	"scheduled",
	"completed",
	"cancelled",
] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

/** The session statuses a `?status=` filter reads. */
export const STATUSES_OF: Record<CalendarStatus, readonly SessionStatus[]> = {
	active: ["scheduled", "completed"],
	scheduled: ["scheduled"],
	completed: ["completed"],
	cancelled: ["cancelled", "no_show"],
};

/** `?status=`: one of CALENDAR_STATUSES, else the active sessions. */
export function toCalendarStatus(value: unknown): CalendarStatus {
	return CALENDAR_STATUSES.includes(value as CalendarStatus)
		? (value as CalendarStatus)
		: "active";
}

/** The longest brief preview a calendar row shows, in characters. */
export const BRIEF_PREVIEW_LENGTH = 100;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The years `?date=` may name. A week reaches into the year on either side,
 * and "10000-01-01" is no date Luxon reads, so the ends keep a margin.
 */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100;

const plain = (date: string) =>
	DateTime.fromISO(date, { zone: "utc", locale: "en-GB" });
const iso = (date: DateTime) => date.toFormat("yyyy-MM-dd");

/** `?view=`: one of CALENDAR_VIEWS when asked for, else the day view. */
export function toCalendarView(value: unknown): CalendarView {
	return CALENDAR_VIEWS.includes(value as CalendarView)
		? (value as CalendarView)
		: "day";
}

/** `?date=`: a real yyyy-MM-dd date from 1900 to 2100, else `today`. */
export function toCalendarDate(value: unknown, today: string): string {
	if (typeof value !== "string" || !DATE.test(value)) return today;
	const date = DateTime.fromFormat(value, "yyyy-MM-dd", { zone: "utc" });
	return date.isValid && date.year >= FIRST_YEAR && date.year <= LAST_YEAR
		? value
		: today;
}

/** Luxon numbers weekdays from Monday (1) to Sunday (7): this day's Sunday. */
const sundayOf = (day: DateTime) => day.minus({ days: day.weekday % 7 });

/**
 * The days a view shows: the day itself; its week from Sunday to Saturday;
 * its month as whole weeks (35 or 42 days); or AGENDA_DAYS days from it.
 */
export function calendarDays(view: CalendarView, date: string): string[] {
	const day = plain(date);
	const run = (first: DateTime, length: number) =>
		Array.from({ length }, (_, offset) => iso(first.plus({ days: offset })));
	if (view === "day") return [date];
	if (view === "week") return run(sundayOf(day), 7);
	if (view === "agenda") return run(day, AGENDA_DAYS);
	const first = sundayOf(day.startOf("month"));
	const lastSunday = sundayOf(day.endOf("month").startOf("day"));
	const weeks = Math.round(lastSunday.diff(first, "days").days / 7) + 1;
	return run(first, weeks * 7);
}

/** The same view `steps` days, weeks, months or list pages away. */
export function shiftDate(
	view: CalendarView,
	date: string,
	steps: number,
): string {
	if (view === "month") return iso(plain(date).plus({ months: steps }));
	const days = { day: 1, week: 7, agenda: AGENDA_DAYS }[view];
	return iso(plain(date).plus({ days: steps * days }));
}

/** The first of the instants a local time can mean (one, unless the clocks pass it twice). */
const earliest = (at: DateTime) => at.getPossibleOffsets()[0] ?? at;

/**
 * A local day of the studio as instants, half-open: from its midnight to
 * the next. 23 or 25 hours long on a clock-change day. A midnight the
 * clocks pass twice (Havana, the Azores) is its first occurrence, like a
 * booked time (`localDateTime`): Luxon would pick one by the zone's offset
 * today, which leaves an hour between two days.
 */
export function dayBounds(
	day: string,
	timezone: string,
): { from: DateTime; to: DateTime } {
	const start = DateTime.fromISO(day, { zone: timezone });
	return {
		from: earliest(start.startOf("day")),
		to: earliest(start.plus({ days: 1 }).startOf("day")),
	};
}

/** Whether a session (half-open, like the constraint) takes any of `day`'s time. */
export function overlapsDay(
	startsAt: DateTime,
	endsAt: DateTime,
	day: string,
	timezone: string,
): boolean {
	const { from, to } = dayBounds(day, timezone);
	return (
		startsAt.toMillis() < to.toMillis() && endsAt.toMillis() > from.toMillis()
	);
}

/**
 * A session's start and end as a row on `day` shows them, in the studio's
 * timezone: "14:00", or "Mon 01:30" for a time on another day. An end at
 * the next midnight is still this day's "00:00".
 */
export function timesOnDay(
	startsAt: DateTime,
	endsAt: DateTime,
	day: string,
	timezone: string,
): { startText: string; endText: string } {
	const { from, to } = dayBounds(day, timezone);
	const text = (at: DateTime, onThisDay: boolean) =>
		at
			.setZone(timezone)
			.setLocale("en-GB")
			.toFormat(onThisDay ? "HH:mm" : "ccc HH:mm");
	return {
		startText: text(startsAt, startsAt.toMillis() >= from.toMillis()),
		endText: text(endsAt, endsAt.toMillis() <= to.toMillis()),
	};
}

/** A day as the week view heads it: "Sun 1 Nov". */
export function dayLabel(day: string): string {
	return plain(day).toFormat("ccc d LLL");
}

/** A month view's title: "November 2026", the month of its date. */
export function monthText(date: string): string {
	return plain(date).toFormat("LLLL yyyy");
}

/**
 * Where a session sits on `day`'s time grid: minutes from the day's local
 * midnight to its start and end, clipped to the day, and the day's length
 * (1440, or 1380 or 1500 on a clock-change day). Elapsed time, so a session
 * keeps its real length across a clock change.
 */
export function minutesOnDay(
	startsAt: DateTime,
	endsAt: DateTime,
	day: string,
	timezone: string,
): { startMinute: number; endMinute: number; dayMinutes: number } {
	const { from, to } = dayBounds(day, timezone);
	const dayMinutes = Math.round(to.diff(from, "minutes").minutes);
	const at = (time: DateTime) =>
		Math.min(
			dayMinutes,
			Math.max(0, Math.round(time.diff(from, "minutes").minutes)),
		);
	return {
		startMinute: at(startsAt),
		endMinute: at(endsAt),
		dayMinutes,
	};
}

/**
 * The range a view shows: "Mon 2 Nov 2026" for a day; a week as "1–7 Nov
 * 2026", "29 Nov – 5 Dec 2026" or "27 Dec 2026 – 2 Jan 2027".
 */
export function rangeText(days: string[]): string {
	const first = plain(days[0]);
	const last = plain(days[days.length - 1]);
	if (days.length === 1) return first.toFormat("ccc d LLL yyyy");
	if (first.year !== last.year) {
		return `${first.toFormat("d LLL yyyy")} – ${last.toFormat("d LLL yyyy")}`;
	}
	if (first.month !== last.month) {
		return `${first.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")}`;
	}
	return `${first.toFormat("d")}–${last.toFormat("d LLL yyyy")}`;
}

/** A brief's first non-empty line, cut to BRIEF_PREVIEW_LENGTH characters with "…". */
export function briefPreview(brief: string): string {
	const line =
		brief
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part !== "") ?? "";
	return line.length > BRIEF_PREVIEW_LENGTH
		? `${line.slice(0, BRIEF_PREVIEW_LENGTH - 1).trimEnd()}…`
		: line;
}

/**
 * One session as a row on `day`: times on that day, a preview of the brief.
 * The calendar's rows and Today's (TAT-107).
 */
export function sessionRow(
	{ session, artistName, project }: CalendarEntry,
	day: string,
	timezone: string,
) {
	return {
		id: session.id,
		startsAt: session.startsAt.toMillis(),
		endsAt: session.endsAt.toMillis(),
		...timesOnDay(session.startsAt, session.endsAt, day, timezone),
		...minutesOnDay(session.startsAt, session.endsAt, day, timezone),
		kind: session.kind,
		status: session.status,
		artistName,
		project: project && {
			id: project.id,
			clientName: project.clientName,
			brief: briefPreview(project.brief),
		},
	};
}

/**
 * Where a form sent from the calendar's session drawer goes back to (Studio
 * OS): the `back` field, only when it is this studio's calendar page with a
 * plain query string, so the field can never send anyone off the site or to
 * another studio's page.
 */
export function calendarBack(value: unknown, slug: string): string | null {
	if (typeof value !== "string") return null;
	const page = `/t/${slug}/calendar`;
	if (value !== page && !value.startsWith(`${page}?`)) return null;
	return /^[\w\-./?=&%]*$/.test(value) ? value : null;
}
