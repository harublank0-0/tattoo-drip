import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { ArtistSlugTakenError } from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import { InvalidImageError } from "#modules/media/errors";
import { variantsOfKey } from "#modules/media/variants";
import { withDbContext } from "#services/db_context";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { whereNoSavepointOpens } from "#tests/helpers/transactions";

const photo = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

function makeService() {
	const images = new RecordingImageService();
	return { images, artists: new ArtistService(images) };
}

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

test.group("ArtistService photo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the photo on the public disk with its size", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();

		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);

		assert.match(
			artist.photoKey ?? "",
			new RegExp(`^tenants/${tenant.id}/artist_photo/`),
		);
		assert.equal(artist.photoWidth, 300);
		assert.equal(artist.photoHeight, 200);
		assert.isTrue(await exists(artist.photoKey ?? ""));
	});

	test("a file that isn't an image is an InvalidImageError and creates nothing", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					artists.create(
						tenant,
						input({ photo: await uploadOf(await testImages.gif()) }),
						owner,
					),
				),
			InvalidImageError,
		);

		assert.lengthOf(await inTenant(tenant, () => artists.list(tenant)), 0);
	});

	test("saving without a new photo keeps all three photo columns", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);

		const saved = await inTenant(tenant, () =>
			artists.update(tenant, artist, input({ name: "Sita R." }), owner),
		);

		assert.equal(saved.photoKey, artist.photoKey);
		assert.equal(saved.photoWidth, 300);
		assert.equal(saved.photoHeight, 200);
		assert.isTrue(await exists(artist.photoKey ?? ""));
	});

	test("replacing a photo keeps the old file until the outermost transaction commits", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		let newKey = "";

		await withDbContext({ tenantId: tenant.id }, async () => {
			const saved = await artists.update(
				tenant,
				artist,
				input({ photo: await photo() }),
				owner,
			);
			newKey = saved.photoKey ?? "";
			assert.notEqual(newKey, oldKey);
			assert.isTrue(
				await exists(oldKey),
				"the old photo stays until the commit",
			);
		});

		assert.isFalse(await exists(oldKey));
		assert.isTrue(await exists(newKey));
	});

	test("a later failure keeps the old photo and drops the new one", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		let newKey = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const saved = await artists.update(
						tenant,
						artist,
						input({ photo: await photo() }),
						owner,
					);
					newKey = saved.photoKey ?? "";
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isTrue(await exists(oldKey));
		assert.isFalse(await exists(newKey));
		const row = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.equal(row.photoKey, oldKey);
	});

	test("a later failure after removePhoto keeps the old photo file and the row's photo", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const saved = await artists.update(
						tenant,
						artist,
						input({ removePhoto: true }),
						owner,
					);
					assert.isNull(saved.photoKey);
					assert.isTrue(
						await exists(oldKey),
						"the old photo stays until the commit",
					);
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isTrue(await exists(oldKey));
		const row = await inTenant(tenant, () => Artist.findOrFail(artist.id));
		assert.equal(row.photoKey, oldKey);
		assert.equal(row.photoWidth, 300);
		assert.equal(row.photoHeight, 200);
	});

	test("removePhoto clears the three columns and deletes the file after the commit", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";

		const saved = await inTenant(tenant, () =>
			artists.update(tenant, artist, input({ removePhoto: true }), owner),
		);

		assert.isNull(saved.photoKey);
		assert.isNull(saved.photoWidth);
		assert.isNull(saved.photoHeight);
		assert.isFalse(await exists(oldKey));
	});

	test("a slug conflict after the photo was stored removes the new photo", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();
		await inTenant(tenant, () => artists.create(tenant, input(), owner));

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					artists.create(
						tenant,
						input({ name: "Other", photo: await photo() }),
						owner,
					),
				),
			ArtistSlugTakenError,
		);

		assert.lengthOf(images.keys, 1);
		for (const key of images.keys) {
			assert.isFalse(await exists(key), `${key} was left on the public disk`);
		}
	});

	test("create leaves no file behind when its transaction cannot open", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					artists.create(tenant, input({ photo: await photo() }), owner),
				),
			/cannot open/,
		);

		assert.lengthOf(
			images.keys,
			0,
			"nothing should be stored if it cannot open",
		);
	});

	test("update leaves no new file behind when its transaction cannot open, and keeps the old one", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await photo() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		images.keys.length = 0;

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					artists.update(
						tenant,
						artist,
						input({ photo: await photo() }),
						owner,
					),
				),
			/cannot open/,
		);

		assert.lengthOf(images.keys, 0);
		assert.isTrue(await exists(oldKey), "the stored photo stays");
	});
});

const widePhoto = async () => uploadOf(await testImages.jpeg(1000, 800));
/** The image's key and the keys of the copies it names. */
const filesOfKey = (key: string) => [
	key,
	...variantsOfKey(key).map((copy) => copy.key),
];

test.group("ArtistService photo copies (TAT-112)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("replacing a photo deletes the old photo's copies after the commit and keeps the new ones", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await widePhoto() }), owner),
		);
		const oldKey = artist.photoKey ?? "";
		const oldFiles = filesOfKey(oldKey);
		assert.lengthOf(oldFiles, 3, "a 1000 px photo has two copies");
		let newKey = "";

		await withDbContext({ tenantId: tenant.id }, async () => {
			const saved = await artists.update(
				tenant,
				artist,
				input({ photo: await widePhoto() }),
				owner,
			);
			newKey = saved.photoKey ?? "";
			for (const key of oldFiles) {
				assert.isTrue(await exists(key), `${key} stays until the commit`);
			}
		});

		for (const key of oldFiles) {
			assert.isFalse(await exists(key), `${key} was left behind`);
		}
		const newFiles = filesOfKey(newKey);
		assert.lengthOf(newFiles, 3);
		for (const key of newFiles) {
			assert.isTrue(await exists(key), `${key} is missing`);
		}
		const idOf = (key: string) => key.split("/").at(-1)?.split(".")[0];
		assert.notEqual(idOf(newKey), idOf(oldKey), "the copies share no id");
	});

	test("removePhoto deletes the copies too", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const { artists } = makeService();
		const artist = await inTenant(tenant, async () =>
			artists.create(tenant, input({ photo: await widePhoto() }), owner),
		);
		const files = filesOfKey(artist.photoKey ?? "");
		assert.lengthOf(files, 3);

		await inTenant(tenant, () =>
			artists.update(tenant, artist, input({ removePhoto: true }), owner),
		);

		for (const key of files) {
			assert.isFalse(await exists(key), `${key} was left behind`);
		}
	});

	test("a slug conflict after the photo was stored removes the new photo and its copies", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { images, artists } = makeService();
		await inTenant(tenant, () => artists.create(tenant, input(), owner));

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					artists.create(
						tenant,
						input({ name: "Other", photo: await widePhoto() }),
						owner,
					),
				),
			ArtistSlugTakenError,
		);

		assert.lengthOf(images.keys, 1);
		const files = filesOfKey(images.keys[0]);
		assert.lengthOf(files, 3);
		for (const key of files) {
			assert.isFalse(await exists(key), `${key} was left on the public disk`);
		}
	});
});
