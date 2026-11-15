import { BillingInvoiceSchema } from "#database/schema";

export const INVOICE_STATUSES = [
	"draft",
	"open",
	"paid",
	"overdue",
	"void",
	"uncollectible",
	"write_off",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses that can still be paid through the hosted link. */
export const PAYABLE_STATUSES: readonly InvoiceStatus[] = ["open", "overdue"];

/**
 * Statuses that reverse a paid invoice: the period it granted ends when one
 * is read back (docs/payments-paybridgenp.md). Each is its own revocation
 * reason in billing_access_periods.
 */
export const REVERSED_STATUSES = [
	"void",
	"uncollectible",
	"write_off",
] as const;
export type ReversedStatus = (typeof REVERSED_STATUSES)[number];

/** One TattooDrip invoice to a studio, a copy of PayBridgeNP's record. */
export default class BillingInvoice extends BillingInvoiceSchema {
	declare status: InvoiceStatus;
}
