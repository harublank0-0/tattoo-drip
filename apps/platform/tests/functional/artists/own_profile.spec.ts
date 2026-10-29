import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { addArtist } from "#tests/helpers/artists";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const base = "/t/own-30/artists";

/**
 * A studio, its owner, an artist member linked to "Asha", an unlinked
 * "Mira" and the owner's own "Oona".
 */
async function studio() {
	const { owner, tenant } = await studioWithOwner("own-30", "Own Thirty");
	const member = await artistIn(tenant, "asha@own-30.example");
	const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
	const mira = await addArtist(tenant, owner, { name: "Mira", slug: "mira" });
	const oona = await addArtist(tenant, owner, {
		name: "Oona",
		slug: "oona",
		linkToMe: true,
	});
	await inTenant(tenant, () =>
		Artist.query().where("id", asha.id).update({ user_id: member.id }),
	);
	return { owner, tenant, member, asha, mira, oona };
}

test.group("An artist's own profile (TAT-30)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist opens their own profile, without the link to their login", async ({
		client,
		assert,
	}) => {
		const { member, asha } = await studio();

		const response = await client
			.get(`${base}/${asha.id}/edit`)
			.withInertia()
			.loginAs(member);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/form");
		assert.equal(response.inertiaProps.artist.id, asha.id);
		assert.isTrue(response.inertiaProps.artist.isMine);
		assert.isFalse(response.inertiaProps.canLink);
	});

	test("an artist saves their own profile and stays linked", async ({
		client,
		assert,
	}) => {
		const { tenant, member, asha } = await studio();

		// No linkToMe: for an owner that unlinks their own profile; for an
		// artist the link is never read. No visible: an unchecked box.
		const response = await client
			.put(`${base}/${asha.id}`)
			.fields({
				name: "Asha Gurung",
				slug: "asha-g",
				bio: "Fine line",
				acceptingInquiries: "on",
				closedMessage: "",
			})
			.withCsrfToken()
			.loginAs(member)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", `${base}/${asha.id}/edit`);
		response.assertFlashMessage("success", '"Asha Gurung" saved.');
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.equal(saved.name, "Asha Gurung");
		assert.equal(saved.slug, "asha-g");
		assert.equal(saved.bio, "Fine line");
		assert.isFalse(saved.visible);
		assert.isTrue(saved.acceptingInquiries);
		assert.equal(saved.userId, member.id);
	});

	test("an artist sets their own styles and TikTok link", async ({
		client,
		assert,
	}) => {
		const { tenant, member, asha } = await studio();

		const response = await client
			.put(`${base}/${asha.id}`)
			.fields({
				name: "Asha",
				slug: "asha",
				visible: "on",
				"styles[]": ["fine-line", "japanese"],
				tiktokUrl: "https://tiktok.com/@asha",
			})
			.withCsrfToken()
			.loginAs(member)
			.redirects(0);

		response.assertHeader("location", `${base}/${asha.id}/edit`);
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.deepEqual(saved.styles, ["fine-line", "japanese"]);
		assert.equal(saved.tiktokUrl, "https://tiktok.com/@asha");
		assert.isNull(saved.instagramUrl);
		assert.equal(saved.userId, member.id);

		const edit = await client
			.get(`${base}/${asha.id}/edit`)
			.withInertia()
			.loginAs(member);
		assert.deepEqual(edit.inertiaProps.artist.styles, [
			"fine-line",
			"japanese",
		]);
		assert.equal(
			edit.inertiaProps.artist.tiktokUrl,
			"https://tiktok.com/@asha",
		);
		assert.isNull(edit.inertiaProps.artist.instagramUrl);
		assert.isNull(edit.inertiaProps.artist.facebookUrl);
	});

	test("an artist gets 404 on a profile that isn't theirs, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant, member, mira, oona } = await studio();

		for (const profile of [mira, oona]) {
			for (const request of [
				client.get(`${base}/${profile.id}/edit`),
				client
					.put(`${base}/${profile.id}`)
					.fields({ name: "Taken", slug: profile.slug }),
				// A bad body is still a 404: the profile is loaded first.
				client.put(`${base}/${profile.id}`).fields({ name: "", slug: "-" }),
			]) {
				const response = await request.withCsrfToken().loginAs(member);
				response.assertStatus(404);
			}
		}
		const rows = await inTenant(tenant, () =>
			Artist.query().whereIn("id", [mira.id, oona.id]).orderBy("slug"),
		);
		assert.deepEqual(
			rows.map(({ name, userId }) => ({ name, userId })),
			[
				{ name: "Mira", userId: null },
				{ name: "Oona", userId: oona.userId },
			],
		);
	});

	test("an artist member with no linked profile gets 404 on every profile, which stay as they were", async ({
		client,
		assert,
	}) => {
		const { tenant, asha, mira, oona } = await studio();
		// A second artist member, linked to nothing: not even the unlinked
		// "Mira" (user_id null) is theirs.
		const unlinked = await artistIn(tenant, "nobody@own-30.example");
		const snapshot = () =>
			inTenant(tenant, async () =>
				(await Artist.query().orderBy("slug")).map(
					({ name, slug, bio, userId }) => ({ name, slug, bio, userId }),
				),
			);
		const before = await snapshot();

		for (const profile of [asha, mira, oona]) {
			for (const request of [
				client.get(`${base}/${profile.id}/edit`),
				client
					.put(`${base}/${profile.id}`)
					.fields({ name: "Taken", slug: "taken", bio: "Changed" }),
			]) {
				const response = await request.withCsrfToken().loginAs(unlinked);
				response.assertStatus(404);
			}
		}
		assert.deepEqual(await snapshot(), before);
	});

	test("the list, a new profile and deleting stay owners only", async ({
		client,
	}) => {
		const { member, asha } = await studio();

		for (const request of [
			client.get(base),
			client.get(`${base}/new`),
			client.post(base).fields({ name: "Sneaky", slug: "sneaky" }),
			client.delete(`${base}/${asha.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(member);
			response.assertStatus(404);
		}
	});

	test("mine opens the member's own profile", async ({ client }) => {
		const { owner, member, asha, oona } = await studio();

		const artist = await client
			.get(`${base}/mine`)
			.loginAs(member)
			.redirects(0);
		artist.assertStatus(302);
		artist.assertHeader("location", `${base}/${asha.id}/edit`);

		const ownerResponse = await client
			.get(`${base}/mine`)
			.loginAs(owner)
			.redirects(0);
		ownerResponse.assertHeader("location", `${base}/${oona.id}/edit`);
	});

	test("mine without a linked profile: an artist goes to Projects with a note, an owner to the list", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("mine-30", "Mine Thirty");
		const member = await artistIn(tenant, "new@mine-30.example");

		const artist = await client
			.get("/t/mine-30/artists/mine")
			.loginAs(member)
			.redirects(0);
		artist.assertHeader("location", "/t/mine-30/projects");
		artist.assertFlashMessage(
			"error",
			"No artist profile is linked to you in Mine Thirty yet. Ask an owner to link one.",
		);

		const ownerResponse = await client
			.get("/t/mine-30/artists/mine")
			.loginAs(owner)
			.redirects(0);
		ownerResponse.assertHeader("location", "/t/mine-30/artists");
	});

	test("an owner still edits any profile and goes back to the list", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha } = await studio();

		const response = await client
			.put(`${base}/${asha.id}`)
			.fields({ name: "Asha R", slug: "asha", visible: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.equal(saved.name, "Asha R");
		// An owner's edit of someone else's profile never changes its link.
		assert.isNotNull(saved.userId);
	});
});
