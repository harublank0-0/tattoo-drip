import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { testImages } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const artists = new ArtistService(new ImageService());
const base = "/t/black-needle/artists";

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

const listOf = (tenant: { id: string }) =>
	inTenant(tenant, () => artists.list(tenant));

test.group("Adding an artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form is empty and offers 'this is my profile'", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/form");
		assert.isNull(response.inertiaProps.artist);
		assert.isTrue(response.inertiaProps.canLink);
	});

	test("the form stops offering it once the owner has a profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		assert.isFalse(response.inertiaProps.canLink);
	});

	test("an owner adds an artist: the slug is normalized and unchecked boxes mean off", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "  SITA-Rai ", bio: "Fine line work" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita Rai" added.');
		const [artist] = await listOf(tenant);
		assert.equal(artist.slug, "sita-rai");
		assert.equal(artist.bio, "Fine line work");
		// Nothing was sent for the checkboxes: they were unchecked.
		assert.isFalse(artist.visible);
		assert.isFalse(artist.acceptingInquiries);
		assert.isNull(artist.userId);
	});

	test("checked boxes mean on, and 'this is my profile' links the owner", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.post(base)
			.fields({
				name: "Sita Rai",
				slug: "sita",
				visible: "on",
				acceptingInquiries: "on",
				linkToMe: "on",
				closedMessage: "Back in May",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [artist] = await listOf(tenant);
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
		assert.equal(artist.userId, owner.id);
		assert.equal(artist.closedMessage, "Back in May");
	});

	test("a taken slug comes back as a field error on slug and adds nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () => artists.create(tenant, input(), owner));

		const response = await client
			.post(base)
			.fields({ name: "Other", slug: "sita" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"slug",
			"This link is already used by another artist.",
		);
		assert.lengthOf(await listOf(tenant), 1);
	});

	test("a second profile for the same owner comes back as a field error on linkToMe", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const response = await client
			.post(base)
			.fields({ name: "Again", slug: "again", linkToMe: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "linkToMe", "You already have a profile.");
		assert.lengthOf(await listOf(tenant), 1);
	});

	for (const slug of ["a", "-ab", "ab-", "a b", "a_b", "x".repeat(64)]) {
		test(`rejects the slug ${JSON.stringify(slug)}`, async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner();

			const response = await client
				.post(base)
				.fields({ name: "Sita Rai", slug })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

			assertValidationError(response, "slug");
			assert.isEmpty(await listOf(tenant));
		});
	}

	test("an empty name or one over 120 characters comes back as a field error", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		for (const name of ["", "x".repeat(121)]) {
			const response = await client
				.post(base)
				.fields({ name, slug: "sita" })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(response, "name");
		}
		assert.isEmpty(await listOf(tenant));
	});

	test("a photo is stored and shown in the edit form", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [artist] = await listOf(tenant);
		assert.isNotNull(artist.photoKey);
		const edit = await client
			.get(`${base}/${artist.id}/edit`)
			.withInertia()
			.loginAs(owner);
		assert.match(
			new URL(edit.inertiaProps.artist.photoUrl).pathname,
			/^\/uploads\/tenants\//,
		);
	});

	test("a file that isn't an image comes back as a field error on photo", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.gif(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "photo");
		assert.isEmpty(await listOf(tenant));
	});
});

test.group("Editing an artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form shows the artist and offers the link only where it can succeed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});
		const [mine, theirs, loose] = await inTenant(tenant, async () => {
			const first = await artists.create(
				tenant,
				input({ name: "Mine", slug: "mine", linkToMe: true }),
				owner,
			);
			const second = await artists.create(
				tenant,
				input({ name: "Theirs", slug: "theirs" }),
				owner,
			);
			await Artist.query().where("id", second.id).update({ user_id: other.id });
			const third = await artists.create(
				tenant,
				input({ name: "Loose", slug: "loose" }),
				owner,
			);
			return [first, second, third];
		});
		const edit = async (id: string) =>
			(await client.get(`${base}/${id}/edit`).withInertia().loginAs(owner))
				.inertiaProps;

		const own = await edit(mine.id);
		assert.equal(own.artist.name, "Mine");
		assert.isTrue(own.artist.isMine);
		assert.isTrue(own.canLink);
		assert.isFalse((await edit(theirs.id)).canLink);
		// Linking "Loose" would be a second profile for the owner.
		assert.isFalse((await edit(loose.id)).canLink);
	});

	test("an unlinked profile offers the link while the owner has no profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const loose = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		const response = await client
			.get(`${base}/${loose.id}/edit`)
			.withInertia()
			.loginAs(owner);

		assert.isTrue(response.inertiaProps.canLink);
		assert.isFalse(response.inertiaProps.artist.isMine);
	});

	test("an owner links an existing profile to themselves from the edit form", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const loose = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		const response = await client
			.put(`${base}/${loose.id}`)
			.fields({ name: "Sita Rai", slug: "sita", linkToMe: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const [saved] = await listOf(tenant);
		assert.equal(saved.userId, owner.id);
		const edit = await client
			.get(`${base}/${loose.id}/edit`)
			.withInertia()
			.loginAs(owner);
		assert.isTrue(edit.inertiaProps.artist.isMine);
	});

	test("linking a second profile from the edit form comes back as a field error on linkToMe and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const loose = await inTenant(tenant, async () => {
			await artists.create(
				tenant,
				input({ name: "Mine", slug: "mine", linkToMe: true }),
				owner,
			);
			return artists.create(tenant, input(), owner);
		});

		const response = await client
			.put(`${base}/${loose.id}`)
			.fields({ name: "Renamed", slug: "renamed", linkToMe: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "linkToMe", "You already have a profile.");
		const saved = await inTenant(tenant, () => Artist.findOrFail(loose.id));
		assert.isNull(saved.userId);
		assert.equal(saved.name, "Sita Rai");
		assert.equal(saved.slug, "sita");
	});

	test("saving changes the fields and keeps the photo", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita", visible: "on" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner);
		const [artist] = await listOf(tenant);

		const response = await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita R.", slug: "sita-r", visible: "on", bio: "New" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita R." saved.');
		const [saved] = await listOf(tenant);
		assert.equal(saved.slug, "sita-r");
		assert.equal(saved.bio, "New");
		assert.equal(saved.photoKey, artist.photoKey);
	});

	test("unchecked boxes on an edit turn the artist off", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita" })
			.withCsrfToken()
			.loginAs(owner);

		const [saved] = await listOf(tenant);
		assert.isFalse(saved.visible);
		assert.isFalse(saved.acceptingInquiries);
	});

	test("an owner removes the photo", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner);
		const [artist] = await listOf(tenant);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita", removePhoto: "on" })
			.withCsrfToken()
			.loginAs(owner);

		const [saved] = await listOf(tenant);
		assert.isNull(saved.photoKey);
		assert.isNull(saved.photoWidth);
	});

	test("saving a slug another artist uses comes back as a field error and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const first = await inTenant(tenant, async () => {
			await artists.create(tenant, input({ name: "Bea", slug: "bea" }), owner);
			return artists.create(tenant, input(), owner);
		});

		const response = await client
			.put(`${base}/${first.id}`)
			.fields({ name: "Renamed", slug: "bea" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "slug");
		const saved = await inTenant(tenant, () => Artist.findOrFail(first.id));
		assert.equal(saved.name, "Sita Rai");
		assert.equal(saved.slug, "sita");
	});
});
