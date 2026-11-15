import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
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
import { entitlementText } from "#modules/packages/entitlement";
import EntitlementService from "#modules/packages/services/entitlement_service";
import { formatDay } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import { withDbContext, withTransaction } from "#services/db_context";
import { queuedMails } from "#tests/helpers/accounts";
import {
	connectStudio,
	livePlans,
	sandboxPlans,
} from "#tests/helpers/online_payments";
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

const access = async (
	tenant: Tenant,
	at = DateTime.fromISO("2026-11-15T00:00:00Z") as DateTime<true>,
) =>
	inTenant(tenant, async () =>
		(
			await (
				await import("@adonisjs/core/services/app")
			).default.container.make(BillingService)
		).access(tenant, at),
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

test.group("Billing: lost answers", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a subscription PayBridgeNP made but TattooDrip lost is adopted, never created twice", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, subscription } = await subscribed(
			client,
			"bill-adopt",
		);
		// The local copy is lost (the answer timed out after the create).
		await inTenant(tenant, async () => {
			await BillingInvoice.query().where("tenant_id", tenant.id).delete();
			await BillingSubscription.query().where("id", subscription.id).delete();
		});
		const again = await client
			.post(`/t/${tenant.slug}/settings/billing/subscription`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.form({ plan: "studio-monthly" });
		again.assertStatus(302);
		assert.lengthOf(paybridge.callsOf("subscriptions.create"), 1);
		const adopted = await inTenant(tenant, () =>
			BillingSubscription.query().firstOrFail(),
		);
		assert.equal(
			adopted.providerSubscriptionId,
			subscription.providerSubscriptionId,
		);
		assert.lengthOf(await inTenant(tenant, () => BillingInvoice.all()), 1);
	});

	test("an invoice paid for a customer whose local row was lost still finds its studio", async ({
		client,
		assert,
	}) => {
		const { tenant, invoice } = await subscribed(client, "bill-orphan");
		await inTenant(tenant, async () => {
			await BillingInvoice.query().where("tenant_id", tenant.id).delete();
			await BillingSubscription.query().where("tenant_id", tenant.id).delete();
			await BillingCustomer.query().where("tenant_id", tenant.id).delete();
		});
		paybridge.payInvoice(invoice.providerInvoiceId);
		(
			await deliver(
				client,
				platformEvent("invoice.paid", { id: invoice.providerInvoiceId }),
			)
		).assertStatus(200);
		assert.lengthOf(await inTenant(tenant, () => BillingCustomer.all()), 1);
		assert.equal((await access(tenant)).state, "paid");
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

/** A paid sandbox subscription, its invoice confirmed through the webhook. */
async function paidSubscription(client: ApiClient, slug: string) {
	const subscribedStudio = await subscribed(client, slug);
	paybridge.payInvoice(subscribedStudio.invoice.providerInvoiceId);
	(
		await deliver(
			client,
			platformEvent("invoice.paid", {
				id: subscribedStudio.invoice.providerInvoiceId,
			}),
		)
	).assertStatus(200);
	return subscribedStudio;
}

const billingService = async () =>
	(await import("@adonisjs/core/services/app")).default.container.make(
		BillingService,
	);

const accessPeriods = (tenant: Tenant) =>
	inTenant(tenant, () =>
		BillingAccessPeriod.query().orderBy("starts_at").orderBy("id"),
	);

const platformAdmin = () =>
	User.create({
		email: "Admin@Platform.example",
		password: "secret-password",
		emailVerifiedAt: DateTime.utc(),
	});

const billingMails = (fake: ReturnType<typeof queue.fake>) =>
	queuedMails(fake).filter(({ to }) => to === "admin@platform.example");

test.group("Billing: modes, plans and reversals", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a sandbox payment gives no access once billing runs live, and a live subscription starts beside the sandbox one", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, invoice } = await paidSubscription(
			client,
			"bill-to-live",
		);
		assert.equal((await access(tenant)).state, "paid");

		paybridge.platformMode = "live";
		await livePlans();
		assert.equal((await access(tenant)).state, "none");
		// The sandbox invoice is no invoice of the live key: paying it is the
		// unknown invoice's 404, and PayBridgeNP is never asked about it.
		const invoiceReads = paybridge.callsOf("invoices.get").length;
		(
			await client
				.post(`/t/${tenant.slug}/settings/billing/invoices/${invoice.id}/pay`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
		assert.equal(paybridge.callsOf("invoices.get").length, invoiceReads);
		// The daily sync reads only the live key's own records: the sandbox
		// subscription doesn't exist for it.
		const reads = paybridge.callsOf("subscriptions.get").length;
		await inTenant(tenant, async () =>
			(await billingService()).syncTenant(tenant),
		);
		assert.equal(paybridge.callsOf("subscriptions.get").length, reads);

		(
			await client
				.post(`/t/${tenant.slug}/settings/billing/subscription`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ plan: "studio-monthly" })
		).assertStatus(302);
		const subscriptions = await inTenant(tenant, () =>
			BillingSubscription.query().orderBy("created_at").orderBy("id"),
		);
		assert.deepEqual(
			subscriptions.map((subscription) => subscription.livemode),
			[false, true],
		);
	});

	test("once billing runs live, the Billing page and the admin totals leave sandbox records out", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await paidSubscription(client, "bill-page-live");
		paybridge.platformMode = "live";
		await livePlans();

		const page = await client
			.get(`/t/${tenant.slug}/settings/billing`)
			.loginAs(owner)
			.withInertia();
		page.assertStatus(200);
		assert.isNull(page.inertiaProps.subscription);
		assert.deepEqual(page.inertiaProps.invoices, []);
		assert.equal(page.inertiaProps.access.state, "none");

		const adminPage = await client
			.get("/admin/billing")
			.loginAs(await platformAdmin())
			.withInertia();
		adminPage.assertStatus(200);
		assert.equal(adminPage.inertiaProps.totals.paidAllTime, "NPR 0");
		assert.deepEqual(adminPage.inertiaProps.invoices, []);
	});

	test("a paid period records its invoice's plan and mode", async ({
		client,
		assert,
	}) => {
		const { tenant, invoice } = await paidSubscription(client, "bill-plan");
		const [monthly] = await sandboxPlans();

		const [period] = await accessPeriods(tenant);
		assert.equal(period.planId, monthly.id);
		assert.isFalse(period.livemode);
		const stored = await inTenant(tenant, () =>
			BillingInvoice.findOrFail(invoice.id),
		);
		assert.equal(stored.planId, monthly.id);
	});

	test("an invoice first read after a renewal onto another plan keeps its own plan and period", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, subscription } = await paidSubscription(
			client,
			"bill-late",
		);
		const [monthly] = await sandboxPlans();
		// December renews on the monthly plan; TattooDrip hears nothing of it.
		const december = paybridge.nextPeriod(subscription.providerSubscriptionId, {
			start: "2026-12-01T00:00:00.000Z",
			end: "2027-01-01T00:00:00.000Z",
			amount: 250_000,
		});
		// The owner moves to yearly from the next renewal, which comes too.
		(
			await client
				.post(`/t/${tenant.slug}/settings/billing/subscription/plan`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ plan: "studio-yearly" })
		).assertStatus(302);
		paybridge.nextPeriod(subscription.providerSubscriptionId, {
			start: "2027-01-01T00:00:00.000Z",
			end: "2028-01-01T00:00:00.000Z",
			amount: 2_500_000,
		});
		// Only now is December's invoice paid and read, with the subscription
		// on the yearly plan and its yearly period.
		paybridge.payInvoice(december.id);
		(
			await deliver(client, platformEvent("invoice.paid", { id: december.id }))
		).assertStatus(200);

		const periods = await accessPeriods(tenant);
		const decemberPeriod = periods.at(-1);
		assert.equal(
			decemberPeriod?.startsAt.toUTC().toISO(),
			"2026-12-01T00:00:00.000Z",
		);
		assert.equal(
			decemberPeriod?.endsAt.toUTC().toISO(),
			"2027-01-01T00:00:00.000Z",
		);
		assert.equal(decemberPeriod?.planId, monthly.id);
	});

	test("a paid invoice with neither its own plan nor a period it falls in grants nothing and emails staff once", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant, subscription } = await paidSubscription(
			client,
			"bill-unresolved",
		);
		const december = paybridge.nextPeriod(subscription.providerSubscriptionId, {
			start: "2026-12-01T00:00:00.000Z",
			end: "2027-01-01T00:00:00.000Z",
			amount: 250_000,
		});
		december.planId = null;
		paybridge.nextPeriod(subscription.providerSubscriptionId, {
			start: "2027-01-01T00:00:00.000Z",
			end: "2027-02-01T00:00:00.000Z",
			amount: 250_000,
		});
		// First read as "paid" but short: not paid in full, so nothing yet.
		december.status = "paid";
		december.amountPaid = 100_000;
		(
			await deliver(client, platformEvent("invoice.paid", { id: december.id }))
		).assertStatus(200);
		assert.lengthOf(billingMails(fake), 0);
		paybridge.payInvoice(december.id);
		for (let delivery = 0; delivery < 2; delivery++) {
			(
				await deliver(
					client,
					platformEvent("invoice.paid", { id: december.id }),
				)
			).assertStatus(200);
		}

		assert.lengthOf(await accessPeriods(tenant), 1);
		const mails = billingMails(fake);
		assert.deepEqual(
			mails.map(({ subject }) => subject),
			["Paid studio invoice not granted"],
		);
		assert.equal(mails[0].data.studioSlug, "bill-unresolved");
		assert.match(String(mails[0].data.url), /\/admin\/billing$/);
	});

	test("a paid invoice that turns void, uncollectible or written off ends its period's access, keeps the row and emails staff once", async ({
		client,
		assert,
	}) => {
		// When access then ends is pinned by the unit tests (accessAt with
		// revokedAt): the fake's periods are fixed dates, the revocation is
		// the real clock's.
		const fake = queue.fake();
		const service = await billingService();
		for (const status of ["void", "uncollectible", "write_off"] as const) {
			const { tenant, invoice } = await paidSubscription(
				client,
				`bill-${status.replace("_", "-")}`,
			);
			paybridge.voidInvoice(invoice.providerInvoiceId, status);
			// Read twice (the next sync too): the second changes nothing.
			await inTenant(tenant, () => service.syncTenant(tenant));
			await inTenant(tenant, () => service.syncTenant(tenant));

			const periods = await accessPeriods(tenant);
			assert.lengthOf(periods, 1);
			assert.isNotNull(periods[0].revokedAt);
			assert.equal(periods[0].revokedReason, status);
			assert.isNull(periods[0].revokedByUserId);
		}
		const mails = billingMails(fake);
		assert.deepEqual(
			mails.map(({ subject, data }) => [subject, data.reason]),
			[
				["Studio paid access ended", "void"],
				["Studio paid access ended", "uncollectible"],
				["Studio paid access ended", "write_off"],
			],
		);
	});

	test("a paid period's dates, invoice and plan never change, and a revocation is set once", async ({
		client,
		assert,
	}) => {
		const { tenant } = await paidSubscription(client, "bill-guard");
		await withDbContext({ tenantId: tenant.id }, async () => {
			const update = (set: string) =>
				withTransaction((inner) =>
					inner.rawQuery(`update billing_access_periods set ${set}`),
				);
			for (const [set, column] of [
				["ends_at = ends_at + interval '1 day'", "ends_at"],
				["starts_at = starts_at - interval '1 day'", "starts_at"],
				["plan_id = null", "plan_id"],
				["livemode = true", "livemode"],
			]) {
				await assert.rejects(
					() => update(set),
					new RegExp(`billing_access_periods_guard: ${column} cannot change`),
				);
			}
			await update("revoked_at = now(), revoked_reason = 'refund'");
			await assert.rejects(
				() => update("revoked_reason = 'other'"),
				/billing_access_periods_guard: a revocation is final/,
			);
			await assert.rejects(
				() => update("revoked_at = null, revoked_reason = null"),
				/billing_access_periods_guard: a revocation is final/,
			);
		});
	});

	test("who ended a period is kept while their account exists, and cleared only when it is deleted", async ({
		client,
		assert,
	}) => {
		const { tenant, invoice } = await paidSubscription(
			client,
			"bill-staff-gone",
		);
		const staff = await platformAdmin();
		const service = await billingService();
		await inTenant(tenant, async () =>
			assert.isTrue(
				await service.endAccess(tenant, invoice.id, "chargeback", staff.id),
			),
		);
		await withDbContext({ tenantId: tenant.id }, () =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(
							"update billing_access_periods set revoked_by_user_id = null",
						),
					),
				/billing_access_periods_guard: a revocation is final/,
			),
		);

		await staff.delete();
		const [period] = await accessPeriods(tenant);
		assert.isNull(period.revokedByUserId);
		assert.equal(period.revokedReason, "chargeback");
		assert.isNotNull(period.revokedAt);
	});

	test("staff end a paid period for a refund; anyone else, or another studio's invoice, gets nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, invoice } = await paidSubscription(
			client,
			"bill-refund",
		);
		const other = await paidSubscription(client, "bill-refund-other");
		const admin = await platformAdmin();
		const endAccess = (user: User, invoiceId: string, reason = "refund") =>
			client
				.post("/admin/billing/end-access")
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({ tenantId: tenant.id, invoiceId, reason });

		const before = await client
			.get("/admin/billing")
			.loginAs(admin)
			.withInertia();
		const row = before.inertiaProps.invoices.find(
			(found: { id: string }) => found.id === invoice.id,
		);
		assert.equal(row?.grant, "granted");

		(await endAccess(owner, invoice.id)).assertStatus(404);
		(await endAccess(admin, other.invoice.id)).assertStatus(302);
		assert.isNull((await accessPeriods(other.tenant))[0].revokedAt);
		assert.isNull((await accessPeriods(tenant))[0].revokedAt);

		(await endAccess(admin, invoice.id)).assertStatus(302);
		const [period] = await accessPeriods(tenant);
		assert.equal(period.revokedReason, "refund");
		assert.equal(period.revokedByUserId, admin.id);
		const after = await client
			.get("/admin/billing")
			.loginAs(admin)
			.withInertia();
		assert.equal(
			after.inertiaProps.invoices.find(
				(found: { id: string }) => found.id === invoice.id,
			)?.grant,
			"ended",
		);
	});
});

test.group("Billing: the package state (studio packages)", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the Billing page names the package and its state", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("pkg-page", "Pkg Page");
		const page = await client
			.get(`/t/${tenant.slug}/settings/billing`)
			.loginAs(owner)
			.withInertia();
		page.assertStatus(200);
		assert.equal(page.inertiaProps.package.state, "trial");
		assert.equal(page.inertiaProps.package.name, "Studio");
		assert.equal(
			page.inertiaProps.package.line,
			"Multiple artists working together.",
		);
		assert.match(page.inertiaProps.package.text, /^Studio trial until /);
	});

	test("the admin page shows each studio's package state", async ({
		client,
		assert,
	}) => {
		const { tenant } = await paidSubscription(client, "pkg-admin");
		const page = await client
			.get("/admin/billing")
			.loginAs(await platformAdmin())
			.withInertia();
		page.assertStatus(200);
		const row = page.inertiaProps.studios.find(
			(studio: { tenantId: string }) => studio.tenantId === tenant.id,
		);
		// The page reads the clock and the fake's period is fixed (Nov 2026):
		// compare with the service's own line at the same moment.
		const service = await (
			await import("@adonisjs/core/services/app")
		).default.container.make(EntitlementService);
		const expected = entitlementText(
			await inTenant(tenant, () => service.for(tenant)),
			(at) => formatDay(at.toUTC().toISODate() as string),
		);
		assert.equal(row?.packageText, expected);
		assert.match(row?.packageText ?? "", /^(Studio, |Paused)/);
	});
});
