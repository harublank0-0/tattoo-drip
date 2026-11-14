import type { DateTime } from "luxon";
import type { Access } from "#modules/billing/access";
import type BillingInvoice from "#modules/billing/models/billing_invoice";
import { PAYABLE_STATUSES } from "#modules/billing/models/billing_invoice";
import type BillingPlan from "#modules/billing/models/billing_plan";
import type BillingSubscription from "#modules/billing/models/billing_subscription";
import { ENDED_STATUSES } from "#modules/billing/models/billing_subscription";
import { intervalText } from "#modules/billing/plans";
import type { BillingOverview } from "#modules/billing/services/billing_service";
import { formatDay, formatMoney } from "#modules/projects/quotes";

/** Words for each subscription status (PayBridgeNP's display statuses). */
export const SUBSCRIPTION_STATUS_TEXT: Record<string, string> = {
	incomplete: "Waiting for the first payment",
	incomplete_expired: "Expired: the first invoice wasn't paid in time",
	draft: "Starts later",
	trialing: "Trial",
	active: "Active",
	past_due: "Past due: an invoice is unpaid",
	paused: "Paused",
	cancelled: "Cancelled",
	completed: "Ended",
};

export const INVOICE_STATUS_TEXT: Record<string, string> = {
	draft: "Draft",
	open: "Due",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
	uncollectible: "Written off",
	write_off: "Written off",
};

export type BillingPageProps = {
	configured: boolean;
	sandbox: boolean;
	access: { state: Access["state"]; text: string };
	plans: {
		code: string;
		name: string;
		price: string;
		interval: string;
		trialDays: number;
	}[];
	subscription: {
		status: string;
		statusText: string;
		live: boolean;
		planCode: string | null;
		planName: string | null;
		pendingPlanName: string | null;
		periodText: string | null;
		nextInvoiceText: string | null;
		cancelText: string | null;
		trialText: string | null;
	} | null;
	invoices: {
		id: string;
		number: string | null;
		status: string;
		statusText: string;
		amount: string;
		paid: string | null;
		periodText: string | null;
		dueText: string | null;
		paidText: string | null;
		payable: boolean;
	}[];
};

/**
 * The studio's Billing page, from BillingService.overview, with every date
 * in the studio's time zone and every amount as NPR text.
 */
export function billingPage(
	overview: BillingOverview,
	planById: Map<string, BillingPlan>,
	timezone: string,
): BillingPageProps {
	const day = (at: DateTime | null) =>
		at ? formatDay(at.setZone(timezone).toFormat("yyyy-MM-dd")) : null;
	return {
		configured: overview.configured,
		sandbox: overview.mode === "sandbox",
		access: {
			state: overview.access.state,
			text: accessText(overview.access, day),
		},
		plans: overview.plans.map((plan) => ({
			code: plan.code,
			name: plan.name,
			price: formatMoney(plan.amount),
			interval: intervalText(plan.intervalUnit, plan.intervalCount),
			trialDays: plan.trialDays,
		})),
		subscription: overview.subscription
			? subscriptionProps(overview.subscription, planById, day)
			: null,
		invoices: overview.invoices.map((invoice) => invoiceProps(invoice, day)),
	};
}

function accessText(
	access: Access,
	day: (at: DateTime | null) => string | null,
): string {
	switch (access.state) {
		case "paid":
			return `Paid until ${day(access.until)}.`;
		case "trial":
			return `Free trial until ${day(access.until)}.`;
		default:
			return "No paid period right now.";
	}
}

function subscriptionProps(
	subscription: BillingSubscription,
	planById: Map<string, BillingPlan>,
	day: (at: DateTime | null) => string | null,
): NonNullable<BillingPageProps["subscription"]> {
	const plan = subscription.planId ? planById.get(subscription.planId) : null;
	const pending = subscription.pendingPlanId
		? planById.get(subscription.pendingPlanId)
		: null;
	const live = !(ENDED_STATUSES as readonly string[]).includes(
		subscription.status,
	);
	const start = day(subscription.currentPeriodStart);
	const end = day(subscription.currentPeriodEnd);
	return {
		status: subscription.status,
		statusText:
			SUBSCRIPTION_STATUS_TEXT[subscription.status] ?? subscription.status,
		live,
		planCode: plan?.code ?? null,
		planName: plan?.name ?? null,
		pendingPlanName: pending?.name ?? null,
		periodText: start && end ? `${start} to ${end}` : null,
		nextInvoiceText:
			live && subscription.nextInvoiceAt && !subscription.cancelAtPeriodEnd
				? `Next invoice ${day(subscription.nextInvoiceAt)}. PayBridgeNP emails it with a link to pay; renewals are not charged automatically.`
				: null,
		cancelText: subscription.cancelAtPeriodEnd
			? `Cancels at the end of the period${(subscription.cancelEffectiveAt ?? subscription.currentPeriodEnd) ? `, ${day(subscription.cancelEffectiveAt ?? subscription.currentPeriodEnd)}` : ""}.`
			: null,
		trialText:
			subscription.status === "trialing" && subscription.trialEndsAt
				? `Trial ends ${day(subscription.trialEndsAt)}.`
				: null,
	};
}

function invoiceProps(
	invoice: BillingInvoice,
	day: (at: DateTime | null) => string | null,
): BillingPageProps["invoices"][number] {
	const start = day(invoice.periodStart);
	const end = day(invoice.periodEnd);
	return {
		id: invoice.id,
		number: invoice.number,
		status: invoice.status,
		statusText: INVOICE_STATUS_TEXT[invoice.status] ?? invoice.status,
		amount: formatMoney(invoice.amountDue),
		paid: invoice.amountPaid > 0 ? formatMoney(invoice.amountPaid) : null,
		periodText: start && end ? `${start} to ${end}` : null,
		dueText: invoice.dueAt ? day(invoice.dueAt) : null,
		paidText: invoice.paidAt ? day(invoice.paidAt) : null,
		payable:
			PAYABLE_STATUSES.includes(invoice.status) &&
			invoice.hostedInvoiceUrl !== null,
	};
}
