import { DateTime } from "luxon";
import { type FailureCode, MODERATION_CODES } from "#modules/design_lab/rules";

/**
 * The owners' generation history (docs/design-lab.md, "History"): one row
 * per usage-ledger attempt, filtered by UTC month, artist and status. Plain
 * rules here; DesignHistoryService reads the ledger.
 */

export const HISTORY_PER_PAGE = 25;

export const HISTORY_STATUSES = [
	"done",
	"in_progress",
	"failed",
	"blocked",
] as const;

export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type HistoryFilters = {
	/** "YYYY-MM", a UTC calendar month, as the allowance counts. */
	month: string;
	/** A user id, or null for everyone. */
	artist: string | null;
	status: HistoryStatus | null;
	page: number;
};

/** The first month the history offers. */
const FIRST_MONTH = "2020-01";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page number from the query string, else 1. */
export const pageNumber = (value: unknown) =>
	typeof value === "string" && /^[1-9]\d{0,7}$/.test(value) ? Number(value) : 1;

/** "YYYY-MM" of `now`'s UTC month. */
export const monthOf = (now: DateTime) => now.toUTC().toFormat("yyyy-MM");

/** The query string's filters; anything malformed falls back to its default. */
export function parseHistoryFilters(
	qs: Record<string, unknown>,
	now: DateTime,
): HistoryFilters {
	const current = monthOf(now);
	const month =
		typeof qs.month === "string" &&
		MONTH.test(qs.month) &&
		qs.month >= FIRST_MONTH &&
		qs.month <= current
			? qs.month
			: current;
	const artist =
		typeof qs.artist === "string" && UUID.test(qs.artist) ? qs.artist : null;
	const status = HISTORY_STATUSES.find((value) => value === qs.status) ?? null;
	return { month, artist, status, page: pageNumber(qs.page) };
}

/** The month's first instant and the next month's, UTC. */
export function monthRange(month: string): { start: DateTime; end: DateTime } {
	const start = DateTime.fromISO(`${month}-01`, { zone: "utc" });
	return { start, end: start.plus({ months: 1 }) };
}

/** A ledger row's status, as the history words it. */
export function historyStatus(
	status: string,
	releaseReason: string | null,
): HistoryStatus {
	if (status === "settled") return "done";
	if (status === "reserved") return "in_progress";
	return releaseReason !== null &&
		MODERATION_CODES.includes(releaseReason as FailureCode)
		? "blocked"
		: "failed";
}

/**
 * Who started an attempt: a member by name (else address); a removed one
 * by name with "(former)", never by address; a deleted account as such.
 */
export function personLabel(
	person: { fullName: string | null; email: string } | null,
	former: boolean,
): string {
	if (person === null) return "Deleted account";
	if (former) {
		return person.fullName ? `${person.fullName} (former)` : "Former member";
	}
	return person.fullName ?? person.email;
}
