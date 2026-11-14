import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type { SendMailPayload } from "#jobs/send_mail_job";
import StaffAlert from "#modules/notifications/models/staff_alert";
import OnlinePaymentAlertJob from "#modules/payments/jobs/online_payment_alert_job";
import type GatewayAccount from "#modules/payments/models/gateway_account";
import GatewayRefund from "#modules/payments/models/gateway_refund";
import Payment from "#modules/payments/models/payment";
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import PaymentService from "#modules/payments/services/payment_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { connectStudio } from "#tests/helpers/online_payments";
import { paybridge } from "#tests/helpers/paybridge";
import { makeArtist } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Who hears about a client's online payment: the studio's staff when it is
 * recorded as a deposit or held for review, and TattooDrip's platform admins
 * when a studio connects its PayBridgeNP project. And the Payments card's
 * words for a row PayBridgeNP made.
 */

type Fake = ReturnType<typeof queue.fake>;

/** The emails the fake queue holds, rendered as the worker would get them. */
const mails = (fake: Fake) =>
	fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => (job.payload as SendMailPayload).mailMessage);

const alertJobs = (fake: Fake) =>
	fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "OnlinePaymentAlertJob");

/** Runs the alert job the way the worker does. */
async function runAlertJob(payload: {
	tenantId: string;
	gatewayPaymentId: string;
}) {
	const job = new OnlinePaymentAlertJob();
	job.$hydrate(payload, {
		jobId: "online-payment-alert-spec",
		name: "OnlinePaymentAlertJob",
		attempt: 1,
		queue: "default",
		priority: 0,
		acquiredAt: new Date(),
		stalledCount: 0,
	});
	await job.execute();
}

/**
 * A verified studio whose deposit_pending project is Asha's (an artist
 * member), with an online checkout started from the deposit page.
 */
async function checkoutOf(client: ApiClient, slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, "Black Needle");
	const asha = await artistIn(tenant, `asha@${slug}.example`);
	const ready = await inTenant(tenant, () => depositReady(tenant));
	await inTenant(tenant, async () => {
		const profile = await makeArtist(tenant, `asha-${slug}`);
		profile.userId = asha.id;
		await profile.save();
		await TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", ready.project.id)
			.update({ artist_id: profile.id });
	});
	const { token } = await inTenant(tenant, () =>
		depositServices().links.issue(tenant, OWNER, ready.project),
	);
	const { account } = await connectStudio(tenant, owner.id, { name: slug });
	(
		await client.post(`${depositPath(slug, token)}/checkout`).json({})
	).assertStatus(201);
	const [session] = [...paybridge.sessions.values()];
	return { tenant, owner, asha, account, project: ready.project, session };
}

const confirm = async (
	tenant: Tenant,
	account: GatewayAccount,
	providerPaymentId: string,
) => {
	const checkouts = await app.container.make(GatewayCheckoutService);
	return inTenant(tenant, () =>
		checkouts.confirmPayment(tenant, account, providerPaymentId),
	);
};

const alertsOf = (tenant: Tenant) =>
	inTenant(tenant, () =>
		StaffAlert.query().where("tenant_id", tenant.id).orderBy("user_id"),
	);

test.group("Online payments: staff alerts", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a recorded deposit queues one alert, for the owners and the project's artist, once", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, asha, account, project, session } = await checkoutOf(
			client,
			"online-alert-paid",
		);
		const fake = queue.fake();
		const paid = paybridge.pay(session.id);

		const stored = await confirm(tenant, account, paid.id);
		assert.isNotNull(stored?.paymentId);
		// A second delivery of the same payment decides nothing new.
		await confirm(tenant, account, paid.id);
		const jobs = alertJobs(fake);
		assert.lengthOf(jobs, 1);
		const payload = {
			tenantId: tenant.id,
			gatewayPaymentId: stored?.id as string,
		};
		assert.deepEqual(jobs[0].job.payload, payload);

		await runAlertJob(payload);
		await runAlertJob(payload);
		const alerts = await alertsOf(tenant);
		assert.sameMembers(
			alerts.map(({ userId }) => userId),
			[owner.id, asha.id],
		);
		for (const alert of alerts) {
			assert.equal(alert.kind, "online_deposit");
			assert.equal(alert.projectId, project.id);
			assert.equal(alert.gatewayPaymentId, stored?.id);
			assert.isNull(alert.paymentId);
		}

		const sent = mails(fake);
		assert.sameMembers(
			sent.map(({ message }) => String(message.to?.[0])),
			[owner.email, asha.email],
		);
		for (const { message, views } of sent) {
			assert.equal(message.subject, "Deposit paid online for Black Needle");
			assert.include(
				String(views.html?.data?.url),
				`/t/${tenant.slug}/projects/${project.id}#payments`,
			);
			assert.isFalse(views.html?.data?.held);
		}
		const toAsha = sent.find(({ message }) => message.to?.[0] === asha.email);
		assert.equal(
			toAsha?.views.html?.data?.intro,
			"Sita paid Black Needle's deposit online, for your project.",
		);
		// Never PayBridgeNP's ids or the amount.
		const everything = JSON.stringify(sent);
		for (const secret of [paid.id, String(paid.providerRef), "3,000"]) {
			assert.notInclude(everything, secret, secret);
		}
	});

	test("a payment held for review alerts the owners only, at Transactions", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, account, session } = await checkoutOf(
			client,
			"online-alert-held",
		);
		const fake = queue.fake();
		const paid = paybridge.pay(session.id, { amount: 299_000 });

		const stored = await confirm(tenant, account, paid.id);
		assert.equal(stored?.reviewReason, "amount_mismatch");
		const [{ job }] = alertJobs(fake);
		await runAlertJob(
			job.payload as { tenantId: string; gatewayPaymentId: string },
		);

		const alerts = await alertsOf(tenant);
		assert.deepEqual(
			alerts.map(({ userId, kind }) => ({ userId, kind })),
			[{ userId: owner.id, kind: "online_review" }],
		);
		const [mail] = mails(fake);
		assert.lengthOf(mails(fake), 1);
		assert.equal(mail.message.to?.[0], owner.email);
		assert.equal(
			mail.message.subject,
			"Online payment to check for Black Needle",
		);
		assert.isTrue(mail.views.html?.data?.held);
		assert.match(
			String(mail.views.html?.data?.url),
			new RegExp(`/t/${tenant.slug}/transactions$`),
		);
	});

	test("a failed payment, or one neither recorded nor held, alerts nobody", async ({
		client,
		assert,
	}) => {
		const { tenant, account, session } = await checkoutOf(
			client,
			"online-alert-failed",
		);
		const fake = queue.fake();
		const failed = paybridge.pay(session.id, {
			status: "failed",
			failureReason: "Declined",
		});
		const stored = await confirm(tenant, account, failed.id);
		assert.lengthOf(alertJobs(fake), 0);
		// The job on its own still does nothing for it.
		await runAlertJob({
			tenantId: tenant.id,
			gatewayPaymentId: stored?.id as string,
		});
		assert.lengthOf(await alertsOf(tenant), 0);
		assert.lengthOf(mails(fake), 0);
	});

	test("another studio's id alerts nobody", async ({ client, assert }) => {
		const a = await checkoutOf(client, "online-alert-a");
		const { tenant: other } = await studioWithOwner("online-alert-b");
		const fake = queue.fake();
		const stored = await confirm(
			a.tenant,
			a.account,
			paybridge.pay(a.session.id).id,
		);
		await runAlertJob({
			tenantId: other.id,
			gatewayPaymentId: stored?.id as string,
		});
		assert.lengthOf(await alertsOf(other), 0);
		assert.lengthOf(await alertsOf(a.tenant), 0);
		assert.lengthOf(mails(fake), 0);
		// Positive control: the same id under its own studio does alert.
		await runAlertJob({
			tenantId: a.tenant.id,
			gatewayPaymentId: stored?.id as string,
		});
		assert.lengthOf(await alertsOf(a.tenant), 2);
		assert.lengthOf(await alertsOf(other), 0);
	});

	test("a duplicate payment is held: the owners hear of it once", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, account, session } = await checkoutOf(
			client,
			"online-alert-duplicate",
		);
		const fake = queue.fake();
		const first = paybridge.pay(session.id);
		const second = paybridge.pay(session.id);
		await confirm(tenant, account, first.id);
		const held = await confirm(tenant, account, second.id);
		assert.equal(held?.reviewReason, "duplicate");
		for (const { job } of alertJobs(fake)) {
			await runAlertJob(
				job.payload as { tenantId: string; gatewayPaymentId: string },
			);
		}
		const review = (await alertsOf(tenant)).filter(
			({ kind }) => kind === "online_review",
		);
		assert.deepEqual(
			review.map(({ userId, gatewayPaymentId }) => ({
				userId,
				gatewayPaymentId,
			})),
			[{ userId: owner.id, gatewayPaymentId: held?.id as string }],
		);
	});

	test("a recorded deposit whose project was deleted before the job ran alerts nobody", async ({
		client,
		assert,
	}) => {
		const { tenant, account, project, session } = await checkoutOf(
			client,
			"online-alert-gone",
		);
		const fake = queue.fake();
		const stored = await confirm(tenant, account, paybridge.pay(session.id).id);
		assert.isNotNull(stored?.paymentId);
		await inTenant(tenant, () =>
			TattooProject.query()
				.where("tenant_id", tenant.id)
				.where("id", project.id)
				.update({ deleted_at: new Date() }),
		);
		await runAlertJob({
			tenantId: tenant.id,
			gatewayPaymentId: stored?.id as string,
		});
		assert.lengthOf(await alertsOf(tenant), 0);
		assert.lengthOf(mails(fake), 0);
	});
});

test.group("Online payments: platform admins", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new connection emails each platform admin, never the key", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner(
			"online-admin-mail",
			"Black Needle",
		);
		const fake = queue.fake();
		const { key, account } = await connectStudio(tenant, owner.id, {
			verified: false,
			name: "online-admin-mail",
		});

		const sent = mails(fake);
		assert.lengthOf(sent, 1);
		const [{ message, views }] = sent;
		assert.equal(message.to?.[0], "admin@platform.example");
		assert.equal(message.subject, "Studio payment connection to verify");
		assert.deepInclude(views.html?.data, {
			studioSlug: "online-admin-mail",
			mode: "sandbox",
		});
		assert.match(String(views.html?.data?.url), /\/admin\/payments$/);
		// Never the key, nor free text a mail client could make a link of.
		const everything = JSON.stringify(sent);
		for (const secret of [
			key,
			account.keyHint,
			account.webhookKey,
			account.providerMerchantName,
			account.providerProjectName,
			"Black Needle",
		]) {
			assert.notInclude(everything, secret, secret);
		}
	});

	test("reconnecting the same project while it waits emails the admins once; a new project or a decided one emails again", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("online-admin-again");
		const accounts = await app.container.make(GatewayAccountService);
		const fake = queue.fake();
		const key = paybridge.studioKey("online-admin-again");
		const connect = (secret: string) =>
			inTenant(tenant, () => accounts.connect(tenant, owner.id, secret));

		await connect(key);
		await connect(key);
		await connect(key);
		assert.lengthOf(mails(fake), 1);

		const other = await connect(paybridge.studioKey("online-admin-other"));
		assert.lengthOf(mails(fake), 2);

		await inTenant(tenant, () =>
			accounts.review(tenant, other.id, owner.id, "suspend"),
		);
		await connect(key);
		assert.lengthOf(mails(fake), 3);
	});
});

test.group("Online payments: the Payments card", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("PaymentService.onlineIds: the deposits and refunds PayBridgeNP made, this studio's only", async ({
		client,
		assert,
	}) => {
		const { tenant, account, project, session } = await checkoutOf(
			client,
			"online-card-ids",
		);
		const { tenant: other } = await studioWithOwner("online-card-other");
		queue.fake();
		const paid = paybridge.pay(session.id);
		const stored = await confirm(tenant, account, paid.id);
		paybridge.refund(paid.id, 100_000);
		const checkouts = await app.container.make(GatewayCheckoutService);
		await inTenant(tenant, () =>
			checkouts.recordRefunds(tenant, account, paid.id),
		);
		const refund = await inTenant(tenant, () =>
			GatewayRefund.query()
				.where("gateway_payment_id", stored?.id as string)
				.firstOrFail(),
		);
		const payments = await app.container.make(PaymentService);

		const ledger = await inTenant(tenant, () =>
			Payment.query().where("project_id", project.id),
		);
		const ledgerIds = ledger.map(({ id }) => id);
		assert.lengthOf(ledgerIds, 2);
		const ids = await inTenant(tenant, () =>
			payments.onlineIds(tenant, ledgerIds),
		);
		assert.sameMembers(
			[...ids],
			[stored?.paymentId as string, refund.paymentId as string],
		);
		assert.equal((await payments.onlineIds(tenant, [])).size, 0);
		// Asked from another studio's context, or for another studio: nothing.
		assert.equal(
			(await inTenant(other, () => payments.onlineIds(tenant, ledgerIds))).size,
			0,
		);
		assert.equal(
			(await inTenant(tenant, () => payments.onlineIds(other, ledgerIds))).size,
			0,
		);
	});
});
