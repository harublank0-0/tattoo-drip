import { BillingSubscriptionSchema } from "#database/schema";

export const SUBSCRIPTION_STATUSES = [
	"incomplete",
	"incomplete_expired",
	"draft",
	"trialing",
	"active",
	"past_due",
	"paused",
	"cancelled",
	"completed",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses that never bill again (billing_subscriptions_one_live leaves them out). */
export const ENDED_STATUSES: readonly SubscriptionStatus[] = [
	"incomplete_expired",
	"cancelled",
	"completed",
];

/** A studio's TattooDrip subscription, a copy of PayBridgeNP's record. */
export default class BillingSubscription extends BillingSubscriptionSchema {
	declare status: SubscriptionStatus;
}
