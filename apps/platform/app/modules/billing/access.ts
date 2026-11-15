import { DateTime } from "luxon";
import type { IntervalUnit } from "#modules/billing/models/billing_plan";
import type { ProviderMode } from "#services/paybridge";

/**
 * Paid access from paid invoices only (docs/payments-paybridgenp.md).
 * PayBridgeNP: "Do not grant paid access from `status` alone … Base access
 * for a billing period on that period's `invoice.paid` event or paid
 * invoice record." A subscription's `active` status therefore grants
 * nothing here; a stored access period does, and a period is stored only
 * once its invoice was read back from the API as paid in full. A period
 * whose invoice was reversed (voided, written off, or ended by staff for a
 * refund) counts only until its revocation.
 */

export type AccessPeriod = {
	startsAt: DateTime;
	endsAt: DateTime;
	revokedAt?: DateTime | null;
};

/**
 * The billing mode whose records decide access: the platform key's mode;
 * with no key, live in production (a sandbox key is refused there, so its
 * records are live ones) and none elsewhere, so a missing setting never
 * turns sandbox records into paid access.
 */
export function accessMode(
	keyMode: ProviderMode | null,
	production: boolean,
): ProviderMode | null {
	return keyMode ?? (production ? "live" : null);
}

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
	const sorted = periods
		.map(({ startsAt, endsAt, revokedAt }) => ({
			startsAt,
			endsAt: revokedAt && revokedAt < endsAt ? revokedAt : endsAt,
		}))
		.filter((period) => period.endsAt > period.startsAt)
		.sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis());
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

/** How long before its period an invoice may be issued and still be that period's. */
const ISSUED_EARLY = { days: 1 };

/**
 * The period a paid invoice grants. Its stored period (the subscription's,
 * as read the first time the invoice was seen) when that is sound and holds
 * the invoice's issue date: PayBridgeNP issues an invoice as its period
 * starts. A stored period that doesn't hold it was read after a renewal
 * (docs/payments-paybridgenp.md), so the period is then one interval of the
 * invoice's own plan from its issue date, or from its payment when it has
 * no issue date. Null when neither is sound: never a guess from today.
 */
export function paidPeriod(
	invoice: {
		periodStart: DateTime | null;
		periodEnd: DateTime | null;
		issuedAt: DateTime | null;
		paidAt: DateTime | null;
	},
	plan: { intervalUnit: IntervalUnit; intervalCount: number } | null,
): AccessPeriod | null {
	const { periodStart, periodEnd, issuedAt } = invoice;
	if (
		periodStart &&
		periodEnd &&
		periodEnd > periodStart &&
		(!issuedAt ||
			(periodStart.minus(ISSUED_EARLY) <= issuedAt && issuedAt < periodEnd))
	) {
		return { startsAt: periodStart, endsAt: periodEnd };
	}
	const startsAt = issuedAt ?? invoice.paidAt;
	if (!plan || !startsAt) return null;
	const unit = plan.intervalUnit === "quarter" ? "month" : plan.intervalUnit;
	const count =
		plan.intervalUnit === "quarter"
			? plan.intervalCount * 3
			: plan.intervalCount;
	return { startsAt, endsAt: startsAt.plus({ [`${unit}s`]: count }) };
}
