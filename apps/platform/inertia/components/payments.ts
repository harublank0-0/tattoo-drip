export type PaymentRowProps = {
	id: string;
	kind: "deposit" | "session" | "balance" | "refund" | "correction";
	/** "NPR 3,000", or "−NPR 3,000" for money going back. */
	amountText: string;
	method: "fonepay" | "esewa" | "khalti" | "bank" | "cash";
	status: "submitted" | "verified" | "rejected";
	/** When it was recorded or sent: "18 Oct 2026". */
	dateText: string;
	/** "Waiting for an owner", "Verified by Asha Rai, 18 Oct 2026", "Recorded by …", "Rejected by …". */
	decisionText: string;
	note: string | null;
	/** "Reverses the NPR 3,000 deposit of 18 Oct 2026", or "Reversed 19 Oct 2026". */
	reversalText: string | null;
	/** Owners only, decided payments with a screenshot: a 5-minute signed URL. */
	proofUrl: string | null;
	/** Owners only: verified, not a reversal, not reversed yet. */
	canReverse: boolean;
};
export type PendingProofProps = {
	paymentId: string;
	imageUrl: string | null;
	width: number | null;
	height: number | null;
	/** What the deposit page asked for when it was sent. */
	expectedText: string;
	referenceCode: string | null;
	method: PaymentRowProps["method"];
	/** "18 Oct 2026, 14:05" in the studio's timezone. */
	sentText: string;
	/** The deposit due now, when it differs from what was asked. */
	dueNowText: string | null;
};
export type BalanceState = "due" | "paid" | "overpaid" | "no_price" | "closed";
export type PaymentsCardProps = {
	balance: {
		totalText: string | null;
		/** Hourly: "estimated: 5 h at NPR 3,000/hour". */
		totalNote: string | null;
		paidText: string;
		state: BalanceState;
		/** due: what is due; overpaid: by how much; closed: what it holds; else null. */
		amountText: string | null;
	};
	/** When the current quote asks for a deposit. */
	deposit: {
		amountText: string;
		receivedText: string;
		dueText: string;
		covered: boolean;
		/** Booked or later, and the deposit is no longer covered (a reversal). */
		lapsed: boolean;
	} | null;
	rows: PaymentRowProps[];
	/** Owners only (else empty): the screenshots to check, newest first. */
	pending: PendingProofProps[];
	/** Owners only. */
	actions: {
		/** What Record payment offers now; empty: the form is hidden. */
		recordKinds: ("deposit" | "session" | "balance")[];
		/** Rupees to prefill: the deposit still due (deposit_pending only), the balance due. */
		depositDue: number | null;
		balanceDue: number | null;
		/** Rupees: the most a refund may be; null: no refund form. */
		refundMax: number | null;
		refundMaxText: string | null;
	} | null;
	outcome: {
		/** Owners only: the project closed holding deposit money and nothing is recorded. */
		needed: { held: number; heldText: string } | null;
		recorded: {
			text: string;
			recordedText: string;
			note: string | null;
		} | null;
	};
};

export type MethodKind = PaymentRowProps["method"];
export type DeskKindName = "deposit" | "session" | "balance";

/** The order methods are offered in. */
export const METHODS: MethodKind[] = [
	"cash",
	"bank",
	"fonepay",
	"esewa",
	"khalti",
];

export const METHOD_LABELS: Record<MethodKind, string> = {
	cash: "Cash",
	bank: "Bank transfer",
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
};

export const KIND_LABELS: Record<PaymentRowProps["kind"], string> = {
	deposit: "Deposit",
	session: "Session payment",
	balance: "Balance",
	refund: "Refund",
	correction: "Reversal",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentRowProps["status"], string> =
	{
		submitted: "Waiting",
		verified: "Verified",
		rejected: "Rejected",
	};

/** What Record payment says about each kind. */
export const DESK_KIND_TEXT: Record<
	DeskKindName,
	{ title: string; description: string | null }
> = {
	deposit: { title: "Deposit", description: null },
	session: {
		title: "Session payment",
		description: "Paid at a session, before the work is finished.",
	},
	balance: { title: "Balance", description: "The rest of the price." },
};
