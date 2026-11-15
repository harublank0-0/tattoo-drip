import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import BillingInvoice from "#modules/billing/models/billing_invoice";
import BillingService from "#modules/billing/services/billing_service";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import EntitlementService from "#modules/packages/services/entitlement_service";
import PilotGrantService from "#modules/packages/services/pilot_grant_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { sandboxPlans, seedBilling } from "#tests/helpers/online_payments";
import { paybridge } from "#tests/helpers/paybridge";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * EntitlementService (studio packages, phase 1): each studio's package state
 * from its paid coverage in the active billing mode, its pilot grants and
 * its trial.
 */

const entitlementOf = async (tenant: Tenant, at?: DateTime) =>
	inTenant(tenant, async () =>
		(await app.container.make(EntitlementService)).for(tenant, at),
	);

/** A studio subscribed and paid through the fake PayBridgeNP (sandbox). */
async function paidStudio(slug: string) {
	await sandboxPlans();
	const { tenant, owner } = await studioWithOwner(slug, "Paid Studio");
	const billing = await app.container.make(BillingService);
	await inTenant(tenant, () =>
		billing.subscribe(
			tenant,
			{ userId: owner.id, email: owner.email },
			"studio-monthly",
		),
	);
	const invoice = await inTenant(tenant, () =>
		BillingInvoice.query().firstOrFail(),
	);
	paybridge.payInvoice(invoice.providerInvoiceId);
	await inTenant(tenant, () => billing.syncTenant(tenant));
	return tenant;
}

/** Moves the workspace's creation long before its trial could still run. */
const createdLongAgo = (tenant: Tenant) =>
	inTenant(tenant, () =>
		dbClient().rawQuery("update tenants set created_at = ? where id = ?", [
			"2025-01-01T00:00:00Z",
			tenant.id,
		]),
	);

const NOV_15 = DateTime.fromISO("2026-11-15T00:00:00Z", { zone: "utc" });

test.group("Packages: EntitlementService", (group) => {
	group.each.setup(() => paybridge.reset());
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new studio is on trial with the package it chose", async ({
		assert,
	}) => {
		const owner = await User.create({
			email: "solo@ent-trial.example",
			password: "secret-password",
		});
		const tenant = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Ent Trial",
			slug: "ent-trial",
			timezone: "Asia/Kathmandu",
		});
		await inTenant(tenant, () => tenant.refresh());
		const solo = await AllowanceBundle.findByOrFail("key", "solo-v1");

		const entitlement = await entitlementOf(tenant);
		assert.equal(entitlement.state, "trial");
		assert.equal(entitlement.package, "solo");
		assert.equal(entitlement.bundleId, solo.id);
		assert.equal(
			entitlement.until?.toMillis(),
			tenant.createdAt.plus({ days: 14 }).toMillis(),
		);
	});

	// The admin page loads each studio once and passes it in, so the service
	// doesn't read the tenant again per studio.
	test("forLoaded resolves from the studio it is given, without reading it again", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("ent-loaded", "Ent Loaded");
		const loaded = await inTenant(tenant, async () => {
			await tenant.refresh();
			return tenant;
		});
		await createdLongAgo(tenant);
		const service = await app.container.make(EntitlementService);

		// Read again, the studio is long past its trial; as given, it is new.
		assert.equal(
			(await inTenant(tenant, () => service.for(tenant))).state,
			"paused",
		);
		assert.equal(
			(await inTenant(tenant, () => service.forLoaded(loaded))).state,
			"trial",
		);
	});

	test("a workspace with no package on record trials the one its type suggests", async ({
		assert,
	}) => {
		const owner = await User.create({
			email: "solo@ent-unchosen.example",
			password: "secret-password",
		});
		const tenant = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Ent Unchosen",
			slug: "ent-unchosen",
			timezone: "Asia/Kathmandu",
			package: "studio",
		});
		// Rows written without one (fixtures, a raw insert) have none.
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set selected_package = null where id = ?",
				[tenant.id],
			),
		);

		const entitlement = await entitlementOf(tenant);
		assert.equal(entitlement.state, "trial");
		assert.equal(entitlement.package, "solo");
	});

	test("a paid invoice makes the studio paid on Studio", async ({ assert }) => {
		const tenant = await paidStudio("ent-paid");
		const studio = await AllowanceBundle.findByOrFail("key", "studio-v1");

		const entitlement = await entitlementOf(tenant, NOV_15);
		assert.equal(entitlement.state, "paid");
		assert.equal(entitlement.package, "studio");
		assert.equal(entitlement.bundleId, studio.id);
		assert.equal(
			entitlement.until?.toUTC().toISO(),
			"2026-12-01T00:00:00.000Z",
		);
	});

	test("a period without a plan counts as Studio", async ({ assert }) => {
		const { tenant } = await studioWithOwner("ent-legacy", "Ent Legacy");
		await seedBilling(tenant);
		const now = DateTime.utc().startOf("second");
		await inTenant(tenant, async () => {
			const invoice = await BillingInvoice.query().firstOrFail();
			await dbClient().rawQuery(
				`insert into billing_access_periods (tenant_id, invoice_id, livemode, starts_at, ends_at, created_at)
				 values (?, ?, false, ?, ?, now())`,
				[
					tenant.id,
					invoice.id,
					now.minus({ days: 1 }).toISO() as string,
					now.plus({ days: 20 }).toISO() as string,
				],
			);
		});
		const studio = await AllowanceBundle.findByOrFail("key", "studio-v1");

		const entitlement = await entitlementOf(tenant, now);
		assert.equal(entitlement.state, "paid");
		assert.equal(entitlement.package, "studio");
		assert.equal(entitlement.bundleId, studio.id);
	});

	test("sandbox periods don't count once billing runs live, and no key means no paid coverage", async ({
		assert,
	}) => {
		const tenant = await paidStudio("ent-modes");
		await createdLongAgo(tenant);
		assert.equal((await entitlementOf(tenant, NOV_15)).state, "paid");

		paybridge.platformMode = "live";
		assert.equal((await entitlementOf(tenant, NOV_15)).state, "paused");

		paybridge.platformEnabled = false;
		const unconfigured = await entitlementOf(tenant, NOV_15);
		assert.equal(unconfigured.state, "paused");
		assert.equal(unconfigured.package, "studio");
	});

	test("a pilot grant applies", async ({ assert }) => {
		const { tenant } = await studioWithOwner("ent-pilot", "Ent Pilot");
		await createdLongAgo(tenant);
		const now = DateTime.utc().startOf("second");
		await new PilotGrantService().grant(
			"ent-pilot",
			{
				package: "studio",
				endsAt: now.plus({ months: 4 }),
				note: "Pilot",
				grantedBy: "Ops",
			},
			now,
		);

		const entitlement = await entitlementOf(tenant, now.plus({ minutes: 1 }));
		assert.equal(entitlement.state, "pilot");
		assert.equal(entitlement.package, "studio");
		assert.equal(
			entitlement.until?.toMillis(),
			now.plus({ months: 4 }).toMillis(),
		);
	});
});
