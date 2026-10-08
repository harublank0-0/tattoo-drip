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
