import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { WorkPhotoLimitError } from "#modules/artists/errors";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import { InvalidImageError } from "#modules/media/errors";
import { withDbContext } from "#services/db_context";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { recordQueries } from "#tests/helpers/query_count";
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
} from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

const PURPOSE = "artist_work_photo";
const upload = async () => uploadOf(await testImages.jpeg(1600, 1200));

function makeService() {
	const images = new RecordingImageService();
	const artists = new ArtistService(images);
	return { images, artists, photos: new WorkPhotoService(images, artists) };
}

/** A service whose first (unlocked) count stages "another upload landed meanwhile". */
class RacingService extends WorkPhotoService {
	calls = 0;
	constructor(
		images: RecordingImageService,
		artists: ArtistService,
		private raced: () => Promise<unknown>,
	) {
		super(images, artists);
	}

	protected override async countPhotos(
		tenant: { id: string },
		artistId: string,
		client?: QueryClientContract,
	) {
		this.calls++;
		const before = await super.countPhotos(tenant, artistId, client);
		if (this.calls === 1) await this.raced();
		return before;
	}
}

const owner = (userId: string): ProfileEditor => ({ userId, role: "owner" });
const asArtist = (userId: string): ProfileEditor => ({
	userId,
	role: "artist",
});

const order = async (tenant: { id: string }, artistId: string) =>
	inTenant(tenant, async () =>
		(
			await ArtistWorkPhoto.query()
				.where("artist_id", artistId)
				.orderBy("position")
		).map((photo) => ({ id: photo.id, position: photo.position })),
	);

test.group("WorkPhotoService (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner adds photos to any artist in order; the seventh is refused before it is decoded", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, photos } = makeService();
		const editor = owner(user.id);

		for (let n = 0; n < MAX_WORK_PHOTOS; n++) {
			const added = await inTenant(tenant, async () =>
				photos.add(tenant, editor, sita, await upload()),
			);
			assert.equal(added.position, n);
			assert.equal(added.width, 1600);
			assert.match(
				added.imageKey,
				new RegExp(`^tenants/${tenant.id}/${PURPOSE}/`),
			);
		}
		const filesBefore = await storedImages(tenant, PURPOSE);
		const storedBefore = images.keys.length;
		assert.lengthOf(filesBefore, MAX_WORK_PHOTOS * 4);

		const file = await upload();
		await assert.rejects(
			() => inTenant(tenant, () => photos.add(tenant, editor, sita, file)),
			WorkPhotoLimitError,
		);

		assert.equal(images.keys.length, storedBefore, "no seventh store");
		assert.deepEqual(await storedImages(tenant, PURPOSE), filesBefore);
		const listed = await inTenant(tenant, () => photos.list(tenant, sita));
		assert.deepEqual(
			listed.map((photo) => photo.position),
			[0, 1, 2, 3, 4, 5],
		);
	});

	test("an unusable file is an InvalidImageError and adds nothing", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();

		const file = await uploadOf(await testImages.heif());
		await assert.rejects(
			() =>
				inTenant(tenant, () => photos.add(tenant, owner(user.id), sita, file)),
			InvalidImageError,
		);

		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		assert.lengthOf(await inTenant(tenant, () => photos.list(tenant, sita)), 0);
	});

	test("two uploads racing for the sixth place: the second is refused under the lock and its file is deleted", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const images = new RecordingImageService();
		const artists = new ArtistService(images);
		const racing = new RacingService(images, artists, () =>
			// The other upload lands its sixth photo after the first count.
			addWorkPhoto(tenant, sita),
		);
		for (let n = 0; n < 5; n++) {
			await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		}

		const file = await upload();
		// Caught inside the context, as the controller does: the failed level
		// rolls back by itself, and the other upload's sixth photo stays.
		await inTenant(tenant, async () => {
			await assert.rejects(
				() => racing.add(tenant, owner(user.id), sita, file),
				WorkPhotoLimitError,
			);
			assert.equal(racing.calls, 2, "counted unlocked, then under the lock");
			assert.lengthOf(images.keys, 1, "it did store the file...");
			assert.deepEqual(
				await storedImages(tenant, PURPOSE),
				[],
				"...and took it away again",
			);
			const rows = await ArtistWorkPhoto.query()
				.where("artist_id", sita.id)
				.orderBy("position");
			assert.deepEqual(
				rows.map((row) => row.position),
				[0, 1, 2, 3, 4, 5],
			);
		});
	});

	test("an artist member adds to their own profile only", async ({
		assert,
	}) => {
		const { tenant, owner: boss } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const other = await addArtist(tenant, boss, {
			name: "Other",
			slug: "other",
		});
		const { images, photos } = makeService();

		const added = await inTenantAs(tenant, member, async () =>
			photos.add(tenant, asArtist(member.id), own, await upload()),
		);
		assert.equal(added.position, 0);

		const before = images.keys.length;
		const file = await upload();
		await assert.rejects(
			() =>
				inTenantAs(tenant, member, () =>
					photos.add(tenant, asArtist(member.id), other, file),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		assert.equal(images.keys.length, before, "nothing was even decoded");
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
		assert.lengthOf(await order(tenant, other.id), 0);
	});

	test("an artist unlinked between the page and the save is refused under the lock and nothing is kept", async ({
		assert,
	}) => {
		const { tenant, owner: boss } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const { images, artists, photos } = makeService();
		// The page loaded the profile as the member's own...
		const loaded = await inTenantAs(tenant, member, () =>
			artists.findEditable(tenant, asArtist(member.id), own.id),
		);
		// ...then an owner removed the member, which unlinks the profile.
		await inTenant(tenant, () => artists.unlinkUser(tenant, member.id));
		assert.isNotNull(boss);

		const file = await upload();
		await assert.rejects(
			() =>
				inTenantAs(tenant, member, () =>
					photos.add(tenant, asArtist(member.id), loaded, file),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);

		assert.lengthOf(images.keys, 1, "the file was stored before the lock...");
		assert.deepEqual(await storedImages(tenant, PURPOSE), [], "...and deleted");
		assert.lengthOf(await order(tenant, own.id), 0);
	});

	test("describe, move and remove by an artist unlinked meanwhile are refused too", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const { artists, photos } = makeService();
		const [first, second] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, own),
			await addWorkPhoto(tenant, own),
		]);
		await inTenant(tenant, () => artists.unlinkUser(tenant, member.id));
		const editor = asArtist(member.id);

		const changes: (() => Promise<unknown>)[] = [
			() => photos.describe(tenant, editor, first, "Koi"),
			() => photos.move(tenant, editor, first, "down"),
			() => photos.remove(tenant, editor, first),
		];
		for (const change of changes) {
			await assert.rejects(
				() => inTenantAs(tenant, member, change),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		}

		const rows = await order(tenant, own.id);
		assert.deepEqual(
			rows.map((row) => row.id),
			[first.id, second.id],
		);
		const after = await inTenant(tenant, () =>
			ArtistWorkPhoto.findOrFail(first.id),
		);
		assert.isNull(after.alt);
	});

	test("another tenant's artist or photo is not found from this tenant's context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("photos-a", "Photos A");
		const b = await studioWithOwner("photos-b", "Photos B");
		const artistA = await addArtist(a.tenant, a.owner);
		const photoA = await inTenant(a.tenant, () =>
			addWorkPhoto(a.tenant, artistA),
		);
		const { photos } = makeService();

		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () =>
					photos.findEditable(b.tenant, owner(b.owner.id), photoA.id),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		// Even a model that was somehow loaded: the service's own tenant guard.
		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () =>
					photos.remove(b.tenant, owner(b.owner.id), photoA),
				),
			/another tenant/,
		);
		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, async () =>
					photos.add(b.tenant, owner(b.owner.id), artistA, await upload()),
				),
			/another tenant/,
		);
		assert.deepEqual(
			(await order(a.tenant, artistA.id)).map((row) => row.id),
			[photoA.id],
		);
		assert.deepEqual(await storedImages(b.tenant, PURPOSE), []);
	});

	test("describe stores the text; empty text becomes null", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));

		const saved = await inTenant(tenant, () =>
			photos.describe(tenant, owner(user.id), photo, "Koi on the forearm"),
		);
		assert.equal(saved.alt, "Koi on the forearm");
		assert.equal(
			(await inTenant(tenant, () => ArtistWorkPhoto.findOrFail(photo.id))).alt,
			"Koi on the forearm",
		);

		for (const empty of ["", "  ", null]) {
			await inTenant(tenant, () =>
				photos.describe(tenant, owner(user.id), photo, empty),
			);
			assert.isNull(
				(await inTenant(tenant, () => ArtistWorkPhoto.findOrFail(photo.id)))
					.alt,
			);
		}
	});

	test("move swaps neighbours and does nothing at either end", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const [one, two, three] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita),
			await addWorkPhoto(tenant, sita),
			await addWorkPhoto(tenant, sita),
		]);
		const editor = owner(user.id);
		const ids = async () => (await order(tenant, sita.id)).map((row) => row.id);

		await inTenant(tenant, () => photos.move(tenant, editor, three, "up"));
		assert.deepEqual(await ids(), [one.id, three.id, two.id]);
		await inTenant(tenant, () => photos.move(tenant, editor, one, "up"));
		assert.deepEqual(
			await ids(),
			[one.id, three.id, two.id],
			"first stays first",
		);
		await inTenant(tenant, () => photos.move(tenant, editor, two, "down"));
		assert.deepEqual(
			await ids(),
			[one.id, three.id, two.id],
			"last stays last",
		);
		await inTenant(tenant, () => photos.move(tenant, editor, one, "down"));
		assert.deepEqual(await ids(), [three.id, one.id, two.id]);
		assert.deepEqual(
			(await order(tenant, sita.id)).map((row) => row.position),
			[0, 1, 2],
		);
	});

	test("remove compacts the positions and deletes the file and its copies after the commit, not before", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const editor = owner(user.id);
		const added: ArtistWorkPhoto[] = [];
		for (let n = 0; n < 3; n++) {
			added.push(
				await inTenant(tenant, async () =>
					photos.add(tenant, editor, sita, await upload()),
				),
			);
		}
		assert.lengthOf(await storedImages(tenant, PURPOSE), 12);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await photos.remove(tenant, editor, added[0]);
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				12,
				"the files stay until the commit",
			);
		});

		assert.lengthOf(await storedImages(tenant, PURPOSE), 8);
		const rows = await order(tenant, sita.id);
		assert.deepEqual(
			rows.map((row) => [row.id, row.position]),
			[
				[added[1].id, 0],
				[added[2].id, 1],
			],
		);
	});

	test("a failure after remove keeps the row and the files", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const editor = owner(user.id);
		const photo = await inTenant(tenant, async () =>
			photos.add(tenant, editor, sita, await upload()),
		);

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await photos.remove(tenant, editor, photo);
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
		assert.lengthOf(await order(tenant, sita.id), 1);
	});

	test("a deleted artist's photos cannot be found, edited, moved or removed", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { artists, photos } = makeService();
		const editor = owner(user.id);
		const photo = await inTenant(tenant, async () =>
			photos.add(tenant, editor, sita, await upload()),
		);
		await inTenant(tenant, () => artists.delete(tenant, sita));

		await assert.rejects(
			() =>
				inTenant(tenant, () => photos.findEditable(tenant, editor, photo.id)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		const changes: (() => Promise<unknown>)[] = [
			() => photos.describe(tenant, editor, photo, "x"),
			() => photos.move(tenant, editor, photo, "up"),
			() => photos.remove(tenant, editor, photo),
		];
		for (const change of changes) {
			await assert.rejects(
				() => inTenant(tenant, change),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		}
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4, "the files stay");
	});

	test("a photo removed by another request meanwhile is a 404 for the second change", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const editor = owner(user.id);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		await inTenant(tenant, () => photos.remove(tenant, editor, photo));

		await assert.rejects(
			() => inTenant(tenant, () => photos.describe(tenant, editor, photo, "x")),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		await assert.rejects(
			() => inTenant(tenant, () => photos.remove(tenant, editor, photo)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
	});

	test("forArtists reads every listed artist's photos in one query and none for no artists", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const mira = await addArtist(tenant, user, { name: "Mira", slug: "mira" });
		const empty = await addArtist(tenant, user, { name: "Zed", slug: "zed" });
		const { photos } = makeService();
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, mira, { alt: "m0" });
			await addWorkPhoto(tenant, sita, { alt: "s0" });
			await addWorkPhoto(tenant, sita, { alt: "s1" });
			await addWorkPhoto(tenant, mira, { alt: "m1" });
		});

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () =>
				photos.forArtists(tenant, [sita.id, mira.id, empty.id]),
			),
		);
		const photoQueries = queries.filter((sql) =>
			sql.includes("artist_work_photos"),
		);
		assert.lengthOf(photoQueries, 1);
		assert.deepEqual(
			result.get(sita.id)?.map((photo) => photo.alt),
			["s0", "s1"],
		);
		assert.deepEqual(
			result.get(mira.id)?.map((photo) => photo.alt),
			["m0", "m1"],
		);
		assert.isUndefined(result.get(empty.id));

		const none = await recordQueries(() =>
			inTenant(tenant, () => photos.forArtists(tenant, [])),
		);
		assert.lengthOf(
			none.queries.filter((sql) => sql.includes("artist_work_photos")),
			0,
		);
		assert.equal(none.result.size, 0);
	});

	test("forArtists never returns another studio's photos", async ({
		assert,
	}) => {
		const a = await studioWithOwner("photos-a", "Photos A");
		const b = await studioWithOwner("photos-b", "Photos B");
		const artistA = await addArtist(a.tenant, a.owner);
		await inTenant(a.tenant, () => addWorkPhoto(a.tenant, artistA));
		const { photos } = makeService();

		const fromB = await inTenant(b.tenant, () =>
			photos.forArtists(b.tenant, [artistA.id]),
		);

		assert.equal(fromB.size, 0);
	});

	test("a replayed upload adds a second photo; replaying past six is refused and stores nothing", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, photos } = makeService();
		const editor = owner(user.id);
		const bytes = await testImages.jpeg(1600, 1200);

		for (let n = 0; n < MAX_WORK_PHOTOS; n++) {
			await inTenant(tenant, async () =>
				photos.add(tenant, editor, sita, await uploadOf(bytes)),
			);
		}
		const stored = images.keys.length;
		const rows = await order(tenant, sita.id);
		assert.lengthOf(
			rows,
			MAX_WORK_PHOTOS,
			"the same bytes six times: no dedupe",
		);

		const again = await uploadOf(bytes);
		await assert.rejects(
			() => inTenant(tenant, () => photos.add(tenant, editor, sita, again)),
			WorkPhotoLimitError,
		);
		assert.equal(images.keys.length, stored);
		assert.lengthOf(await order(tenant, sita.id), MAX_WORK_PHOTOS);
	});
});
