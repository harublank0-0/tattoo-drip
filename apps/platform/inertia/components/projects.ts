import type { ReferenceProps } from "~/components/inquiries";
import type { PaymentsCardProps } from "~/components/payments";

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

/** A chat message and its one-tap links (WhatsApp prefilled; Viber's link takes no text). */
export type ChatMessageProps = {
	text: string;
	whatsappUrl: string;
	viberUrl: string;
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
	/** Booked without a price: the Quote card offers "Set price" once. */
	canSetPrice: boolean;
	/** The chat message for the current quote, when it can be sent. */
	message: ChatMessageProps | null;
	form: {
		depositPercent: number | null;
		defaultValidUntil: string;
		minDate: string;
		maxDate: string;
	};
	/** The manual moves this project can make now, in table order. */
	moves: ManualMoveName[];
	/** The deposit money the project holds ("NPR 3,000"), for the withdraw confirm; null when none. */
	depositHeldText: string | null;
	/** How many sessions a withdrawal would cancel. */
	scheduledSessionCount: number;
	/** Booked, but no tattoo session is scheduled. */
	bookedWithoutSession: boolean;
	/** Whether the quote summary shows "Valid until" and Expired: false from booked on. */
	quoteExpiryShown: boolean;
	/** The project's live sessions, earliest first. */
	sessions: SessionRow[];
	/** The move form's first and last day, yyyy-MM-dd in the studio's timezone (TAT-85). */
	sessionDates: { today: string; max: string };
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
	/**
	 * Owners only, while the project waits for its deposit (TAT-65): the
	 * link (`url` null once it no longer works), why one can't be made now,
	 * the chat message that sends it, and the day a screenshot came.
	 */
	deposit: {
		link: {
			url: string | null;
			referenceCode: string;
			expiresText: string;
		} | null;
		problem: string | null;
		message: ChatMessageProps | null;
		proofReceivedText: string | null;
		/** Links open on this machine (the dev host), so no client can use them. */
		devHost: boolean;
	} | null;
	/** The Payments card (TAT-66): owners get the screenshots and the forms, the assigned artist the list. */
	payments: PaymentsCardProps;
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
	/** Owners: a deposit screenshot waits for a decision. */
	proofWaiting: boolean;
	/** Owners: a closed project holds deposit money with no outcome recorded. */
	depositToSettle: boolean;
	/** Owners: the quote expired but a late decision on the deposit spares the project; revise, take the rest or withdraw. */
	quoteLapsed: boolean;
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

/** One session on the project page. */
export type SessionRow = {
	id: string;
	/** "Sun 18 Oct 2026, 14:00–17:00", in the studio's timezone. */
	whenText: string;
	kind: string;
	status: string;
	/** Null when the artist's profile was deleted. */
	artistName: string | null;
	/** The outcomes this member can record now, in button order; [] for none (TAT-85). */
	outcomes: ("completed" | "no_show" | "cancelled")[];
	/** A started tattoo session whose project isn't booked yet: Done waits for the booking. */
	awaitingBooking: boolean;
	/** The move form's starting values in the studio's timezone; null when this member can't move it. */
	move: { date: string; startTime: string; hours: number } | null;
};

export const SESSION_KIND_LABELS: Record<string, string> = {
	consultation: "Consultation",
	tattoo: "Tattoo",
	touch_up: "Touch-up",
};

export const SESSION_STATUS_LABELS: Record<string, string> = {
	scheduled: "Scheduled",
	completed: "Completed",
	no_show: "No-show",
	cancelled: "Cancelled",
};
