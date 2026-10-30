import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { polyglot, testImages, uploadOf } from "#tests/helpers/images";
import { failDeletes } from "#tests/helpers/storage_failures";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedImages,
	tempUploads,
} from "#tests/helpers/uploads";
import { assertValidationError } from "#tests/helpers/validation";

const PURPOSE = "artist_work_photo";
const LIMIT_MESSAGE =
	"This artist already has 100 photos. Remove one to add another.";
const ALT_MESSAGE = "Keep the description to one line, up to 200 characters.";

const images = new ImageService();
const artistService = new ArtistService(images);
const photoService = new WorkPhotoService(images, artistService);

/** The artist's rows, newest first. */
const rows = (tenant: Tenant, artistId: string) =>
	inTenant(tenant, () =>
		ArtistWorkPhoto.query()
			.where("artist_id", artistId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc"),
	);

/** POST a file as `photo` to an artist's photos. */
const upload = (
	client: ApiClient,
	user: User,
	tenant: Tenant,
	artistId: string,
	data: Buffer,
	filename = "work.jpg",
) =>
	client
		.post(`/t/${tenant.slug}/artists/${artistId}/photos`)
		.file("photo", data, { filename })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

/** A photo added through the service, with its real files. */
async function realPhoto(tenant: Tenant, owner: User, artistId: string) {
	const artist = await inTenant(tenant, () =>
		artistService.findFor(tenant, artistId),
	);
	return inTenant(tenant, async () =>
		photoService.add(
			tenant,
			{ userId: owner.id, role: "owner" },
			artist,
			await uploadOf(await testImages.jpeg(1600, 1200)),
		),
	);
}

test.group("Work photo uploads (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner uploads a photo to an artist: back to the edit page with a note, one row, its files on the public disk", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			await testImages.jpeg(1600, 1200),
		);

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		response.assertFlashMessage("success", "Photo added.");
		const [photo] = await rows(tenant, sita.id);
		assert.equal(photo.width, 1600);
		assert.isNull(photo.alt);
		assert.deepEqual(photo.styles, []);
		assert.isFalse(photo.healed);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
	});

	test("a photo from a phone loses its metadata", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			await testImages.phonePhoto(1500, 1000),
		);

		response.assertStatus(302);
		const [photo] = await rows(tenant, sita.id);
		// The sideways phone photo is stored upright (1000 x 1500), without GPS.
		assert.equal(photo.width, 1000);
		assert.equal(photo.height, 1500);
	});

	test("the 101st photo gets a field error and stores nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			for (let n = 0; n < 100; n++) await addWorkPhoto(tenant, sita);
		});
		const before = await tempUploads();

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			await testImages.jpeg(1600, 1200),
		);

		assertValidationError(response, "photo", LIMIT_MESSAGE);
		assert.lengthOf(await rows(tenant, sita.id), 100);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("an artist member uploads to their own profile", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		assert.isNotNull(owner);

		const response = await upload(
			client,
			member,
			tenant,
			own.id,
			await testImages.jpeg(1600, 1200),
		);

		response.assertStatus(302);
		response.assertFlashMessage("success", "Photo added.");
		assert.lengthOf(await rows(tenant, own.id), 1);
	});

	test("an artist member uploading to another artist gets a 404 and nothing is stored or left in temp", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = await artistIn(tenant);
		await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const other = await addArtist(tenant, owner, {
			name: "Mira",
			slug: "mira",
		});
		const before = await tempUploads();

		const response = await upload(
			client,
			member,
			tenant,
			other.id,
			await testImages.jpeg(1600, 1200),
		);

		response.assertStatus(404);
		assert.lengthOf(await rows(tenant, other.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("another studio's artist id is a 404 with any body", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOwner("work-a", "Work A");
		const b = await studioWithOwner("work-b", "Work B");
		const artistB = await addArtist(b.tenant, b.owner);

		const withFile = await upload(
			client,
			a.owner,
			a.tenant,
			artistB.id,
			await testImages.jpeg(1600, 1200),
		);
		const withoutFile = await client
			.post(`/t/${a.tenant.slug}/artists/${artistB.id}/photos`)
			.withCsrfToken()
			.loginAs(a.owner)
			.redirects(0);

		withFile.assertStatus(404);
		withoutFile.assertStatus(404);
		assert.lengthOf(await rows(b.tenant, artistB.id), 0);
		assert.deepEqual(await storedImages(a.tenant, PURPOSE), []);
		assert.deepEqual(await storedImages(b.tenant, PURPOSE), []);
	});

	test("a deleted artist's id is a 404", async ({ client, assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () => artistService.delete(tenant, sita));

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			await testImages.jpeg(1600, 1200),
		);

		response.assertStatus(404);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("without a file the photo field says to choose one", async ({
		client,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await client
			.post(`/t/${tenant.slug}/artists/${sita.id}/photos`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "photo", "Choose a photo to upload.");
	});

	test("an SVG, a HEIC and a PDF are refused by extension; a GIF renamed .jpg, a 49 MP PNG and a text file renamed .png by the decoder; nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
		const cases: [string, Buffer, string, string][] = [
			["svg", svg, "work.svg", "Upload a JPEG, PNG or WebP image."],
			["svg as .png", svg, "work.png", "Upload a JPEG, PNG or WebP image."],
			[
				"heic",
				await testImages.heif(),
				"work.heic",
				"Upload a JPEG, PNG or WebP image.",
			],
			[
				"heic as .jpg",
				await testImages.heif(),
				"work.jpg",
				"Upload a JPEG, PNG or WebP image.",
			],
			[
				"pdf",
				Buffer.from("%PDF-1.4 hello"),
				"work.pdf",
				"Upload a JPEG, PNG or WebP image.",
			],
			[
				"gif as .jpg",
				await testImages.gif(),
				"work.jpg",
				"Upload a JPEG, PNG or WebP image.",
			],
			[
				"text as .png",
				Buffer.from("hello"),
				"work.png",
				"Upload a JPEG, PNG or WebP image.",
			],
			[
				"49 MP png",
				await testImages.huge(),
				"work.png",
				"This image is too large. Use one under 40 megapixels.",
			],
		];
		const before = await tempUploads();

		for (const [name, data, filename, message] of cases) {
			const response = await upload(
				client,
				owner,
				tenant,
				sita.id,
				data,
				filename,
			);
			assertValidationError(response, "photo", message);
			assert.lengthOf(await rows(tenant, sita.id), 0, name);
			assert.deepEqual(await storedImages(tenant, PURPOSE), [], name);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a file over 10 MB is a field error and stores nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			Buffer.alloc(11 * 1024 * 1024),
			"big.jpg",
		);

		assertValidationError(response, "photo", "Use an image of 10 MB or less.");
		assert.lengthOf(await rows(tenant, sita.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("a polyglot upload is processed like any image (its bytes are checked in image_service.spec.ts)", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await upload(
			client,
			owner,
			tenant,
			sita.id,
			await polyglot(),
		);

		response.assertStatus(302);
		assert.lengthOf(await rows(tenant, sita.id), 1);
		assert.isAbove((await storedImages(tenant, PURPOSE)).length, 1);
	});
});

test.group("Work photo details and removal (TAT-116, TAT-126)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A save of the description alone: no style box and no healed box are sent. */
	const describe = (
		client: ApiClient,
		user: User,
		tenant: Tenant,
		id: string,
		alt: string | null,
	) =>
		client
			.put(`/t/${tenant.slug}/artists/photos/${id}`)
			.form({ alt })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

	/** A save as the tray sends it: the style boxes that are ticked and, ticked, the healed box. */
	const saveDetails = (
		client: ApiClient,
		user: User,
		tenant: Tenant,
		id: string,
		fields: { alt: string; styles?: string[]; healed?: string },
	) =>
		client
			.put(`/t/${tenant.slug}/artists/photos/${id}`)
			.fields({
				alt: fields.alt,
				...(fields.styles ? { "styles[]": fields.styles } : {}),
				...(fields.healed ? { healed: fields.healed } : {}),
			})
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

	test("an owner describes a photo, in Devanagari too, and clears it", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const saved = await describe(
			client,
			owner,
			tenant,
			photo.id,
			"  कालो माछा, बाहुलामा  ",
		);
		saved.assertStatus(302);
		saved.assertHeader("location", `/t/${tenant.slug}/artists/${sita.id}/edit`);
		saved.assertFlashMessage("success", "Photo saved.");
		assert.equal((await rows(tenant, sita.id))[0].alt, "कालो माछा, बाहुलामा");

		for (const empty of ["", " ", "   "]) {
			await describe(client, owner, tenant, photo.id, "again").then((r) =>
				r.assertStatus(302),
			);
			const cleared = await describe(client, owner, tenant, photo.id, empty);
			cleared.assertStatus(302);
			assert.isNull(
				(await rows(tenant, sita.id))[0].alt,
				JSON.stringify(empty),
			);
		}
	});

	test("a description with a line break, a control character or over 200 characters is a field error and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { alt: "Koi" }),
		);

		for (const alt of [
			"a\nb",
			"a\r\nb",
			"a\u0000b",
			"a b",
			"a b",
			"x".repeat(201),
			"क".repeat(201),
		]) {
			const response = await describe(client, owner, tenant, photo.id, alt);
			assertValidationError(response, "alt", ALT_MESSAGE);
			assert.equal(
				(await rows(tenant, sita.id))[0].alt,
				"Koi",
				JSON.stringify(alt),
			);
		}
		// Exactly 200 is fine.
		const ok = await describe(client, owner, tenant, photo.id, "x".repeat(200));
		ok.assertStatus(302);
	});

	test("HTML in a description is stored as text", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const response = await describe(
			client,
			owner,
			tenant,
			photo.id,
			'"><script>alert(1)</script>',
		);

		response.assertStatus(302);
		assert.equal(
			(await rows(tenant, sita.id))[0].alt,
			'"><script>alert(1)</script>',
		);
	});

	test("an owner saves a photo's description, two styles and the healed mark", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const response = await saveDetails(client, owner, tenant, photo.id, {
			alt: "Koi",
			styles: ["realism", "blackwork"],
			healed: "1",
		});

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		response.assertFlashMessage("success", "Photo saved.");
		const [saved] = await rows(tenant, sita.id);
		assert.equal(saved.alt, "Koi");
		// As sent, not in the list's order.
		assert.deepEqual(saved.styles, ["realism", "blackwork"]);
		assert.isTrue(saved.healed);
	});

	test("a save without style boxes or the healed box clears them", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, {
				alt: "Koi",
				styles: ["realism"],
				healed: true,
			}),
		);

		const response = await saveDetails(client, owner, tenant, photo.id, {
			alt: "Koi",
		});

		response.assertStatus(302);
		const [saved] = await rows(tenant, sita.id);
		assert.equal(saved.alt, "Koi");
		assert.deepEqual(saved.styles, []);
		assert.isFalse(saved.healed);
	});

	test("exactly three styles are accepted", async ({ client, assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const response = await saveDetails(client, owner, tenant, photo.id, {
			alt: "Koi",
			styles: ["realism", "blackwork", "colour"],
		});

		response.assertStatus(302);
		assert.lengthOf((await rows(tenant, sita.id))[0].styles, 3);
	});

	test("a fourth style is a field error and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, {
				alt: "Koi",
				styles: ["realism"],
				healed: true,
			}),
		);

		const response = await saveDetails(client, owner, tenant, photo.id, {
			alt: "Changed",
			styles: ["realism", "blackwork", "colour", "japanese"],
		});

		assertValidationError(response, "styles", "Pick up to 3 styles.");
		const [saved] = await rows(tenant, sita.id);
		assert.equal(saved.alt, "Koi");
		assert.deepEqual(saved.styles, ["realism"]);
		assert.isTrue(saved.healed);
	});

	test("an unknown style is a field error and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { alt: "Koi", styles: ["realism"] }),
		);

		// The error sits under "styles", not "styles.1", as on the artist form.
		const response = await saveDetails(client, owner, tenant, photo.id, {
			alt: "Changed",
			styles: ["realism", "nope"],
		});

		assertValidationError(response, "styles", "Pick styles from the list.");
		const [saved] = await rows(tenant, sita.id);
		assert.equal(saved.alt, "Koi");
		assert.deepEqual(saved.styles, ["realism"]);
	});

	test("the move route is gone", async ({ client }) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const response = await client
			.post(`/t/${tenant.slug}/artists/photos/${photo.id}/move`)
			.form({ direction: "down" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
	});

	test("the edit page lists the photos newest first with their styles and healed mark", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const now = DateTime.now();
		// Added out of date order: the dates decide, not the order of creation.
		const [middle, oldest, newest] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, {
				alt: "middle",
				createdAt: now.minus({ days: 2 }),
			}),
			await addWorkPhoto(tenant, sita, {
				alt: "oldest",
				createdAt: now.minus({ days: 3 }),
			}),
			await addWorkPhoto(tenant, sita, {
				alt: "newest",
				createdAt: now.minus({ days: 1 }),
				styles: ["realism", "retired-style"],
				healed: true,
			}),
		]);

		const response = await client
			.get(`/t/${tenant.slug}/artists/${sita.id}/edit`)
			.withInertia()
			.loginAs(owner);

		const { workPhotos } = response.inertiaProps;
		assert.deepEqual(
			workPhotos.map((photo: { id: string }) => photo.id),
			[newest.id, middle.id, oldest.id],
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
		// The stored slugs as they are, then the defaults.
		assert.deepEqual(workPhotos[0].styles, ["realism", "retired-style"]);
		assert.isTrue(workPhotos[0].healed);
		assert.deepEqual(workPhotos[1].styles, []);
		assert.isFalse(workPhotos[1].healed);
	});

	test("removing a photo deletes the row and its files; the others keep their place", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const first = await realPhoto(tenant, owner, sita.id);
		const second = await realPhoto(tenant, owner, sita.id);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 8);

		const response = await client
			.delete(`/t/${tenant.slug}/artists/photos/${first.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		response.assertFlashMessage("success", "Photo removed.");
		const left = await rows(tenant, sita.id);
		assert.deepEqual(
			left.map((row) => row.id),
			[second.id],
		);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
	});

	test("an artist changes their own photos and none of another artist's", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
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
		const [older, newer, theirs, theirs2] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, own),
			await addWorkPhoto(tenant, own),
			await addWorkPhoto(tenant, other, { alt: "Theirs" }),
			await addWorkPhoto(tenant, other),
		]);
		const before = await rows(tenant, other.id);

		const attempts = [
			await describe(client, member, tenant, theirs.id, "Hijacked"),
			await saveDetails(client, member, tenant, theirs.id, {
				alt: "Hijacked",
				styles: ["realism"],
				healed: "1",
			}),
			await client
				.delete(`/t/${tenant.slug}/artists/photos/${theirs2.id}`)
				.withCsrfToken()
				.loginAs(member)
				.redirects(0),
		];
		for (const response of attempts) response.assertStatus(404);
		assert.deepEqual(
			(await rows(tenant, other.id)).map((row) => row.serialize()),
			before.map((row) => row.serialize()),
		);

		const own1 = await describe(client, member, tenant, newer.id, "Mine");
		own1.assertStatus(302);
		assert.deepEqual(
			(await rows(tenant, own.id)).map((row) => [row.id, row.alt]),
			[
				[newer.id, "Mine"],
				[older.id, null],
			],
		);
		const removed = await client
			.delete(`/t/${tenant.slug}/artists/photos/${older.id}`)
			.withCsrfToken()
			.loginAs(member)
			.redirects(0);
		removed.assertStatus(302);
		assert.lengthOf(await rows(tenant, own.id), 1);
	});

	test("an artist unlinked by an owner can no longer change the photos", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, own));
		await inTenant(tenant, () => artistService.unlinkUser(tenant, member.id));

		const response = await describe(client, member, tenant, photo.id, "Late");

		response.assertStatus(404);
		assert.isNull((await rows(tenant, own.id))[0].alt);
	});

	test("another studio's photo id is a 404 for every route", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOwner("work-a", "Work A");
		const b = await studioWithOwner("work-b", "Work B");
		const artistB = await addArtist(b.tenant, b.owner);
		const photoB = await inTenant(b.tenant, () =>
			addWorkPhoto(b.tenant, artistB, { alt: "B" }),
		);

		const responses = [
			await describe(client, a.owner, a.tenant, photoB.id, "Hijacked"),
			await saveDetails(client, a.owner, a.tenant, photoB.id, {
				alt: "Hijacked",
				styles: ["realism"],
				healed: "1",
			}),
			await client
				.delete(`/t/${a.tenant.slug}/artists/photos/${photoB.id}`)
				.withCsrfToken()
				.loginAs(a.owner)
				.redirects(0),
		];

		for (const response of responses) response.assertStatus(404);
		const [still] = await rows(b.tenant, artistB.id);
		assert.equal(still.alt, "B");
		assert.deepEqual(still.styles, []);
		assert.isFalse(still.healed);
	});
});

test.group(
	"A removal that can't delete the files fails visibly (TAT-116 fix round 1)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("the photo stays with an error message, and removing again once storage is back succeeds", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner();
			const sita = await addArtist(tenant, owner);
			const photo = await realPhoto(tenant, owner, sita.id);
			const remove = () =>
				client
					.delete(`/t/${tenant.slug}/artists/photos/${photo.id}`)
					.withCsrfToken()
					.loginAs(owner)
					.redirects(0);
			const failing = failDeletes("public", () => true);

			let refused: Awaited<ReturnType<typeof remove>>;
			try {
				refused = await remove();
			} finally {
				failing.restore();
			}

			refused.assertStatus(302);
			refused.assertHeader(
				"location",
				`/t/${tenant.slug}/artists/${sita.id}/edit`,
			);
			refused.assertFlashMessage(
				"error",
				"Couldn't remove the photo, try again.",
			);
			assert.notExists(refused.flashMessage("success"));
			assert.lengthOf(await rows(tenant, sita.id), 1);
			assert.lengthOf(await storedImages(tenant, PURPOSE), 4);

			const retry = await remove();
			retry.assertStatus(302);
			retry.assertFlashMessage("success", "Photo removed.");
			assert.lengthOf(await rows(tenant, sita.id), 0);
			assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		});
	},
);
