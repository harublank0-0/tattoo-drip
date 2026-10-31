import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { WorkPhotoLimitError } from "#modules/artists/errors";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
	type WorkFilter,
} from "#modules/artists/services/work_photo_service";
import type { WorkCursor } from "#modules/artists/work_cursor";
import FlashService from "#modules/flash/services/flash_service";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import StudioPageService from "#modules/storefront/services/studio_page_service";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { recordQueries } from "#tests/helpers/query_count";
import { failDeletes, withStrayCopy } from "#tests/helpers/storage_failures";
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

/** The artist's rows, newest first (the order every read uses). */
const order = async (tenant: { id: string }, artistId: string) =>
	inTenant(tenant, async () =>
		(
			await ArtistWorkPhoto.query()
				.where("artist_id", artistId)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
		).map((photo) => ({ id: photo.id, createdAt: photo.createdAt })),
	);

/**
 * `count` photo rows for the artist, dated one second apart in the past (an
 * hour ago and after), the oldest first. Returned in that order.
 */
const seedPhotos = (
	tenant: { id: string },
	artist: { id: string },
	count: number,
	start: DateTime = DateTime.now().minus({ hours: 1 }),
) =>
	inTenant(tenant, async () => {
		const added: ArtistWorkPhoto[] = [];
		for (let n = 0; n < count; n++) {
			added.push(
				await addWorkPhoto(tenant, artist, {
					alt: `p${n}`,
					createdAt: start.plus({ seconds: n }),
				}),
			);
		}
		return added;
	});

test.group("WorkPhotoService (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner adds photos, the newest listed first; the 101st is refused before it is decoded", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, photos } = makeService();
		const editor = owner(user.id);
		assert.equal(MAX_WORK_PHOTOS, 100);
		await seedPhotos(tenant, sita, MAX_WORK_PHOTOS - 1);

		const added = await inTenant(tenant, async () =>
			photos.add(tenant, editor, sita, await upload()),
		);
		assert.equal(added.width, 1600);
		assert.match(
			added.imageKey,
			new RegExp(`^tenants/${tenant.id}/${PURPOSE}/`),
		);
		// The returned instance matches what the database stores for a new photo.
		assert.isNull(added.alt);
		assert.deepEqual(added.styles, []);
		assert.isFalse(added.healed);
		const listed = await inTenant(tenant, () => photos.list(tenant, sita));
		assert.lengthOf(listed, MAX_WORK_PHOTOS);
		assert.equal(listed[0].id, added.id, "the new photo is the newest");
		assert.equal(listed[1].alt, `p${MAX_WORK_PHOTOS - 2}`);
		assert.equal(listed.at(-1)?.alt, "p0");
		const filesBefore = await storedImages(tenant, PURPOSE);
		const storedBefore = images.keys.length;
		assert.lengthOf(filesBefore, 4);

		const file = await upload();
		await assert.rejects(
			() => inTenant(tenant, () => photos.add(tenant, editor, sita, file)),
			WorkPhotoLimitError,
		);

		assert.equal(images.keys.length, storedBefore, "no 101st store");
		assert.deepEqual(await storedImages(tenant, PURPOSE), filesBefore);
		assert.lengthOf(
			await inTenant(tenant, () => photos.list(tenant, sita)),
			MAX_WORK_PHOTOS,
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

	test("two uploads racing for the 100th place: the second is refused under the lock and its file is deleted", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const images = new RecordingImageService();
		const artists = new ArtistService(images);
		const racing = new RacingService(images, artists, () =>
			// The other upload lands the 100th photo after the first count.
			addWorkPhoto(tenant, sita),
		);
		await seedPhotos(tenant, sita, MAX_WORK_PHOTOS - 1);

		const file = await upload();
		// Caught inside the context, as the controller does: the failed level
		// rolls back by itself, and the other upload's photo stays.
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
			const rows = await ArtistWorkPhoto.query().where("artist_id", sita.id);
			assert.lengthOf(rows, MAX_WORK_PHOTOS);
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
		assert.equal(added.artistId, own.id);

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

	test("updateDetails and remove by an artist unlinked meanwhile are refused too", async ({
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
		const [first, second] = await seedPhotos(tenant, own, 2);
		await inTenant(tenant, () => artists.unlinkUser(tenant, member.id));
		const editor = asArtist(member.id);

		const changes: (() => Promise<unknown>)[] = [
			() =>
				photos.updateDetails(tenant, editor, first, {
					alt: "Koi",
					styles: ["realism"],
					healed: true,
				}),
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
			[second.id, first.id],
		);
		const after = await inTenant(tenant, () =>
			ArtistWorkPhoto.findOrFail(first.id),
		);
		assert.equal(after.alt, "p0");
		assert.deepEqual(after.styles, []);
		assert.isFalse(after.healed);
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

	test("updateDetails stores the description, the styles as given and the healed mark; empty text becomes null", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		const read = () =>
			inTenant(tenant, () => ArtistWorkPhoto.findOrFail(photo.id));

		const saved = await inTenant(tenant, () =>
			photos.updateDetails(tenant, owner(user.id), photo, {
				alt: "  Koi  ",
				styles: ["realism", "blackwork"],
				healed: true,
			}),
		);
		assert.equal(saved.alt, "Koi");
		const stored = await read();
		assert.equal(stored.alt, "Koi");
		// As given: not the list's order.
		assert.deepEqual(stored.styles, ["realism", "blackwork"]);
		assert.isTrue(stored.healed);

		for (const empty of ["", "  ", null]) {
			await inTenant(tenant, () =>
				photos.updateDetails(tenant, owner(user.id), photo, {
					alt: empty,
					styles: [],
					healed: false,
				}),
			);
			const cleared = await read();
			assert.isNull(cleared.alt, JSON.stringify(empty));
			assert.deepEqual(cleared.styles, []);
			assert.isFalse(cleared.healed);
		}
	});

	test("the database refuses a fourth style", async ({ assert }) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		const setStyles = (slugs: string) =>
			inTenant(tenant, () =>
				withTransaction((trx) =>
					trx.rawQuery(
						"update artist_work_photos set styles = ?::varchar[] where id = ?",
						[slugs, photo.id],
					),
				),
			);

		await assert.rejects(
			() => setStyles("{blackwork,fine-line,realism,colour}"),
			/artist_work_photos_styles_max/,
		);
		await setStyles("{blackwork,fine-line,realism}");
		const stored = await inTenant(tenant, () =>
			ArtistWorkPhoto.findOrFail(photo.id),
		);
		assert.lengthOf(stored.styles, 3);
	});

	test("remove deletes the file and its copies first, then the row; the other photos keep their dates", async ({
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
		const datesBefore = new Map(
			(await order(tenant, sita.id)).map((row) => [row.id, row.createdAt]),
		);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await photos.remove(tenant, editor, added[0]);
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				8,
				"the files go first, before the commit",
			);
		});

		assert.lengthOf(await storedImages(tenant, PURPOSE), 8);
		const rows = await order(tenant, sita.id);
		assert.deepEqual(
			rows.map((row) => row.id),
			[added[2].id, added[1].id],
		);
		for (const row of rows) {
			assert.equal(
				row.createdAt.toMillis(),
				datesBefore.get(row.id)?.toMillis(),
				"a removal rewrites no date",
			);
		}
	});

	test("a later failure in the same request restores the row but the files are already gone; removing again finishes", async ({
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

		// The documented limit of "files first": the row is back, its files are not.
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		assert.lengthOf(await order(tenant, sita.id), 1);
		// A missing file counts as deleted, so the owner's retry removes the row.
		await inTenant(tenant, () => photos.remove(tenant, editor, photo));
		assert.lengthOf(await order(tenant, sita.id), 0);
	});

	test("a deleted artist's photos cannot be found, edited or removed", async ({
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
			() =>
				photos.updateDetails(tenant, editor, photo, {
					alt: "x",
					styles: [],
					healed: false,
				}),
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
			() =>
				inTenant(tenant, () =>
					photos.updateDetails(tenant, editor, photo, {
						alt: "x",
						styles: [],
						healed: false,
					}),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		await assert.rejects(
			() => inTenant(tenant, () => photos.remove(tenant, editor, photo)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
	});

	test("forArtists reads each listed artist's newest perArtist photos, newest first, in one query, and none for no artists", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const mira = await addArtist(tenant, user, { name: "Mira", slug: "mira" });
		const empty = await addArtist(tenant, user, { name: "Zed", slug: "zed" });
		const { photos } = makeService();
		const start = DateTime.now().minus({ hours: 1 });
		const sitaPhotos = await seedPhotos(tenant, sita, 8, start);
		// Mira's dates fall among Sita's: each artist is ranked on their own.
		const miraPhotos = await seedPhotos(
			tenant,
			mira,
			2,
			start.plus({ seconds: 3 }),
		);

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () =>
				photos.forArtists(tenant, [sita.id, mira.id, empty.id], 6),
			),
		);
		const photoQueries = queries.filter((sql) =>
			sql.includes("artist_work_photos"),
		);
		assert.lengthOf(photoQueries, 1);
		assert.deepEqual(
			result.get(sita.id)?.map((photo) => photo.id),
			sitaPhotos
				.slice(2)
				.reverse()
				.map((photo) => photo.id),
			"Sita's six newest, newest first",
		);
		assert.deepEqual(
			result.get(mira.id)?.map((photo) => photo.id),
			miraPhotos
				.slice()
				.reverse()
				.map((photo) => photo.id),
		);
		assert.isUndefined(result.get(empty.id));

		const one = await inTenant(tenant, () =>
			photos.forArtists(tenant, [sita.id], 3),
		);
		assert.deepEqual(
			one.get(sita.id)?.map((photo) => photo.alt),
			["p7", "p6", "p5"],
		);

		const none = await recordQueries(() =>
			inTenant(tenant, () => photos.forArtists(tenant, [], 6)),
		);
		assert.lengthOf(
			none.queries.filter((sql) => sql.includes("artist_work_photos")),
			0,
		);
		assert.equal(none.result.size, 0);
	});

	test("forArtists breaks a tie in dates by id, so the same photos come back every time", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const sameMoment = DateTime.now().minus({ hours: 1 });
		const added = await inTenant(tenant, async () => {
			const rows: ArtistWorkPhoto[] = [];
			for (let n = 0; n < 4; n++) {
				rows.push(await addWorkPhoto(tenant, sita, { createdAt: sameMoment }));
			}
			return rows;
		});
		// The ids come in creation order, so the newest by id is the last added.
		const newestTwo = added
			.slice(2)
			.reverse()
			.map((photo) => photo.id);

		const read = await inTenant(tenant, () =>
			photos.forArtists(tenant, [sita.id], 2),
		);

		assert.deepEqual(
			read.get(sita.id)?.map((photo) => photo.id),
			newestTwo,
		);
		assert.deepEqual(
			(await inTenant(tenant, () => photos.list(tenant, sita))).map(
				(photo) => photo.id,
			),
			added
				.slice()
				.reverse()
				.map((photo) => photo.id),
		);
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
			photos.forArtists(b.tenant, [artistA.id], 6),
		);

		assert.equal(fromB.size, 0);
	});

	test("a replayed upload adds a second photo; replaying past 100 is refused and stores nothing", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, photos } = makeService();
		const editor = owner(user.id);
		const bytes = await testImages.jpeg(1600, 1200);
		await seedPhotos(tenant, sita, MAX_WORK_PHOTOS - 2);

		for (let n = 0; n < 2; n++) {
			await inTenant(tenant, async () =>
				photos.add(tenant, editor, sita, await uploadOf(bytes)),
			);
		}
		const stored = images.keys.length;
		const rows = await order(tenant, sita.id);
		assert.lengthOf(rows, MAX_WORK_PHOTOS);
		assert.equal(stored, 2, "the same bytes twice: no dedupe");

		const again = await uploadOf(bytes);
		await assert.rejects(
			() => inTenant(tenant, () => photos.add(tenant, editor, sita, again)),
			WorkPhotoLimitError,
		);
		assert.equal(images.keys.length, stored);
		assert.lengthOf(await order(tenant, sita.id), MAX_WORK_PHOTOS);
	});
});

test.group("removing a photo is durable (TAT-116 fix round 1)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a failed file delete fails the removal, keeps the row, the order and the public listing; the retry removes every copy", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, artists, photos } = makeService();
		const editor = owner(user.id);
		const added: ArtistWorkPhoto[] = [];
		for (let n = 0; n < 3; n++) {
			added.push(
				await inTenant(tenant, async () =>
					photos.add(tenant, editor, sita, await upload()),
				),
			);
		}
		const copies = (key: string) =>
			key.replace(/\.320-640-1280\.jpg$/, ".640w.jpg");
		const failing = failDeletes(
			"public",
			(key) => key === copies(added[0].imageKey),
		);

		let thrown: unknown;
		try {
			await inTenant(tenant, () => photos.remove(tenant, editor, added[0]));
		} catch (error) {
			thrown = error;
		} finally {
			failing.restore();
		}

		assert.instanceOf(thrown, ImageDeleteError);
		// The row is still there, in its place, and the public read still lists it.
		assert.deepEqual(
			(await order(tenant, sita.id)).map((row) => row.id),
			added
				.slice()
				.reverse()
				.map((photo) => photo.id),
		);
		const listed = await inTenant(tenant, () =>
			new StudioPageService(
				artists,
				images,
				photos,
				new OpeningHoursService(),
				new FlashService(images, artists),
			).visibleArtists(tenant),
		);
		assert.lengthOf(listed[0].workPhotos, 3);
		// The other files of the photo were tried and are gone; the failed one is left.
		const left = await storedImages(tenant, PURPOSE);
		assert.lengthOf(left, 12 - 3);
		assert.include(left, copies(added[0].imageKey).split("/").pop() ?? "");

		// Storage is back: the retry removes every copy.
		await inTenant(tenant, () => photos.remove(tenant, editor, added[0]));
		assert.lengthOf(await storedImages(tenant, PURPOSE), 8);
		assert.deepEqual(
			(await order(tenant, sita.id)).map((row) => row.id),
			[added[2].id, added[1].id],
		);
	});

	test("the files go before the row: a row delete that fails afterwards leaves the owner able to remove again", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const editor = owner(user.id);
		const photo = await inTenant(tenant, async () =>
			photos.add(tenant, editor, sita, await upload()),
		);
		const failing = failDeletes("public", () => true);
		try {
			await assert.rejects(
				() => inTenant(tenant, () => photos.remove(tenant, editor, photo)),
				ImageDeleteError,
			);
		} finally {
			failing.restore();
		}
		// Nothing was deleted: every file is still there and the row too.
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
		assert.lengthOf(await order(tenant, sita.id), 1);
		assert.lengthOf(
			failing.attempts,
			4,
			"every file was tried, none gave up early",
		);
	});
});

test.group(
	"removing a photo stored in the upload fallback state (TAT-116 fix round 2)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a variant write fails and its cleanup fails: the owner's removal still leaves no file for that photo", async ({
			assert,
		}) => {
			const { tenant, owner: user } = await studioWithOwner();
			const sita = await addArtist(tenant, user);
			const { photos } = makeService();
			const editor = owner(user.id);
			const photo = await withStrayCopy(
				"public",
				{ writtenFirst: ".320w.jpg", failing: ".640w.jpg" },
				async () =>
					inTenant(tenant, async () =>
						photos.add(tenant, editor, sita, await upload()),
					),
			);
			// A plain key names no copies, yet one is on the disk.
			assert.notMatch(photo.imageKey, /\.320-640-1280\./);
			assert.lengthOf(await storedImages(tenant, PURPOSE), 2);
			// Another photo with all its files, which must survive.
			const other = await inTenant(tenant, async () =>
				photos.add(tenant, editor, sita, await upload()),
			);

			await inTenant(tenant, () => photos.remove(tenant, editor, photo));

			const left = await storedImages(tenant, PURPOSE);
			const idOf = (key: string) => key.split("/").pop()?.split(".")[0] ?? "";
			assert.lengthOf(left, 4, "only the other photo's files are left");
			assert.isTrue(
				left.every((file) => file.startsWith(idOf(other.imageKey))),
			);
			assert.deepEqual(
				(await order(tenant, sita.id)).map((row) => row.id),
				[other.id],
			);
		});
	},
);

test.group("the paged read (TAT-126)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const base = DateTime.fromISO("2026-10-30T04:00:00Z");
	const filterOf = (
		artistIds: string[],
		over: Partial<WorkFilter> = {},
	): WorkFilter => ({ artistIds, style: null, healed: false, ...over });
	/** `created_at desc, id desc`, worked out here and not by the database. */
	const newestFirst = (rows: ArtistWorkPhoto[]) =>
		rows
			.slice()
			.sort(
				(a, b) =>
					b.createdAt.toMillis() - a.createdAt.toMillis() ||
					(a.id < b.id ? 1 : -1),
			)
			.map((photo) => photo.id);
	const ids = (rows: ArtistWorkPhoto[]) => rows.map((photo) => photo.id);
	const onPhotos = (queries: string[]) =>
		queries.filter((sql) => sql.includes("artist_work_photos"));

	test("page lists the given artists' photos newest first; nothing and no query for no artists", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const mira = await addArtist(tenant, user, { name: "Mira", slug: "mira" });
		const zed = await addArtist(tenant, user, { name: "Zed", slug: "zed" });
		const { photos } = makeService();
		const [s1, m1, s2] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, { createdAt: base }),
			await addWorkPhoto(tenant, mira, {
				createdAt: base.plus({ minutes: 1 }),
			}),
			await addWorkPhoto(tenant, sita, {
				createdAt: base.plus({ minutes: 2 }),
			}),
		]);
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, zed, { createdAt: base.plus({ minutes: 3 }) }),
		);

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () =>
				photos.page(tenant, filterOf([sita.id, mira.id]), null, 10),
			),
		);

		assert.deepEqual(ids(result.photos), [s2.id, m1.id, s1.id]);
		assert.isNull(result.next);
		assert.lengthOf(onPhotos(queries), 1);

		const none = await recordQueries(() =>
			inTenant(tenant, () => photos.page(tenant, filterOf([]), null, 10)),
		);
		assert.deepEqual(none.result, { photos: [], next: null });
		assert.lengthOf(onPhotos(none.queries), 0);

		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					photos.page(tenant, filterOf([sita.id]), null, 0),
				),
			/limit/,
		);
	});

	test("paging by cursor visits every photo once, also across photos created in the same instant", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const added = await inTenant(tenant, async () => {
			const rows: ArtistWorkPhoto[] = [];
			// One newer, three in the same instant, one older.
			for (const at of [
				base.plus({ hours: 1 }),
				base,
				base,
				base,
				base.minus({ hours: 1 }),
			]) {
				rows.push(await addWorkPhoto(tenant, sita, { createdAt: at }));
			}
			return rows;
		});
		const filter = filterOf([sita.id]);

		const first = await inTenant(tenant, () =>
			photos.page(tenant, filter, null, 2),
		);
		assert.isNotNull(first.next);
		const second = await inTenant(tenant, () =>
			photos.page(tenant, filter, first.next, 2),
		);
		assert.isNotNull(second.next);
		const third = await inTenant(tenant, () =>
			photos.page(tenant, filter, second.next, 2),
		);

		assert.deepEqual(
			[first, second, third].map((page) => page.photos.length),
			[2, 2, 1],
		);
		assert.deepEqual(
			[...ids(first.photos), ...ids(second.photos), ...ids(third.photos)],
			newestFirst(added),
		);
		assert.isNull(third.next);
		// The cursor names the last photo of its page.
		assert.equal(first.next?.id, first.photos[1].id);
		assert.equal(second.next?.id, second.photos[1].id);

		// Exactly a page's worth left is not "more".
		const whole = await inTenant(tenant, () =>
			photos.page(tenant, filter, null, 5),
		);
		assert.lengthOf(whole.photos, 5);
		assert.isNull(whole.next);
	});

	test("the cursor keeps the microseconds, so photos within one millisecond are not skipped", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		// A JavaScript date holds milliseconds: these three share one, and
		// only the database can tell them apart.
		const stamps = [
			"2026-10-30T04:05:06.123123Z",
			"2026-10-30T04:05:06.123456Z",
			"2026-10-30T04:05:06.123789Z",
		];
		const added = await inTenant(tenant, async () => {
			const rows: ArtistWorkPhoto[] = [];
			for (const stamp of stamps) {
				const row = await addWorkPhoto(tenant, sita);
				await dbClient().rawQuery(
					"update artist_work_photos set created_at = ?::timestamptz where id = ?",
					[stamp, row.id],
				);
				rows.push(row);
			}
			return rows;
		});
		const filter = filterOf([sita.id]);

		const seen: string[] = [];
		const cursors: WorkCursor[] = [];
		let after: WorkCursor | null = null;
		for (let n = 0; n < 3; n++) {
			const page = await inTenant(tenant, () =>
				photos.page(tenant, filter, after, 1),
			);
			seen.push(...ids(page.photos));
			if (page.next) cursors.push(page.next);
			after = page.next;
		}

		assert.deepEqual(seen, [added[2].id, added[1].id, added[0].id]);
		assert.deepEqual(
			cursors.map((cursor) => cursor.at),
			[stamps[2], stamps[1]],
		);
		assert.isNull(after);
	});

	test("a photo removed between pages: the next page still starts after the cursor", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const [p1, p2, p3, p4] = await seedPhotos(tenant, sita, 4, base);
		const filter = filterOf([sita.id]);
		const first = await inTenant(tenant, () =>
			photos.page(tenant, filter, null, 2),
		);
		assert.deepEqual(ids(first.photos), [p4.id, p3.id]);

		// The photo the cursor names, and one already shown, go meanwhile.
		await inTenant(tenant, async () => {
			await p3.delete();
			await p4.delete();
		});
		const second = await inTenant(tenant, () =>
			photos.page(tenant, filter, first.next, 2),
		);

		assert.deepEqual(ids(second.photos), [p2.id, p1.id]);
		assert.isNull(second.next);
	});

	test("style and healed filter, and combine", async ({ assert }) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { photos } = makeService();
		const [plain, both, healedOnly] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, {
				styles: ["realism"],
				createdAt: base,
			}),
			await addWorkPhoto(tenant, sita, {
				styles: ["realism", "blackwork"],
				healed: true,
				createdAt: base.plus({ minutes: 1 }),
			}),
			await addWorkPhoto(tenant, sita, {
				styles: [],
				healed: true,
				createdAt: base.plus({ minutes: 2 }),
			}),
		]);
		const read = async (over: Partial<WorkFilter>) =>
			ids(
				(
					await inTenant(tenant, () =>
						photos.page(tenant, filterOf([sita.id], over), null, 10),
					)
				).photos,
			);

		assert.deepEqual(await read({ style: "realism" }), [both.id, plain.id]);
		assert.deepEqual(await read({ healed: true }), [healedOnly.id, both.id]);
		assert.deepEqual(await read({ style: "realism", healed: true }), [both.id]);
		assert.deepEqual(await read({ style: "blackwork" }), [both.id]);
		assert.deepEqual(await read({ style: "japanese" }), []);
		// A style matches whole slugs only, and is only ever a value.
		assert.deepEqual(await read({ style: "real" }), []);
		assert.deepEqual(await read({ style: 'realism","blackwork' }), []);
		assert.deepEqual(await read({ style: "{realism}" }), []);
	});

	test("facets: the styles the given artists' photos carry and whether one is healed; another artist's are not counted; none for no artists", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const mira = await addArtist(tenant, user, { name: "Mira", slug: "mira" });
		const zed = await addArtist(tenant, user, { name: "Zed", slug: "zed" });
		const empty = await addArtist(tenant, user, { name: "Eve", slug: "eve" });
		const { photos } = makeService();
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, sita, { styles: ["realism"] });
			await addWorkPhoto(tenant, sita, {
				styles: ["realism", "blackwork"],
			});
			await addWorkPhoto(tenant, sita, { styles: [] });
			await addWorkPhoto(tenant, mira, { styles: ["japanese"], healed: true });
			await addWorkPhoto(tenant, zed, { styles: ["tribal"], healed: true });
		});
		const facets = async (artistIds: string[]) => {
			const { styles, healed } = await inTenant(tenant, () =>
				photos.facets(tenant, artistIds),
			);
			return { styles: styles.slice().sort(), healed };
		};

		assert.deepEqual(await facets([sita.id]), {
			styles: ["blackwork", "realism"],
			healed: false,
		});
		assert.deepEqual(await facets([sita.id, mira.id]), {
			styles: ["blackwork", "japanese", "realism"],
			healed: true,
		});
		assert.deepEqual(await facets([empty.id]), { styles: [], healed: false });

		const { queries } = await recordQueries(() => facets([sita.id, mira.id]));
		assert.lengthOf(onPhotos(queries), 1);
		const none = await recordQueries(() => facets([]));
		assert.deepEqual(none.result, { styles: [], healed: false });
		assert.lengthOf(onPhotos(none.queries), 0);
	});

	test("another tenant's photos never appear, from this tenant's context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("paged-a", "Paged A");
		const b = await studioWithOwner("paged-b", "Paged B");
		const artistA = await addArtist(a.tenant, a.owner);
		await inTenant(a.tenant, () =>
			addWorkPhoto(a.tenant, artistA, { styles: ["realism"], healed: true }),
		);
		const { photos } = makeService();
		const filter = filterOf([artistA.id]);

		// Asked as studio B for studio A's artist: the tenant filter and the
		// row-level security each keep the photo out.
		const asB = await inTenant(b.tenant, () =>
			photos.page(b.tenant, filter, null, 10),
		);
		const forgedAsB = await inTenant(b.tenant, () =>
			photos.page(a.tenant, filter, null, 10),
		);
		const facetsAsB = await inTenant(b.tenant, () =>
			photos.facets(b.tenant, [artistA.id]),
		);
		const forgedFacets = await inTenant(b.tenant, () =>
			photos.facets(a.tenant, [artistA.id]),
		);

		assert.deepEqual(asB, { photos: [], next: null });
		assert.deepEqual(forgedAsB, { photos: [], next: null });
		assert.deepEqual(facetsAsB, { styles: [], healed: false });
		assert.deepEqual(forgedFacets, { styles: [], healed: false });
		// And its own studio still sees it.
		const own = await inTenant(a.tenant, () =>
			photos.page(a.tenant, filter, null, 10),
		);
		assert.lengthOf(own.photos, 1);
	});
});
