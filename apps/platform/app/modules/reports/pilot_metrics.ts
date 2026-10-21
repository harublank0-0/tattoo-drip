import { DateTime } from "luxon";

/**
 * The pilot's three numbers (TAT-70) as plain arithmetic and words: how
 * much new work arrives through the intake link, how long an inquiry takes
 * to become a verified deposit, and how many clients miss their session.
 * PilotMetricsService gathers the facts; the inbox card and metrics:pilot
 * print them with these functions. The definitions are the spec's rulings
 * 3 to 7.
 */

/** The owners' card covers the last 30 days. */
export const CARD_DAYS = 30;

/** metrics:pilot's default: gate 1's six weeks. */
export const GATE_DAYS = 42;

/** A half-open window of instants: [from, to). */
export type MetricsWindow = { from: DateTime; to: DateTime };

/** The `days` × 24 hours before `now`: instants, so no time zone changes a number. */
export function lastDays(
	days: number,
	now: DateTime = DateTime.now(),
): MetricsWindow {
	return { from: now.minus({ hours: days * 24 }), to: now };
}

/** One studio's raw facts in a window (or several studios', combined). */
export type PilotFacts = {
	/** Live inquiries that arrived in the window: every inquiry comes through the intake link. */
	linkInquiries: number;
	/** Live projects booked at the desk (no inquiry) in the window. */
	deskProjects: number;
	/** Hours from each inquiry to its project's first verified deposit, for those verified in the window. */
	depositHours: number[];
	/** Sessions that started in the window, by outcome; `noOutcome` ones are still scheduled. */
	sessions: { completed: number; noShow: number; noOutcome: number };
};

/** Facts with nothing in them. */
export function noFacts(): PilotFacts {
	return {
		linkInquiries: 0,
		deskProjects: 0,
		depositHours: [],
		sessions: { completed: 0, noShow: 0, noOutcome: 0 },
	};
}

/** The share of new work that came through the link, or null with none at all. */
export function linkShare({
	linkInquiries,
	deskProjects,
}: Pick<PilotFacts, "linkInquiries" | "deskProjects">): number | null {
	const total = linkInquiries + deskProjects;
	return total === 0 ? null : linkInquiries / total;
}

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const at = (index: number) => sorted[index] ?? 0;
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return at(middle);
	return (at(middle - 1) + at(middle)) / 2;
}

/** No-shows out of the sessions that happened or should have, or null with none. */
export function noShowRate({
	completed,
	noShow,
}: PilotFacts["sessions"]): number | null {
	const finished = completed + noShow;
	return finished === 0 ? null : noShow / finished;
}

/** "75%": a whole percentage. */
export function percentText(ratio: number): string {
	return `${Math.round(ratio * 100)}%`;
}

/** "under an hour", "18 hours" (under 48), then "2.5 days" or "3 days". */
export function durationText(hours: number): string {
	if (hours < 1) return "under an hour";
	if (hours < 48) {
		const whole = Math.round(hours);
		return whole === 1 ? "1 hour" : `${whole} hours`;
	}
	const days = Math.round((hours / 24) * 10) / 10;
	return `${Number.isInteger(days) ? days.toFixed(0) : days.toFixed(1)} days`;
}

/** Several studios' facts as one: counts summed, durations pooled (the median is over all of them). */
export function combineFacts(list: readonly PilotFacts[]): PilotFacts {
	return list.reduce(
		(all, one) => ({
			linkInquiries: all.linkInquiries + one.linkInquiries,
			deskProjects: all.deskProjects + one.deskProjects,
			depositHours: [...all.depositHours, ...one.depositHours],
			sessions: {
				completed: all.sessions.completed + one.sessions.completed,
				noShow: all.sessions.noShow + one.sessions.noShow,
				noOutcome: all.sessions.noOutcome + one.sessions.noOutcome,
			},
		}),
		noFacts(),
	);
}

/** One number: its label, its value ("—" with nothing to count) and what it is made of. */
export type PilotTile = { label: string; value: string; detail: string };

/** The owners' card: "Last 30 days", three tiles, and the hint about sessions without an outcome. */
export type PilotCard = {
	title: string;
	tiles: PilotTile[];
	note: string | null;
};

const NONE = "—";

const plural = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

/** The three numbers, worded. */
export function pilotTiles(facts: PilotFacts): PilotTile[] {
	const share = linkShare(facts);
	const middle = median(facts.depositHours);
	const rate = noShowRate(facts.sessions);
	const deposits = facts.depositHours.length;
	const finished = facts.sessions.completed + facts.sessions.noShow;

	let depositDetail = "No deposits verified from an inquiry yet.";
	if (deposits === 1) depositDetail = "From 1 deposit";
	else if (deposits > 1) depositDetail = `Median of ${deposits} deposits`;

	return [
		{
			label: "Through the link",
			value: share === null ? NONE : percentText(share),
			detail:
				share === null
					? "No inquiries or desk bookings yet."
					: `${plural(facts.linkInquiries, "inquiry", "inquiries")} through the link, ${plural(facts.deskProjects, "booking", "bookings")} at the desk`,
		},
		{
			label: "Inquiry to deposit",
			value: middle === null ? NONE : durationText(middle),
			detail: depositDetail,
		},
		{
			label: "No-shows",
			value: rate === null ? NONE : percentText(rate),
			detail:
				rate === null
					? "No finished sessions yet."
					: `${facts.sessions.noShow} of ${plural(finished, "finished session", "finished sessions")}`,
		},
	];
}

/** "3 past sessions without an outcome aren't counted.", or null when every past session has one. */
export function pilotNote({ sessions }: PilotFacts): string | null {
	if (sessions.noOutcome === 0) return null;
	if (sessions.noOutcome === 1) {
		return "1 past session without an outcome isn't counted.";
	}
	return `${sessions.noOutcome} past sessions without an outcome aren't counted.`;
}

/** The inbox card's props for the last `days` days. */
export function pilotCard(facts: PilotFacts, days: number): PilotCard {
	return {
		title: `Last ${days} days`,
		tiles: pilotTiles(facts),
		note: pilotNote(facts),
	};
}

/** metrics:pilot's block: the heading, one line per number, then the note. */
export function pilotLines(heading: string, facts: PilotFacts): string[] {
	const note = pilotNote(facts);
	return [
		heading,
		...pilotTiles(facts).map(
			({ label, value, detail }) => `  ${label}: ${value} (${detail})`,
		),
		...(note ? [`  ${note}`] : []),
	];
}
