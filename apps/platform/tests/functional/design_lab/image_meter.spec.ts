import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import DesignUsageService, {
	AllowanceError,
} from "#modules/design_lab/services/design_usage_service";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import PilotGrant from "#modules/packages/models/pilot_grant";
import { formatDay } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import env from "#start/env";
import { seedDesignLab } from "#tests/helpers/design_lab";
import { captureLogs } from "#tests/helpers/logs";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The Design Lab image meter (docs/superpowers/specs/2026-11-16-image-meter-design.md):
 * once enforcement is on, a studio's monthly limit is its package bundle's
 * `images_per_month`; until then DESIGN_LAB_MONTHLY_LIMIT stays in force and
 * the bundle's refusals are only logged. 0 in the setting is the off switch.
 */
test.group("Design Lab image meter", (group) => {
	group.each.setup(async () => {
		const rollback = await testUtils.db().wrapInGlobalTransaction();
		return async () => {
			// env.set also writes process.env, which later specs' child processes
			// inherit: put the defaults back and leave both unset there.
			env.set("DESIGN_LAB_MONTHLY_LIMIT", 40);
			env.set("PACKAGE_ENFORCEMENT", undefined as never);
			delete process.env.DESIGN_LAB_MONTHLY_LIMIT;
			delete process.env.PACKAGE_ENFORCEMENT;
			await rollback();
		};
	});

	const enforce = (on: boolean) =>
		env.set("PACKAGE_ENFORCEMENT", (on ? "enforce" : "observe") as never);
	const setting = (limit: number) => env.set("DESIGN_LAB_MONTHLY_LIMIT", limit);
	const usage = () => app.container.make(DesignUsageService);

	/** A studio whose month holds `settled` settled images (the seed's one included). */
	async function studio(slug: string, settled = 1) {
		const { tenant } = await studioWithOwner(slug, `Studio ${slug}`);
		const artist = await artistIn(tenant, `artist@${slug}.example`);
		const { designGeneration } = await seedDesignLab(tenant, artist);
		if (settled > 1) {
			await inTenant(tenant, () =>
				DesignUsageRecord.create({
					tenantId: tenant.id,
					generationId: designGeneration.id,
					attempt: 2,
					userId: artist.id,
					provider: designGeneration.provider,
					model: designGeneration.model,
					units: settled - 1,
					status: "settled",
					reservedAt: DateTime.utc(),
					settledAt: DateTime.utc(),
				}),
			);
		}
		let next = 10;
		const reserve = async (count: number) =>
			inTenant(tenant, async () =>
				(await usage()).reserve(
					tenant,
					artist.id,
					Array.from({ length: count }, () => ({
						generationId: designGeneration.id,
						attempt: next++,
						provider: designGeneration.provider,
						model: designGeneration.model,
					})),
				),
			);
		const allowance = async () =>
			inTenant(tenant, async () => (await usage()).allowance(tenant));
		return { tenant, reserve, allowance };
	}

	/** A running pilot grant (Solo unless said) on a new bundle of `images` a month. */
	async function soloPilotOn(
		tenant: Tenant,
		key: string,
		images: number | null,
		pkg: "solo" | "studio" = "solo",
	) {
		const bundle = await AllowanceBundle.create({
			key,
			package: pkg,
			imagesPerMonth: images,
		});
		await inTenant(tenant, () =>
			PilotGrant.create({
				tenantId: tenant.id,
				package: pkg,
				allowanceBundleId: bundle.id,
				startsAt: DateTime.utc().minus({ days: 1 }),
				endsAt: DateTime.utc().plus({ months: 2 }),
				note: "Image meter test",
				grantedBy: "Ops",
			}),
		);
	}

	const refusalOf = (promise: Promise<unknown>) =>
		promise.then(
			() => null,
			(error) => error,
		);

	const resetDay = () =>
		formatDay(
			DateTime.utc().startOf("month").plus({ months: 1 }).toISODate() as string,
		);

	test("enforce mode takes the limit from the studio's bundle", async ({
		assert,
	}) => {
		const s = await studio("meter-enforce");
		await soloPilotOn(s.tenant, "test-solo-3", 3);
		enforce(true);
		setting(40);

		const allowance = await s.allowance();
		assert.equal(allowance.limit, 3);
		assert.equal(allowance.packageLimit, 3);
		assert.instanceOf(await refusalOf(s.reserve(3)), AllowanceError);
		assert.isNull(await refusalOf(s.reserve(2)));
	});

	test("observe mode keeps the setting in force", async ({ assert }) => {
		const s = await studio("meter-observe");
		await soloPilotOn(s.tenant, "test-solo-3b", 3);
		enforce(false);
		setting(2);

		const allowance = await s.allowance();
		assert.equal(allowance.limit, 2);
		assert.equal(allowance.packageLimit, 3);
	});

	test("observe mode allows and logs what the bundle would refuse", async ({
		assert,
	}) => {
		const s = await studio("meter-log", 3);
		await soloPilotOn(s.tenant, "test-solo-3c", 3);
		enforce(false);
		setting(50);

		const logs = captureLogs();
		let refused: unknown;
		try {
			refused = await refusalOf(s.reserve(1));
		} finally {
			logs.restore();
		}

		assert.isNull(refused);
		const wouldRefuse = logs
			.everything()
			.filter((call) => call.includes("Package rule would refuse"));
		assert.lengthOf(wouldRefuse, 1);
		assert.containsSubset(wouldRefuse[0][0], {
			tenantId: s.tenant.id,
			rule: "image_allowance",
			packageLimit: 3,
			used: 3,
			requested: 1,
		});
	});

	test("a bundle with no image number falls back to the setting", async ({
		assert,
	}) => {
		const s = await studio("meter-null");
		await soloPilotOn(s.tenant, "test-solo-null", null);
		enforce(true);
		setting(7);

		const allowance = await s.allowance();
		assert.equal(allowance.limit, 7);
		assert.isNull(allowance.packageLimit);
	});

	test("0 in the setting turns generation off in every mode", async ({
		assert,
	}) => {
		const s = await studio("meter-off");
		enforce(true);
		setting(0);

		assert.equal((await s.allowance()).limit, 0);
		assert.instanceOf(await refusalOf(s.reserve(1)), AllowanceError);
	});

	test("the off switch says generation is off and never offers Studio", async ({
		assert,
	}) => {
		const s = await studio("meter-off-words");
		await soloPilotOn(s.tenant, "test-solo-off", 3);
		enforce(true);
		setting(0);
		const off =
			"Design Lab generation is turned off for now. Your designs and history stay available.";

		const refusal = (await refusalOf(s.reserve(1))) as Error;
		assert.equal(refusal.message, off);
		assert.equal((await s.allowance()).limitText, off);
	});

	test("at the limit the page gets the refusal's words; below it, none", async ({
		assert,
	}) => {
		const full = await studio("meter-page-full", 3);
		await soloPilotOn(full.tenant, "test-solo-3e", 3);
		const room = await studio("meter-page-room");
		await soloPilotOn(room.tenant, "test-solo-3f", 3);
		enforce(true);
		setting(40);

		const refusal = (await refusalOf(full.reserve(1))) as Error;
		assert.equal((await full.allowance()).limitText, refusal.message);
		assert.include(refusal.message, "The Studio package includes 40 a month.");
		assert.isNull((await room.allowance()).limitText);
	});

	test("the refusal names the reset date, what still works, and offers Studio only when it gives more", async ({
		assert,
	}) => {
		const words = (limit: number) =>
			`Your studio has used all ${limit} generations for this month. New generations are paused until ${resetDay()}; your designs and history stay available.`;

		const solo = await studio("meter-words", 3);
		await soloPilotOn(solo.tenant, "test-solo-3d", 3);
		enforce(true);
		setting(40);
		const enforced = (await refusalOf(solo.reserve(1))) as Error;
		assert.equal(
			enforced.message,
			`${words(3)} The Studio package includes 40 a month.`,
		);

		// Observe mode: the setting applies to every package, so no offer.
		enforce(false);
		setting(3);
		const observed = (await refusalOf(solo.reserve(1))) as Error;
		assert.equal(observed.message, words(3));

		// A Studio studio at its limit is offered nothing.
		const full = await studio("meter-studio", 3);
		await soloPilotOn(full.tenant, "test-studio-3", 3, "studio");
		enforce(true);
		setting(40);
		const studioRefusal = (await refusalOf(full.reserve(1))) as Error;
		assert.equal(studioRefusal.message, words(3));
	});
});
