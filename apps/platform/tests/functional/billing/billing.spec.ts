import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import BillingAccessPeriod from "#modules/billing/models/billing_access_period";
import BillingCustomer from "#modules/billing/models/billing_customer";
import BillingEvent from "#modules/billing/models/billing_event";
import BillingInvoice from "#modules/billing/models/billing_invoice";
import BillingSubscription from "#modules/billing/models/billing_subscription";
import BillingService from "#modules/billing/services/billing_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { connectStudio, sandboxPlans } from "#tests/helpers/online_payments";
import {
	PLATFORM_WEBHOOK_SECRET,
	paybridge,
	sign,
} from "#tests/helpers/paybridge";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * TattooDrip's subscription billing through the fake PayBridgeNP
 * (docs/payments-paybridgenp.md): subscribing, paid access from paid
 * invoices only, the platform webhook, paying, cancelling and changing
 * plan, and the platform admin's pages.
 */

const WEBHOOK = "/api/v1/webhooks/paybridgenp/platform";

let eventCount = 0;
function platformEvent(type: string, data: Record<string, unknown>) {
	return {
		id: `evt_platform_${++eventCount}_${Date.now()}`,
		type,
		created: Math.floor(Date.now() / 1000),
		livemode: false,
		data,
	};
}

function deliver(
	client: ApiClient,
	event: Record<string, unknown>,
	secret = PLATFORM_WEBHOOK_SECRET,
) {
	const raw = JSON.stringify(event);
	return client
		.post(WEBHOOK)
		.header("content-type", "application/json")
		.header("x-paybridgenp-signature", sign(raw, secret))
		.unsafeJson(raw);
}

async function subscribed(client: ApiClient, slug: string) {
	await sandboxPlans();
	const { tenant, owner } = await studioWithOwner(slug, "Black Needle");
	const response = await client
		.post(`/t/${tenant.slug}/settings/billing/subscription`)
		.loginAs(owner)
		.withCsrfToken()
		.redirects(0)
		.form({ plan: "studio-monthly" });
	response.assertStatus(302);
	const subscription = await inTenant(tenant, () =>
		BillingSubscription.query().firstOrFail(),
	);
	const invoice = await inTenant(tenant, () =>
		BillingInvoice.query().firstOrFail(),
	);
	return { tenant, owner, subscription, invoice };
}

const access = async (tenant: Tenant) =>
	inTenant(tenant, async () =>
		(
			await (
				await import("@adonisjs/core/services/app")
			).default.container.make(BillingService)
		).access(
			tenant,
			DateTime.fromISO("2026-11-15T00:00:00Z") as DateTime<true>,
		),
	);

test.group("Billing: subscribing and access", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("subscribing creates the customer and subscription once, with stable idempotency keys", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, subscription, invoice } = await subscribed(
			client,
			"bill-subscribe",
		);
		const customer = await inTenant(tenant, () =>
			BillingCustomer.query().firstOrFail(),
		);
		assert.equal(
			paybridge.customers.get(customer.providerCustomerId)?.externalCustomerId,
			tenant.id,
		);
		assert.deepEqual(
			paybridge.callsOf("customers.create").map((call) => call.idempotencyKey),
			[`td-billing-customer-${tenant.id}-sandbox`],
		);
		assert.deepEqual(
			paybridge
				.callsOf("subscriptions.create")
				.map((call) => call.idempotencyKey),
			[`td-billing-subscription-${tenant.id}-sandbox-1`],
		);
		assert.equal(subscription.status, "incomplete");
		assert.equal(invoice.status, "open");
		assert.equal(invoice.amountDue, 250_000);
		assert.equal(
			invoice.periodStart?.toISO(),
			DateTime.fromISO("2026-11-01T00:00:00Z").toISO(),
		);

		const again = await client
			.post(`/t/${tenant.slug}/settings/billing/subscription`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.form({ plan: "studio-yearly" });
		again.assertFlashMessage(
			"error",
			"Your studio already has a subscription.",
		);
		assert.lengthOf(paybridge.callsOf("subscriptions.create"), 1);
	});

	test("an active subscription without a paid invoice grants no paid access", async ({
		client,
		assert,
	}) => {
		const { tenant, subscription } = await subscribed(client, "bill-active");
		// PayBridgeNP says active (keep_active plans), the invoice is unpaid.
		const provider = paybridge.subscriptions.get(
			subscription.providerSubscriptionId,
		);
		if (provider) provider.status = "active";
		(
			await deliver(
				client,
				platformEvent("subscription.activated", {
					id: subscription.providerSubscriptionId,
				}),
			)
		).assertStatus(200);
		const fresh = await inTenant(tenant, () =>
			BillingSubscription.findOrFail(subscription.id),
		);
		assert.equal(fresh.status, "active");
		assert.deepEqual(await access(tenant), { state: "none" });
		assert.lengthOf(await inTenant(tenant, () => BillingAccessPeriod.all()), 0);
	});

	test("invoice.paid, confirmed with the API, grants that invoice's period once", async ({
		client,
		assert,
	}) => {
		const { tenant, invoice } = await subscribed(client, "bill-paid");
		// The event alone (no payment at the provider) grants nothing.
		const early = platformEvent("invoice.paid", {
			id: invoice.providerInvoiceId,
		});
		(await deliver(client, early)).assertStatus(200);
		assert.deepEqual(await access(tenant), { state: "none" });

		paybridge.payInvoice(invoice.providerInvoiceId);
		const paid = platformEvent("invoice.paid", {
			id: invoice.providerInvoiceId,
		});
		(await deliver(client, paid)).assertStatus(200);
		(await deliver(client, paid)).assertStatus(200);
		const granted = await access(tenant);
		assert.equal(granted.state, "paid");
		assert.equal(
			granted.state === "paid" && granted.until.toISO(),
			DateTime.fromISO("2026-12-01T00:00:00Z").toISO(),
		);
		const periods = await inTenant(tenant, () => BillingAccessPeriod.all());
		assert.lengthOf(periods, 1);
		const stored = await inTenant(tenant, () =>
			BillingInvoice.findOrFail(invoice.id),
		);
		assert.equal(stored.status, "paid");
		assert.lengthOf(await inTenant(tenant, () => BillingEvent.all()), 2);
	});

	test("a partly paid invoice grants nothing", async ({ client, assert }) => {
		const { tenant, invoice } = await subscribed(client, "bill-partial");
		paybridge.payInvoice(invoice.providerInvoiceId, 100_000);
		const provider = paybridge.invoices.get(invoice.providerInvoiceId);
		if (provider) provider.status = "paid";
		(
			await deliver(
				client,
				platformEvent("invoice.paid", { id: invoice.providerInvoiceId }),
			)
		).assertStatus(200);
		assert.deepEqual(await access(tenant), { state: "none" });
	});

	test("the platform webhook refuses bad signatures and ignores events about no studio", async ({
		client,
		assert,
	}) => {
		const { tenant, invoice } = await subscribed(client, "bill-hooks");
		(
			await deliver(
				client,
				platformEvent("invoice.paid", { id: invoice.providerInvoiceId }),
				"whsec_wrong00000000",
			)
		).assertStatus(400);
		(
			await deliver(client, platformEvent("plan.created", { id: "bpl_1" }))
		).assertStatus(200);
		(
			await deliver(
				client,
				platformEvent("invoice.paid", {
					id: "inv_x",
					customer: { id: "bc_nobody" },
				}),
			)
		).assertStatus(200);
		assert.lengthOf(await inTenant(tenant, () => BillingEvent.all()), 0);
	});

	test("paying leaves for PayBridgeNP's hosted page; a paid invoice says so", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, invoice } = await subscribed(client, "bill-pay");
		const pay = () =>
			client
				.post(`/t/${tenant.slug}/settings/billing/invoices/${invoice.id}/pay`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0);
		const plain = await pay();
		plain.assertStatus(302);
		assert.match(
			plain.header("location") ?? "",
			/^https:\/\/checkout\.paybridgenp\.com\//,
		);
		const inertia = await pay().header("x-inertia", "true");
		inertia.assertStatus(409);
		assert.match(
			inertia.header("x-inertia-location") ?? "",
			/^https:\/\/checkout\.paybridgenp\.com\//,
		);

		// A hosted URL off PayBridgeNP's domains is never sent to a browser.
		const provider = paybridge.invoices.get(invoice.providerInvoiceId);
		if (provider) provider.hostedUrl = "https://evil.example/pay";
		const refused = await pay();
		refused.assertFlashMessage("error", "This invoice can't be paid now.");

		paybridge.payInvoice(invoice.providerInvoiceId);
		const done = await pay();
		done.assertFlashMessage("success", "This invoice is already paid.");
	});

	test("cancel at period end, and a plan change for the next renewal", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, subscription } = await subscribed(
			client,
			"bill-change",
		);
		const post = (path: string, form: Record<string, string> = {}) =>
			client
				.post(`/t/${tenant.slug}/settings/billing/${path}`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form(form);
		(
			await post("subscription/plan", { plan: "studio-yearly" })
		).assertFlashMessage(
			"success",
			"Plan change scheduled for your next renewal.",
		);
		let fresh = await inTenant(tenant, () =>
			BillingSubscription.findOrFail(subscription.id),
		);
		assert.isNotNull(fresh.pendingPlanId);
		(await post("subscription/cancel")).assertFlashMessage(
			"success",
			"Your subscription will end at the end of the current period.",
		);
		fresh = await inTenant(tenant, () =>
			BillingSubscription.findOrFail(subscription.id),
		);
		assert.isTrue(fresh.cancelAtPeriodEnd);
		const page = await client
			.get(`/t/${tenant.slug}/settings/billing`)
			.loginAs(owner)
			.withInertia();
		assert.match(
			page.inertiaProps.subscription.cancelText,
			/^Cancels at the end of the period/,
		);
	});

	test("an artist can't reach billing; a provider outage changes nothing", async ({
		client,
		assert,
	}) => {
		await sandboxPlans();
		const { tenant, owner } = await studioWithOwner(
			"bill-roles",
			"Black Needle",
		);
		const artist = await artistIn(tenant, "ink@bill-roles.example");
		(
			await client.get(`/t/${tenant.slug}/settings/billing`).loginAs(artist)
		).assertStatus(404);
		paybridge.failNext("customers.create");
		const response = await client
			.post(`/t/${tenant.slug}/settings/billing/subscription`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.form({ plan: "studio-monthly" });
		response.assertFlashMessage(
			"error",
			"The payment service didn't answer. Nothing changed; try again in a minute.",
		);
		assert.lengthOf(await inTenant(tenant, () => BillingSubscription.all()), 0);
	});
});

test.group("Billing: platform admin", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("only a confirmed listed admin opens the admin pages, which show TattooDrip's income only", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, invoice } = await subscribed(client, "bill-admin");
		paybridge.payInvoice(invoice.providerInvoiceId);
		(
			await deliver(
				client,
				platformEvent("invoice.paid", { id: invoice.providerInvoiceId }),
			)
		).assertStatus(200);
		const admin = await User.create({
			email: "Admin@Platform.example",
			password: "secret-password",
			emailVerifiedAt: DateTime.utc(),
		});
		(await client.get("/admin/billing").loginAs(owner)).assertStatus(404);
		const page = await client
			.get("/admin/billing")
			.loginAs(admin)
			.withInertia();
		page.assertStatus(200);
		assert.equal(page.inertiaProps.totals.paidAllTime, "NPR 2,500");
		const studio = page.inertiaProps.studios.find(
			(row: { tenantId: string }) => row.tenantId === tenant.id,
		);
		assert.equal(studio?.name, "Black Needle");
	});

	test("an admin verifies a studio's connection; until then it can't take payments", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner(
			"bill-review",
			"Black Needle",
		);
		const { account } = await connectStudio(tenant, owner.id, {
			verified: false,
		});
		const admin = await User.create({
			email: "admin@platform.example",
			password: "secret-password",
			emailVerifiedAt: DateTime.utc(),
		});
		const list = await client
			.get("/admin/payments")
			.loginAs(admin)
			.withInertia();
		assert.equal(
			list.inertiaProps.accounts.find(
				(row: { accountId: string }) => row.accountId === account.id,
			)?.status,
			"pending",
		);
		const before = await client
			.get(`/t/${tenant.slug}/settings/online-payments`)
			.loginAs(owner)
			.withInertia();
		assert.isFalse(before.inertiaProps.available);
		const review = (user: User) =>
			client
				.post("/admin/payments/review")
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({
					tenantId: tenant.id,
					accountId: account.id,
					decision: "verify",
				});
		(await review(owner)).assertStatus(404);
		(await review(admin)).assertStatus(302);
		const settings = await client
			.get(`/t/${tenant.slug}/settings/online-payments`)
			.loginAs(owner)
			.withInertia();
		assert.isTrue(settings.inertiaProps.available);
		assert.equal(settings.inertiaProps.account.status, "verified");
		assert.notInclude(JSON.stringify(settings.inertiaProps), "sk_test_");
	});
});
