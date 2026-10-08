import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";

const tenancy = new TenancyService();

async function ownerWithTenant(slug = "black-needle") {
	const owner = await User.create({
		email: `${slug}@example.com`,
		password: "secret-password",
	});
	const tenant = await tenancy.createTenant(owner, {
		type: "studio",
		name: "Black Needle",
		slug,
		timezone: "Asia/Kathmandu",
	});
	return { owner, tenant };
}

test.group("Soft deletes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("softDelete stamps deletedAt and hides the row from queries", async ({
		assert,
	}) => {
		const { tenant } = await ownerWithTenant();

		await tenant.softDelete();

		assert.isNotNull(tenant.deletedAt);
		assert.isNull(await Tenant.find(tenant.id));
		assert.isNull(await Tenant.query().where("id", tenant.id).first());
	});

	test("withTrashed includes deleted rows; onlyTrashed returns only them", async ({
		assert,
	}) => {
		const { tenant: deleted } = await ownerWithTenant("gone-ink");
		const { tenant: live } = await ownerWithTenant("live-ink");
		await deleted.softDelete();

		const all = await Tenant.withTrashed().whereIn("id", [deleted.id, live.id]);
		const trashed = await Tenant.onlyTrashed().whereIn("id", [
			deleted.id,
			live.id,
		]);

		assert.sameMembers(
			all.map((tenant) => tenant.id),
			[deleted.id, live.id],
		);
		assert.deepEqual(
			trashed.map((tenant) => tenant.id),
			[deleted.id],
		);
	});

	test("restore brings a deleted row back", async ({ assert }) => {
		const { tenant } = await ownerWithTenant();
		await tenant.softDelete();

		await tenant.restore();

		assert.isNull(tenant.deletedAt);
		assert.isNotNull(await Tenant.find(tenant.id));
	});

	test("a removed member can be added back, but never twice at once", async ({
		assert,
	}) => {
		const { owner, tenant } = await ownerWithTenant();
		const membership = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.firstOrFail();

		await membership.softDelete();
		await TenantMembership.create({
			tenantId: tenant.id,
			userId: owner.id,
			role: "artist",
		});

		await assert.rejects(() =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: owner.id,
				role: "owner",
			}),
		);
	});

	test("soft-deleting a tenant soft-deletes its memberships too", async ({
		assert,
	}) => {
		const { tenant } = await ownerWithTenant();

		await tenant.softDelete();

		const live = await TenantMembership.query().where("tenant_id", tenant.id);
		const all = await TenantMembership.withTrashed().where(
			"tenant_id",
			tenant.id,
		);
		assert.lengthOf(live, 0);
		assert.lengthOf(all, 1);
		assert.isNotNull(all[0].deletedAt);
	});

	test("deleting a tenant keeps when earlier members were removed", async ({
		assert,
	}) => {
		const { tenant } = await ownerWithTenant();
		const artistUser = await User.create({
			email: "artist@example.com",
			password: "secret-password",
		});
		const artist = await TenantMembership.create({
			tenantId: tenant.id,
			userId: artistUser.id,
			role: "artist",
		});
		await artist.softDelete();
		const removedAt = artist.deletedAt?.toMillis();

		await new Promise((resolve) => setTimeout(resolve, 20));
		await tenant.softDelete();

		const reloaded = await TenantMembership.withTrashed()
			.where("id", artist.id)
			.firstOrFail();
		assert.equal(reloaded.deletedAt?.toMillis(), removedAt);
	});

	test("tenantsFor skips deleted memberships and deleted tenants", async ({
		assert,
	}) => {
		const { owner, tenant: removedFrom } = await ownerWithTenant("removed");
		const second = await tenancy.createTenant(owner, {
			type: "independent",
			name: "Closed",
			slug: "closed",
			timezone: "Asia/Kathmandu",
		});
		const kept = await tenancy.createTenant(owner, {
			type: "independent",
			name: "Kept",
			slug: "kept",
			timezone: "Asia/Kathmandu",
		});
		const membership = await TenantMembership.query()
			.where("tenant_id", removedFrom.id)
			.firstOrFail();
		await membership.softDelete();
		await second.softDelete();

		const result = await tenancy.tenantsFor(owner);

		assert.deepEqual(
			result.map(({ tenant }) => tenant.slug),
			[kept.slug],
		);
	});
});
