import type { ReferenceProps } from "~/components/inquiries";

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

export type ManualMoveName = "hold" | "resume" | "decline" | "withdraw";

/** What each move's button says. */
export const MOVE_LABELS: Record<ManualMoveName, string> = {
	hold: "Put on hold",
	resume: "Resume",
	decline: "Decline",
	withdraw: "Client withdrew",
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
	/** The manual moves this project can make now, in table order. */
	moves: ManualMoveName[];
	/** Withdrawing would be allowed, but the project holds deposit money. */
	withdrawBlocked: boolean;
	/** How many sessions a withdrawal would cancel. */
	scheduledSessionCount: number;
	/** Booked, but no tattoo session is scheduled. */
	bookedWithoutSession: boolean;
	notes: string | null;
	contactedText: string;
	/** Owners only: the project's artist and the studio's artists. */
	assignment: {
		artistId: string | null;
		choices: { id: string; name: string }[];
	} | null;
	/** For a project made from an inquiry: what the client asked for. */
	request: {
		placement: string;
		approximateSize: string;
		preferredDates: string;
		budget: string | null;
		source: string;
		references: ReferenceProps[];
	} | null;
	/** The client's id for the "View client" link; null unless an owner. */
	clientId: string | null;
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

/** One row of the projects list. */
export type ProjectRow = {
	id: string;
	clientName: string | null;
	artistName: string | null;
	status: string;
	contactedText: string;
	/** Booked, but no tattoo session is scheduled. */
	noSession: boolean;
};

export type ProjectListProps = {
	/** "active", "closed" or one status. */
	filter: string;
	counts: { active: number; closed: number; byStatus: Record<string, number> };
	projects: ProjectRow[];
	page: { current: number; last: number; total: number };
};

/** The single-status filter chips, in lifecycle order. */
export const ACTIVE_FILTERS = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
	"healing_check",
] as const;
