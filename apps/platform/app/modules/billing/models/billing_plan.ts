import { BillingPlanSchema } from "#database/schema";

export type IntervalUnit = "day" | "week" | "month" | "quarter" | "year";

/** A TattooDrip plan in one PayBridgeNP mode (platform data, no tenant). */
export default class BillingPlan extends BillingPlanSchema {
	declare intervalUnit: IntervalUnit;
}
