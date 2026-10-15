import { DateTime } from "luxon";

/**
 * When the client was last contacted, for people: "contacted today",
 * "contacted yesterday", "contacted 3 days ago" or "never contacted",
 * counting calendar days in the studio's timezone.
 */
export function contactedText(
	at: DateTime | null,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	if (!at) return "never contacted";
	const days = Math.round(
		now
			.setZone(timezone)
			.startOf("day")
			.diff(at.setZone(timezone).startOf("day"), "days").days,
	);
	if (days <= 0) return "contacted today";
	if (days === 1) return "contacted yesterday";
	return `contacted ${days} days ago`;
}
