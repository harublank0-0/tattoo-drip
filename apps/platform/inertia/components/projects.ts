import type { ReferenceProps } from "~/components/inquiries";
import type {
	CardMessageProps,
	ContactLinksProps,
	MessageKindName,
} from "~/components/messages";
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

/** The finish card (TAT-111): the step, the healing check's day, and the owner's action. */
export type FinishProps = {
	step: "finish" | "complete";
	/** "7 Nov 2026"; null without a completed tattoo session. */
	dueText: string | null;
	/** The healing check's day has passed (the studio's today). */
	overdue: boolean;
	/** Owners only; null for the assigned artist, who sees the card without a button. */
	action: {
		/** The balance due the confirmation names, paisa as digits; "0" when nothing is owed. */
		confirmedDue: string;
		/** "NPR 15,000" when money is owed, else null. */
		balanceDueText: string | null;
		/** The balance is an hourly estimate. */
		estimated: boolean;
		/** A session is still scheduled: no button until it has its outcome. */
		sessionScheduled: boolean;
	} | null;
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
	/** One-tap links to the client without a message; null without a phone (TAT-52). */
	contact: ContactLinksProps | null;
	/** The messages the "Message the client" card offers now (TAT-52). */
	messages: CardMessageProps[];
	/** The message the card starts on. */
	messageKind: MessageKindName | null;
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
	/** Finishing (TAT-111): in progress for owners, the healing check for owners and the assigned artist; null otherwise. */
	finish: FinishProps | null;
	/** Declined, cancelled or completed: no artist picker and no "Mark contacted". */
	closed: boolean;
	/** Whether the quote summary shows "Valid until" and Expired: false from booked on. */
	quoteExpiryShown: boolean;
	/** The project's live sessions, earliest first. */
	sessions: SessionRow[];
	/** The move form's first and last day, yyyy-MM-dd in the studio's timezone (TAT-85). */
	sessionDates: { today: string; max: string };
	/**
	 * Scheduling a session on this project (TAT-85): the artists this member
	 * may choose, the default, whether it is fixed (an artist schedules only
	 * themselves) and what a tattoo session would do; null when the project
	 * takes no new sessions or the member has no artist to schedule with.
	 */
	scheduling: {
		artists: { id: string; name: string }[];
		artistId: string | null;
		artistFixed: boolean;
		/** The kinds this project takes now, in the form's order (touch-ups only during a healing check, TAT-111). */
		kinds: string[];
		hint: string | null;
	} | null;
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

/**
 * The word for every status a badge shows: a project's, an inquiry's, and the
 * flag for a deposit screenshot that waits for a decision.
 */
export const STATUS_LABELS: Record<string, string> = {
	new: "New request",
	accepted: "Accepted",
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
	screenshot_to_check: "Screenshot to check",
};

/** The flag a project row shows while a deposit screenshot waits for an owner. */
export const PROOF_WAITING_STATUS = "screenshot_to_check";

/** Whose move it is (TAT-98); each group has its own colour and icon. */
export type StatusGroup = "studio" | "client" | "booked" | "chair" | "closed";

/**
 * The group of every status in STATUS_LABELS, one each (a unit test pins it
 * to the server's lists): waiting on the studio, waiting on the client,
 * booked, in the chair, closed. Add a status here and in STATUS_LABELS
 * together.
 */
export const STATUS_GROUPS: Record<string, StatusGroup> = {
	new: "studio",
	reviewing: "studio",
	screenshot_to_check: "studio",
	quoted: "client",
	on_hold: "client",
	deposit_pending: "client",
	booked: "booked",
	in_progress: "chair",
	healing_check: "chair",
	completed: "closed",
	accepted: "closed",
	declined: "closed",
	cancelled: "closed",
};

/** What each group means, for the badge's tooltip and the page's legend. */
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
	studio: "Waiting on the studio",
	client: "Waiting on the client",
	booked: "Booked",
	chair: "In the chair",
	closed: "Closed",
};

/** A status's group; one nobody mapped reads as closed, never as someone's move. */
export function statusGroup(status: string): StatusGroup {
	return STATUS_GROUPS[status] ?? "closed";
}

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
	/** Owners: a finished fixed-price project with money still owed (TAT-111). */
	balanceOwed: boolean;
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
