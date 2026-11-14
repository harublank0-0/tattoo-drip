import { BillingAccessPeriodSchema } from "#database/schema";

/** Paid access for one billing period, granted once its invoice was confirmed paid. */
export default class BillingAccessPeriod extends BillingAccessPeriodSchema {}
