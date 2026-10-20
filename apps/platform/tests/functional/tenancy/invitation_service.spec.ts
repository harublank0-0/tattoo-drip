import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import { Settings } from "luxon";
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

test.group(
	"InvitationService: expiry by the database's clock (TAT-33)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("pending says expired by the database's clock, not the app's", async ({
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("clock-33", "Clock 33");
			await invite(tenant, owner, { email: "live@clock-33.example" });
			const old = await invite(tenant, owner, {
				email: "old@clock-33.example",
			});
			await expireInvitation(tenant, old.id);
			const real = Settings.now;
			// An app clock far ahead: by it both invitations are long gone.
			Settings.now = () => Date.now() + 30 * 24 * 60 * 60 * 1000;
			try {
				const list = await inTenant(tenant, () => invitations.pending(tenant));

				assert.deepEqual(
					list
						.map(({ email, expired }) => ({ email, expired }))
						.sort((a, b) => a.email.localeCompare(b.email)),
					[
						{ email: "live@clock-33.example", expired: false },
						{ email: "old@clock-33.example", expired: true },
					],
				);
			} finally {
				Settings.now = real;
			}
		});
	},
);

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
		assert.equal(live.flow, invitationFlow(made.token));
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
			invitationFlow(made.token),
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
			invitationFlow(made.token),
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
		const flow = invitationFlow(made.token);
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
				invitations.accept(
					confirmedMember,
					forMember.token,
					invitationFlow(forMember.token),
				),
			),
			"already_member",
		);
		assert.equal(
			await refusal(() => invitations.accept(other, "x".repeat(43), flow)),
			"invalid",
		);
		// Another invitation's flow, this row's own id, and something that isn't an id.
		for (const wrongFlow of [invitationFlow(forMember.token), made.id]) {
			assert.equal(
				await refusal(() =>
					invitations.accept(unconfirmed, made.token, wrongFlow),
				),
				"invalid",
			);
		}
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

	test("an old tab's form can't accept the terms of a replacement it never showed", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("tabs-33", "Tabs 33");
		const invitee = await confirmedUser("ink@tabs-33.example");
		const first = await invite(tenant, owner, {
			email: invitee.email,
			role: "artist",
		});
		// Tab one renders the invitation as an artist.
		const tabOne = await invitations.preview(first.token, invitee);
		// The owner replaces it with another role (the row, and its id, stay);
		// the recipient opens the new link in a second tab, which stages the
		// new token in the session.
		const second = await invite(tenant, owner, {
			email: invitee.email,
			role: "owner",
		});
		const tabTwo = await invitations.preview(second.token, invitee);
		assert.equal(second.id, first.id);
		assert.equal(tabOne.state, "live");
		assert.equal(tabTwo.state, "live");
		if (tabOne.state !== "live" || tabTwo.state !== "live") return;
		assert.equal(tabTwo.role, "owner");

		// Tab one's form, sent with the session's token (the new one).
		assert.equal(
			await refusal(() =>
				invitations.accept(invitee, second.token, tabOne.flow),
			),
			"invalid",
		);
		assert.lengthOf(await memberships(tenant), 1, "only the owner so far");

		// Tab two's form shows the owner role and gets it.
		const joined = await invitations.accept(invitee, second.token, tabTwo.flow);
		assert.equal(joined.role, "owner");
		assert.lengthOf(await memberships(tenant), 2);
	});

	test("a renewed link's flow differs too, and a flow is never the row's id", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"renew-flow-33",
			"Renew 33",
		);
		const invitee = await confirmedUser("ink@renew-flow-33.example");
		const made = await invite(tenant, owner, { email: invitee.email });
		const other = await invite(tenant, owner, {
			email: "other@renew-flow-33.example",
		});
		const flowOf = async (token: string) => {
			const preview = await invitations.preview(token, invitee);
			return preview.state === "live" ? preview.flow : preview.state;
		};
		const before = await flowOf(made.token);

		const renewed = await inTenant(tenant, () =>
			invitations.renew(tenant, owner, made.id),
		);

		const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
		assert.match(before, uuid);
		assert.equal(await flowOf(made.token), "invalid", "the old link is dead");
		const after = await flowOf(renewed.token);
		assert.match(after, uuid);
		assert.notEqual(after, before, "a new link, a new flow");
		assert.equal(await flowOf(renewed.token), after, "stable for one link");
		assert.notEqual(before, made.id, "not the row's id");
		assert.notEqual(after, made.id, "not the row's id, which a renewal keeps");
		assert.notEqual(after, await flowOf(other.token));
	});

	test("a second accept with the same link finds nothing", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("replay-33", "Replay 33");
		const made = await invite(tenant, owner, {
			email: "ink@replay-33.example",
		});
		const flow = invitationFlow(made.token);
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
			invitationFlow(made.token),
		);

		assert.isFalse(joined.claimed);
		assert.lengthOf(await memberships(tenant), 2);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			owner.id,
		);
	});
});
