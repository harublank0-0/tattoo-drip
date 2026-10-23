import { DateTime } from "luxon";

/**
 * The instant a studio means by a local date (yyyy-MM-dd) and time (HH:mm)
 * in `timezone`, or null when there is none: a date that doesn't exist, or
 * a time the clocks skip that day (Luxon would quietly move it an hour
 * on). A time the clocks pass twice is its first occurrence.
 */
export function localDateTime(
	date: string,
	time: string,
	timezone: string,
): DateTime | null {
	const local = `${date}T${time}`;
	const instant = DateTime.fromISO(local, { zone: timezone });
	if (!instant.isValid) return null;
	if (instant.toFormat("yyyy-MM-dd'T'HH:mm") !== local) return null;
	// Luxon settles a repeated hour by the zone's offset at `Settings.now`, so
	// the first occurrence is picked here, whatever season the booking is made in.
	const [first] = instant.getPossibleOffsets();
	return first ?? instant;
}

/**
 * A session's time for people, in the studio's timezone: "Sun 18 Oct 2026,
 * 14:00–17:00", or "Sun 18 Oct 2026, 22:30 – Mon 19 Oct 2026, 01:30" when
 * it ends on another day.
 */
export function sessionTimeText(
	startsAt: DateTime,
	endsAt: DateTime,
	timezone: string,
): string {
	const start = startsAt.setZone(timezone).setLocale("en-GB");
	const end = endsAt.setZone(timezone).setLocale("en-GB");
	const day = (at: DateTime) => at.toFormat("ccc d LLL yyyy");
	const time = (at: DateTime) => at.toFormat("HH:mm");
	if (start.hasSame(end, "day")) {
		return `${day(start)}, ${time(start)}–${time(end)}`;
	}
	return `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}

/**
 * When a session starts, short, for a list: "Sat 24 Oct, 11:00" in the
 * studio's timezone, with the year ("Sat 2 Jan 2027, 11:00") when the day is
 * not in the studio's current year (`now` is read in the studio's zone too).
 */
export function sessionStartText(
	startsAt: DateTime,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	const start = startsAt.setZone(timezone).setLocale("en-GB");
	const year = start.year === now.setZone(timezone).year ? "" : " yyyy";
	return start.toFormat(`ccc d LLL${year}, HH:mm`);
}

/**
 * The move form's starting values for a session (TAT-85), in the studio's
 * timezone: its local day (today when that day can't be chosen: it has
 * passed, or is more than a year ahead), its local start time and its
 * length in hours. `today` and `last` are the form's first and last day
 * (yyyy-MM-dd).
 */
export function sessionFormValues(
	startsAt: DateTime,
	endsAt: DateTime,
	timezone: string,
	today: string,
	last: string,
): { date: string; startTime: string; hours: number } {
	const start = startsAt.setZone(timezone);
	const date = start.toFormat("yyyy-MM-dd");
	return {
		date: date >= today && date <= last ? date : today,
		startTime: start.toFormat("HH:mm"),
		hours: endsAt.diff(startsAt, "minutes").minutes / 60,
	};
}
