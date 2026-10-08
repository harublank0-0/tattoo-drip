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

test.group("TenancyService.membershipFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("returns the tenant and membership for a member", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		const found = await tenancy.membershipFor(owner, "black-needle");

		assert.equal(found?.tenant.id, tenant.id);
		assert.equal(found?.membership.userId, owner.id);
		assert.equal(found?.membership.role, "owner");
	});

	test("returns null for every non-member case", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const stranger = await makeUser("stranger@example.com");
		await tenancy.createTenant(stranger, studio("red-ink"));

		assert.isNull(await tenancy.membershipFor(stranger, "black-needle"));
		assert.isNull(await tenancy.membershipFor(owner, "no-such-studio"));
		assert.isNull(await tenancy.membershipFor(owner, "Black-Needle"));

		await tenant.softDelete();
		assert.isNull(await tenancy.membershipFor(owner, "black-needle"));
	});

	test("returns null once the membership is removed", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const artistUser = await makeUser("artist@example.com");
		const artist = await TenantMembership.create({
			tenantId: tenant.id,
			userId: artistUser.id,
			role: "artist",
		});

		await artist.softDelete();

		assert.isNull(await tenancy.membershipFor(artistUser, "black-needle"));
	});
});

test.group("TenancyService.hasTenant", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("is true with a live tenant, false without one", async ({ assert }) => {
		const withTenant = await makeUser("with@example.com");
		const without = await makeUser("without@example.com");
		await tenancy.createTenant(withTenant, studio("black-needle"));

		assert.isTrue(await tenancy.hasTenant(withTenant));
		assert.isFalse(await tenancy.hasTenant(without));
	});

	test("is false once the user's only tenant is deleted", async ({
		assert,
	}) => {
		const user = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(user, studio("black-needle"));

		await tenant.softDelete();

		assert.isFalse(await tenancy.hasTenant(user));
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

	test("rejects a membership id from another tenant", async ({ assert }) => {
		const { tenant } = await ownerAndTenant();
		const stranger = await makeUser("stranger@example.com");
		const otherTenant = await tenancy.createTenant(
			stranger,
			studio("other-ink"),
		);
		const otherMembership = await TenantMembership.query()
			.where("tenant_id", otherTenant.id)
			.firstOrFail();

		// A caller bug: the id doesn't belong to this tenant. The guard must
		// not wave the change through.
		await assert.rejects(
			() =>
				db.transaction((trx) =>
					tenancy.assertKeepsAnOwner(trx, tenant.id, otherMembership.id),
				),
			/not a live membership/,
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
