import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * What the public deposit page says (TAT-65): `due` (pay and send a
 * screenshot), `submitted` (a screenshot waits for the studio), `paid`
 * (nothing left to pay), `updating` (the studio is changing the quote),
 * `expired` (the quote expired before the deposit came) or `cancelled`.
 */
export const DEPOSIT_STATES = [
	"due",
	"submitted",
	"paid",
	"updating",
	"expired",
	"cancelled",
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

/** The kinds of payment method a deposit page can show: all but cash. */
export const DEPOSIT_METHOD_KINDS = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
] as const;
export type DepositMethodKind = (typeof DEPOSIT_METHOD_KINDS)[number];

export type DepositFacts = {
	status: ProjectStatus;
	/** The project's current quote has expired. */
	quoteExpired: boolean;
	/** Nothing is left to pay: a zero deposit, or verified deposit money reaching it. */
	settled: boolean;
	/** A deposit payment waits for the studio's decision. */
	proofPending: boolean;
};

/**
 * The page's state; the first rule that matches wins. A cancelled (or
 * declined) project says so whatever was paid. A covered deposit is paid in
 * any other status, also when a revision sent the project back to `quoted`
 * (expiry spares it, TAT-64). A waiting screenshot comes next, so the client
 * isn't asked to pay twice. Then `deposit_pending` is due, or expired once
 * the quote has (before the sweep cancels the project), and anything else
 * means the studio is still working on the quote.
 */
export function depositState(facts: DepositFacts): DepositState {
	if (facts.status === "cancelled" || facts.status === "declined") {
		return "cancelled";
	}
	if (facts.settled) return "paid";
	if (facts.proofPending) return "submitted";
	if (facts.status === "deposit_pending") {
		return facts.quoteExpired ? "expired" : "due";
	}
	return "updating";
}
