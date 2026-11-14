import app from "@adonisjs/core/services/app";
import { DateTime } from "luxon";
import BillingAccessPeriod from "#modules/billing/models/billing_access_period";
import BillingCustomer from "#modules/billing/models/billing_customer";
import BillingInvoice from "#modules/billing/models/billing_invoice";
import BillingPlan from "#modules/billing/models/billing_plan";
import BillingSubscription from "#modules/billing/models/billing_subscription";
import GatewayAccount from "#modules/payments/models/gateway_account";
import GatewayCheckout from "#modules/payments/models/gateway_checkout";
import GatewayPayment from "#modules/payments/models/gateway_payment";
import GatewayRefund from "#modules/payments/models/gateway_refund";
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { paybridge } from "#tests/helpers/paybridge";
import { inTenant } from "#tests/helpers/tenants";

/**
 * Test fixtures for online payments (docs/payments-paybridgenp.md), all in
 * the fake PayBridgeNP (tests/helpers/paybridge.ts).
 */

/** The catalogue's plans in sandbox, as `billing:sync-plans` stores them. */
export async function sandboxPlans() {
	const plans: BillingPlan[] = [];
	for (const [code, amount, unit] of [
		["studio-monthly", 250_000, "month"],
		["studio-yearly", 2_500_000, "year"],
	] as const) {
		const existing = await BillingPlan.query()
			.where("code", code)
			.where("livemode", false)
			.first();
		if (existing?.providerPlanId) {
			paybridge.plans.set(existing.providerPlanId, {
				id: existing.providerPlanId,
				livemode: false,
			});
			plans.push(existing);
			continue;
		}
		const providerPlanId = `bpl_test_${code}`;
		paybridge.plans.set(providerPlanId, {
			id: providerPlanId,
			livemode: false,
		});
		const values = {
			code,
			name: `TattooDrip Studio, ${unit}ly`,
			amount,
			currency: "NPR",
			intervalUnit: unit,
			intervalCount: 1,
			trialDays: 0,
			livemode: false,
			providerPlanId,
			active: true,
		};
		plans.push(
			existing
				? await existing.merge(values).save()
				: await BillingPlan.create(values),
		);
	}
	return plans;
}

/**
 * A studio's billing records as a sync would store them: a customer, a
 * live subscription and one open invoice with a hosted page.
 */
export async function seedBilling(tenant: Pick<Tenant, "id">) {
	const [monthly] = await sandboxPlans();
	return inTenant(tenant, async () => {
		const customer = await BillingCustomer.create({
			tenantId: tenant.id,
			livemode: false,
			providerCustomerId: `bc_seed_${tenant.id}`,
		});
		const subscription = await BillingSubscription.create({
			tenantId: tenant.id,
			customerId: customer.id,
			planId: monthly.id,
			providerSubscriptionId: `sub_seed_${tenant.id}`,
			status: "active",
			livemode: false,
			currentPeriodStart: DateTime.utc().startOf("month"),
			currentPeriodEnd: DateTime.utc().startOf("month").plus({ months: 1 }),
			cancelAtPeriodEnd: false,
		});
		const invoice = await BillingInvoice.create({
			tenantId: tenant.id,
			subscriptionId: subscription.id,
			providerInvoiceId: `inv_seed_${tenant.id}`,
			number: "TEST-1",
			status: "open",
			amountDue: 250_000,
			amountPaid: 0,
			currency: "NPR",
			hostedInvoiceUrl: "https://checkout.paybridgenp.com/invoice/seed",
			livemode: false,
		});
		// The same records at the (fake) provider, so syncs and actions work.
		paybridge.customers.set(customer.providerCustomerId, {
			id: customer.providerCustomerId,
			externalCustomerId: tenant.id,
		});
		paybridge.subscriptions.set(subscription.providerSubscriptionId, {
			id: subscription.providerSubscriptionId,
			status: "active",
			customerId: customer.providerCustomerId,
			customerExternalId: tenant.id,
			planId: monthly.providerPlanId,
			pendingPlanId: null,
			currentPeriodStart: subscription.currentPeriodStart?.toISO() ?? null,
			currentPeriodEnd: subscription.currentPeriodEnd?.toISO() ?? null,
			nextInvoiceAt: subscription.currentPeriodEnd?.toISO() ?? null,
			trialEndsAt: null,
			cancelAtPeriodEnd: false,
			canceledAt: null,
			cancelEffectiveAt: null,
			endedAt: null,
			pausedAt: null,
			latestInvoiceId: invoice.providerInvoiceId,
			referenceId: tenant.id,
			livemode: false,
		});
		paybridge.invoices.set(invoice.providerInvoiceId, {
			id: invoice.providerInvoiceId,
			number: "TEST-1",
			status: "open",
			amountDue: 250_000,
			amountPaid: 0,
			currency: "NPR",
			issuedAt: subscription.currentPeriodStart?.toISO() ?? null,
			dueAt: null,
			paidAt: null,
			hostedUrl: "https://checkout.paybridgenp.com/invoice/seed",
			customerId: customer.providerCustomerId,
			customerExternalId: tenant.id,
			subscriptionId: subscription.providerSubscriptionId,
			periodStart: subscription.currentPeriodStart?.toISO() ?? null,
			periodEnd: subscription.currentPeriodEnd?.toISO() ?? null,
			livemode: false,
		});
		return { customer, subscription, invoice };
	});
}

/**
 * A studio connected to its own (fake) PayBridgeNP project and, unless
 * `verified` is false, checked by a platform admin. Returns the key the fake
 * knows and the account.
 */
export async function connectStudio(
	tenant: Pick<Tenant, "id">,
	userId: string,
	{
		verified = true,
		name = "studio",
	}: { verified?: boolean; name?: string } = {},
) {
	const key = paybridge.studioKey(name);
	const accounts = await app.container.make(GatewayAccountService);
	const account = await inTenant(tenant, async () => {
		const connected = await accounts.connect(tenant, userId, key);
		return verified
			? accounts.review(tenant, connected.id, userId, "verify")
			: connected;
	});
	return { key, account };
}

/** Everything a studio holds about online payments, for isolation snapshots. */
export function onlinePaymentRows(tenant: Pick<Tenant, "id">) {
	return inTenant(tenant, async () => ({
		accounts: (await GatewayAccount.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		checkouts: (await GatewayCheckout.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		payments: (await GatewayPayment.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		refunds: (await GatewayRefund.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));
}

/** Everything a studio holds about its TattooDrip subscription, for isolation snapshots. */
export function billingRows(tenant: Pick<Tenant, "id">) {
	return inTenant(tenant, async () => ({
		customers: (await BillingCustomer.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		subscriptions: (await BillingSubscription.query().orderBy("id")).map(
			(row) => row.serialize(),
		),
		invoices: (await BillingInvoice.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		periods: (await BillingAccessPeriod.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));
}
