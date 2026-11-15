import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import BillingService from "#modules/billing/services/billing_service";
import GatewayCheckout from "#modules/payments/models/gateway_checkout";
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import TransactionService from "#modules/payments/services/transaction_service";
import type { TransactionFilters } from "#modules/payments/transactions";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { connectStudio, seedBilling } from "#tests/helpers/online_payments";
import { paybridge } from "#tests/helpers/paybridge";
import { inTenantAs, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The payment and billing services' reads and writes, called the way a
 * request calls them (inTenantAs: one studio's member, that studio's
 * row-level-security context): asked about another studio, by its tenant or
 * by the ids of its records, they find nothing and change nothing. The
 * route-level checks are in tests/isolation; these hold for any caller.
 */

const KTM = "Asia/Kathmandu";

const filters = (): TransactionFilters => ({
	from: DateTime.now().setZone(KTM).minus({ days: 7 }).toISODate() as string,
	to: DateTime.now().setZone(KTM).plus({ days: 1 }).toISODate() as string,
	status: null,
	provider: null,
	type: null,
	q: null,
	page: 1,
});

/**
 * A verified studio with a recorded online deposit (its checkout, gateway
 * payment and ledger row) and a live subscription with an open invoice.
 */
async function studioWithOnlineMoney(client: ApiClient, slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, slug);
	const ready = await inTenantAs(tenant, owner, () => depositReady(tenant));
	const { token } = await inTenantAs(tenant, owner, () =>
		depositServices().links.issue(tenant, OWNER, ready.project),
	);
	const { account } = await connectStudio(tenant, owner.id, { name: slug });
	(
		await client.post(`${depositPath(slug, token)}/checkout`).json({})
	).assertStatus(201);
	// The session this checkout just made: the fake's newest.
	const session = [...paybridge.sessions.values()].at(-1);
	const checkouts = await app.container.make(GatewayCheckoutService);
	const paid = paybridge.pay(session?.id as string);
	const stored = await inTenantAs(tenant, owner, () =>
		checkouts.confirmPayment(tenant, account, paid.id),
	);
	const billing = await seedBilling(tenant);
	return {
		tenant,
		owner,
		account,
		project: ready.project,
		gatewayPayment: stored,
		checkoutId: stored?.checkoutId as string,
		invoice: billing.invoice,
	};
}

test.group("Online payment services: tenant isolation", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		queue.fake();
		return () => queue.restore();
	});

	test("TransactionService sees only the studio's own records, by tenant or by id", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOnlineMoney(client, "iso-tx-a");
		const b = await studioWithOnlineMoney(client, "iso-tx-b");
		const transactions = await app.container.make(TransactionService);
		const asB = <T>(fn: () => Promise<T>) => inTenantAs(b.tenant, b.owner, fn);

		// Positive control: A sees its own deposit, checkout and totals.
		const own = await inTenantAs(a.tenant, a.owner, () =>
			transactions.page(a.tenant, filters(), KTM),
		);
		assert.isAbove(own.total, 0);
		assert.equal(
			await inTenantAs(a.tenant, a.owner, () =>
				transactions.checkoutIdFor(a.tenant, a.checkoutId),
			),
			a.checkoutId,
		);
		const ownTotals = await inTenantAs(a.tenant, a.owner, () =>
			transactions.totals(a.tenant, filters(), KTM),
		);
		assert.isTrue(
			ownTotals.some((row) => row.gross > 0),
			JSON.stringify(ownTotals),
		);
		const ownDaily = await inTenantAs(a.tenant, a.owner, () =>
			transactions.daily(a.tenant, filters(), KTM),
		);
		assert.isTrue(ownDaily.some(({ collected }) => collected > 0));
		assert.isNotEmpty(
			await inTenantAs(a.tenant, a.owner, () =>
				transactions.export(a.tenant, filters(), KTM),
			),
		);

		// B's member, asking for A's records by A's tenant or A's ids.
		const theirs = await asB(() => transactions.page(a.tenant, filters(), KTM));
		assert.equal(theirs.total, 0);
		assert.deepEqual(theirs.rows, []);
		assert.deepEqual(
			await asB(() => transactions.export(a.tenant, filters(), KTM)),
			[],
		);
		const totals = await asB(() =>
			transactions.totals(a.tenant, filters(), KTM),
		);
		assert.isTrue(
			totals.every(
				(row) =>
					row.gross === 0 &&
					row.collectedCount === 0 &&
					row.pending === 0 &&
					row.started === 0,
			),
			JSON.stringify(totals),
		);
		const daily = await asB(() => transactions.daily(a.tenant, filters(), KTM));
		assert.isTrue(
			daily.every(({ collected, refunded }) => !collected && !refunded),
		);
		for (const id of [
			a.checkoutId,
			a.gatewayPayment?.id as string,
			a.gatewayPayment?.paymentId as string,
		]) {
			assert.isNull(
				await asB(() => transactions.checkoutIdFor(a.tenant, id)),
				id,
			);
			// Nor by B's own tenant with A's id.
			assert.isNull(
				await asB(() => transactions.checkoutIdFor(b.tenant, id)),
				id,
			);
		}
		// B's own page holds B's records only.
		const mine = await asB(() => transactions.page(b.tenant, filters(), KTM));
		assert.equal(mine.total, own.total);
		assert.notInclude(
			JSON.stringify(mine.rows),
			a.gatewayPayment?.paymentId as string,
		);
	});

	test("GatewayAccountService and GatewayCheckoutService find nothing of another studio", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOnlineMoney(client, "iso-gw-a");
		const b = await studioWithOnlineMoney(client, "iso-gw-b");
		const accounts = await app.container.make(GatewayAccountService);
		const checkouts = await app.container.make(GatewayCheckoutService);
		const asB = <T>(fn: () => Promise<T>) => inTenantAs(b.tenant, b.owner, fn);

		assert.equal(
			(await inTenantAs(a.tenant, a.owner, () => accounts.current(a.tenant)))
				?.id,
			a.account.id,
		);
		assert.isNull(await asB(() => accounts.current(a.tenant)));
		assert.deepEqual(await asB(() => accounts.availability(a.tenant)), {
			available: false,
			reason: "not_connected",
		});

		// A's checkout, by A's tenant or by B's: not found, and nothing read.
		const reads = paybridge.callsOf("sessions.retrieve").length;
		for (const tenant of [a.tenant, b.tenant] as Tenant[]) {
			await assert.rejects(
				() => asB(() => checkouts.syncCheckout(tenant, a.checkoutId)),
				/Row not found/,
			);
		}
		assert.lengthOf(paybridge.callsOf("sessions.retrieve"), reads);
		const checkout = await inTenantAs(a.tenant, a.owner, () =>
			GatewayCheckout.findOrFail(a.checkoutId),
		);
		assert.equal(checkout.status, "paid");
	});

	test("BillingService reads nothing of another studio's subscription or invoices", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOnlineMoney(client, "iso-bill-a");
		const b = await studioWithOnlineMoney(client, "iso-bill-b");
		const billing = await app.container.make(BillingService);
		const asB = <T>(fn: () => Promise<T>) => inTenantAs(b.tenant, b.owner, fn);

		assert.isNotNull(
			await inTenantAs(a.tenant, a.owner, () =>
				billing.liveSubscription(a.tenant),
			),
		);
		assert.isNull(await asB(() => billing.liveSubscription(a.tenant)));
		assert.isNull(await asB(() => billing.latestSubscription(a.tenant)));
		assert.deepEqual(await asB(() => billing.access(a.tenant)), {
			state: "none",
		});
		// A's invoice, asked for by A's tenant or by B's: not found, nothing read.
		const reads = paybridge.callsOf("invoices.get").length;
		for (const tenant of [a.tenant, b.tenant] as Tenant[]) {
			await assert.rejects(
				() => asB(() => billing.payUrl(tenant, a.invoice.id)),
				/Row not found/,
			);
		}
		assert.lengthOf(paybridge.callsOf("invoices.get"), reads);
		assert.isString(
			await inTenantAs(a.tenant, a.owner, () =>
				billing.payUrl(a.tenant, a.invoice.id),
			),
		);
	});
});
