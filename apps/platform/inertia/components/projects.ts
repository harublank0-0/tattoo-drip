import type { ReferenceProps } from "~/components/inquiries";
import type {
	CardMessageProps,
	ContactChannelName,
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

/** What the Next step card can hold (the server's NEXT_STEP_ACTIONS, TAT-108). */
export type NextStepAction =
	| "verify_proof"
	| "issue_quote"
	| "send_quote"
	| "client_accepted"
	| "revise_quote"
	| "resume"
	| "deposit_link"
	| "record_payment"
	| "schedule"
	| "open_sessions"
	| "finish"
	| "record_outcome";

/**
 * The project page's Next step card (TAT-108), chosen on the server by the rules Today and the
 * Projects list use: its words, the actions it holds (names, drawn by `NextStepCard`) and the
 * id Today's and the list's links land on.
 */
export type NextStepProps = {
	kind: string;
	title: string;
	text: string | null;
	/** The one main action, or null when there is nothing to do here. */
	primary: NextStepAction | null;
	secondary: NextStepAction[];
	/** The element id the card carries (`payments`, `quote`, `quote-form`, `deposit`, `sessions`); null for none. */
	anchor: string | null;
	/** It waits on the studio: the marigold dot. */
	needsYou: boolean;
};

export type ProjectPageProps = {
	project: {
		id: string;
		status: string;
		brief: string;
		/** The start of the brief, as the Projects list names the piece. */
		piece: string;
		clientName: string | null;
		artistName: string | null;
	};
	nextStep: NextStepProps;
	/** The current quote (the highest version), or null. */
	quote: QuoteProps | null;
	/** Earlier versions, newest first. */
	history: QuoteProps[];
	canQuote: boolean;
	canAccept: boolean;
	/**
	 * An artist's view of a quoted project whose deposit is under what an artist may offer
	 * (TAT-16): "Client accepted" is not offered, an owner confirms it. Always false for owners.
	 */
	ownerAccepts: boolean;
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
		/** An artist, in a studio whose default deposit sets a minimum: the Deposit field explains it (TAT-16). */
		depositFloor: boolean;
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
	/** The channel of the last contact, which the message cards lead with (TAT-104). */
	lastChannel: ContactChannelName | null;
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

/** The money in a typed field as a number of rupees, or null when it is not a positive amount. */
function typedRupees(typed: string): number | null {
	const rupees = Number(typed.trim());
	return typed.trim() !== "" && Number.isFinite(rupees) && rupees > 0
		? rupees
		: null;
}

/** A refund's submit button: it names the amount, which is the confirmation (TAT-108). */
export function refundLabel(amount: string): string {
	const rupees = typedRupees(amount);
	return rupees === null
		? "Record refund"
		: `Record refund of ${formatRupees(rupees)}`;
}

/** Set price's submit button: it names the price, which can't be changed afterwards (TAT-108). */
export function priceLabel(price: string): string {
	const rupees = typedRupees(price);
	return rupees === null
		? "Set price"
		: `Set the price to ${formatRupees(rupees)}`;
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

/**
 * The smallest deposit an artist may quote, in whole rupees (TAT-16): the form's own suggestion,
 * and never under NPR 1, except in a studio whose default is 0%, which has chosen no deposit.
 * The server's artistDepositFloor is the rule; a unit test keeps the two equal.
 */
export function artistDepositFloor(
	total: number,
	percent: number | null,
): number {
	return percent === 0 ? 0 : Math.max(1, suggestedDeposit(total, percent));
}

/**
 * The Deposit field's note for an artist while a minimum applies (`form.depositFloor`): the
 * minimum for the typed total, and that only an owner goes lower.
 */
export function depositFloorHint(
	total: number,
	percent: number | null,
): string {
	if (percent === null) return "Only an owner can quote without a deposit.";
	const least =
		total > 0 ? formatRupees(artistDepositFloor(total, percent)) : null;
	return `${
		least === null
			? `At least your studio's ${percent}% of the total`
			: `At least ${least}, your studio's ${percent}% deposit`
	}. Only an owner can quote less or no deposit.`;
}

/** The Quote card's note when an owner has to confirm the client's yes (TAT-16). */
export const OWNER_ACCEPTS_NOTE =
	"An owner confirms this quote when the client agrees: its deposit is below what an artist can offer.";

/** One row of the projects list (TAT-109). */
export type ProjectRow = {
	id: string;
	clientName: string | null;
	/** The start of the brief (TAT-115 will make it the piece title). */
	piece: string;
	/** Owners only; null for artists and for a project without an artist. */
	artistName: string | null;
	status: string;
	/** What waits (WaitingService), else an owner's money fact; null when neither. */
	line: { text: string; needsYou: boolean; hash: string | null } | null;
	/** "Sat 24 Oct, 11:00": the next scheduled session that has not ended; null when none. */
	nextSessionText: string | null;
	/** "Contacted 2 days ago on WhatsApp (Quote)"; null when there was no contact. */
	contactedText: string | null;
};

export type ProjectListProps = {
	/** The current chip: "active", "needs_you", "closed" or one status. */
	filter: string;
	/** A Today group key or "on_client"; null for a plain chip view. */
	waiting: string | null;
	/** The chosen sort; null where the view has its own order (waiting and closed views). */
	sort: "needs" | "contact" | null;
	/** The sort asked for, kept in the views that have their own order so a chip can carry it back. */
	chosenSort: "needs" | "contact";
	counts: {
		active: number;
		/** WaitingService.work().needsYou.length: the Today badge's number. */
		needsYou: number;
		closed: number;
		byStatus: Record<string, number>;
	};
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
