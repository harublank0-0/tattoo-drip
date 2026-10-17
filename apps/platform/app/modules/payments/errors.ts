import type { RuleViolation } from "#modules/payments/rules";

/**
 * A payment method that breaks its kind's rules (see checkPaymentMethod).
 * Each violation's message is written for the user: show it as a field
 * error on its field.
 */
export class PaymentMethodRuleError extends Error {
	constructor(readonly violations: RuleViolation[]) {
		super(violations.map(({ message }) => message).join(" "));
		this.name = "PaymentMethodRuleError";
	}
}

export const DEPOSIT_LINK_RULE_REASONS = [
	"not_deposit_pending",
	"quote_expired",
	"nothing_due",
	"no_payment_methods",
] as const;
export type DepositLinkRuleReason = (typeof DEPOSIT_LINK_RULE_REASONS)[number];

const LINK_MESSAGES: Record<DepositLinkRuleReason, string> = {
	not_deposit_pending: "Only a deposit-pending project can have a deposit link",
	quote_expired: "The project's current quote has expired",
	nothing_due: "The project's deposit is zero or already covered",
	no_payment_methods: "The tenant shows no payment method on the deposit page",
};

/**
 * A deposit link can't be made now (TAT-65); `reason` says why, and
 * DEPOSIT_LINK_PROBLEMS has the owner's text. Thrown after the savepoint
 * rolled back. The message is for developers.
 */
export class DepositLinkRuleError extends Error {
	constructor(readonly reason: DepositLinkRuleReason) {
		super(LINK_MESSAGES[reason]);
		this.name = "DepositLinkRuleError";
	}
}

export const DEPOSIT_PROOF_REASONS = [
	"not_due",
	"method_unavailable",
	"amount_changed",
] as const;
export type DepositProofReason = (typeof DEPOSIT_PROOF_REASONS)[number];

const PROOF_MESSAGES: Record<DepositProofReason, string> = {
	not_due: "The deposit page's state is not due",
	method_unavailable: "The tenant doesn't show that kind of payment method",
	amount_changed: "The expected amount is not what is due now",
};

/**
 * A deposit proof the page can't take now (TAT-65). Thrown before the
 * image is stored, or after the savepoint that stored it rolled back (and
 * deleted it). The message is for developers.
 */
export class DepositProofError extends Error {
	constructor(readonly reason: DepositProofReason) {
		super(PROOF_MESSAGES[reason]);
		this.name = "DepositProofError";
	}
}

/**
 * A deposit link that doesn't work: unknown, replaced, expired, another
 * tenant's, or its project is gone. One error for all of them, so the API
 * answers every one with the same 404.
 */
export class DepositPageNotFoundError extends Error {
	constructor() {
		super("No live deposit link with this token in the tenant");
		this.name = "DepositPageNotFoundError";
	}
}
