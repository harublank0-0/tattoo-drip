import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import { PackageRuleError } from "#modules/packages/errors";
import type { PackageKey } from "#modules/packages/packages";
import PackageGate from "#modules/packages/services/package_gate";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import { addArtist } from "#tests/helpers/artists";
import { inTenant } from "#tests/helpers/tenants";

/**
 * The package gate (studio packages, phase 2): adding or restoring an
 * active artist is checked against the package's limit and the paused
 * state. Observe mode (the default) only logs; enforce mode refuses.
 */

/** A workspace on `pkg` with its owner (and, when independent, the owner's profile). */
async function workspace(
	slug: string,
	type: "studio" | "independent",
	pkg?: PackageKey,
) {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type,
		name: slug,
		slug,
		timezone: "Asia/Kathmandu",
		...(pkg ? { package: pkg } : {}),
	});
	return { tenant, owner };
}

/** Moves the workspace's creation back so its trial is long over and it is paused. */
const paused = (tenant: Tenant) =>
	inTenant(tenant, () =>
		dbClient().rawQuery("update tenants set created_at = ? where id = ?", [
			"2025-01-01T00:00:00Z",
			tenant.id,
		]),
	);

const gate = () => app.container.make(PackageGate);

const activation = async (tenant: Tenant) =>
	inTenant(tenant, async () => (await gate()).checkArtistActivation(tenant));

test.group("Packages: the package gate", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		env.set("PACKAGE_ENFORCEMENT", undefined as never);
	});

	test("in observe mode nothing is refused: past the limit or paused, the rule is only logged", async ({
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", undefined as never);
		const solo = await workspace("gate-observe", "independent");
		await assert.doesNotReject(() => activation(solo.tenant));

		const late = await workspace("gate-observe-paused", "studio");
		await paused(late.tenant);
		await assert.doesNotReject(() => activation(late.tenant));
	});

	test("in enforce mode a Solo studio with an active artist can't add another", async ({
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { tenant } = await workspace("gate-solo", "independent");

		try {
			await activation(tenant);
			assert.fail("expected a refusal");
		} catch (error) {
			assert.instanceOf(error, PackageRuleError);
			assert.equal((error as PackageRuleError).code, "artist_limit");
			assert.equal(
				(error as PackageRuleError).message,
				"Solo includes one active artist. Archive an artist, or upgrade to Studio.",
			);
		}

		const artists = await app.container.make(ArtistService);
		await inTenant(tenant, async () => {
			const [own] = await artists.list(tenant);
			await artists.archive(tenant, own.id);
		});
		await assert.doesNotReject(() => activation(tenant));
	});

	test("in enforce mode a paused studio can't add an active artist; a Studio trial can add any number", async ({
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const late = await workspace("gate-paused", "studio");
		await paused(late.tenant);
		try {
			await activation(late.tenant);
			assert.fail("expected a refusal");
		} catch (error) {
			assert.instanceOf(error, PackageRuleError);
			assert.equal((error as PackageRuleError).code, "paused");
			assert.equal(
				(error as PackageRuleError).message,
				"Pay for a package to add an active artist.",
			);
		}

		const studio = await workspace("gate-studio", "studio");
		for (const slug of ["asha", "bina", "chet"]) {
			await addArtist(studio.tenant, studio.owner, { name: slug, slug });
		}
		await assert.doesNotReject(() => activation(studio.tenant));
	});

	test("the usage counts active artists against the package's limit", async ({
		assert,
	}) => {
		const solo = await workspace("gate-usage", "independent");
		const extra = await addArtist(solo.tenant, solo.owner, {
			name: "Bina",
			slug: "bina",
		});
		const artists = await app.container.make(ArtistService);
		await inTenant(solo.tenant, () => artists.archive(solo.tenant, extra.id));
		assert.deepEqual(
			await inTenant(solo.tenant, async () =>
				(await gate()).artistUsage(solo.tenant),
			),
			{ active: 1, limit: 1 },
		);

		const studio = await workspace("gate-usage-studio", "studio");
		assert.deepEqual(
			await inTenant(studio.tenant, async () =>
				(await gate()).artistUsage(studio.tenant),
			),
			{ active: 0, limit: null },
		);
	});
});
