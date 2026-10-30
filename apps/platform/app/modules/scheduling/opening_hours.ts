/**
 * A studio's opening hours and closed days (TAT-128): the rules and words
 * both the server and the settings page share. Pure: no database, no
 * framework.
 *
 * Hours are one opening and one closing time per weekday, on the studio's
 * wall clock (`tenants.timezone`), never past midnight. Weekdays count from
 * Sunday (0), like Postgres `extract(dow)` and JavaScript `getDay()`.
 */
export const WEEKDAYS = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A time as the forms and the API give it: 24-hour "HH:mm". */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What ticking a day offers when no other day has times yet. */
export const DEFAULT_OPENS = "11:00";
export const DEFAULT_CLOSES = "20:00";

/** At most this many closed-day entries that have not ended. */
export const MAX_UPCOMING_CLOSURES = 20;
/** The longest closed-day entry, in days (first day and last day included). */
export const MAX_CLOSURE_DAYS = 60;
/** The longest closed-day note, in characters. */
export const CLOSURE_NOTE_MAX = 120;

/** One open weekday; times are "HH:mm". */
export type OpeningDay = { day: Weekday; opens: string; closes: string };

/** A closed-days entry from the form; dates are yyyy-MM-dd. */
export type ClosureInput = {
	startsOn: string;
	endsOn: string;
	note: string | null;
};

/** A closed-days entry as the public studio read shows it. */
export type ShownClosure = { from: string; to: string; note: string | null };

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function parts(date: string) {
	const [year, month, day] = date.split("-").map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return { year, month: MONTHS[month - 1], day, weekday: SHORT_DAYS[weekday] };
}

/**
 * The dashboard's words for a closed-days entry, always with the year:
 * "Tue 20 Oct 2026", "20 – 28 Oct 2026", "30 Oct – 2 Nov 2026",
 * "30 Dec 2026 – 2 Jan 2027". `from` and `to` are yyyy-MM-dd.
 */
export function closedDaysWhen(from: string, to: string): string {
	const a = parts(from);
	const b = parts(to);
	if (from === to) return `${a.weekday} ${a.day} ${a.month} ${a.year}`;
	if (a.year !== b.year) {
		return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
	}
	if (a.month !== b.month) {
		return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
	}
	return `${a.day} – ${b.day} ${b.month} ${b.year}`;
}

/**
 * The flash messages of the Good to know settings page (TAT-128). The
 * page's own words are in inertia/components/good_to_know.ts. "Up to 15
 * minutes" is the public cache (Page look says the same).
 */
export const HOURS_SAVED =
	"Opening hours saved. They can take up to 15 minutes to show on your page.";
export const CLOSED_DAYS_ADDED =
	"Closed days added. They can take up to 15 minutes to show on your page.";
export const CLOSED_DAYS_REMOVED = "Closed days removed.";
export const TEXTS_SAVED =
	"Saved. It can take up to 15 minutes to show on your page.";
