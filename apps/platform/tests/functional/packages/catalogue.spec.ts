import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import BillingPlan from "#modules/billing/models/billing_plan";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import { PACKAGES } from "#modules/packages/packages";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { sandboxPlans } from "#tests/helpers/online_payments";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The package catalogue's data (studio packages, phase 1): the versioned
 * allowance bundles, each plan's package and bundle, and the package a new
 * workspace starts its trial on.
 */
test.group("Packages: catalogue", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the seeded bundles exist and can't be changed or removed", async ({
		assert,
	}) => {
		const bundles = await AllowanceBundle.query().orderBy("key");
		assert.deepEqual(
			bundles.map((bundle) => [
				bundle.key,
				bundle.package,
				bundle.imagesPerMonth,
				bundle.storageMegabytes,
				bundle.storageReserveMegabytes,
				bundle.smsPerMonth,
			]),
			[
				["solo-v1", "solo", 40, null, null, null],
				// The storage meter's launch defaults (5 GB and 25 GB).
				["solo-v2", "solo", 40, 5120, null, null],
				["studio-v1", "studio", 40, null, null, null],
				["studio-v2", "studio", 40, 25600, null, null],
			],
		);
		// New trials and grants take v2; existing plans keep v1, which reads v2's storage.
		assert.equal(PACKAGES.solo.defaultBundleKey, "solo-v2");
		assert.equal(PACKAGES.studio.defaultBundleKey, "studio-v2");
		for (const statement of [
			"update allowance_bundles set images_per_month = 41",
			"delete from allowance_bundles",
		]) {
			await assert.rejects(
				() => withTransaction((trx) => trx.rawQuery(statement)),
				/allowance_bundles_guard: bundles are immutable/,
			);
		}
	});

	test("synced and catalogue plans carry their package and bundle", async ({
		assert,
	}) => {
		const studio = await AllowanceBundle.findByOrFail("key", "studio-v1");
		const plans = await sandboxPlans();
		assert.lengthOf(plans, 2);
		for (const plan of plans) {
			const stored = await BillingPlan.findOrFail(plan.id);
			assert.equal(stored.package, "studio");
			assert.equal(stored.allowanceBundleId, studio.id);
		}
	});

	test("a new workspace stores the package its type suggests", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pkg-studio", "Pkg Studio");
		assert.equal(tenant.selectedPackage, "studio");

		const owner = await User.create({
			email: "solo@pkg-solo.example",
			password: "secret-password",
		});
		const solo = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Pkg Solo",
			slug: "pkg-solo",
			timezone: "Asia/Kathmandu",
		});
		await inTenant(solo, () => solo.refresh());
		assert.equal(solo.selectedPackage, "solo");
	});
});
