import { BillingPlanSchema } from "#database/schema";
import type { PackageKey } from "#modules/packages/packages";

export type IntervalUnit = "day" | "week" | "month" | "quarter" | "year";

/** A TattooDrip plan in one PayBridgeNP mode (platform data, no tenant). */
export default class BillingPlan extends BillingPlanSchema {
	declare intervalUnit: IntervalUnit;
	declare package: PackageKey;
}
