import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import { withTransaction } from "#services/db_context";
import { sandboxPlans } from "#tests/helpers/online_payments";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The database's own package rules (studio packages): at most one pilot
 * grant runs at a time for a studio, and a plan or a grant names a bundle
 * of its own package.
 */
test.group("Packages: database rules", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const grant = (
		tenantId: string,
		bundleId: string,
		pkg: string,
		from: DateTime,
		to: DateTime,
	) =>
		withTransaction((trx) =>
			trx.rawQuery(
				`insert into pilot_grants (tenant_id, package, allowance_bundle_id, starts_at, ends_at, note, granted_by, created_at)
				 values (?, ?, ?, ?, ?, 'Spec', 'Ops', now())`,
				[tenantId, pkg, bundleId, from.toJSDate(), to.toJSDate()],
			),
		);

	test("two grants can't run at once for a studio; back to back is fine", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("rules-overlap", "Overlap");
		const studio = await AllowanceBundle.findByOrFail("key", "studio-v1");
		const t0 = DateTime.utc().startOf("second");

		await inTenant(tenant, async () => {
			await grant(tenant.id, studio.id, "studio", t0, t0.plus({ months: 1 }));
			await assert.rejects(
				() =>
					grant(
						tenant.id,
						studio.id,
						"studio",
						t0.plus({ days: 3 }),
						t0.plus({ months: 2 }),
					),
				/pilot_grants_one_running/,
			);
			// Half-open: one ending at t1 and the next starting at t1 don't overlap.
			await grant(
				tenant.id,
				studio.id,
				"studio",
				t0.plus({ months: 1 }),
				t0.plus({ months: 2 }),
			);
		});
	});

	test("a grant or a plan must name a bundle of its own package", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("rules-bundle", "Bundle");
		const solo = await AllowanceBundle.findByOrFail("key", "solo-v1");
		const t0 = DateTime.utc().startOf("second");

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => grant(tenant.id, solo.id, "studio", t0, t0.plus({ months: 1 })),
				/pilot_grants_bundle_package/,
			);
		});
		await sandboxPlans();
		await assert.rejects(
			() =>
				sql(
					{},
					"update billing_plans set package = 'solo' where package = 'studio' and allowance_bundle_id is not null",
				),
			/billing_plans_bundle_package/,
		);
	});
});
