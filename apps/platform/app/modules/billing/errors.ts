import { Exception } from "@adonisjs/core/exceptions";

export type BillingRule =
	| "billing_unavailable"
	| "plan_unavailable"
	| "already_subscribed"
	| "no_subscription"
	| "same_plan"
	| "not_payable"
	| "provider_unavailable"
	| "provider_refused";

const MESSAGES: Record<BillingRule, string> = {
	billing_unavailable: "Billing isn't set up yet. Try again later.",
	plan_unavailable: "That plan isn't available.",
	already_subscribed: "Your studio already has a subscription.",
	no_subscription: "Your studio has no subscription to change.",
	same_plan: "Your studio is already on that plan.",
	not_payable: "This invoice can't be paid now.",
	provider_unavailable:
		"The payment service didn't answer. Nothing changed; try again in a minute.",
	provider_refused:
		"The payment service refused the request. Nothing changed; contact TattooDrip if it keeps happening.",
};

/** A billing action refused for a reason the studio owner can read. */
export class BillingRuleError extends Exception {
	static status = 409;

	constructor(readonly reason: BillingRule) {
		super(MESSAGES[reason], { code: `E_BILLING_${reason.toUpperCase()}` });
	}
}
