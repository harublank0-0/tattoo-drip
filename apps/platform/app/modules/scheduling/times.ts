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
	return instant.toFormat("yyyy-MM-dd'T'HH:mm") === local ? instant : null;
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
