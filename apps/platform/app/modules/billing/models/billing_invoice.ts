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

/** One TattooDrip invoice to a studio, a copy of PayBridgeNP's record. */
export default class BillingInvoice extends BillingInvoiceSchema {
	declare status: InvoiceStatus;
}
