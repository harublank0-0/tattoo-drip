/**
 * One quote version as the project page gets it. The amounts in the form's
 * units (rupees, hours) prefill a revision.
 */
export type QuoteProps = {
	id: string;
	version: number;
	kind: "fixed" | "hourly";
	priceText: string;
	totalText: string;
	depositText: string;
	/** yyyy-MM-dd, the last day it is valid in the studio's timezone. */
	validUntil: string;
	validUntilText: string;
	issuedText: string;
	expired: boolean;
	fixedPrice: number | null;
	hourlyRate: number | null;
	estimatedHours: number | null;
	depositAmount: number;
};

export type ProjectPageProps = {
	project: {
		id: string;
		status: string;
		brief: string;
		clientName: string | null;
		artistName: string | null;
	};
	/** The current quote (the highest version), or null. */
	quote: QuoteProps | null;
	/** Earlier versions, newest first. */
	history: QuoteProps[];
	canQuote: boolean;
	canAccept: boolean;
	/** The chat message for the current quote, when it can be sent. */
	message: { text: string; whatsappUrl: string; viberUrl: string } | null;
	form: {
		depositPercent: number | null;
		defaultValidUntil: string;
		minDate: string;
		maxDate: string;
	};
};

export const STATUS_LABELS: Record<string, string> = {
	reviewing: "Reviewing",
	quoted: "Quoted",
	on_hold: "On hold",
	deposit_pending: "Deposit pending",
	booked: "Booked",
	in_progress: "In progress",
	completed: "Completed",
	healing_check: "Healing check",
	declined: "Declined",
	cancelled: "Cancelled",
};

const GROUPED = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Rupees for people, like the server's formatMoney: "NPR 1,50,000". */
export function formatRupees(rupees: number): string {
	return `NPR ${GROUPED.format(rupees)}`;
}

/**
 * The deposit the form suggests: `percent` of the total, in whole rupees and
 * never above the total. The server enforces the real limit.
 */
export function suggestedDeposit(
	total: number,
	percent: number | null,
): number {
	if (!percent || !(total > 0)) return 0;
	return Math.min(Math.floor(total), Math.round((total * percent) / 100));
}
