import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import { LastOwnerError, MemberRuleError } from "#modules/tenancy/errors";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import MemberService from "#modules/tenancy/services/member_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const members = new MemberService(
	new TenancyService(),
	new ArtistService(new ImageService()),
);

const membershipOf = (tenant: Tenant, userId: string) =>
	inTenant(tenant, () =>
		TenantMembership.withTrashed()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.firstOrFail(),
	);

test.group("MemberService (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("remove soft-deletes the membership and unlinks the member's profile; its projects stay", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("remove-33", "Remove 33");
		const member = await artistIn(tenant, "asha@remove-33.example");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const project = await inTenant(tenant, async () => {
			await Artist.query().where("id", asha.id).update({ user_id: member.id });
			return makeProject(tenant, await makeClient(tenant), {
				artistId: asha.id,
			});
		});
		const target = await membershipOf(tenant, member.id);

		const removed = await inTenant(tenant, () =>
			members.remove(tenant, { userId: owner.id }, target.id),
		);

		assert.deepEqual(removed, { name: "asha@remove-33.example" });
		assert.isNotNull((await membershipOf(tenant, member.id)).deletedAt);
		await inTenant(tenant, async () => {
			assert.isNull((await Artist.findOrFail(asha.id)).userId);
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				asha.id,
			);
		});
	});

	test("the last owner can't be removed or demoted", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("last-33", "Last 33");
		const member = await artistIn(tenant, "asha@last-33.example");
		const ownerRow = await membershipOf(tenant, owner.id);
		// The service doesn't check who acts (the route does): here an
		// artist's id stands for an actor who isn't the target.
		const actor = { userId: member.id };

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => members.remove(tenant, actor, ownerRow.id),
				LastOwnerError,
			);
			await assert.rejects(
				() => members.changeRole(tenant, actor, ownerRow.id, "artist"),
				LastOwnerError,
			);
		});
		const after = await membershipOf(tenant, owner.id);
		assert.equal(after.role, "owner");
		assert.isNull(after.deletedAt);
	});

	test("after one owner demotes the other, the last one can't be", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("two-owners-33", "Two 33");
		const second = await artistIn(tenant, "co@two-owners-33.example");
		const secondRow = await membershipOf(tenant, second.id);
		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, secondRow.id, "owner"),
		);
		const ownerRow = await membershipOf(tenant, owner.id);

		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, secondRow.id, "artist"),
		);
		await inTenant(tenant, async () => {
			await assert.rejects(
				() =>
					members.changeRole(
						tenant,
						{ userId: second.id },
						ownerRow.id,
						"artist",
					),
				LastOwnerError,
			);
		});
		assert.equal((await membershipOf(tenant, owner.id)).role, "owner");
	});

	test("changeRole makes an artist an owner and back, and the profile stays linked", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("role-33", "Role 33");
		const member = await artistIn(tenant, "asha@role-33.example");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: member.id }),
		);
		const row = await membershipOf(tenant, member.id);

		const promoted = await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, row.id, "owner"),
		);
		assert.deepEqual(promoted, { name: "asha@role-33.example" });
		assert.equal((await membershipOf(tenant, member.id)).role, "owner");

		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, row.id, "artist"),
		);
		assert.equal((await membershipOf(tenant, member.id)).role, "artist");
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			member.id,
		);
	});

	test("nobody removes or changes their own membership here", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("self-33", "Self 33");
		await artistIn(tenant, "co@self-33.example");
		const ownerRow = await membershipOf(tenant, owner.id);
		const self = { userId: owner.id };

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => members.remove(tenant, self, ownerRow.id),
				MemberRuleError,
			);
			await assert.rejects(
				() => members.changeRole(tenant, self, ownerRow.id, "artist"),
				MemberRuleError,
			);
		});
		assert.isNull((await membershipOf(tenant, owner.id)).deletedAt);
	});

	test("another studio's membership, or a removed one, is a 404", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("own-row-33", "Own Row");
		const { tenant: other } = await studioWithOwner("other-row-33");
		const theirs = await artistIn(other, "asha@other-row-33.example");
		const theirRow = await membershipOf(other, theirs.id);
		const gone = await artistIn(tenant, "gone@own-row-33.example");
		const goneRow = await membershipOf(tenant, gone.id);
		await inTenant(tenant, () =>
			members.remove(tenant, { userId: owner.id }, goneRow.id),
		);
		const actor = { userId: owner.id };

		await inTenant(tenant, async () => {
			for (const id of [theirRow.id, goneRow.id]) {
				await assert.rejects(
					() => members.findFor(tenant, id),
					lucidErrors.E_ROW_NOT_FOUND,
				);
				await assert.rejects(
					() => members.remove(tenant, actor, id),
					lucidErrors.E_ROW_NOT_FOUND,
				);
				await assert.rejects(
					() => members.changeRole(tenant, actor, id, "owner"),
					lucidErrors.E_ROW_NOT_FOUND,
				);
			}
		});
		assert.isNull((await membershipOf(other, theirs.id)).deletedAt);
	});
});
