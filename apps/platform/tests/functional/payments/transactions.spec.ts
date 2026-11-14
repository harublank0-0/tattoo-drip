import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Tenant from "#modules/tenancy/models/tenant";
import { connectStudio } from "#tests/helpers/online_payments";
import { paybridge } from "#tests/helpers/paybridge";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The studio's Transactions page (docs/payments-paybridgenp.md): totals
 * count collected money only, refunds and reversals are adjustments, and
 * only the studio's own records show.
 */

const verified = (at: DateTime, userId: string) => ({
	status: "verified" as const,
	verifiedAt: at,
	verifiedByUserId: userId,
});

/** A studio whose November holds every kind of record. */
async function studioWithMoney(slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, "Black Needle");
	const day = DateTime.fromISO("2026-11-10T06:00:00Z");
	await inTenant(tenant, async () => {
		const client = await makeClient(tenant, { name: "Sita Rai" });
		const project = await makeProject(tenant, client, { status: "booked" });
		const deposit = await makePayment(tenant, project, {
			...verified(day, owner.id),
			method: "esewa",
		});
		await makePayment(tenant, project, {
			...verified(day.plus({ days: 1 }), owner.id),
			kind: "session",
			amount: 500_000,
			method: "cash",
		});
		await makePayment(tenant, project, {
			...verified(day.plus({ days: 2 }), owner.id),
			kind: "refund",
			amount: -100_000,
			method: "cash",
			note: "=SUM(A1)",
		});
		// A mistaken desk entry and its reversal.
		const mistake = await makePayment(tenant, project, {
			...verified(day.plus({ days: 3 }), owner.id),
			kind: "balance",
			amount: 200_000,
			method: "bank",
		});
		await makePayment(tenant, project, {
			...verified(day.plus({ days: 3 }), owner.id),
			kind: "correction",
			amount: -200_000,
			method: "bank",
			correctsPaymentId: mistake.id,
		});
		// Not income: a screenshot waiting and a rejected one.
		await makePayment(tenant, project, { createdAt: day.plus({ days: 4 }) });
		await makePayment(tenant, project, {
			createdAt: day.plus({ days: 4 }),
			status: "rejected",
			verifiedAt: day.plus({ days: 4 }),
			verifiedByUserId: owner.id,
		});
		return deposit;
	});
	return { tenant, owner };
}

const page = (tenant: Tenant, query = "from=2026-11-01&to=2026-11-30") =>
	`/t/${tenant.slug}/transactions?${query}`;

test.group("Transactions", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("totals count collected money; refunds and reversals adjust it; pending is apart", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithMoney("tx-totals");
		const response = await client
			.get(page(tenant))
			.loginAs(owner)
			.withInertia();
		response.assertStatus(200);
		const [npr] = response.inertiaProps.totals;
		assert.deepEqual(npr, {
			currency: "NPR",
			gross: "NPR 10,000",
			refunds: "NPR 1,000",
			reversals: "−NPR 2,000",
			net: "NPR 7,000",
			collectedCount: 3,
			pending: "NPR 3,000",
			started: "NPR 0",
			review: null,
		});
		assert.equal(response.inertiaProps.pagination.total, 7);
		// The daily lines are the studio's days (Kathmandu).
		assert.deepEqual(
			response.inertiaProps.daily.map(
				(d: { day: string; collected: string }) => [d.day, d.collected],
			),
			[
				["2026-11-10", "NPR 3,000"],
				["2026-11-11", "NPR 5,000"],
				["2026-11-12", "NPR 0"],
				["2026-11-13", "NPR 2,000"],
			],
		);
	});

	test("filters by status, provider, type, period and search", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithMoney("tx-filters");
		const rows = async (query: string) =>
			(
				await client
					.get(page(tenant, `from=2026-11-01&to=2026-11-30&${query}`))
					.loginAs(owner)
					.withInertia()
			).inertiaProps.rows as {
				type: string;
				status: string;
				amountText: string;
			}[];
		assert.deepEqual(
			(await rows("status=pending")).map((r) => r.amountText),
			["NPR 3,000"],
		);
		assert.deepEqual(
			(await rows("provider=esewa")).map((r) => r.type),
			["deposit"],
		);
		assert.deepEqual(
			(await rows("type=refund")).map((r) => r.amountText),
			["−NPR 1,000"],
		);
		assert.lengthOf(await rows("q=Sita"), 7);
		assert.lengthOf(await rows("q=nobody"), 0);
		// "All" sends an empty value: no filter, the others still apply.
		// Cash: the session payment, the refund, the waiting and the rejected screenshot.
		assert.lengthOf(await rows("status=&provider=cash"), 4);
		const december = await client
			.get(page(tenant, "from=2026-12-01&to=2026-12-31"))
			.loginAs(owner)
			.withInertia();
		assert.lengthOf(december.inertiaProps.rows, 0);
		assert.deepEqual(december.inertiaProps.totals, []);
	});

	test("the CSV follows the filters and is safe in spreadsheets", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithMoney("tx-csv");
		const response = await client
			.get(
				`/t/${tenant.slug}/transactions/export.csv?from=2026-11-01&to=2026-11-30&type=refund`,
			)
			.loginAs(owner);
		response.assertStatus(200);
		response.assertHeader("cache-control", "private, no-store");
		const lines = response.text().trim().split("\r\n");
		assert.lengthOf(lines, 2);
		assert.include(lines[1], "refund,succeeded,cash,no,-1000.00,NPR");
		assert.include(lines[1], `"'=SUM(A1)"`);
	});

	test("online payments held for review or still open show apart and count nowhere", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithMoney("tx-online");
		const { account } = await connectStudio(tenant, owner.id);
		await inTenant(tenant, async () => {
			const { default: GatewayCheckout } = await import(
				"#modules/payments/models/gateway_checkout"
			);
			const { default: GatewayPayment } = await import(
				"#modules/payments/models/gateway_payment"
			);
			const client = await makeClient(tenant, { name: "Hari" });
			const project = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			const held = await GatewayCheckout.create({
				tenantId: tenant.id,
				accountId: account.id,
				projectId: project.id,
				amount: 300_000,
				currency: "NPR",
				livemode: false,
				idempotencyKey: crypto.randomUUID(),
				providerSessionId: "cs_held",
				status: "open",
				expiresAt: DateTime.utc().plus({ minutes: 20 }),
			});
			await GatewayPayment.create({
				tenantId: tenant.id,
				checkoutId: held.id,
				projectId: project.id,
				providerPaymentId: "pay_held",
				status: "success",
				method: "khalti",
				amount: 299_000,
				currency: "NPR",
				livemode: false,
				reviewReason: "amount_mismatch",
			});
		});
		const today = DateTime.utc().setZone("Asia/Kathmandu").toISODate();
		const response = await client
			.get(page(tenant, `from=2026-11-01&to=${today}`))
			.loginAs(owner)
			.withInertia();
		const [npr] = response.inertiaProps.totals;
		assert.equal(npr.gross, "NPR 10,000");
		assert.equal(npr.review, "NPR 2,990");
		const held = response.inertiaProps.rows.find(
			(r: { status: string }) => r.status === "review",
		);
		assert.match(held.problem, /amount paid differs/);
		assert.isTrue(held.checkable);
	});

	test("another studio's records never show or count; artists can't open the page", async ({
		client,
		assert,
	}) => {
		const a = await studioWithMoney("tx-studio-a");
		const b = await studioWithMoney("tx-studio-b");
		const response = await client
			.get(page(a.tenant))
			.loginAs(a.owner)
			.withInertia();
		assert.equal(response.inertiaProps.pagination.total, 7);
		assert.equal(response.inertiaProps.totals[0].gross, "NPR 10,000");
		(await client.get(page(b.tenant)).loginAs(a.owner)).assertStatus(404);
		const artist = await artistIn(a.tenant, "ink@tx-studio-a.example");
		(await client.get(page(a.tenant)).loginAs(artist)).assertStatus(404);
		(
			await client
				.get(`/t/${a.tenant.slug}/transactions/export.csv`)
				.loginAs(artist)
		).assertStatus(404);
	});
});
