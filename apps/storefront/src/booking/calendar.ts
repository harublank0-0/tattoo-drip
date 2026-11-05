import { addDays, type Closure, type Week } from "../studio/hours.ts";

/**
 * The booking flow's preference calendar (Prompt 6). Pure. The platform has
 * no availability for clients yet (availability.ts), so these are days a
 * client would like to come in, never appointments: a day is offered when the
 * studio's own published week opens on it and no published closure covers
 * it, from tomorrow (in the studio's timezone) up to a year ahead. A studio
 * that published no hours offers every day in that range: nothing says it is
 * closed. The studio replies with a time that suits it.
 */

/** How far ahead a client may name a day. */
export const HORIZON_DAYS = 365;
/** The most days a client may name. */
export const MAX_DAYS = 3;

export interface CalendarRules {
	/** The studio's published week, Sunday first (hours.ts readWeek). */
	readonly week: Week;
	readonly closures: readonly Closure[];
}

/** Why a day can or can't be named. */
export type DayState = "open" | "past" | "beyond" | "closed" | "closure";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as yyyy-MM-dd. */
export function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !DATE.test(value)) return false;
	return addDays(value, 0) === value;
}

/** The weekday of a date, 0 = Sunday. */
export function weekdayOf(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whether a client may name `date`, seen on the studio's `today`. */
export function dayState(
	date: string,
	today: string,
	rules: CalendarRules,
): DayState {
	if (date <= today) return "past";
	if (date > addDays(today, HORIZON_DAYS)) return "beyond";
	if (rules.closures.some((c) => c.from <= date && date <= c.to)) {
		return "closure";
	}
	const published = rules.week.some((day) => day !== null);
	if (published && rules.week[weekdayOf(date)] === null) return "closed";
	return "open";
}

/** A month as `year` and `month` (1 to 12). */
export interface Month {
	readonly year: number;
	readonly month: number;
}

export function monthOf(date: string): Month {
	return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function shiftMonth({ year, month }: Month, by: number): Month {
	const index = year * 12 + (month - 1) + by;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: Month, b: Month): boolean {
	return a.year === b.year && a.month === b.month;
}

/** The month's weeks, Sunday first: each a week of dates, null outside the month. */
export function monthWeeks({ year, month }: Month): (string | null)[][] {
	const first = `${year}-${String(month).padStart(2, "0")}-01`;
	const days: (string | null)[] = Array(weekdayOf(first)).fill(null);
	for (
		let date = first;
		monthOf(date).month === month;
		date = addDays(date, 1)
	) {
		days.push(date);
	}
	while (days.length % 7 !== 0) days.push(null);
	const weeks: (string | null)[][] = [];
	for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
	return weeks;
}

const LONG = new Intl.DateTimeFormat("en-GB", {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const SHORT = new Intl.DateTimeFormat("en-GB", {
	weekday: "short",
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

const utc = (date: string) => {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
};

/** "Tuesday 12 November 2026": a calendar date, the same wherever it is read. */
export function longDate(date: string): string {
	return LONG.format(utc(date));
}

/** "Tue 12 Nov". */
export function shortDate(date: string): string {
	return SHORT.format(utc(date));
}

/** "November 2026". */
export function monthTitle({ year, month }: Month): string {
	return MONTH.format(new Date(Date.UTC(year, month - 1, 1)));
}
