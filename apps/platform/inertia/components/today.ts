import type { CalendarSession } from "~/components/calendar";
import type { PilotCardProps } from "~/components/pilot_metrics_card";
import type { SetupProps, StudioPageProps } from "~/components/studio_link";

/**
 * Today's props (TAT-107). The server decides every group, row, count, word
 * and target (TodayController); the page only lays them out. Plain types:
 * the unit tests load this file.
 */

export type TodayGroupKey =
	| "proofs"
	| "requests"
	| "prices"
	| "ending"
	| "deposits"
	| "sessions";

export type TodayTarget = {
	route: "tenant.projects.show" | "tenant.inbox.show";
	id: string;
	/** A card id on the project page ("payments", "quote", …), or null. */
	hash: string | null;
};

export type TodayRow = {
	id: string;
	name: string;
	detail: string;
	meta: string | null;
	target: TodayTarget;
};

export type TodayMore = {
	route: "tenant.inbox.index" | "tenant.projects.index";
	/** The Projects list view that holds exactly the group (`?waiting=`); null for the Inbox. */
	waiting: string | null;
};

export type TodayGroup = {
	key: TodayGroupKey;
	count: number;
	rows: TodayRow[];
	/** Where "See all" goes when `count` is more than the rows shown; null otherwise. */
	more: TodayMore | null;
};

/** A number in the summary strip, worded by the server (#modules/reports/overview). */
export type TodayMetric = {
	key: "sessions" | "needs" | "upcoming" | "artists";
	label: string;
	value: string;
	detail: string;
};

/** A session after today: a calendar row with its own day. */
export type UpcomingSession = CalendarSession & {
	/** yyyy-MM-dd, the studio's day it starts on. */
	date: string;
	/** "Sat 8 Nov". */
	dayText: string;
};

export type TodayPageProps = {
	/** "Good afternoon, Priya", by the studio's clock. */
	greeting: string;
	/** The summary strip, in order. */
	metrics: TodayMetric[];
	/** The sessions after today: the first few, and how many there are in `days` days. */
	upcoming: { count: number; days: number; rows: UpcomingSession[] };
	/** "Thursday 22 October", the studio's date. */
	dateText: string;
	/** yyyy-MM-dd, the studio's date when the page loaded. */
	date: string;
	timezone: string;
	/** Non-empty groups, in page order. */
	needsYou: TodayGroup[];
	sessions: {
		scope: "studio" | "artist" | "unlinked";
		rows: CalendarSession[];
	};
	waiting: { count: number; rows: TodayRow[]; more: TodayMore | null };
	/** Owners, until the four steps are done; null otherwise. */
	setup: SetupProps | null;
	/** Owners while `setup` is shown (its last step opens the page); null otherwise. */
	studioPage: StudioPageProps | null;
	/** Owners only. */
	pilotMetrics: PilotCardProps | null;
};

/** Each group's title, in page order. */
export const GROUP_TITLES: Record<TodayGroupKey, string> = {
	proofs: "Payment screenshots to check",
	requests: "New requests",
	prices: "Prices to send",
	ending: "Prices ending soon",
	deposits: "Deposits to chase",
	sessions: "Sessions to book",
};

/**
 * What the member does on a row's page, by group: the word at the end of the
 * row (Studio OS). The row is the link; this says where it leads.
 */
export const GROUP_ACTIONS: Record<TodayGroupKey, string> = {
	proofs: "Check",
	requests: "Review",
	prices: "Send price",
	ending: "Follow up",
	deposits: "Chase",
	sessions: "Book",
};

/** How many rows "Needs you" holds in all: the requests and projects of every group. */
export function attentionTotal(groups: { count: number }[]): number {
	return groups.reduce((sum, { count }) => sum + count, 0);
}

/** "See all 7 in the Inbox" / "See all 7 on Projects": where a long group goes on. */
export function moreText({
	count,
	more,
}: {
	count: number;
	more: TodayMore;
}): string {
	return `See all ${count} ${more.route === "tenant.inbox.index" ? "in the Inbox" : "on Projects"}`;
}

/** What an empty section says, in plain words, for the member's role. */
export function emptyText(
	section: "needsYou" | "sessions" | "waiting" | "upcoming",
	role: string,
	scope?: string,
): string {
	const owner = role === "owner";
	switch (section) {
		case "needsYou":
			return owner
				? "You're all caught up. New requests and payment screenshots show up here."
				: "You're all caught up. Your projects show up here when they need a price or a session.";
		case "upcoming":
			if (scope === "unlinked") return "No sessions to show.";
			return owner
				? "Nothing booked in the next 7 days."
				: "Nothing booked for you in the next 7 days.";
		case "sessions":
			if (scope === "unlinked") {
				return "Your account isn't linked to an artist profile yet, so no sessions show here. Ask an owner to link it.";
			}
			return owner ? "No sessions today." : "No sessions for you today.";
		case "waiting":
			return owner
				? "Nobody to chase. Prices and deposit links you send wait here until the client answers."
				: "Nobody to chase. Prices you send wait here until the client answers.";
	}
}

/**
 * Whether the setup checklist leads the page: a new studio with nothing
 * that needs it. Once something needs the owner, the checklist moves down.
 */
export function setupFirst({
	setup,
	needsYou,
}: {
	setup: unknown;
	needsYou: unknown[];
}): boolean {
	return Boolean(setup) && needsYou.length === 0;
}
