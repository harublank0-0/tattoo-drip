import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import { INVITATION_TOKEN_KEY } from "#modules/identity/account_tokens";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { addArtist } from "#tests/helpers/artists";
import {
	confirmedUser,
	expireInvitation,
	invitationFlow,
	invite,
} from "#tests/helpers/invitations";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const REFUSED = "Invalid or expired CSRF token";

async function studio() {
	const { owner, tenant } = await studioWithOwner("join-33", "Join 33");
	const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
	const made = await invite(tenant, owner, {
		email: "asha@join-33.example",
		artistId: asha.id,
	});
	return { owner, tenant, asha, made };
}

const membersOf = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantMembership.query().where("tenant_id", tenant.id),
	);

test.group("The invitation link and page (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the link only stages its token and opens the page without it", async ({
		client,
	}) => {
		const { made } = await studio();

		const response = await client
			.get(`/invitations/${made.token}`)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/invitations");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(INVITATION_TOKEN_KEY, made.token);
	});

	test("a malformed link is the router's 404", async ({ client }) => {
		(await client.get("/invitations/short").redirects(0)).assertStatus(404);
		(
			await client.get(`/invitations/${"a".repeat(42)}=`).redirects(0)
		).assertStatus(404);
	});

	test("a guest sees the studio, the address, the role, the profile and both ways in, never the token", async ({
		client,
		assert,
	}) => {
		const { made } = await studio();

		const page = await client
			.get("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.withInertia();

		page.assertStatus(200);
		page.assertInertiaComponent("invitations/show");
		page.assertHeader("cache-control", "no-store");
		page.assertHeader("referrer-policy", "same-origin");
		const props = page.inertiaProps;
		assert.equal(props.state, "ready");
		assert.equal(props.step, "sign_in");
		assert.equal(props.studioName, "Join 33");
		assert.equal(props.email, "asha@join-33.example");
		assert.equal(props.role, "artist");
		assert.equal(props.profileName, "Asha");
		assert.isNull(props.flow);
		assert.isNull(props.studioSlug);
		assert.notInclude(JSON.stringify(props), made.token);
	});

	test("a guest sees the same page whether or not the address has an account", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, made } = await studio();
		const other = await invite(tenant, owner, {
			email: "none@join-33.example",
		});
		await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});
		const props = async (token: string) =>
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: token })
					.withInertia()
			).inertiaProps;

		const withAccount = await props(made.token);
		const without = await props(other.token);
		assert.equal(withAccount.step, without.step);
		assert.deepEqual(
			Object.keys(withAccount).sort(),
			Object.keys(without).sort(),
		);
	});

	test("the steps for a signed-in visitor: another account, unconfirmed, ready, a member", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const other = await confirmedUser("other@join-33.example");
		const invitee = await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});
		const stepOf = async (user: User) =>
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: made.token })
					.withInertia()
					.loginAs(user)
			).inertiaProps;

		const switching = await stepOf(other);
		assert.equal(switching.step, "switch_account");
		assert.equal(switching.viewerEmail, "other@join-33.example");
		assert.equal((await stepOf(invitee)).step, "confirm_email");

		await User.query()
			.where("id", invitee.id)
			.update({ email_verified_at: new Date() });
		const ready = await stepOf(await User.findOrFail(invitee.id));
		assert.equal(ready.step, "accept");
		assert.equal(ready.flow, invitationFlow(made.token));

		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: invitee.id,
				role: "artist",
			}),
		);
		const member = await stepOf(await User.findOrFail(invitee.id));
		assert.equal(member.step, "already_member");
		assert.equal(member.studioSlug, "join-33");
		assert.isNull(member.flow);
	});

	test("an expired, an unknown and a missing link", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		await expireInvitation(tenant, made.id);
		const pageFor = async (session: Record<string, string>) =>
			(await client.get("/invitations").withSession(session).withInertia())
				.inertiaProps;

		const expired = await pageFor({ [INVITATION_TOKEN_KEY]: made.token });
		assert.equal(expired.state, "expired");
		assert.equal(expired.studioName, "Join 33");
		assert.equal(
			(await pageFor({ [INVITATION_TOKEN_KEY]: "z".repeat(43) })).state,
			"invalid",
		);
		assert.equal((await pageFor({})).state, "invalid");
	});

	test("joining: the member exists with the profile, the link is used up, and an artist lands on Projects", async ({
		client,
		assert,
	}) => {
		const { tenant, asha, made } = await studio();
		const user = await confirmedUser("asha@join-33.example");

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: invitationFlow(made.token) })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/join-33/projects");
		response.assertFlashMessage(
			"success",
			"You joined Join 33. Your artist profile is linked to you.",
		);
		response.assertSessionMissing(INVITATION_TOKEN_KEY);
		assert.lengthOf(await membersOf(tenant), 2);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			user.id,
		);
		(await client.get("/t/join-33/projects").loginAs(user)).assertStatus(200);
		assert.equal(
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: made.token })
					.withInertia()
			).inertiaProps.state,
			"invalid",
		);
	});

	test("an owner's invitation lands on the Inbox; a taken profile still joins, with the note", async ({
		client,
	}) => {
		const { owner, tenant, asha } = await studio();
		const forOwner = await invite(tenant, owner, {
			email: "co@join-33.example",
			role: "owner",
		});
		const forArtist = await invite(tenant, owner, {
			email: "mira@join-33.example",
			artistId: asha.id,
		});
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: owner.id }),
		);
		const join = async (email: string, token: string) =>
			client
				.post("/invitations")
				.withSession({ [INVITATION_TOKEN_KEY]: token })
				.form({ flow: invitationFlow(token) })
				.withCsrfToken()
				.loginAs(await confirmedUser(email))
				.redirects(0);

		const asOwner = await join("co@join-33.example", forOwner.token);
		asOwner.assertHeader("location", "/t/join-33/inbox");
		asOwner.assertFlashMessage("success", "You joined Join 33.");

		const taken = await join("mira@join-33.example", forArtist.token);
		taken.assertFlashMessage(
			"success",
			"You joined Join 33. The artist profile in the invitation was taken or removed: ask an owner to link one.",
		);
	});

	test("joining is refused for another account, without the flow, with another invitation's flow and without CSRF; nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, made } = await studio();
		const other = await invite(tenant, owner, {
			email: "mira@join-33.example",
		});
		const wrong = await confirmedUser("other@join-33.example");
		const invitee = await confirmedUser("asha@join-33.example");
		const staged = { [INVITATION_TOKEN_KEY]: made.token };

		const wrongAccount = await client
			.post("/invitations")
			.withSession(staged)
			.form({ flow: invitationFlow(made.token) })
			.withCsrfToken()
			.loginAs(wrong)
			.redirects(0);
		wrongAccount.assertHeader("location", "/invitations");

		for (const form of [
			{},
			{ flow: other.id },
			{ flow: made.id },
			{ flow: invitationFlow(other.token) },
		]) {
			const response = await client
				.post("/invitations")
				.withSession(staged)
				.form(form)
				.withCsrfToken()
				.loginAs(invitee)
				.redirects(0);
			response.assertHeader("location", "/invitations");
		}

		const noCsrf = await client
			.post("/invitations")
			.withSession(staged)
			.form({ flow: invitationFlow(made.token) })
			.loginAs(invitee)
			.redirects(0);
		noCsrf.assertFlashMessage("error", REFUSED);

		assert.lengthOf(await membersOf(tenant), 1);
	});

	test("an unconfirmed account goes to /confirm-email, and nothing changes", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const unconfirmed = await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: invitationFlow(made.token) })
			.withCsrfToken()
			.loginAs(unconfirmed)
			.redirects(0);

		response.assertHeader("location", "/confirm-email");
		assert.lengthOf(await membersOf(tenant), 1);
	});

	test("a member of another studio joins this one with their own address, and nothing else changes for them", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const { owner: elsewhere, tenant: theirs } = await studioWithOwner(
			"elsewhere-33",
			"Elsewhere",
		);
		await User.query()
			.where("id", elsewhere.id)
			.update({ email: "asha@join-33.example", email_verified_at: new Date() });
		const user = await User.findOrFail(elsewhere.id);

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: invitationFlow(made.token) })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertHeader("location", "/t/join-33/projects");
		assert.lengthOf(await membersOf(tenant), 2);
		const own = await inTenant(theirs, () =>
			TenantMembership.query().where("tenant_id", theirs.id),
		);
		assert.deepEqual(
			own.map(({ userId, role }) => ({ userId, role })),
			[{ userId: user.id, role: "owner" }],
		);
	});

	test("a member of another studio can't use this studio's invitation for another address; nothing changes", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const { owner: elsewhere, tenant: theirs } = await studioWithOwner(
			"elsewhere-no-33",
			"Elsewhere No",
		);
		await User.query()
			.where("id", elsewhere.id)
			.update({ email_verified_at: new Date() });
		const user = await User.findOrFail(elsewhere.id);

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: invitationFlow(made.token) })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertHeader("location", "/invitations");
		assert.lengthOf(await membersOf(tenant), 1);
		const own = await inTenant(theirs, () =>
			TenantMembership.query().where("tenant_id", theirs.id),
		);
		assert.lengthOf(own, 1);
		assert.isNotNull(
			await inTenant(tenant, () => TenantInvitation.find(made.id)),
			"the invitation is still there",
		);
	});
});
