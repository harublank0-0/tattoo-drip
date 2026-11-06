/**
 * The calendar page's props (TAT-50), where its Now marker goes and what day
 * it is. Plain types and two functions with no imports, so the unit tests can
 * load it.
 */

export type CalendarView = "day" | "week" | "month" | "agenda";

/** `?status=`: which sessions show (the server's CALENDAR_STATUSES). */
export type CalendarStatus = "active" | "scheduled" | "completed" | "cancelled";

/** The status filter's choices, in order. */
export const STATUS_CHOICES: { value: CalendarStatus; label: string }[] = [
	{ value: "active", label: "Booked and done" },
	{ value: "scheduled", label: "Scheduled" },
	{ value: "completed", label: "Done" },
	{ value: "cancelled", label: "Cancelled and no-shows" },
];

/** The view switcher's choices, in order. */
export const VIEW_CHOICES: { value: CalendarView; label: string }[] = [
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "agenda", label: "List" },
];

/** One session as a row on one day. */
export type CalendarSession = {
	id: string;
	/** Epoch milliseconds, for the Now marker. */
	startsAt: number;
	/** Epoch milliseconds: whether the session is in the chair now. */
	endsAt: number;
	/** Minutes from the day's local midnight to the start and the end, clipped to the day. */
	startMinute: number;
	endMinute: number;
	/** The day's length in minutes: 1440, or 1380 / 1500 on a clock-change day. */
	dayMinutes: number;
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
	/** All of the day's sessions; a month cell lists only the first few. */
	count?: number;
	/** False for a month view's days from the weeks around the month. */
	inMonth?: boolean;
	/** The studio's opening hours that weekday ("HH:mm"); null when it is closed that weekday. */
	hours?: { opens: string; closes: string } | null;
	/** A closed-days entry that takes this day; null when there is none. */
	closure?: { note: string | null } | null;
};

/** The session the drawer shows (`?session=`), with what this member may do. */
export type SelectedSession = {
	id: string;
	kind: string;
	status: string;
	artistName: string | null;
	/** "Sun 18 Oct 2026, 14:00–17:00", in the studio's timezone. */
	whenText: string;
	/** "3 h 30 min". */
	lengthText: string;
	/** Null when this member can't open the project. */
	project: {
		id: string;
		clientName: string | null;
		brief: string;
		status: string;
		/** Owners only: the client page. */
		clientId: string | null;
	} | null;
	outcomes: ("completed" | "no_show" | "cancelled")[];
	awaitingBooking: boolean;
	/** The move form's starting values; null when this member can't move it. */
	move: { date: string; startTime: string; hours: number } | null;
	dates: { today: string; max: string };
};

export type CalendarPageProps = {
	view: CalendarView;
	/** yyyy-MM-dd: the day shown, or a day of the week or month shown, or the list's first day. */
	date: string;
	status: CalendarStatus;
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
	/** How many sessions the range holds, each once (one past midnight is on two days). */
	total: number;
	/** The session the drawer shows, or null. */
	selected: SelectedSession | null;
};

/** A session placed on a time grid: its lane and how many lanes its cluster has. */
export type Placed<T> = { item: T; lane: number; lanes: number };

/**
 * Side-by-side lanes for a day's sessions on the time grid (Studio OS):
 * sessions that overlap in time share a cluster, each takes the first lane
 * free at its start, and every session of a cluster is as narrow as the
 * cluster's lane count, so nothing hides another. Presentation only: the
 * server decides whether two sessions may overlap (one artist never can).
 */
export function layoutLanes<
	T extends { startMinute: number; endMinute: number },
>(items: readonly T[]): Placed<T>[] {
	const sorted = [...items].sort(
		(a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
	);
	const placed: Placed<T>[] = [];
	let cluster: Placed<T>[] = [];
	let laneEnds: number[] = [];
	let clusterEnd = -1;
	const close = () => {
		for (const entry of cluster) entry.lanes = laneEnds.length;
		cluster = [];
		laneEnds = [];
	};
	for (const item of sorted) {
		// A zero-length session still takes a sliver, so it gets a lane.
		const end = Math.max(item.endMinute, item.startMinute + 1);
		if (cluster.length > 0 && item.startMinute >= clusterEnd) close();
		let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.startMinute);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(end);
		} else {
			laneEnds[lane] = end;
		}
		const entry = { item, lane, lanes: 1 };
		cluster.push(entry);
		placed.push(entry);
		clusterEnd = Math.max(cluster.length === 1 ? end : clusterEnd, end);
	}
	close();
	return placed;
}

/**
 * The hours a time grid shows: from the earlier of the opening time and the
 * first session, to the later of the closing time and the last session,
 * whole hours, at least 8 to 20 when nothing says otherwise, and never past
 * the day's end (25 hours on the day the clocks go back).
 */
export function gridHours(
	days: {
		hours?: { opens: string; closes: string } | null;
		sessions: { startMinute: number; endMinute: number; dayMinutes?: number }[];
	}[],
): { first: number; last: number } {
	const minute = (time: string) => {
		const [h, m] = time.split(":").map(Number);
		return h * 60 + m;
	};
	let start = 8 * 60;
	let end = 20 * 60;
	// A day is 24 hours, or 25 on the day the clocks go back.
	let longest = 24 * 60;
	for (const day of days) {
		if (day.hours) {
			start = Math.min(start, minute(day.hours.opens));
			end = Math.max(end, minute(day.hours.closes));
		}
		for (const session of day.sessions) {
			start = Math.min(start, session.startMinute);
			end = Math.max(end, session.endMinute);
			longest = Math.max(longest, session.dayMinutes ?? 0);
		}
	}
	return {
		first: Math.max(0, Math.floor(start / 60)),
		last: Math.min(Math.ceil(longest / 60), Math.ceil(end / 60)),
	};
}

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

/** What a calendar address holds; the defaults are left out of it. */
export type CalendarQuery = {
	view: CalendarView;
	date: string;
	artist: string | null;
	status: CalendarStatus;
	/** The drawer's session. */
	session?: string | null;
};

/**
 * The calendar's address for `query` under `base` (its route): view and
 * date always, the artist and status only when set, the session last. Every
 * toolbar control, event and drawer link builds its address here, so
 * changing one thing keeps the rest.
 */
export function calendarHref(base: string, query: CalendarQuery): string {
	const params = new URLSearchParams({ view: query.view, date: query.date });
	if (query.artist) params.set("artist", query.artist);
	if (query.status !== "active") params.set("status", query.status);
	if (query.session) params.set("session", query.session);
	return `${base}?${params.toString()}`;
}

/**
 * Minutes since the studio's local midnight at `now`: where the Now line
 * sits on today's time grid. The wall clock, so on a clock-change day it is
 * at most an hour off the grid's elapsed-time placement, after the change.
 */
export function minuteOfDay(now: number, timezone: string): number {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const part = (type: string) =>
		Number(parts.find((entry) => entry.type === type)?.value ?? 0);
	return part("hour") * 60 + part("minute");
}
