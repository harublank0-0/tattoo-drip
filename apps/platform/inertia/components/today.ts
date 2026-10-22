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
	status: string | null;
};

export type TodayGroup = {
	key: TodayGroupKey;
	count: number;
	rows: TodayRow[];
	/** Where "See all" goes when `count` is more than the rows shown; null otherwise. */
	more: TodayMore | null;
};

export type TodayPageProps = {
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
