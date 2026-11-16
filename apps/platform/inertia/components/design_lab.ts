/**
 * AI Design Lab's words and small rules for the pages (docs/design-lab.md).
 * Plain functions with no imports, so the unit tests load them. The server
 * decides every status, count and limit; these only word them.
 */

export type GenerationStatus =
	| "queued"
	| "processing"
	| "completed"
	| "failed"
	| "moderated";

export type Allowance = {
	/** The limit in force: the package's once limits are on, else the platform's. */
	limit: number;
	/** The package's images a month; null when not metered. */
	packageLimit: number | null;
	used: number;
	reserved: number;
	remaining: number;
	resetsAt: string;
};

/** Still with the queue or the provider: the page keeps polling. */
export const isPending = (status: GenerationStatus) =>
	status === "queued" || status === "processing";

/** The badge's look for a status. */
export function statusVariant(
	status: GenerationStatus,
): "default" | "secondary" | "destructive" | "outline" {
	if (status === "completed") return "default";
	if (status === "failed" || status === "moderated") return "destructive";
	return "secondary";
}

/** "12 of 40 generations left this month". */
export function allowanceText(allowance: Allowance): string {
	if (allowance.limit === 0)
		return "Generation isn't available for your studio.";
	return `${allowance.remaining} of ${allowance.limit} generations left this month`;
}

/** With this many or fewer generations left, the page warns (studio packages, ruling 12). */
export const LOW_ALLOWANCE = 5;

/**
 * The warning before the limit, with the exact count and the reset date:
 * "Only 3 generations left this month. Resets on 1 Dec." Null with more
 * left, and at 0 (the form says it), or when generation is off.
 */
export function allowanceWarning(allowance: Allowance): string | null {
	const { remaining, limit } = allowance;
	if (limit === 0 || remaining < 1 || remaining > LOW_ALLOWANCE) return null;
	const what = remaining === 1 ? "1 generation" : `${remaining} generations`;
	return `Only ${what} left this month. ${resetsText(allowance.resetsAt)}.`;
}

/** "Resets on 1 Dec" from the server's ISO instant (UTC). */
export function resetsText(resetsAt: string): string {
	const date = new Date(resetsAt);
	if (Number.isNaN(date.getTime())) return "";
	return `Resets on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

/**
 * What a submit will use, said before it is sent: "Uses 2 of your 12
 * remaining generations." or why it can't go.
 */
export function usageText(variations: number, allowance: Allowance): string {
	if (allowance.remaining === 0) {
		return "Your studio has no generations left this month.";
	}
	if (variations > allowance.remaining) {
		return `Only ${allowance.remaining} left this month: ask for ${allowance.remaining} or fewer.`;
	}
	const what = variations === 1 ? "1 generation" : `${variations} generations`;
	return `Uses ${what} of your ${allowance.remaining} remaining this month. Each variation is a separate image.`;
}

/** The variation counts the form offers: 1 up to the server's maximum and what is left. */
export function variationChoices(max: number, remaining: number): number[] {
	const top = Math.max(1, Math.min(max, remaining));
	return Array.from({ length: top }, (_, index) => index + 1);
}

/** Whether a fresh poll answer differs from what the page shows. */
export function statusesChanged(
	shown: { id: string; status: GenerationStatus; attempt: number }[],
	polled: { id: string; status: GenerationStatus; attempt: number }[],
): boolean {
	if (shown.length !== polled.length) return true;
	const byId = new Map(shown.map((row) => [row.id, row]));
	return polled.some((row) => {
		const before = byId.get(row.id);
		return (
			!before || before.status !== row.status || before.attempt !== row.attempt
		);
	});
}

/** How often the page asks for statuses while something is pending. */
export const POLL_INTERVAL_MS = 3_000;

export const REVIEW_STATE_LABELS: Record<string, string> = {
	exploring: "Exploring",
	decided: "Concept chosen",
	archived: "Archived",
};

/** The owners' history (docs/design-lab.md, "History"): one row per attempt. */
export type HistoryStatus = "done" | "in_progress" | "failed" | "blocked";

export type HistoryCounts = {
	used: number;
	inProgress: number;
	failed: number;
	blocked: number;
};

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
	done: "Done",
	in_progress: "In progress",
	failed: "Failed",
	blocked: "Blocked",
};

/** The history badge's look. */
export function historyVariant(
	status: HistoryStatus,
): "default" | "secondary" | "destructive" {
	if (status === "done") return "default";
	if (status === "in_progress") return "secondary";
	return "destructive";
}

/** "23 of 40 used · 1 in progress · 3 failed · 1 blocked" (no limit: "23 used · …"). */
export function historyCountsText(
	counts: HistoryCounts,
	limit: number | null,
): string {
	const used =
		limit === null ? `${counts.used} used` : `${counts.used} of ${limit} used`;
	return `${used} · ${counts.inProgress} in progress · ${counts.failed} failed · ${counts.blocked} blocked`;
}

/** The history's query string: only what differs from the defaults. */
export function historyQuery(
	filters: { month: string; artist: string | null; status: string | null },
	page: number,
	currentMonth: string,
): string {
	const query = new URLSearchParams();
	if (filters.month !== currentMonth) query.set("month", filters.month);
	if (filters.artist) query.set("artist", filters.artist);
	if (filters.status) query.set("status", filters.status);
	if (page > 1) query.set("page", String(page));
	const text = query.toString();
	return text ? `?${text}` : "";
}

/** "November 2026" for "2026-11". */
export function monthLabel(month: string): string {
	const [year, number] = month.split("-").map(Number);
	const names = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	return `${names[number - 1] ?? month} ${year}`;
}
