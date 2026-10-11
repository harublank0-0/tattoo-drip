import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { inTenant, inTenantAs } from "#tests/helpers/tenants";

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

		await inTenant(tenant, async () => {
			await tenant.softDelete();

			assert.isNotNull(tenant.deletedAt);
			assert.isNull(await Tenant.find(tenant.id));
			assert.isNull(await Tenant.query().where("id", tenant.id).first());
			// The row is still visible to this context: only the soft-delete
			// filter hides it, so the checks above do not pass for lack of access.
			assert.isNotNull(
				await Tenant.withTrashed().where("id", tenant.id).first(),
			);
		});
	});

	test("withTrashed includes deleted rows; onlyTrashed returns only them", async ({
		assert,
	}) => {
		const { tenant: deleted } = await ownerWithTenant("gone-ink");
		const { tenant: live } = await ownerWithTenant("live-ink");
		await inTenant(deleted, () => deleted.softDelete());

		// One tenant is visible per context, so each is read in its own.
		await inTenant(deleted, async () => {
			const all = await Tenant.withTrashed().where("id", deleted.id);
			const trashed = await Tenant.onlyTrashed().where("id", deleted.id);
			assert.deepEqual(
				all.map((tenant) => tenant.id),
				[deleted.id],
			);
			assert.deepEqual(
				trashed.map((tenant) => tenant.id),
				[deleted.id],
			);
		});
		await inTenant(live, async () => {
			const all = await Tenant.withTrashed().where("id", live.id);
			const trashed = await Tenant.onlyTrashed().where("id", live.id);
			assert.deepEqual(
				all.map((tenant) => tenant.id),
				[live.id],
				"visible to this context",
			);
			assert.lengthOf(trashed, 0, "but not deleted, so not in onlyTrashed");
		});
	});

	test("restore brings a deleted row back", async ({ assert }) => {
		const { tenant } = await ownerWithTenant();

		await inTenant(tenant, async () => {
			await tenant.softDelete();

			await tenant.restore();

			assert.isNull(tenant.deletedAt);
			assert.isNotNull(await Tenant.find(tenant.id));
		});
	});

	test("a removed member can be added back, but never twice at once", async ({
		assert,
	}) => {
		const { owner, tenant } = await ownerWithTenant();
		await inTenant(tenant, async () => {
			const membership = await TenantMembership.query()
				.where("tenant_id", tenant.id)
				.firstOrFail();

			await membership.softDelete();
			await TenantMembership.create({
				tenantId: tenant.id,
				userId: owner.id,
				role: "artist",
			});
		});

		// Its own context, so the failed insert rolls back only itself. The
		// message check keeps a policy refusal from passing for the unique index.
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					TenantMembership.create({
						tenantId: tenant.id,
						userId: owner.id,
						role: "owner",
					}),
				),
			/duplicate key value violates unique constraint/,
		);
	});

	test("soft-deleting a tenant soft-deletes its memberships too", async ({
		assert,
	}) => {
		const { tenant } = await ownerWithTenant();

		await inTenant(tenant, async () => {
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
	});

	test("deleting a tenant keeps when earlier members were removed", async ({
		assert,
	}) => {
		const { tenant } = await ownerWithTenant();
		const artistUser = await User.create({
			email: "artist@example.com",
			password: "secret-password",
		});

		await inTenant(tenant, async () => {
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
		await inTenant(removedFrom, async () => {
			const membership = await TenantMembership.query()
				.where("tenant_id", removedFrom.id)
				.firstOrFail();
			await membership.softDelete();
		});
		await inTenant(second, () => second.softDelete());

		// From inside the studio the owner was removed from: the removed
		// membership and its live tenant are both visible there, so only the
		// membership soft-delete scope keeps the studio out of the list.
		const result = await inTenantAs(removedFrom, owner, () =>
			tenancy.tenantsFor(owner),
		);

		assert.deepEqual(
			result.map(({ tenant }) => tenant.slug),
			[kept.slug],
		);
	});
});
