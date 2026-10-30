/**
 * A studio's opening hours and today's state (TAT-128). Pure: no DOM, no
 * clock of its own (every function takes the instant), so the server render
 * and the browser island share it and the tests fix the time.
 *
 * Hours are one opening and one closing time per weekday, "HH:mm" 24-hour on
 * the studio's wall clock (its timezone), never past midnight. A closed day
 * (a range of dates) beats the weekly hours. This is the one place for the
 * time words ("Open now", "till 8 pm", day and month names); the section's
 * labels live in `studioCopy.goodToKnow`. A Nepali version replaces both.
 */
import { PAGE_CACHE } from "./cache.ts";
import { cleanLine, graphemes } from "./text.ts";

/** One open weekday, "HH:mm" 24-hour, in the studio's timezone. */
export interface OpeningDay {
	readonly opens: string;
	readonly closes: string;
}

/** Sunday first; null is closed. Always 7 entries. */
export type Week = readonly (OpeningDay | null)[];

/** Days the studio is closed whatever its hours say: yyyy-MM-dd, both ends included. */
export interface Closure {
	readonly from: string;
	readonly to: string;
	readonly note: string | null;
}

export type CoverState =
	| { readonly kind: "open"; readonly closes: string }
	| { readonly kind: "later"; readonly opens: string }
	| {
			readonly kind: "closed";
			/** A closed weekday ("Closed today") rather than after hours ("Closed now"). */
			readonly allDay: boolean;
			readonly next: {
				readonly inDays: number;
				readonly weekday: number;
				readonly opens: string;
			} | null;
	  }
	| { readonly kind: "closure"; readonly note: string | null };

export const WEEKDAY_KEYS = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const;
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LONG_DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;
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
] as const;
/** The word for a day with no hours, and for a closed-days entry with no note. */
export const CLOSED_TEXT = "Closed";
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The most closed-day entries and the longest note the API sends. */
const MAX_CLOSURES = 20;
const NOTE_MAX = 120;

/**
 * How long a page may be served after it was rendered: s-maxage plus
 * stale-while-revalidate, from the page's own Cache-Control, so a change
 * there changes this.
 */
export const PAGE_MAX_AGE_MS = (() => {
	const seconds = (name: string) =>
		Number(new RegExp(`${name}=(\\d+)`).exec(PAGE_CACHE)?.[1] ?? 0);
	return (seconds("s-maxage") + seconds("stale-while-revalidate")) * 1000;
})();

const formats = new Map<string, Intl.DateTimeFormat | null>();
function zonedFormat(timeZone: string): Intl.DateTimeFormat | null {
	let format = formats.get(timeZone);
	if (format === undefined) {
		try {
			format = new Intl.DateTimeFormat("en-US", {
				timeZone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				weekday: "short",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		} catch {
			format = null; // an unknown zone: no open state, never a wrong one
		}
		formats.set(timeZone, format);
	}
	return format;
}

/** The studio's wall clock at `at`: its date, weekday (0 = Sunday) and minutes since midnight. */
export function zonedNow(
	at: Date,
	timeZone: string,
): { date: string; weekday: number; minutes: number } | null {
	const format = zonedFormat(timeZone);
	if (!format || Number.isNaN(at.getTime())) return null;
	const part: Record<string, string> = {};
	for (const { type, value } of format.formatToParts(at)) part[type] = value;
	const weekday = SHORT_DAYS.indexOf(
		part.weekday as (typeof SHORT_DAYS)[number],
	);
	if (weekday === -1) return null;
	return {
		date: `${part.year}-${part.month}-${part.day}`,
		weekday,
		minutes: Number(part.hour) * 60 + Number(part.minute),
	};
}

/** `date` (yyyy-MM-dd) plus `days`. */
export function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const minutesOf = (time: string) =>
	Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const closureOn = (closures: readonly Closure[], date: string) =>
	closures.find((closure) => closure.from <= date && date <= closure.to);

/**
 * Today's state at `at`, or null when there is nothing to say (no hours and
 * no closure today, or no usable timezone).
 */
export function coverState(
	week: Week,
	closures: readonly Closure[],
	timeZone: string,
	at: Date,
): CoverState | null {
	const now = zonedNow(at, timeZone);
	if (!now) return null;
	const closure = closureOn(closures, now.date);
	if (closure) return { kind: "closure", note: closure.note };
	if (week.every((day) => day === null)) return null;
	const today = week[now.weekday] ?? null;
	if (today) {
		if (now.minutes < minutesOf(today.opens)) {
			return { kind: "later", opens: today.opens };
		}
		if (now.minutes < minutesOf(today.closes)) {
			return { kind: "open", closes: today.closes };
		}
	}
	for (let inDays = 1; inDays <= 7; inDays++) {
		const weekday = (now.weekday + inDays) % 7;
		const day = week[weekday] ?? null;
		if (day && !closureOn(closures, addDays(now.date, inDays))) {
			return {
				kind: "closed",
				allDay: today === null,
				next: { inDays, weekday, opens: day.opens },
			};
		}
	}
	return { kind: "closed", allDay: today === null, next: null };
}

/**
 * The state at `at` when it stays the same for the page's whole cache life
 * (checked each minute: states change only on the minute), else null. What
 * the server may render: a cached copy is then still right when served.
 */
export function steadyCoverState(
	week: Week,
	closures: readonly Closure[],
	timeZone: string,
	at: Date,
	window = PAGE_MAX_AGE_MS,
): CoverState | null {
	const first = coverState(week, closures, timeZone, at);
	if (!first) return null;
	const key = JSON.stringify(first);
	for (let ms = 60_000; ms <= window; ms += 60_000) {
		const later = coverState(
			week,
			closures,
			timeZone,
			new Date(at.getTime() + ms),
		);
		if (JSON.stringify(later) !== key) return null;
	}
	return first;
}

/** "8 pm", "10:30 am", "12 pm": how studios here write a time. */
export function clockText(time: string): string {
	const hours = Number(time.slice(0, 2));
	const minutes = time.slice(3, 5);
	const hour = hours % 12 === 0 ? 12 : hours % 12;
	const half = hours < 12 ? "am" : "pm";
	return minutes === "00" ? `${hour} ${half}` : `${hour}:${minutes} ${half}`;
}

/** The cover line: a bold lead and an optional detail ("Open now", "till 8 pm"). */
export function coverText(state: CoverState): {
	lead: string;
	detail: string | null;
} {
	switch (state.kind) {
		case "open":
			return { lead: "Open now", detail: `till ${clockText(state.closes)}` };
		case "later":
			return {
				lead: "Closed now",
				detail: `opens at ${clockText(state.opens)}`,
			};
		case "closure":
			return { lead: "Closed today", detail: state.note };
		case "closed": {
			const lead = state.allDay ? "Closed today" : "Closed now";
			if (!state.next) return { lead, detail: null };
			const day =
				state.next.inDays === 1 ? "tomorrow" : LONG_DAYS[state.next.weekday];
			return { lead, detail: `opens ${day} at ${clockText(state.next.opens)}` };
		}
	}
}

export interface HoursLine {
	readonly days: string;
	readonly hours: string;
}

/** The week as Good to know lists it: Sunday first, equal neighbours grouped. [] when no day is open. */
export function hoursLines(week: Week): HoursLine[] {
	if (week.every((day) => day === null)) return [];
	const text = (day: OpeningDay | null) =>
		day ? `${clockText(day.opens)} – ${clockText(day.closes)}` : CLOSED_TEXT;
	const lines: HoursLine[] = [];
	let start = 0;
	for (let i = 1; i <= 7; i++) {
		if (i < 7 && text(week[i] ?? null) === text(week[start] ?? null)) continue;
		const days =
			start === 0 && i === 7
				? "Every day"
				: start === i - 1
					? SHORT_DAYS[start]
					: `${SHORT_DAYS[start]} – ${SHORT_DAYS[i - 1]}`;
		lines.push({ days, hours: text(week[start] ?? null) });
		start = i;
	}
	return lines;
}

/** "Tue 20 Oct", "20 – 28 Oct", "30 Oct – 2 Nov", "30 Dec 2026 – 2 Jan 2027": no year unless the range crosses one. */
export function closedDaysText(from: string, to: string): string {
	const part = (date: string) => {
		const [y, m, d] = date.split("-").map(Number);
		return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
	};
	const a = part(from);
	const b = part(to);
	if (from === to) return `${SHORT_DAYS[a.weekday]} ${a.d} ${MONTHS[a.m - 1]}`;
	if (a.y !== b.y) {
		return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
	}
	if (a.m !== b.m)
		return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
	return `${a.d} – ${b.d} ${MONTHS[b.m - 1]}`;
}

/** A real calendar date: yyyy-MM-dd that survives a round trip through Date. */
function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !DATE.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/**
 * The API's `openingHours` as a week, defensively (the API is trusted, not
 * blindly): a non-array is a closed week; an unknown day, a malformed time,
 * closing at or before opening, and a second entry for a day are dropped.
 */
export function readWeek(value: unknown): Week {
	const week: (OpeningDay | null)[] = Array(7).fill(null);
	if (!Array.isArray(value)) return week;
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const { day, opens, closes } = entry as Record<string, unknown>;
		const index = WEEKDAY_KEYS.indexOf(day as (typeof WEEKDAY_KEYS)[number]);
		if (index === -1 || week[index] !== null) continue;
		if (typeof opens !== "string" || typeof closes !== "string") continue;
		if (!CLOCK.test(opens) || !CLOCK.test(closes) || closes <= opens) continue;
		week[index] = { opens, closes };
	}
	return week;
}

/**
 * The API's `closedDays`, defensively: a non-array is none; an entry whose
 * dates are not real dates or whose last day is before its first is dropped;
 * a note passes through cleanLine and is null past 120 graphemes; at most 20.
 */
export function readClosures(value: unknown): Closure[] {
	if (!Array.isArray(value)) return [];
	const closures: Closure[] = [];
	for (const entry of value) {
		if (closures.length === MAX_CLOSURES) break;
		if (typeof entry !== "object" || entry === null) continue;
		const { from, to, note } = entry as Record<string, unknown>;
		if (!isDate(from) || !isDate(to) || to < from) continue;
		const line = typeof note === "string" ? cleanLine(note) : null;
		closures.push({
			from,
			to,
			note: line !== null && graphemes(line).length <= NOTE_MAX ? line : null,
		});
	}
	return closures;
}
