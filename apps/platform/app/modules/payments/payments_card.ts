import type { DateTime } from "luxon";
import { formatSignedMoney } from "#modules/payments/ledger";
import type DepositOutcome from "#modules/payments/models/deposit_outcome";
import type Payment from "#modules/payments/models/payment";
import type {
	DeskKind,
	PaymentKind,
	PaymentStatus,
} from "#modules/payments/models/payment";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";
import {
	CLOSED_FOR_OUTCOME,
	type ProjectMoney,
} from "#modules/payments/services/payment_service";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import {
	BOOKED_STATUSES,
	formatDay,
	formatHours,
	formatMoney,
} from "#modules/projects/quotes";

export type PaymentRowProps = {
	id: string;
	kind: PaymentKind;
	amountText: string;
	method: PaymentMethodKind;
	status: PaymentStatus;
	dateText: string;
	decisionText: string;
	note: string | null;
	reversalText: string | null;
	proofUrl: string | null;
	canReverse: boolean;
};

export type PendingProofProps = {
	paymentId: string;
	imageUrl: string | null;
	width: number | null;
	height: number | null;
	expectedText: string;
	referenceCode: string | null;
	method: PaymentMethodKind;
	sentText: string;
	dueNowText: string | null;
};

export type BalanceState =
	| "due"
	| "paid"
	| "overpaid"
	| "no_price"
	| "closed"
	| "over_refunded";

export type PaymentsCardProps = {
	/**
	 * The money in one line (TAT-108): "Paid NPR 5,000 of NPR 20,000 · Balance NPR 15,000". The
	 * Payments card's main line and, on a phone, a line under the page's name.
	 */
	summary: string;
	balance: {
		totalText: string | null;
		totalNote: string | null;
		paidText: string;
		state: BalanceState;
		amountText: string | null;
	};
	deposit: {
		amountText: string;
		receivedText: string;
		dueText: string;
		covered: boolean;
		lapsed: boolean;
	} | null;
	rows: PaymentRowProps[];
	pending: PendingProofProps[];
	actions: {
		recordKinds: DeskKind[];
		depositDue: number | null;
		balanceDue: number | null;
		refundMax: number | null;
		refundMaxText: string | null;
	} | null;
	outcome: {
		needed: { held: number; heldText: string } | null;
		recorded: {
			text: string;
			recordedText: string;
			note: string | null;
		} | null;
	};
};

export type PaymentsCardInput = {
	money: ProjectMoney;
	status: ProjectStatus;
	timezone: string;
	/** Who decided or recorded, by user id (PaymentService.memberNames). */
	names: Map<string, string>;
	/** Owners only: signed screenshot URLs by payment id. */
	proofUrls: Map<string, string>;
	/** The project's deposit-link reference code, if it has a link. */
	referenceCode: string | null;
};

/** How a kind reads inside a sentence. */
const KIND_WORDS: Record<PaymentKind, string> = {
	deposit: "deposit",
	session: "session payment",
	balance: "balance payment",
	refund: "refund",
	correction: "reversal",
};

/** The desk form's cap, in paisa: a balance due above it isn't prefilled. */
const MAX_PREFILL = 1_000_000_000n;

/**
 * The project page's Payments card (TAT-66), from the project's money: the
 * screenshots to check, the signed screenshot links, the Reverse buttons,
 * the forms' limits and the outcome form. It is the owners' card: an artist
 * is sent no money at all (TAT-108), so the controller never builds it for
 * them. Dates are the studio's.
 */
export function paymentsCard({
	money,
	status,
	timezone,
	names,
	proofUrls,
	referenceCode,
}: PaymentsCardInput): PaymentsCardProps {
	const day = (at: DateTime) =>
		formatDay(at.setZone(timezone).toFormat("yyyy-MM-dd"));
	const who = (id: string | null) =>
		(id !== null && names.get(id)) || "a deleted account";
	const byId = new Map(money.payments.map((payment) => [payment.id, payment]));
	const reversals = new Map(
		money.payments
			.filter(({ correctsPaymentId }) => correctsPaymentId !== null)
			.map((payment) => [payment.correctsPaymentId as string, payment]),
	);
	const { quote, balance } = money;

	const rows = money.payments.map((payment): PaymentRowProps => {
		const reversal = reversals.get(payment.id);
		const original = payment.correctsPaymentId
			? byId.get(payment.correctsPaymentId)
			: undefined;
		return {
			id: payment.id,
			kind: payment.kind,
			amountText: formatSignedMoney(payment.amount),
			method: payment.method,
			status: payment.status,
			dateText: day(payment.createdAt),
			decisionText: decisionText(payment, who, day),
			note: payment.note,
			reversalText: original
				? `Reverses the ${formatMoney(Math.abs(original.amount))} ${KIND_WORDS[original.kind]} of ${day(original.createdAt)}`
				: reversal
					? `Reversed ${day(reversal.createdAt)}`
					: null,
			proofUrl:
				payment.status !== "submitted"
					? (proofUrls.get(payment.id) ?? null)
					: null,
			canReverse:
				payment.status === "verified" &&
				payment.kind !== "correction" &&
				reversal === undefined,
		};
	});

	const pending = money.payments
		.filter(({ status: state }) => state === "submitted")
		.map(
			(payment): PendingProofProps => ({
				paymentId: payment.id,
				imageUrl: proofUrls.get(payment.id) ?? null,
				width: payment.proofImageWidth,
				height: payment.proofImageHeight,
				expectedText: formatMoney(payment.amount),
				referenceCode,
				method: payment.method,
				sentText: `${day(payment.createdAt)}, ${payment.createdAt.setZone(timezone).toFormat("HH:mm")}`,
				dueNowText:
					payment.kind === "deposit" && money.depositDue !== payment.amount
						? formatMoney(money.depositDue)
						: null,
			}),
		);

	const closed = CLOSED_FOR_OUTCOME.includes(status);
	const due = balance.due;
	const state: BalanceState = closed
		? balance.paid < 0n
			? "over_refunded"
			: "closed"
		: due === null
			? "no_price"
			: due > 0n
				? "due"
				: due < 0n
					? "overpaid"
					: "paid";
	const amountText =
		state === "closed"
			? formatMoney(balance.paid)
			: state === "over_refunded"
				? formatMoney(-balance.paid)
				: state === "due" && due !== null
					? formatMoney(due)
					: state === "overpaid" && due !== null
						? formatMoney(-due)
						: null;

	const paid = formatSignedMoney(balance.paid);
	const total = balance.total === null ? "" : formatMoney(balance.total);
	const summaries: Record<BalanceState, string> = {
		due: `Paid ${paid} of ${total} · Balance ${amountText}${quote?.kind === "hourly" ? " (estimated)" : ""}`,
		paid: `Paid in full: ${total}`,
		overpaid: `Paid ${paid} of ${total} · Overpaid by ${amountText}`,
		no_price:
			balance.paid === 0n ? "No price yet" : `Paid ${paid} · No price yet`,
		closed: balance.paid === 0n ? "Nothing paid" : `Holds ${amountText}`,
		over_refunded: `Refunded ${amountText} more than it received`,
	};

	const refundable = !money.outcomeNeeded && balance.paid > 0n;
	return {
		summary: summaries[state],
		balance: {
			totalText: balance.total === null ? null : formatMoney(balance.total),
			totalNote:
				quote?.kind === "hourly"
					? `estimated: ${formatHours(quote.estimatedMinutes ?? 0)} h at ${formatMoney(quote.hourlyRate ?? 0)}/hour`
					: null,
			paidText: formatSignedMoney(balance.paid),
			state,
			amountText,
		},
		deposit:
			quote && quote.depositAmount > 0
				? {
						amountText: formatMoney(quote.depositAmount),
						receivedText: formatSignedMoney(money.depositHeld),
						dueText: formatMoney(money.depositDue),
						covered: money.depositDue === 0,
						lapsed: money.depositDue > 0 && BOOKED_STATUSES.includes(status),
					}
				: null,
		rows,
		pending,
		actions: {
			recordKinds:
				status === "declined"
					? []
					: status === "deposit_pending"
						? ["deposit", "session", "balance"]
						: ["session", "balance"],
			depositDue:
				status === "deposit_pending" && money.depositDue > 0
					? money.depositDue / 100
					: null,
			balanceDue:
				due !== null && due > 0n && due <= MAX_PREFILL
					? Number(due) / 100
					: null,
			refundMax: refundable ? Number(balance.paid) / 100 : null,
			refundMaxText: refundable ? formatMoney(balance.paid) : null,
		},
		outcome: {
			needed: money.outcomeNeeded
				? {
						held: money.depositSettleable / 100,
						heldText: formatMoney(money.depositSettleable),
					}
				: null,
			recorded: money.outcome
				? {
						text: outcomeText(money.outcome, byId),
						recordedText: `Recorded ${day(money.outcome.createdAt)} by ${who(money.outcome.recordedByUserId)}`,
						note: money.outcome.note,
					}
				: null,
		},
	};
}

/**
 * Who decided a payment, and when. A verified payment without a screenshot
 * was entered at the desk: "Recorded by".
 */
function decisionText(
	payment: Payment,
	who: (id: string | null) => string,
	day: (at: DateTime) => string,
): string {
	if (payment.status === "submitted") return "Waiting for an owner";
	const at = day(payment.verifiedAt ?? payment.createdAt);
	const by = who(payment.verifiedByUserId);
	if (payment.status === "rejected") return `Rejected by ${by}, ${at}`;
	return payment.proofImageKey
		? `Verified by ${by}, ${at}`
		: `Recorded by ${by}, ${at}`;
}

/** What the studio decided about the deposit, in a sentence. */
function outcomeText(
	outcome: DepositOutcome,
	byId: Map<string, Payment>,
): string {
	const held = formatMoney(outcome.amount);
	if (outcome.outcome === "kept") return `Deposit kept by the studio: ${held}.`;
	if (outcome.outcome === "moved")
		return `Deposit moved to a new date: ${held}.`;
	const refund = outcome.refundPaymentId
		? byId.get(outcome.refundPaymentId)
		: undefined;
	return `Deposit refunded: ${formatMoney(Math.abs(refund?.amount ?? 0))} of ${held} back to the client.`;
}
