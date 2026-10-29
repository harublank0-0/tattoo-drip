/**
 * The calendar page's props (TAT-50), where its Now marker goes and what day
 * it is. Plain types and two functions with no imports, so the unit tests can
 * load it.
 */

export type CalendarView = "day" | "week";

/** One session as a row on one day. */
export type CalendarSession = {
	id: string;
	/** Epoch milliseconds, for the Now marker. */
	startsAt: number;
	/** "14:00", or "Mon 01:30" for a time on another day. */
	startText: string;
	endText: string;
	kind: string;
	/** "scheduled" or "completed": the calendar shows active sessions only. */
	status: string;
	/** The session's artist; null when their profile was deleted. */
	artistName: string | null;
	/** Null when this member can't open the project. */
	project: { id: string; clientName: string | null; brief: string } | null;
};

export type CalendarDay = {
	/** yyyy-MM-dd, a day of the studio. */
	date: string;
	/** "Sun 1 Nov". */
	label: string;
	sessions: CalendarSession[];
};

export type CalendarPageProps = {
	view: CalendarView;
	/** yyyy-MM-dd: the day shown, or a day of the week shown. */
	date: string;
	/** The studio's timezone, for the Now marker's time. */
	timezone: string;
	/** "Mon 2 Nov 2026", or "1–7 Nov 2026" for a week. */
	rangeText: string;
	/** yyyy-MM-dd: one day or one week back, and on. */
	previous: string;
	next: string;
	/** The whole studio (owners), one artist, or nobody (an artist member without a profile). */
	scope: "studio" | "artist" | "unlinked";
	/** Owners: the artist picker. Null for artist members. */
	artistFilter: {
		selected: string | null;
		artists: { id: string; name: string }[];
	} | null;
	/** Whether "Book session" shows: owners of a studio with an artist, and artists with a profile. */
	canBook: boolean;
	days: CalendarDay[];
};

/**
 * Where the Now marker goes among a day's sessions (in time order): before
 * the first that starts after `now`, or after the last when all have started.
 */
export function nowIndex(
	sessions: { startsAt: number }[],
	now: number,
): number {
	const index = sessions.findIndex(({ startsAt }) => startsAt > now);
	return index === -1 ? sessions.length : index;
}

/**
 * The studio's date (yyyy-MM-dd) at `now`. The page moves it with the clock
 * so a tab left open past the studio's midnight still knows which day is
 * today.
 */
export function studioDate(now: number, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const part = (type: string) =>
		parts.find((entry) => entry.type === type)?.value;
	return `${part("year")}-${part("month")}-${part("day")}`;
}
