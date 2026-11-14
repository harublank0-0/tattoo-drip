import { GatewayCheckoutSchema } from "#database/schema";

export const CHECKOUT_STATUSES = [
	"creating",
	"open",
	"paid",
	"failed",
	"cancelled",
	"expired",
	"superseded",
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** Attempts that may still be paid. */
export const LIVE_CHECKOUT_STATUSES: readonly CheckoutStatus[] = [
	"creating",
	"open",
];

/** One hosted checkout session for a project's deposit. */
export default class GatewayCheckout extends GatewayCheckoutSchema {
	declare status: CheckoutStatus;
	declare purpose: "deposit";
}
