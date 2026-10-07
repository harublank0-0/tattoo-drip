import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import User from "#models/user";
import { LastOwnerError, SlugTakenError } from "#modules/tenancy/errors";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";

const tenancy = new TenancyService();

function makeUser(email: string) {
	return User.create({ email, password: "secret-password" });
}

function studio(slug: string) {
	return {
		type: "studio" as const,
		name: "Black Needle",
		slug,
		timezone: "Asia/Kathmandu",
	};
}

test.group("TenancyService.createTenant", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates the tenant with its creator as owner", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		assert.equal(tenant.slug, "black-needle");
		assert.equal(tenant.type, "studio");
		const memberships = await TenantMembership.query().where(
			"tenant_id",
			tenant.id,
		);
		assert.lengthOf(memberships, 1);
		assert.equal(memberships[0].userId, owner.id);
		assert.equal(memberships[0].role, "owner");
	});

	test("turns a taken slug into SlugTakenError and creates nothing", async ({
		assert,
	}) => {
		const first = await makeUser("first@example.com");
		const second = await makeUser("second@example.com");
		await tenancy.createTenant(first, studio("black-needle"));

		// Same slug again: what a second signup racing past validation does.
		await assert.rejects(
			() => tenancy.createTenant(second, studio("black-needle")),
			SlugTakenError,
		);

		const secondMemberships = await TenantMembership.query().where(
			"user_id",
			second.id,
		);
		assert.lengthOf(secondMemberships, 0);
	});
});

test.group("TenancyService.tenantsFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists only the user's tenants, with roles, oldest first", async ({
		assert,
	}) => {
		const ada = await makeUser("ada@example.com");
		const ben = await makeUser("ben@example.com");
		const own = await tenancy.createTenant(ada, studio("ada-ink"));
		const other = await tenancy.createTenant(ben, studio("ben-ink"));
		await TenantMembership.create({
			tenantId: other.id,
			userId: ada.id,
			role: "artist",
		});
		await tenancy.createTenant(ben, studio("ben-only"));

		const result = await tenancy.tenantsFor(ada);

		assert.deepEqual(
			result.map(({ tenant, role }) => [tenant.slug, role]),
			[
				[own.slug, "owner"],
				[other.slug, "artist"],
			],
		);
	});
});

test.group("TenancyService.assertKeepsAnOwner", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	async function ownerAndTenant() {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const membership = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.firstOrFail();
		return { tenant, membership };
	}

	test("rejects losing the only owner", async ({ assert }) => {
		const { tenant, membership } = await ownerAndTenant();

		await assert.rejects(
			() =>
				db.transaction((trx) =>
					tenancy.assertKeepsAnOwner(trx, tenant.id, membership.id),
				),
			LastOwnerError,
		);
	});

	test("allows losing an owner when another owner remains", async ({
		assert,
	}) => {
		const { tenant, membership } = await ownerAndTenant();
		const second = await makeUser("second@example.com");
		await TenantMembership.create({
			tenantId: tenant.id,
			userId: second.id,
			role: "owner",
		});

		await assert.doesNotReject(() =>
			db.transaction((trx) =>
				tenancy.assertKeepsAnOwner(trx, tenant.id, membership.id),
			),
		);
	});

	test("allows losing an artist", async ({ assert }) => {
		const { tenant } = await ownerAndTenant();
		const artistUser = await makeUser("artist@example.com");
		const artist = await TenantMembership.create({
			tenantId: tenant.id,
			userId: artistUser.id,
			role: "artist",
		});

		await assert.doesNotReject(() =>
			db.transaction((trx) =>
				tenancy.assertKeepsAnOwner(trx, tenant.id, artist.id),
			),
		);
	});
});
