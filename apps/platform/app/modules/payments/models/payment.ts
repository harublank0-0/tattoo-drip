import { PaymentSchema } from "#database/schema";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";

export const PAYMENT_KINDS = [
	"deposit",
	"session",
	"balance",
	"refund",
	"correction",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["submitted", "verified", "rejected"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Money received for a project. Append-only, enforced by a database trigger:
 * never edited or deleted, except that its decision (`status`,
 * `verifiedByUserId`, `verifiedAt`) is recorded once, `updatedAt` moves and
 * its proof can be cleared (privacy deletion). A decided payment (verified or
 * rejected) is final; its verifier becomes null only when that user's account
 * is deleted. A refund is a negative `refund` payment; a mistaken
 * verification is reversed with a `correction`. Amounts are signed integer
 * paisa.
 */
export default class Payment extends PaymentSchema {
	declare kind: PaymentKind;
	declare status: PaymentStatus;
	declare method: PaymentMethodKind;
}
