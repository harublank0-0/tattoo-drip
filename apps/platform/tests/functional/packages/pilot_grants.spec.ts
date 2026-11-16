import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import PilotGrantService, {
	PilotGrantError,
} from "#modules/packages/services/pilot_grant_service";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Pilot grants (studio packages, ruling 7): an explicit, temporary package
 * for a pilot studio until its agreed transition date, set by an operator.
 * Dates are relative to `now`, so the tests never age.
 */
test.group("Packages: pilot grants", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const pilots = new PilotGrantService();

	test("a grant runs from now to its date with the package's default bundle", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pilot-a", "Pilot A");
		const now = DateTime.utc().startOf("second");
		const studioBundle = await AllowanceBundle.findByOrFail("key", "studio-v1");

		const grant = await pilots.grant(
			"pilot-a",
			{
				package: "studio",
				endsAt: now.plus({ months: 4 }),
				note: "Design partner",
				grantedBy: "Operator A",
			},
			now,
		);

		assert.equal(grant.tenantId, tenant.id);
		assert.equal(grant.package, "studio");
		assert.equal(grant.allowanceBundleId, studioBundle.id);
		assert.equal(grant.startsAt.toMillis(), now.toMillis());
		assert.equal(grant.endsAt.toMillis(), now.plus({ months: 4 }).toMillis());
		assert.equal(grant.note, "Design partner");
		assert.equal(grant.grantedBy, "Operator A");
	});

	test("a new grant ends the running one, and a grant is visible only to its studio", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pilot-b", "Pilot B");
		const { tenant: other } = await studioWithOwner("pilot-c", "Pilot C");
		const now = DateTime.utc().startOf("second");
		const later = now.plus({ days: 1 });

		await pilots.grant(
			"pilot-b",
			{
				package: "solo",
				endsAt: now.plus({ months: 2 }),
				note: "First",
				grantedBy: "Ops",
			},
			now,
		);
		await pilots.grant(
			"pilot-b",
			{
				package: "studio",
				endsAt: now.plus({ months: 6 }),
				note: "Second",
				grantedBy: "Ops",
			},
			later,
		);

		// Read in each studio's own context, as every tenant read is.
		const grants = await inTenant(tenant, () => pilots.forTenant(tenant));
		assert.deepEqual(
			grants.map((grant) => [
				grant.note,
				grant.startsAt.toMillis(),
				grant.endsAt.toMillis(),
			]),
			[
				["First", now.toMillis(), later.toMillis()],
				["Second", later.toMillis(), now.plus({ months: 6 }).toMillis()],
			],
		);
		assert.deepEqual(await inTenant(other, () => pilots.forTenant(other)), []);
		// Another studio's context sees none of them, whatever it asks for.
		assert.deepEqual(await inTenant(other, () => pilots.forTenant(tenant)), []);
	});

	test("an unknown studio, a past date, an empty note or no operator is refused", async ({
		assert,
	}) => {
		await studioWithOwner("pilot-d", "Pilot D");
		const now = DateTime.utc().startOf("second");
		const valid = {
			package: "studio" as const,
			endsAt: now.plus({ months: 1 }),
			note: "Pilot",
			grantedBy: "Ops",
		};

		await assert.rejects(
			() => pilots.grant("no-such-studio", valid, now),
			PilotGrantError,
		);
		await assert.rejects(
			() =>
				pilots.grant(
					"pilot-d",
					{ ...valid, endsAt: now.minus({ days: 1 }) },
					now,
				),
			PilotGrantError,
		);
		await assert.rejects(
			() => pilots.grant("pilot-d", { ...valid, endsAt: now }, now),
			PilotGrantError,
		);
		for (const note of ["", "   ", "x".repeat(501)]) {
			await assert.rejects(
				() => pilots.grant("pilot-d", { ...valid, note }, now),
				PilotGrantError,
			);
		}
		for (const grantedBy of ["", "   ", "x".repeat(101)]) {
			await assert.rejects(
				() => pilots.grant("pilot-d", { ...valid, grantedBy }, now),
				PilotGrantError,
			);
		}
	});

	test("a grant that would overlap a later one is refused in words, not a database error", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pilot-overlap", "Pilot Overlap");
		const now = DateTime.utc().startOf("second");
		// A grant that starts next week: not running now, so not ended.
		await pilots.grant(
			"pilot-overlap",
			{
				package: "studio",
				endsAt: now.plus({ months: 2 }),
				note: "Later",
				grantedBy: "Ops",
			},
			now.plus({ days: 7 }),
		);

		await assert.rejects(
			() =>
				pilots.grant(
					"pilot-overlap",
					{
						package: "studio",
						endsAt: now.plus({ months: 1 }),
						note: "Now",
						grantedBy: "Ops",
					},
					now,
				),
			"This grant would overlap another of this studio's grants. Check its grants and run it again.",
		);
		assert.lengthOf(await inTenant(tenant, () => pilots.forTenant(tenant)), 1);
	});
});
