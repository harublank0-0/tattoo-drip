import type { DateTime } from "luxon";

/**
 * Today's overview (Studio OS): the greeting and the summary strip at the
 * top of the page, worded here so the page only lays them out. Pure: the
 * controller passes what it already loaded, and nothing here queries.
 */

/** How many days after today the "Next 7 days" count and list cover. */
export const UPCOMING_DAYS = 7;

/** How many of those sessions the list shows; the count is all of them. */
export const UPCOMING_ROWS = 5;

/**
 * "Good afternoon, Priya": the time of day at the studio (its timezone, the
 * same clock as the page's date) and the first word of the member's name;
 * without a name, the greeting alone. Before 5 in the morning is still the
 * evening: a late session, not an early start.
 */
export function greetingText(hour: number, fullName: string | null): string {
	const part =
		hour >= 5 && hour < 12
			? "Good morning"
			: hour >= 12 && hour < 17
				? "Good afternoon"
				: "Good evening";
	const first = fullName?.trim().split(/\s+/)[0];
	return first ? `${part}, ${first}` : part;
}

export type OverviewMetricKey = "sessions" | "needs" | "upcoming" | "artists";

export type OverviewMetric = {
	key: OverviewMetricKey;
	label: string;
	value: string;
	detail: string;
};

type SessionFacts = {
	status: string;
	startsAt: DateTime;
	endsAt: DateTime;
};

/**
 * The summary strip, every number from what the page already shows, so a
 * number and the list under it always agree:
 *
 * - Sessions today: the day's active sessions (scheduled or completed, the
 *   calendar's rule), and what is happening now or next.
 * - Need you: every row of "Needs you" (requests and projects are separate
 *   groups, so nothing is counted twice).
 * - Next 7 days: the sessions after today, up to seven days on.
 * - Artists in today (owners of a studio with two or more artists): how
 *   many of the live artists have a session today.
 */
export function overviewMetrics({
	isOwner,
	today,
	now,
	timezone,
	needs,
	upcoming,
	artists,
}: {
	isOwner: boolean;
	today: SessionFacts[];
	now: DateTime;
	timezone: string;
	needs: { requests: number; projects: number };
	upcoming: { count: number; first: DateTime | null };
	/** The studio's live artists and the ids with a session today; null for artists. */
	artists: { total: number; busy: number } | null;
}): OverviewMetric[] {
	const at = (time: DateTime) =>
		time.setZone(timezone).setLocale("en-GB").toFormat("HH:mm");
	const inChair = today.filter(
		(s) =>
			s.status === "scheduled" &&
			s.startsAt.toMillis() <= now.toMillis() &&
			s.endsAt.toMillis() > now.toMillis(),
	).length;
	const next = today
		.filter((s) => s.status === "scheduled" && s.startsAt > now)
		.sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis())[0];

	const metrics: OverviewMetric[] = [
		{
			key: "sessions",
			label: "Sessions today",
			value: String(today.length),
			detail:
				today.length === 0
					? "Nothing booked"
					: inChair > 0
						? `${inChair} in the chair now`
						: next
							? `Next at ${at(next.startsAt)}`
							: "All done for today",
		},
	];

	const needTotal = needs.requests + needs.projects;
	const needParts = [
		needs.requests > 0 ? plural(needs.requests, "request") : null,
		needs.projects > 0 ? plural(needs.projects, "project") : null,
	].filter((part): part is string => part !== null);
	metrics.push({
		key: "needs",
		label: "Need you",
		value: String(needTotal),
		detail: needTotal === 0 ? "All caught up" : needParts.join(", "),
	});

	metrics.push({
		key: "upcoming",
		label: `Next ${UPCOMING_DAYS} days`,
		value: String(upcoming.count),
		detail: upcoming.first
			? `Next ${upcoming.first.setZone(timezone).setLocale("en-GB").toFormat("ccc d LLL, HH:mm")}`
			: "Nothing booked yet",
	});

	if (isOwner && artists && artists.total >= 2) {
		metrics.push({
			key: "artists",
			label: "Artists in today",
			value: `${artists.busy} of ${artists.total}`,
			detail: artists.busy === 0 ? "No sessions today" : "With a session today",
		});
	}
	return metrics;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}
