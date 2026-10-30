import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import { TATTOO_STYLES } from "#modules/artists/styles";
import ImageService from "#modules/media/services/image_service";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { testImages } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";
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
	styles: [],
	instagramUrl: null,
	facebookUrl: null,
	tiktokUrl: null,
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

	test("a multipart PUT with a new photo reaches the controller with its fields and replaces the photo", async ({
		client,
		assert,
	}) => {
		// Inertia's form sends a real multipart PUT (no _method field); the body
		// is read by WebMultipartMiddleware, not by the body parser (TAT-38).
		const { owner, tenant } = await studioWithOwner();
		await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita", visible: "on" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner);
		const [artist] = await listOf(tenant);
		const before = await tempUploads();

		const response = await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita R.", slug: "sita-r", visible: "on", bio: "New" })
			.file("photo", await testImages.jpeg(), { filename: "new.jpg" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita R." saved.');
		const [saved] = await listOf(tenant);
		assert.equal(saved.slug, "sita-r");
		assert.equal(saved.bio, "New");
		assert.isNotNull(saved.photoKey);
		assert.notEqual(saved.photoKey, artist.photoKey);
		assert.deepEqual(await newTempUploads(before), []);
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

test.group("An artist's styles and social links", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner saves two styles and an Instagram link", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({
				name: "Sita Rai",
				slug: "sita",
				"styles[]": ["blackwork", "fine-line"],
				instagramUrl: "https://instagram.com/sita",
				// The form sends every box: an empty one is no link.
				facebookUrl: "",
				tiktokUrl: "",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const [artist] = await listOf(tenant);
		assert.deepEqual(artist.styles, ["blackwork", "fine-line"]);
		assert.equal(artist.instagramUrl, "https://instagram.com/sita");
		assert.isNull(artist.facebookUrl);
		assert.isNull(artist.tiktokUrl);
	});

	test("no style boxes sent means none", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(
				tenant,
				input({
					styles: ["blackwork", "realism"],
					tiktokUrl: "https://tiktok.com/@sita",
				}),
				owner,
			),
		);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [saved] = await listOf(tenant);
		assert.deepEqual(saved.styles, []);
		assert.isNull(saved.tiktokUrl);
	});

	test("a sixth style is a field error on styles", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ styles: ["blackwork"] }), owner),
		);

		const response = await client
			.put(`${base}/${artist.id}`)
			.fields({
				name: "Renamed",
				slug: "sita",
				"styles[]": [
					"blackwork",
					"fine-line",
					"traditional",
					"realism",
					"colour",
					"japanese",
				],
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "styles", "Pick up to 5 styles.");
		const saved = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.deepEqual(saved.styles, ["blackwork"]);
		assert.equal(saved.name, "Sita Rai");
	});

	test("exactly five styles are accepted", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		// Not the list's order: the order sent is the order stored.
		const sent = ["realism", "blackwork", "colour", "fine-line", "japanese"];

		const response = await client
			.post(base)
			.fields({ name: "Sita Rai", slug: "sita", "styles[]": sent })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const [artist] = await listOf(tenant);
		assert.deepEqual(artist.styles, sent);
	});

	test("an unknown style is a field error", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ styles: ["blackwork"] }), owner),
		);

		const response = await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Renamed", slug: "sita", "styles[]": ["nope"] })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "styles", "Pick styles from the list.");
		const saved = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.deepEqual(saved.styles, ["blackwork"]);
		assert.equal(saved.name, "Sita Rai");
	});

	test("a plain-http link is a field error", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({
				name: "Sita Rai",
				slug: "sita",
				facebookUrl: "http://facebook.com/sita",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"facebookUrl",
			"Enter a full link that starts with https://",
		);
		assert.isEmpty(await listOf(tenant));
	});

	test("styles survive a save that also uploads a photo", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.post(base)
			.fields({
				name: "Sita Rai",
				slug: "sita",
				"styles[]": ["blackwork", "fine-line"],
			})
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const [artist] = await listOf(tenant);
		assert.isNotNull(artist.photoKey);
		assert.deepEqual(artist.styles, ["blackwork", "fine-line"]);
	});

	test("the edit form offers every style and shows a dropped one unchecked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		// A slug that has since left the list, written past the validator.
		await inTenant(tenant, () =>
			Artist.query()
				.where("id", artist.id)
				.update({ styles: ["blackwork", "retired-style"] }),
		);

		const edit = await client
			.get(`${base}/${artist.id}/edit`)
			.withInertia()
			.loginAs(owner);

		const { styleOptions } = edit.inertiaProps;
		assert.lengthOf(styleOptions, 18);
		assert.deepEqual(styleOptions[0], { slug: "blackwork", name: "Blackwork" });
		assert.notInclude(
			styleOptions.map((option: { slug: string }) => option.slug),
			"retired-style",
		);
		// Only listed styles reach the form, so the dropped one has no box to check.
		assert.deepEqual(edit.inertiaProps.artist.styles, ["blackwork"]);

		await client
			.put(`${base}/${artist.id}`)
			.fields({ name: "Sita Rai", slug: "sita", "styles[]": "blackwork" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const saved = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.deepEqual(saved.styles, ["blackwork"]);
	});

	test("the add form offers every style, in order", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		assert.deepEqual(
			response.inertiaProps.styleOptions,
			TATTOO_STYLES.map(({ slug, name }) => ({ slug, name })),
		);
	});
});

test.group("The work photos on the artist form (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the edit page carries the photos newest first, each with only its id, thumbnail, description, styles and healed mark", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const [older, newer] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, { alt: "Koi on the forearm" }),
			await addWorkPhoto(tenant, sita),
		]);

		const response = await client
			.get(`${base}/${sita.id}/edit`)
			.withInertia()
			.loginAs(owner);

		const { workPhotos } = response.inertiaProps;
		assert.lengthOf(workPhotos, 2);
		assert.deepEqual(
			workPhotos.map((photo: { id: string }) => photo.id),
			[newer.id, older.id],
		);
		for (const photo of workPhotos) {
			assert.deepEqual(Object.keys(photo).sort(), [
				"alt",
				"healed",
				"id",
				"styles",
				"thumbnailUrl",
			]);
		}
		assert.isNull(workPhotos[0].alt);
		assert.equal(workPhotos[1].alt, "Koi on the forearm");
		// The 320 px copy, in the studio's own folder.
		assert.match(
			new URL(workPhotos[1].thumbnailUrl).pathname,
			new RegExp(
				`^/uploads/tenants/${tenant.id}/artist_work_photo/.+\\.320w\\.jpg$`,
			),
		);
		// Never the key, the tenant or artist ids, positions or timestamps.
		const text = JSON.stringify(workPhotos);
		for (const word of [
			"imageKey",
			"tenantId",
			"artistId",
			"position",
			"createdAt",
		]) {
			assert.notInclude(text, word);
		}
		assert.notInclude(text, sita.id);
	});

	test("the create page has no photos yet", async ({ client, assert }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		assert.deepEqual(response.inertiaProps.workPhotos, []);
	});

	test("an artist's own page carries their photos, and nobody else's", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const other = await addArtist(tenant, owner, {
			name: "Mira",
			slug: "mira",
		});
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, own, { alt: "mine" });
			await addWorkPhoto(tenant, other, { alt: "theirs" });
		});

		const response = await client
			.get(`${base}/${own.id}/edit`)
			.withInertia()
			.loginAs(member);

		assert.deepEqual(
			response.inertiaProps.workPhotos.map(
				(photo: { alt: string }) => photo.alt,
			),
			["mine"],
		);
		const theirs = await client
			.get(`${base}/${other.id}/edit`)
			.withInertia()
			.loginAs(member);
		theirs.assertStatus(404);
	});
});
