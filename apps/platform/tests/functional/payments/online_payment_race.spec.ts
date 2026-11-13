import { randomBytes } from "node:crypto";
import app from "@adonisjs/core/services/app";
import { test } from "@japa/runner";
import GatewayCheckout from "#modules/payments/models/gateway_checkout";
import GatewayPayment from "#modules/payments/models/gateway_payment";
import Payment from "#modules/payments/models/payment";
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import { connectStudio } from "#tests/helpers/online_payments";
import { paybridge } from "#tests/helpers/paybridge";
import {
	errorOf,
	forgetStudio,
	heldOpen,
	onItsOwnConnection,
	waitUntilBlocked,
} from "#tests/helpers/races";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Real concurrency (docs/payments-paybridgenp.md): two deliveries of one
 * payment on two connections. Confirming locks the checkout row first, so
 * the second waits for the first to commit and then finds it recorded.
 * The studios are committed and removed again in the teardown.
 */

const slugs: string[] = [];

test.group("Online payments under concurrent delivery", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.teardown(async () => {
		for (const slug of slugs.splice(0)) await forgetStudio(slug);
	});

	test("two deliveries of one payment record it once", async ({ assert }) => {
		const slug = `pay-race-${randomBytes(4).toString("hex")}`;
		slugs.push(slug);
		const { tenant, owner } = await studioWithOwner(slug, "Pay race");
		const services = depositServices();
		const ready = await inTenant(tenant, () => depositReady(tenant));
		const { token } = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, ready.project),
		);
		const { account } = await connectStudio(tenant, owner.id, { name: slug });
		const checkouts = await app.container.make(GatewayCheckoutService);
		await inTenant(tenant, () => checkouts.startDeposit(tenant, token));
		const [session] = [...paybridge.sessions.values()];
		const payment = paybridge.pay(session.id);

		const confirm = () => checkouts.confirmPayment(tenant, account, payment.id);
		const first = heldOpen(tenant, confirm);
		await first.reached;
		const second = await onItsOwnConnection(tenant, confirm);
		assert.isTrue(await waitUntilBlocked(second.pid, second.outcome));
		first.release();
		assert.isUndefined(errorOf(await first.outcome));
		assert.isUndefined(errorOf(await second.outcome));

		const rows = await inTenant(tenant, async () => ({
			ledger: await Payment.query().where("tenant_id", tenant.id),
			online: await GatewayPayment.query().where("tenant_id", tenant.id),
			checkout: await GatewayCheckout.query()
				.where("tenant_id", tenant.id)
				.firstOrFail(),
		}));
		assert.lengthOf(rows.ledger, 1);
		assert.lengthOf(rows.online, 1);
		assert.equal(rows.online[0].paymentId, rows.ledger[0].id);
		assert.equal(rows.checkout.status, "paid");
	});
});
