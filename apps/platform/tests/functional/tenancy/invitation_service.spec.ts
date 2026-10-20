import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import { hashAccountToken } from "#modules/identity/account_tokens";
import { InvitationRuleError } from "#modules/tenancy/errors";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { dbClient } from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import {
	confirmedUser,
	expireInvitation,
	invitationFlow,
	invitationService,
	invite,
} from "#tests/helpers/invitations";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const invitations = invitationService();

/** The reason of the InvitationRuleError `work` throws, or "accepted". */
async function refusal(work: () => Promise<unknown>) {
	try {
		await work();
		return "accepted";
	} catch (error) {
		if (error instanceof InvitationRuleError) return error.reason;
		throw error;
	}
}

const memberships = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantMembership.query()
			.where("tenant_id", tenant.id)
			.orderBy("created_at"),
	);

test.group("InvitationService: making invitations (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("invite stores only the token's hash, bound to the canonical address, for 7 days", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("make-33", "Make 33");

		const made = await invite(tenant, owner, {
			email: " Ink@Make-33.Example ",
			role: "owner",
		});

		assert.isFalse(made.replaced);
		assert.match(made.token, /^[A-Za-z0-9_-]{43}$/);
		const row = await inTenant(tenant, () =>
			TenantInvitation.findOrFail(made.id),
		);
		assert.equal(row.email, "ink@make-33.example");
		assert.equal(row.role, "owner");
		assert.equal(row.tokenHash, hashAccountToken(made.token));
		assert.equal(row.invitedByUserId, owner.id);
		assert.notInclude(JSON.stringify(row.serialize()), made.token);
		assert.equal(made.expiresAt.toMillis(), row.expiresAt.toMillis());
		const { rows } = await inTenant(tenant, () =>
			dbClient().rawQuery(
				"select expires_at - created_at = interval '7 days' as week, expires_at > now() as live from tenant_invitations where id = ?",
				[made.id],
			),
		);
		assert.isTrue(rows[0].week);
		assert.isTrue(rows[0].live);
	});

	test("inviting the same address again replaces the invitation and kills its link", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("replace-33", "Replace 33");
		const first = await invite(tenant, owner);

		const second = await invite(tenant, owner, { role: "owner" });

		assert.isTrue(second.replaced);
		assert.equal(second.id, first.id);
		assert.equal(
			(await invitations.preview(first.token, null)).state,
			"invalid",
		);
		const rows = await inTenant(tenant, () =>
			TenantInvitation.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].role, "owner");
	});

	test("a live member's address is refused; a removed member's and an unknown one aren't", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("member-33", "Member 33");
		const member = await artistIn(tenant, "asha@member-33.example");
		const gone = await artistIn(tenant, "gone@member-33.example");
		await inTenant(tenant, async () => {
			const row = await TenantMembership.query()
				.where("user_id", gone.id)
				.firstOrFail();
			await row.softDelete();
		});

		assert.equal(
			await refusal(() => invite(tenant, owner, { email: member.email })),
			"already_member",
		);
		assert.equal(
			await refusal(() => invite(tenant, owner, { email: gone.email })),
			"accepted",
		);
		assert.equal(
			await refusal(() =>
				invite(tenant, owner, { email: "nobody@member-33.example" }),
			),
			"accepted",
		);
	});

	test("invite answers the same for an address with or without an account", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("enum-33", "Enum 33");
		await User.create({
			email: "has@enum-33.example",
			password: "secret-password",
		});

		const known = await invite(tenant, owner, { email: "has@enum-33.example" });
		const unknown = await invite(tenant, owner, {
			email: "none@enum-33.example",
		});

		assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
		assert.isFalse(known.replaced);
		assert.isFalse(unknown.replaced);
	});

	test("only a live profile nobody is linked to can be offered", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("offer-33", "Offer 33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("offer-other-33");
		const free = await addArtist(tenant, owner, { name: "Free", slug: "free" });
		const taken = await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		await inTenant(tenant, () => gone.softDelete());
		const foreign = await addArtist(other, otherOwner);

		for (const artistId of [taken.id, gone.id, foreign.id]) {
			assert.equal(
				await refusal(() => invite(tenant, owner, { artistId })),
				"profile_unavailable",
				artistId,
			);
		}
		const made = await invite(tenant, owner, { artistId: free.id });
		const row = await inTenant(tenant, () =>
			TenantInvitation.findOrFail(made.id),
		);
		assert.equal(row.artistId, free.id);
	});

	test("renew gives a new link and 7 more days; the old link no longer works", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("renew-33", "Renew 33");
		const made = await invite(tenant, owner);
		await expireInvitation(tenant, made.id);

		const renewed = await inTenant(tenant, () =>
			invitations.renew(tenant, owner, made.id),
		);

		assert.equal(renewed.email, "ink@invite-33.example");
		assert.notEqual(renewed.token, made.token);
		assert.equal(
			(await invitations.preview(made.token, null)).state,
			"invalid",
		);
		assert.equal(
			(await invitations.preview(renewed.token, null)).state,
			"live",
		);
	});

	test("revoke deletes it; another studio's id is a 404 for renew and revoke", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("revoke-33", "Revoke 33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("revoke-other-33");
		const mine = await invite(tenant, owner);
		const theirs = await invite(other, otherOwner);

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => invitations.renew(tenant, owner, theirs.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			await assert.rejects(
				() => invitations.revoke(tenant, theirs.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			assert.deepEqual(await invitations.revoke(tenant, mine.id), {
				email: "ink@invite-33.example",
			});
		});
		assert.equal(
			(await invitations.preview(mine.token, null)).state,
			"invalid",
		);
		assert.equal((await invitations.preview(theirs.token, null)).state, "live");
	});

	test("pending lists the studio's invitations, newest first, with the profile and whether each expired; another studio sees none", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("pending-33", "Pending 33");
		const { tenant: other } = await studioWithOwner("pending-other-33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const old = await invite(tenant, owner, {
			email: "old@pending-33.example",
		});
		await expireInvitation(tenant, old.id);
		await invite(tenant, owner, {
			email: "new@pending-33.example",
			artistId: asha.id,
		});

		const list = await inTenant(tenant, () => invitations.pending(tenant));

		assert.deepEqual(
			list.map(({ email, profileName, expired }) => ({
				email,
				profileName,
				expired,
			})),
			[
				{
					email: "new@pending-33.example",
					profileName: "Asha",
					expired: false,
				},
				{ email: "old@pending-33.example", profileName: null, expired: true },
			],
		);
		assert.isEmpty(await inTenant(other, () => invitations.pending(tenant)));
	});
});

test.group("InvitationService: opening and accepting (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("preview: invalid, expired and live, with the step for each visitor", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("preview-33", "Preview 33");
		const made = await invite(tenant, owner, {
			email: "ink@preview-33.example",
		});
		const other = await confirmedUser("other@preview-33.example");
		const invitee = await User.create({
			email: "ink@preview-33.example",
			password: "secret-password",
		});

		assert.deepEqual(await invitations.preview("x".repeat(43), null), {
			state: "invalid",
		});
		const live = await invitations.preview(made.token, null);
		assert.equal(live.state, "live");
		if (live.state !== "live") return;
		assert.equal(live.step, "sign_in");
		assert.equal(live.email, "ink@preview-33.example");
		assert.equal(live.studio.name, "Preview 33");
		assert.equal(live.flow, await invitationFlow(tenant, made.token));
		assert.isNull(live.profileName);

		const step = async (viewer: User) => {
			const preview = await invitations.preview(made.token, viewer);
			return preview.state === "live" ? preview.step : preview.state;
		};
		assert.equal(await step(other), "switch_account");
		assert.equal(await step(invitee), "confirm_email");
		await User.query()
			.where("id", invitee.id)
			.update({ email_verified_at: new Date() });
		const confirmed = await User.findOrFail(invitee.id);
		assert.equal(await step(confirmed), "accept");
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: invitee.id,
				role: "artist",
			}),
		);
		assert.equal(await step(confirmed), "already_member");

		await expireInvitation(tenant, made.id);
		assert.deepEqual(await invitations.preview(made.token, null), {
			state: "expired",
			studioName: "Preview 33",
		});
	});

	test("accept makes the member with the invitation's role, claims the profile and uses the invitation up", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("accept-33", "Accept 33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const made = await invite(tenant, owner, {
			email: "asha@accept-33.example",
			artistId: asha.id,
		});
		const user = await confirmedUser("asha@accept-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.deepEqual(joined, {
			studio: { name: "Accept 33", slug: "accept-33" },
			role: "artist",
			claimed: true,
		});
		const rows = await memberships(tenant);
		assert.deepEqual(
			rows.map(({ userId, role }) => ({ userId, role })),
			[
				{ userId: owner.id, role: "owner" },
				{ userId: user.id, role: "artist" },
			],
		);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			user.id,
		);
		assert.equal(
			(await invitations.preview(made.token, null)).state,
			"invalid",
		);
	});

	test("an invitation without a profile gives claimed null; an owner's gives the owner role", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("accept-owner-33", "AO 33");
		const made = await invite(tenant, owner, {
			email: "co@accept-owner-33.example",
			role: "owner",
		});
		const user = await confirmedUser("co@accept-owner-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.equal(joined.role, "owner");
		assert.isNull(joined.claimed);
	});

	test("accept refuses a wrong account, an unconfirmed one, a member, a dead link and a wrong flow; nothing changes", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("refuse-33", "Refuse 33");
		const made = await invite(tenant, owner, {
			email: "ink@refuse-33.example",
		});
		const flow = await invitationFlow(tenant, made.token);
		const other = await confirmedUser("other@refuse-33.example");
		const unconfirmed = await User.create({
			email: "ink@refuse-33.example",
			password: "secret-password",
		});
		const memberUser = await artistIn(tenant, "member@refuse-33.example");
		const forMember = await invite(tenant, owner, {
			email: "fresh@refuse-33.example",
		});
		// The member's address was invited before they joined some other way.
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenant_invitations set email = ? where id = ?",
				[memberUser.email, forMember.id],
			),
		);
		await User.query()
			.where("id", memberUser.id)
			.update({ email_verified_at: new Date() });
		const confirmedMember = await User.findOrFail(memberUser.id);

		assert.equal(
			await refusal(() => invitations.accept(other, made.token, flow)),
			"wrong_account",
		);
		assert.equal(
			await refusal(() => invitations.accept(unconfirmed, made.token, flow)),
			"unverified",
		);
		assert.equal(
			await refusal(() =>
				invitations.accept(confirmedMember, forMember.token, forMember.id),
			),
			"already_member",
		);
		assert.equal(
			await refusal(() => invitations.accept(other, "x".repeat(43), flow)),
			"invalid",
		);
		// Another invitation's flow, and something that isn't an id.
		assert.equal(
			await refusal(() =>
				invitations.accept(unconfirmed, made.token, forMember.id),
			),
			"invalid",
		);
		assert.equal(
			await refusal(() => invitations.accept(other, made.token, "nope")),
			"invalid",
		);
		await expireInvitation(tenant, made.id);
		await User.query()
			.where("id", unconfirmed.id)
			.update({ email_verified_at: new Date() });
		assert.equal(
			await refusal(async () =>
				invitations.accept(
					await User.findOrFail(unconfirmed.id),
					made.token,
					flow,
				),
			),
			"expired",
		);

		assert.lengthOf(await memberships(tenant), 2);
		assert.equal(
			(await invitations.preview(made.token, null)).state,
			"expired",
		);
	});

	test("a second accept with the same link finds nothing", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("replay-33", "Replay 33");
		const made = await invite(tenant, owner, {
			email: "ink@replay-33.example",
		});
		const flow = await invitationFlow(tenant, made.token);
		const user = await confirmedUser("ink@replay-33.example");

		await invitations.accept(user, made.token, flow);

		assert.equal(
			await refusal(() => invitations.accept(user, made.token, flow)),
			"invalid",
		);
		assert.lengthOf(await memberships(tenant), 2);
	});

	test("a profile taken meanwhile: the person still joins, without it", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("taken-33", "Taken 33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const made = await invite(tenant, owner, {
			email: "ink@taken-33.example",
			artistId: asha.id,
		});
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: owner.id }),
		);
		const user = await confirmedUser("ink@taken-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.isFalse(joined.claimed);
		assert.lengthOf(await memberships(tenant), 2);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			owner.id,
		);
	});
});
