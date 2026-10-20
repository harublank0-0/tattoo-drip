import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { hashAccountToken } from "#modules/identity/account_tokens";
import {
	INVITATION_LINK_FLASH,
	type NewInvitationLink,
} from "#modules/tenancy/invitations";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { addArtist } from "#tests/helpers/artists";
import { invite } from "#tests/helpers/invitations";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const base = "/t/members-33/settings/members";

async function studio() {
	const { owner, tenant } = await studioWithOwner("members-33", "Members 33");
	const member = await artistIn(tenant, "asha@members-33.example");
	const memberRow = await inTenant(tenant, () =>
		TenantMembership.query().where("user_id", member.id).firstOrFail(),
	);
	return { owner, tenant, member, memberRow };
}

const invitationsOf = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantInvitation.query().where("tenant_id", tenant.id).orderBy("email"),
	);

test.group("Settings, Members (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the members, themselves marked, the invitations and the profiles they can offer", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member, memberRow } = await studio();
		await addArtist(tenant, owner, { name: "Free", slug: "free" });
		await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		await invite(tenant, owner, { email: "mira@members-33.example" });

		const response = await client.get(base).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/members");
		const props = response.inertiaProps;
		const ownerRow = await inTenant(tenant, () =>
			TenantMembership.query().where("user_id", owner.id).firstOrFail(),
		);
		assert.deepEqual(props.members, [
			{
				id: ownerRow.id,
				name: null,
				email: owner.email,
				role: "owner",
				isYou: true,
			},
			{
				id: memberRow.id,
				name: null,
				email: member.email,
				role: "artist",
				isYou: false,
			},
		]);
		assert.deepEqual(
			props.invitations.map(
				({
					email,
					role,
					expired,
				}: {
					email: string;
					role: string;
					expired: boolean;
				}) => ({
					email,
					role,
					expired,
				}),
			),
			[{ email: "mira@members-33.example", role: "artist", expired: false }],
		);
		assert.match(
			props.invitations[0].expiresText,
			/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/,
		);
		assert.deepEqual(
			props.profiles.map(({ name }: { name: string }) => name),
			["Free"],
		);
		assert.notProperty(props, "newLink");
		assert.isUndefined(response.body().flash.invitationLink);
		response.assertHeader("cache-control", "no-store");
	});

	test("inviting flashes the link once; the page shows it from the flash and never again", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();

		const response = await client
			.post(`${base}/invitations`)
			.form({ email: "Mira@Members-33.example", role: "artist", artistId: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", base);
		response.assertFlashMessage(
			"success",
			"Invitation link ready: send it to mira@members-33.example.",
		);
		const link = response.flashMessages()[
			INVITATION_LINK_FLASH
		] as NewInvitationLink;
		assert.equal(link.email, "mira@members-33.example");
		const token = link.url.split("/invitations/")[1] ?? "";
		assert.match(token, /^[A-Za-z0-9_-]{43}$/);
		const [stored] = await invitationsOf(tenant);
		assert.equal(stored.tokenHash, hashAccountToken(token));
		assert.include(link.message, "Members 33");
		assert.include(link.message, link.url);
		assert.isTrue(link.whatsappUrl.startsWith("https://wa.me/?text="));

		const shown = await client
			.get(base)
			.withFlashMessages({ [INVITATION_LINK_FLASH]: link })
			.withInertia()
			.loginAs(owner);
		// In the page object's flash field, which the Inertia client strips from
		// history state, and nowhere in the props it keeps (and encrypts) there:
		// Back after the owner left would otherwise bring the link back.
		assert.deepEqual(shown.body().flash.invitationLink, link);
		assert.notProperty(shown.inertiaProps, "newLink");
		assert.notInclude(JSON.stringify(shown.inertiaProps), token);
		// The response that carries a link is never stored by the browser.
		shown.assertHeader("cache-control", "no-store");

		const later = await client.get(base).withInertia().loginAs(owner);
		assert.isUndefined(later.body().flash.invitationLink);
		assert.notInclude(JSON.stringify(later.body()), token);
	});

	test("another page that receives the pending flash does not carry the link", async ({
		client,
		assert,
	}) => {
		const { owner } = await studio();
		const link: NewInvitationLink = {
			email: "mira@members-33.example",
			url: "https://platform.example/invitations/Zm9vYmFyYmF6cXV4",
			message: "You're invited to join Members 33 on Tattoo Drip.",
			whatsappUrl: "https://wa.me/?text=hi",
			expiresText: "27 Oct 2026, 14:05",
		};

		// A second tab's request, between the invitation and its redirect.
		const other = await client
			.get("/t/members-33/inbox")
			.withFlashMessages({ [INVITATION_LINK_FLASH]: link })
			.withInertia()
			.loginAs(owner);

		other.assertStatus(200);
		assert.isUndefined(other.body().flash.invitationLink);
		assert.notInclude(JSON.stringify(other.body()), "Zm9vYmFyYmF6cXV4");
	});

	test("a flash that isn't a link is not shown", async ({ client, assert }) => {
		const { owner } = await studio();

		const response = await client
			.get(base)
			.withFlashMessages({
				[INVITATION_LINK_FLASH]: { url: "https://x.example" },
			})
			.withInertia()
			.loginAs(owner);

		assert.isUndefined(response.body().flash.invitationLink);
	});

	test("inviting an address again replaces its invitation", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		await invite(tenant, owner, { email: "mira@members-33.example" });

		const response = await client
			.post(`${base}/invitations`)
			.form({ email: "mira@members-33.example", role: "owner" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"New invitation link ready for mira@members-33.example. The earlier link no longer works.",
		);
		const rows = await invitationsOf(tenant);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].role, "owner");
	});

	test("a member's address, a taken profile, a bad address and no role are field errors, and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member } = await studio();
		const taken = await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		const post = (form: Record<string, string>) =>
			client
				.post(`${base}/invitations`)
				.form(form)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const asMember = await post({ email: member.email, role: "artist" });
		assertValidationError(asMember, "email");
		const takenProfile = await post({
			email: "new@members-33.example",
			role: "artist",
			artistId: taken.id,
		});
		assertValidationError(takenProfile, "artistId");
		assertValidationError(
			await post({ email: "not-an-address", role: "artist" }),
			"email",
		);
		assertValidationError(
			await post({ email: "new@members-33.example", role: "staff" }),
			"role",
		);
		assert.isEmpty(await invitationsOf(tenant));
	});

	test("a new link replaces the old one; cancelling kills it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const made = await invite(tenant, owner, {
			email: "mira@members-33.example",
		});

		const renewed = await client
			.post(`${base}/invitations/${made.id}/renew`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		renewed.assertFlashMessage(
			"success",
			"New link ready for mira@members-33.example. The old one no longer works.",
		);
		const link = renewed.flashMessages()[
			INVITATION_LINK_FLASH
		] as NewInvitationLink;
		const [row] = await invitationsOf(tenant);
		assert.notEqual(row.tokenHash, hashAccountToken(made.token));
		assert.equal(
			row.tokenHash,
			hashAccountToken(link.url.split("/invitations/")[1] ?? ""),
		);

		const cancelled = await client
			.delete(`${base}/invitations/${made.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		cancelled.assertFlashMessage(
			"success",
			"Invitation for mira@members-33.example cancelled. Its link no longer works.",
		);
		assert.isEmpty(await invitationsOf(tenant));
	});

	test("make owner and make artist", async ({ client, assert }) => {
		const { owner, tenant, memberRow } = await studio();
		const put = (role: string) =>
			client
				.put(`${base}/${memberRow.id}/role`)
				.form({ role })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		(await put("owner")).assertFlashMessage(
			"success",
			"asha@members-33.example is now an owner.",
		);
		const promoted = await inTenant(tenant, () =>
			TenantMembership.findOrFail(memberRow.id),
		);
		assert.equal(promoted.role, "owner");

		(await put("artist")).assertFlashMessage(
			"success",
			"asha@members-33.example is now an artist.",
		);
	});

	test("removing a member: their next request is a 404, and their profile stays with the studio, unlinked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member, memberRow } = await studio();
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: member.id }),
		);
		(await client.get("/t/members-33/projects").loginAs(member)).assertStatus(
			200,
		);

		const response = await client
			.delete(`${base}/${memberRow.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"asha@members-33.example removed. Their access to Members 33 ended.",
		);
		(await client.get("/t/members-33/projects").loginAs(member)).assertStatus(
			404,
		);
		const profile = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.isNull(profile.userId);
		assert.isNull(profile.deletedAt);
	});

	test("an owner can't remove themselves or change their own role", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const ownerRow = await inTenant(tenant, () =>
			TenantMembership.query().where("user_id", owner.id).firstOrFail(),
		);

		for (const request of [
			client.delete(`${base}/${ownerRow.id}`),
			client.put(`${base}/${ownerRow.id}/role`).form({ role: "artist" }),
		]) {
			const response = await request
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			response.assertHeader("location", base);
			response.assertFlashMessage(
				"error",
				"You can't remove yourself or change your own role here.",
			);
		}
		const after = await inTenant(tenant, () =>
			TenantMembership.findOrFail(ownerRow.id),
		);
		assert.equal(after.role, "owner");
		assert.isNull(after.deletedAt);
	});

	test("another studio's member is a 404, even with a bad body", async ({
		client,
	}) => {
		const { owner } = await studio();
		const { tenant: other } = await studioWithOwner("members-other-33");
		const theirs = await artistIn(other, "asha@members-other-33.example");
		const theirRow = await inTenant(other, () =>
			TenantMembership.query().where("user_id", theirs.id).firstOrFail(),
		);

		for (const request of [
			client.put(`${base}/${theirRow.id}/role`).form({ role: "nope" }),
			client.delete(`${base}/${theirRow.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
