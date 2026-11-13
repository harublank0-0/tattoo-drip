import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import GatewayAccount from "#modules/payments/models/gateway_account";
import GatewayCheckout from "#modules/payments/models/gateway_checkout";
import GatewayEvent from "#modules/payments/models/gateway_event";
import GatewayPayment from "#modules/payments/models/gateway_payment";
import GatewayRefund from "#modules/payments/models/gateway_refund";
import Payment from "#modules/payments/models/payment";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { connectStudio } from "#tests/helpers/online_payments";
import { paybridge, sign } from "#tests/helpers/paybridge";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * A client's online deposit through the studio's own (fake) PayBridgeNP
 * project, end to end (docs/payments-paybridgenp.md): the checkout the
 * deposit page starts, the signed webhook that confirms it, and every way
 * a payment must not be recorded.
 */

async function studio(slug: string, { verified = true } = {}) {
	const { tenant, owner } = await studioWithOwner(slug, "Black Needle");
	const services = depositServices();
	const ready = await inTenant(tenant, () => depositReady(tenant));
	const { token } = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	const { key, account } = await connectStudio(tenant, owner.id, {
		verified,
		name: slug,
	});
	return { tenant, owner, token, key, account, project: ready.project };
}

const startCheckout = (client: ApiClient, slug: string, token: string) =>
	client.post(`${depositPath(slug, token)}/checkout`).json({});

const ledger = (tenant: Pick<Tenant, "id">) =>
	inTenant(tenant, () =>
		Payment.query().where("tenant_id", tenant.id).orderBy("created_at"),
	);

/** Sends a signed event to the studio's webhook, with the exact body signed. */
function deliver(
	client: ApiClient,
	key: string,
	event: Record<string, unknown>,
	{ secret, body }: { secret?: string; body?: string } = {},
) {
	const raw = body ?? JSON.stringify(event);
	const endpoint = paybridge.webhookOf(key);
	const path = new URL(endpoint.url).pathname;
	return client
		.post(path)
		.header("content-type", "application/json")
		.header("x-paybridgenp-signature", sign(raw, secret ?? endpoint.secret))
		.unsafeJson(raw);
}

let eventCount = 0;
const event = (type: string, data: Record<string, unknown>) => ({
	id: `evt_test_${++eventCount}_${Date.now()}`,
	type,
	created: Math.floor(Date.now() / 1000),
	livemode: false,
	data,
});

test.group("Online deposits: checkout", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the checkout charges the deposit due from the database, whatever the client sends", async ({
		client,
		assert,
	}) => {
		const { tenant, token, key } = await studio("online-amount");
		const response = await client
			.post(`${depositPath(tenant.slug, token)}/checkout`)
			.json({ amount: 1, currency: "USD" });
		response.assertStatus(201);
		assert.match(
			response.body().data.checkoutUrl,
			/^https:\/\/checkout\.paybridgenp\.com\//,
		);
		const [session] = [...paybridge.sessions.values()];
		assert.equal(session.amount, 300_000);
		assert.equal(session.currency, "NPR");
		assert.equal(session.key, key);
		const checkout = await inTenant(tenant, () =>
			GatewayCheckout.query().firstOrFail(),
		);
		assert.deepInclude(session.metadata, {
			td_checkout_id: checkout.id,
			td_tenant_id: tenant.id,
			td_project_id: checkout.projectId,
			td_purpose: "deposit",
		});
		// The return URL is the studio page's marker, never the link's token.
		assert.equal(
			session.returnUrl,
			`http://${tenant.slug}.localhost:3000/deposit#paid-online`,
		);
		assert.notInclude(session.returnUrl ?? "", token);
		const [create] = paybridge.callsOf("checkout.create");
		assert.equal(create.idempotencyKey, checkout.idempotencyKey);
	});

	test("a second click reuses the open session; a provider failure keeps the key for the retry", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await studio("online-retry");
		paybridge.failNext("checkout.create");
		(await startCheckout(client, tenant.slug, token)).assertStatus(503);
		const pending = await inTenant(tenant, () =>
			GatewayCheckout.query().firstOrFail(),
		);
		assert.equal(pending.status, "creating");

		const first = await startCheckout(client, tenant.slug, token);
		first.assertStatus(201);
		const second = await startCheckout(client, tenant.slug, token);
		second.assertStatus(201);
		assert.equal(second.body().data.checkoutUrl, first.body().data.checkoutUrl);
		const creates = paybridge.callsOf("checkout.create");
		assert.lengthOf(creates, 2);
		assert.equal(creates[0].idempotencyKey, pending.idempotencyKey);
		assert.equal(creates[1].idempotencyKey, pending.idempotencyKey);
		assert.lengthOf(paybridge.sessions, 1);
	});

	test("no online payment for a connection still under review, nor once a screenshot waits", async ({
		client,
		assert,
	}) => {
		const pending = await studio("online-pending", { verified: false });
		const refused = await startCheckout(
			client,
			pending.tenant.slug,
			pending.token,
		);
		refused.assertStatus(409);
		assert.equal(refused.body().error.code, "online_payment_unavailable");
		const page = await client.get(
			depositPath(pending.tenant.slug, pending.token),
		);
		assert.deepEqual(page.body().data.onlinePayment, {
			available: false,
			checkout: null,
		});
		assert.lengthOf(paybridge.callsOf("checkout.create"), 0);
	});

	test("returning from the checkout shows `confirming`; only the signed webhook makes it `paid`", async ({
		client,
		assert,
	}) => {
		const { tenant, token, key, project } = await studio("online-return");
		(await startCheckout(client, tenant.slug, token)).assertStatus(201);
		const [session] = [...paybridge.sessions.values()];
		// The client pays and comes back, with whatever query string.
		const payment = paybridge.pay(session.id);
		const back = await client.get(
			`${depositPath(tenant.slug, token)}?status=success&session_id=${session.id}`,
		);
		assert.equal(back.body().data.onlinePayment.checkout.status, "confirming");
		assert.equal(back.body().data.state, "due");
		assert.lengthOf(await ledger(tenant), 0);

		(
			await deliver(
				client,
				key,
				event("payment.succeeded", { id: payment.id, session_id: session.id }),
			)
		).assertStatus(200);
		const after = await client.get(depositPath(tenant.slug, token));
		assert.equal(after.body().data.onlinePayment.checkout.status, "paid");
		assert.equal(after.body().data.state, "paid");
		const [recorded] = await ledger(tenant);
		assert.equal(recorded.projectId, project.id);
		assert.equal(recorded.kind, "deposit");
		assert.equal(recorded.amount, 300_000);
		assert.equal(recorded.method, "khalti");
		assert.equal(recorded.status, "verified");
		assert.isNull(recorded.verifiedByUserId);
	});
});

test.group("Online deposits: webhooks", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	async function paidSession(client: ApiClient, slug: string) {
		const setup = await studio(slug);
		(await startCheckout(client, setup.tenant.slug, setup.token)).assertStatus(
			201,
		);
		const [session] = [...paybridge.sessions.values()];
		return { ...setup, session };
	}

	test("a bad signature, a stale timestamp or a changed body is refused before anything is read", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(
			client,
			"hook-signature",
		);
		const payment = paybridge.pay(session.id);
		const succeeded = event("payment.succeeded", { id: payment.id });
		(
			await deliver(client, key, succeeded, { secret: "whsec_wrong0000000" })
		).assertStatus(400);
		const raw = JSON.stringify(succeeded);
		const endpoint = paybridge.webhookOf(key);
		const path = new URL(endpoint.url).pathname;
		const stale = sign(
			raw,
			endpoint.secret,
			Math.floor(Date.now() / 1000) - 600,
		);
		(
			await client
				.post(path)
				.header("content-type", "application/json")
				.header("x-paybridgenp-signature", stale)
				.unsafeJson(raw)
		).assertStatus(400);
		// Signed, then changed in transit.
		const tampered = raw.replace(payment.id, "pay_someone_else");
		(
			await client
				.post(path)
				.header("content-type", "application/json")
				.header("x-paybridgenp-signature", sign(raw, endpoint.secret))
				.unsafeJson(tampered)
		).assertStatus(400);
		(
			await client.post(`${path.slice(0, -5)}AAAAA`).unsafeJson("{}")
		).assertStatus(404);
		assert.lengthOf(await ledger(tenant), 0);
		assert.lengthOf(await inTenant(tenant, () => GatewayEvent.all()), 0);
		assert.lengthOf(paybridge.callsOf("payments.retrieve"), 0);
	});

	test("the exact bytes are verified: whitespace and key order the body parser would lose still pass", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(client, "hook-raw");
		const payment = paybridge.pay(session.id);
		const raw = `{ "type": "payment.succeeded",\n  "id": "evt_raw_1", "created": ${Math.floor(Date.now() / 1000)}, "livemode": false,\n  "data": { "id": "${payment.id}", "note": "" } }`;
		(await deliver(client, key, {}, { body: raw })).assertStatus(200);
		assert.lengthOf(await ledger(tenant), 1);
	});

	test("repeated and concurrent deliveries record one payment", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(client, "hook-repeat");
		const payment = paybridge.pay(session.id);
		const succeeded = event("payment.succeeded", { id: payment.id });
		(await deliver(client, key, succeeded)).assertStatus(200);
		(await deliver(client, key, succeeded)).assertStatus(200);
		// Another event about the same payment (a retried delivery with a new id).
		(
			await deliver(client, key, event("payment.succeeded", { id: payment.id }))
		).assertStatus(200);
		assert.lengthOf(await ledger(tenant), 1);
		assert.lengthOf(await inTenant(tenant, () => GatewayPayment.all()), 1);
		assert.lengthOf(await inTenant(tenant, () => GatewayEvent.all()), 2);
	});

	test("a payment that doesn't match its checkout is held for review, never recorded", async ({
		client,
		assert,
	}) => {
		for (const [slug, overrides, reason] of [
			["hook-amount", { amount: 299_000 }, "amount_mismatch"],
			["hook-currency", { currency: "USD" }, "currency_mismatch"],
			["hook-mode", { livemode: true }, "mode_mismatch"],
			["hook-meta", { metadata: { td_checkout_id: "x" } }, "metadata_mismatch"],
			["hook-card", { method: "card" }, "unsupported_method"],
		] as const) {
			paybridge.reset();
			const { tenant, key, session } = await paidSession(client, slug);
			const payment = paybridge.pay(session.id, overrides);
			(
				await deliver(
					client,
					key,
					event("payment.succeeded", { id: payment.id }),
				)
			).assertStatus(200);
			assert.lengthOf(await ledger(tenant), 0, slug);
			const held = await inTenant(tenant, () =>
				GatewayPayment.query().firstOrFail(),
			);
			assert.equal(held.reviewReason, reason, slug);
			assert.isNull(held.paymentId);
		}
	});

	test("a second success for a paid checkout is a duplicate: recorded once, the other held", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(
			client,
			"hook-duplicate",
		);
		const first = paybridge.pay(session.id);
		const second = paybridge.pay(session.id);
		(
			await deliver(client, key, event("payment.succeeded", { id: first.id }))
		).assertStatus(200);
		(
			await deliver(client, key, event("payment.succeeded", { id: second.id }))
		).assertStatus(200);
		assert.lengthOf(await ledger(tenant), 1);
		const held = await inTenant(tenant, () =>
			GatewayPayment.query()
				.where("provider_payment_id", second.id)
				.firstOrFail(),
		);
		assert.equal(held.reviewReason, "duplicate");
	});

	test("a failed payment is kept with its reason and records nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(client, "hook-failed");
		const failed = paybridge.pay(session.id, {
			status: "failed",
			failureReason: "Insufficient balance",
		});
		(
			await deliver(client, key, event("payment.failed", { id: failed.id }))
		).assertStatus(200);
		assert.lengthOf(await ledger(tenant), 0);
		const row = await inTenant(tenant, () =>
			GatewayPayment.query().firstOrFail(),
		);
		assert.equal(row.status, "failed");
		assert.equal(row.failureReason, "Insufficient balance");
	});

	test("refunds PayBridgeNP reports are recorded once each, partial and full", async ({
		client,
		assert,
	}) => {
		const { tenant, key, session } = await paidSession(client, "hook-refund");
		const payment = paybridge.pay(session.id);
		(
			await deliver(client, key, event("payment.succeeded", { id: payment.id }))
		).assertStatus(200);
		const partial = paybridge.refund(payment.id, 100_000);
		const refunded = event("refund.succeeded", {
			id: partial.id,
			paymentId: payment.id,
		});
		(await deliver(client, key, refunded)).assertStatus(200);
		(
			await deliver(client, key, event("payment.refunded", { id: payment.id }))
		).assertStatus(200);
		paybridge.refund(payment.id, 50_000, "requires_action");
		(
			await deliver(client, key, event("payment.refunded", { id: payment.id }))
		).assertStatus(200);
		let rows = await ledger(tenant);
		assert.deepEqual(
			rows.map((row) => [row.kind, row.amount]),
			[
				["deposit", 300_000],
				["refund", -100_000],
			],
		);
		paybridge.refund(payment.id, 200_000);
		(
			await deliver(client, key, event("payment.refunded", { id: payment.id }))
		).assertStatus(200);
		rows = await ledger(tenant);
		assert.deepEqual(
			rows.map((row) => row.amount),
			[300_000, -100_000, -200_000],
		);
		const online = await inTenant(tenant, () =>
			GatewayPayment.query().firstOrFail(),
		);
		assert.equal(online.refundedAmount, 300_000);
		assert.equal(online.status, "refunded");
		assert.lengthOf(await inTenant(tenant, () => GatewayRefund.all()), 3);
	});

	test("a missed webhook is caught by the owner's one-off check", async ({
		client,
		assert,
	}) => {
		const { tenant, owner, session } = await paidSession(client, "hook-missed");
		paybridge.pay(session.id);
		const checkout = await inTenant(tenant, () =>
			GatewayCheckout.query().firstOrFail(),
		);
		const response = await client
			.post(`/t/${tenant.slug}/transactions/${checkout.id}/sync`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0);
		response.assertStatus(302);
		response.assertFlashMessage(
			"success",
			"Checked with PayBridgeNP: the payment is recorded.",
		);
		assert.lengthOf(await ledger(tenant), 1);
		assert.lengthOf(paybridge.callsOf("sessions.retrieve"), 1);
	});

	test("one studio's webhook key and secret never record another studio's payment", async ({
		client,
		assert,
	}) => {
		const a = await paidSession(client, "hook-tenant-a");
		const b = await studio("hook-tenant-b");
		const payment = paybridge.pay(a.session.id);
		// B's endpoint, B's secret, A's payment: B's key can't read it, and the
		// payment names no checkout of B's.
		const response = await deliver(
			client,
			b.key,
			event("payment.succeeded", { id: payment.id }),
		);
		response.assertStatus(500);
		assert.lengthOf(await ledger(a.tenant), 0);
		assert.lengthOf(await ledger(b.tenant), 0);
		const stored = await inTenant(a.tenant, () =>
			GatewayAccount.query().firstOrFail(),
		);
		assert.notInclude(stored.secretKeySealed, a.key);
		assert.notProperty(stored.serialize(), "secretKeySealed");
	});
});
