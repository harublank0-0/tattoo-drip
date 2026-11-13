import { DateTime } from "luxon";
import type { IntervalUnit } from "#modules/billing/models/billing_plan";

/**
 * Paid access from paid invoices only (docs/payments-paybridgenp.md).
 * PayBridgeNP: "Do not grant paid access from `status` alone … Base access
 * for a billing period on that period's `invoice.paid` event or paid
 * invoice record." A subscription's `active` status therefore grants
 * nothing here; a stored access period does, and a period is stored only
 * once its invoice was read back from the API as paid in full.
 */

export type AccessPeriod = { startsAt: DateTime; endsAt: DateTime };

export type Access =
	| { state: "paid"; until: DateTime }
	| { state: "trial"; until: DateTime }
	| { state: "none" };

/**
 * The studio's access at `now`: paid while a paid period covers it (until
 * the end of the last period that continues it without a gap), else trial
 * while the subscription is trialing and its trial hasn't ended, else none.
 */
export function accessAt(
	periods: readonly AccessPeriod[],
	subscription: { status: string; trialEndsAt: DateTime | null } | null,
	now: DateTime = DateTime.utc(),
): Access {
	const sorted = [...periods].sort(
		(a, b) => a.startsAt.toMillis() - b.startsAt.toMillis(),
	);
	const covering = sorted.find(
		(period) => period.startsAt <= now && now < period.endsAt,
	);
	if (covering) {
		let until = covering.endsAt;
		for (const period of sorted) {
			if (period.startsAt <= until && period.endsAt > until) {
				until = period.endsAt;
			}
		}
		return { state: "paid", until };
	}
	if (
		subscription?.status === "trialing" &&
		subscription.trialEndsAt &&
		subscription.trialEndsAt > now
	) {
		return { state: "trial", until: subscription.trialEndsAt };
	}
	return { state: "none" };
}

/** Whether an invoice read from the API is paid in full, in this mode and currency. */
export function isPaidInFull(invoice: {
	status: string;
	amountDue: number;
	amountPaid: number;
	currency: string;
}): boolean {
	return (
		invoice.status === "paid" &&
		Number.isSafeInteger(invoice.amountDue) &&
		Number.isSafeInteger(invoice.amountPaid) &&
		invoice.amountPaid >= invoice.amountDue &&
		invoice.currency === "NPR"
	);
}

/**
 * The period a paid invoice grants: its stored period when it has a sound
 * one, else one plan interval from when it was paid.
 */
export function paidPeriod(
	invoice: {
		periodStart: DateTime | null;
		periodEnd: DateTime | null;
		paidAt: DateTime | null;
	},
	plan: { intervalUnit: IntervalUnit; intervalCount: number } | null,
	now: DateTime = DateTime.utc(),
): AccessPeriod | null {
	const { periodStart, periodEnd } = invoice;
	if (periodStart && periodEnd && periodEnd > periodStart) {
		return { startsAt: periodStart, endsAt: periodEnd };
	}
	if (!plan) return null;
	const startsAt = invoice.paidAt ?? now;
	const unit = plan.intervalUnit === "quarter" ? "month" : plan.intervalUnit;
	const count =
		plan.intervalUnit === "quarter"
			? plan.intervalCount * 3
			: plan.intervalCount;
	return { startsAt, endsAt: startsAt.plus({ [`${unit}s`]: count }) };
}
