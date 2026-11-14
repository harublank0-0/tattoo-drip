import { GatewayPaymentSchema } from "#database/schema";

export const REVIEW_REASONS = [
	"amount_mismatch",
	"currency_mismatch",
	"mode_mismatch",
	"session_mismatch",
	"metadata_mismatch",
	"duplicate",
	"unsupported_method",
	"project_deleted",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** A payment PayBridgeNP reported for a checkout (recorded, failed, or held for review). */
export default class GatewayPayment extends GatewayPaymentSchema {
	declare reviewReason: ReviewReason | null;
}
