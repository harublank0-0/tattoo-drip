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
	limit: number;
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
