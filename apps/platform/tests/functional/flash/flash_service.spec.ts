import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import { FlashInUseError, FlashLimitError } from "#modules/flash/errors";
import FlashDesign from "#modules/flash/models/flash_design";
import FlashService, {
	MAX_FLASH_DESIGNS,
} from "#modules/flash/services/flash_service";
import { ImageDeleteError } from "#modules/media/errors";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { makeClient, makeInquiry, makeProject } from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { failDeletes } from "#tests/helpers/storage_failures";
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
} from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

const PURPOSE = "flash_design";
const upload = async () => uploadOf(await testImages.png(1200, 1200));
const MOTH = { name: "Moth", size: "About 3 in", price: 300_000 };

function makeService() {
	const images = new RecordingImageService();
	const artists = new ArtistService(images);
	return { images, artists, flash: new FlashService(images, artists) };
}

/** A service whose first (unlocked) count stages "another upload landed meanwhile". */
class RacingService extends FlashService {
	calls = 0;
	constructor(
		images: RecordingImageService,
		artists: ArtistService,
		private raced: () => Promise<unknown>,
	) {
		super(images, artists);
	}

	protected override async countDesigns(
		tenant: { id: string },
		artistId: string,
		client?: QueryClientContract,
	) {
		this.calls++;
		const before = await super.countDesigns(tenant, artistId, client);
		if (this.calls === 1) await this.raced();
		return before;
	}
}

const owner = (userId: string): ProfileEditor => ({ userId, role: "owner" });
const asArtist = (userId: string): ProfileEditor => ({
	userId,
	role: "artist",
});

/** `count` designs for the artist, dated one second apart in the past, the oldest first. */
const seedDesigns = (
	tenant: { id: string },
	artist: { id: string },
	count: number,
	start: DateTime = DateTime.now().minus({ hours: 1 }),
) =>
	inTenant(tenant, async () => {
		const added: FlashDesign[] = [];
		for (let n = 0; n < count; n++) {
			added.push(
				await addFlashDesign(tenant, artist, {
					name: `d${n}`,
					createdAt: start.plus({ seconds: n }),
				}),
			);
		}
		return added;
	});

test.group("FlashService (TAT-129)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner adds a design to any artist and an artist to their own; listed newest first, shown, the price in paisa", async ({
		assert,
	}) => {
		const { tenant, owner: boss } = await studioWithOwner();
		const member = await artistIn(tenant);
		const sita = await addArtist(tenant, boss);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const { flash } = makeService();

		const first = await inTenant(tenant, async () =>
			flash.add(tenant, owner(boss.id), sita, await upload(), MOTH),
		);
		const second = await inTenantAs(tenant, member, async () =>
			flash.add(tenant, asArtist(member.id), own, await upload(), {
				name: "Koi",
				size: "About 5 in",
				price: null,
			}),
		);
		const third = await inTenant(tenant, async () =>
			flash.add(tenant, owner(boss.id), sita, await upload(), {
				name: "Lotus",
				size: "About 2 in",
				price: null,
			}),
		);

		const listed = await inTenant(tenant, () => flash.list(tenant, sita));
		assert.deepEqual(
			listed.map((design) => design.id),
			[third.id, first.id],
		);
		assert.equal(first.name, "Moth");
		assert.equal(first.size, "About 3 in");
		assert.equal(first.price, 300_000);
		assert.equal(first.currency, "NPR");
		assert.isFalse(first.hidden);
		assert.equal(first.width, 1200);
		assert.match(
			first.imageKey,
			new RegExp(`^tenants/${tenant.id}/${PURPOSE}/`),
		);
		assert.equal(second.artistId, own.id);
		assert.isNull(second.price);
	});

	test("the 101st design is refused before it is decoded", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { images, flash } = makeService();
		assert.equal(MAX_FLASH_DESIGNS, 100);
		await seedDesigns(tenant, sita, MAX_FLASH_DESIGNS);
		const before = await storedImages(tenant, PURPOSE);

		const file = await upload();
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					flash.add(tenant, owner(user.id), sita, file, MOTH),
				),
			FlashLimitError,
		);

		assert.lengthOf(images.keys, 0, "no store call, so no decode");
		assert.deepEqual(await storedImages(tenant, PURPOSE), before);
		assert.lengthOf(
			await inTenant(tenant, () => flash.list(tenant, sita)),
			MAX_FLASH_DESIGNS,
		);
	});

	test("two uploads racing for the 100th place: the second is refused under the lock and its file is deleted", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const images = new RecordingImageService();
		const artists = new ArtistService(images);
		const racing = new RacingService(images, artists, () =>
			// The other upload lands the 100th design after the first count.
			addFlashDesign(tenant, sita),
		);
		await seedDesigns(tenant, sita, MAX_FLASH_DESIGNS - 1);

		const file = await upload();
		await inTenant(tenant, async () => {
			await assert.rejects(
				() => racing.add(tenant, owner(user.id), sita, file, MOTH),
				FlashLimitError,
			);
			assert.equal(racing.calls, 2, "counted unlocked, then under the lock");
			assert.lengthOf(images.keys, 1, "it did store the file...");
			assert.deepEqual(
				await storedImages(tenant, PURPOSE),
				[],
				"...and took it away again",
			);
			const rows = await FlashDesign.query().where("artist_id", sita.id);
			assert.lengthOf(rows, MAX_FLASH_DESIGNS);
		});
	});

	test("update saves the name, size, price and hidden, trimmed; the picture stays", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { flash } = makeService();
		const editor = owner(user.id);
		const design = await inTenant(tenant, async () =>
			flash.add(tenant, editor, sita, await upload(), MOTH),
		);

		await inTenant(tenant, () =>
			flash.update(tenant, editor, design, {
				name: "  Moth  ",
				size: "About 4 in",
				price: null,
				hidden: true,
			}),
		);

		const read = await inTenant(tenant, () =>
			FlashDesign.findOrFail(design.id),
		);
		assert.equal(read.name, "Moth");
		assert.equal(read.size, "About 4 in");
		assert.isNull(read.price);
		assert.isTrue(read.hidden);
		assert.equal(read.imageKey, design.imageKey);
	});

	test("remove deletes the row and then the files; a file that can't be deleted keeps the row", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { flash } = makeService();
		const editor = owner(user.id);
		const gone = await inTenant(tenant, async () =>
			flash.add(tenant, editor, sita, await upload(), MOTH),
		);
		const kept = await inTenant(tenant, async () =>
			flash.add(tenant, editor, sita, await upload(), { ...MOTH, name: "Koi" }),
		);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 6);

		await inTenant(tenant, () => flash.remove(tenant, editor, gone));
		assert.lengthOf(await storedImages(tenant, PURPOSE), 3);
		assert.deepEqual(
			(await inTenant(tenant, () => flash.list(tenant, sita))).map((d) => d.id),
			[kept.id],
		);

		const failing = failDeletes("public", () => true);
		try {
			await assert.rejects(
				() => inTenant(tenant, () => flash.remove(tenant, editor, kept)),
				ImageDeleteError,
			);
		} finally {
			failing.restore();
		}
		assert.deepEqual(
			(await inTenant(tenant, () => flash.list(tenant, sita))).map((d) => d.id),
			[kept.id],
			"the design is still listed",
		);
		// A retry finishes the job.
		await inTenant(tenant, () => flash.remove(tenant, editor, kept));
		assert.lengthOf(await inTenant(tenant, () => flash.list(tenant, sita)), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("a design that a request or a project names can't be removed: FlashInUseError, row and files untouched", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { flash } = makeService();
		const editor = owner(user.id);
		const byInquiry = await inTenant(tenant, async () =>
			flash.add(tenant, editor, sita, await upload(), MOTH),
		);
		const byProject = await inTenant(tenant, async () =>
			flash.add(tenant, editor, sita, await upload(), { ...MOTH, name: "Koi" }),
		);
		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeInquiry(tenant, client, { flashDesignId: byInquiry.id });
			await makeProject(tenant, client, { flashDesignId: byProject.id });
		});
		const files = await storedImages(tenant, PURPOSE);
		assert.lengthOf(files, 6);

		const failing = failDeletes("public", () => true);
		try {
			for (const design of [byInquiry, byProject]) {
				await inTenant(tenant, async () => {
					await assert.rejects(
						() => flash.remove(tenant, editor, design),
						FlashInUseError,
					);
					// The request survived its savepoint: reads still work.
					assert.lengthOf(await flash.list(tenant, sita), 2);
				});
			}
			assert.lengthOf(failing.attempts, 0, "no delete reached the drive");
		} finally {
			failing.restore();
		}
		assert.deepEqual(await storedImages(tenant, PURPOSE), files);
	});

	test("an artist unlinked meanwhile, or a deleted artist, can't update or remove: E_ROW_NOT_FOUND", async ({
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
		const { artists, flash } = makeService();
		const [mine] = await seedDesigns(tenant, own, 1);
		const [theirs] = await seedDesigns(tenant, other, 1);
		const details = { name: "New", size: "1 in", price: null, hidden: false };

		await inTenant(tenant, () => artists.unlinkUser(tenant, member.id));
		const editor = asArtist(member.id);
		const changes: (() => Promise<unknown>)[] = [
			() => flash.update(tenant, editor, mine, details),
			() => flash.remove(tenant, editor, mine),
		];
		for (const change of changes) {
			await assert.rejects(
				() => inTenantAs(tenant, member, change),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		}

		// An owner's change to a deleted artist's design is refused too.
		await inTenant(tenant, () => artists.delete(tenant, other));
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					flash.update(tenant, owner(boss.id), theirs, details),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		await assert.rejects(
			() =>
				inTenant(tenant, () => flash.remove(tenant, owner(boss.id), theirs)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		const read = await inTenant(tenant, () => FlashDesign.findOrFail(mine.id));
		assert.equal(read.name, "d0");
	});

	test("findEditable: another tenant's design, another artist's for an artist member and an unknown id are E_ROW_NOT_FOUND", async ({
		assert,
	}) => {
		const a = await studioWithOwner("flash-edit-a", "Edit A");
		const b = await studioWithOwner("flash-edit-b", "Edit B");
		const member = await artistIn(a.tenant);
		const own = await addArtist(a.tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const other = await addArtist(a.tenant, a.owner, {
			name: "Other",
			slug: "other",
		});
		const artistB = await addArtist(b.tenant, b.owner);
		const [mine] = await seedDesigns(a.tenant, own, 1);
		const [theirs] = await seedDesigns(a.tenant, other, 1);
		const [foreign] = await seedDesigns(b.tenant, artistB, 1);
		const { flash } = makeService();

		const found = await inTenant(a.tenant, () =>
			flash.findEditable(a.tenant, owner(a.owner.id), theirs.id),
		);
		assert.equal(found.design.id, theirs.id);
		assert.equal(found.artist.id, other.id);
		const asOwn = await inTenantAs(a.tenant, member, () =>
			flash.findEditable(a.tenant, asArtist(member.id), mine.id),
		);
		assert.equal(asOwn.artist.id, own.id);

		const refused: { who: typeof a.owner; find: () => Promise<unknown> }[] = [
			// Another tenant's design.
			{
				who: a.owner,
				find: () => flash.findEditable(a.tenant, owner(a.owner.id), foreign.id),
			},
			// Another artist's design, for an artist member.
			{
				who: member,
				find: () =>
					flash.findEditable(a.tenant, asArtist(member.id), theirs.id),
			},
			// An unknown id.
			{
				who: a.owner,
				find: () =>
					flash.findEditable(
						a.tenant,
						owner(a.owner.id),
						"0199f000-0000-7000-8000-000000000001",
					),
			},
		];
		for (const { who, find } of refused) {
			await assert.rejects(
				() => inTenantAs(a.tenant, who, find),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		}
	});

	test("page: shown designs of the given artists, newest first; the cursor visits each once across ties; nothing and no query for no artists", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const { flash } = makeService();
		const at = DateTime.now().minus({ hours: 2 });
		const tie = at.plus({ minutes: 5 });
		const made = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, sita, { name: "oldest", createdAt: at }),
			await addFlashDesign(tenant, sita, { name: "tie-1", createdAt: tie }),
			await addFlashDesign(tenant, sita, { name: "tie-2", createdAt: tie }),
			await addFlashDesign(tenant, sita, { name: "tie-3", createdAt: tie }),
			await addFlashDesign(tenant, sita, {
				name: "newest",
				createdAt: at.plus({ minutes: 9 }),
			}),
			await addFlashDesign(tenant, sita, {
				name: "hidden",
				hidden: true,
				createdAt: at.plus({ minutes: 10 }),
			}),
		]);
		const expected = made
			.filter((design) => !design.hidden)
			.sort(
				(x, y) =>
					y.createdAt.toMillis() - x.createdAt.toMillis() ||
					(x.id < y.id ? 1 : -1),
			)
			.map((design) => design.id);
		const filter = { artistIds: [sita.id] };

		const one = await inTenant(tenant, () =>
			flash.page(tenant, filter, null, 2),
		);
		const two = await inTenant(tenant, () =>
			flash.page(tenant, filter, one.next, 2),
		);
		const three = await inTenant(tenant, () =>
			flash.page(tenant, filter, two.next, 2),
		);

		assert.deepEqual(
			[...one.designs, ...two.designs, ...three.designs].map(
				(design) => design.id,
			),
			expected,
		);
		assert.deepEqual(
			[one.designs.length, two.designs.length, three.designs.length],
			[2, 2, 1],
		);
		assert.isNotNull(one.next);
		assert.isNotNull(two.next);
		assert.isNull(three.next);

		const none = await recordQueries(() =>
			inTenant(tenant, () => flash.page(tenant, { artistIds: [] }, null, 5)),
		);
		assert.deepEqual(none.result, { designs: [], next: null });
		assert.lengthOf(
			none.queries.filter((query) => query.includes("flash_designs")),
			0,
		);
	});

	test("artistsWithDesigns counts shown designs only; findShown is null for a hidden design or an artist not given; forIds gives hidden ones too", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const sita = await addArtist(tenant, user);
		const arjun = await addArtist(tenant, user, {
			name: "Arjun",
			slug: "arjun",
		});
		const mira = await addArtist(tenant, user, { name: "Mira", slug: "mira" });
		const { flash } = makeService();
		const [shown, hidden] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, sita),
			await addFlashDesign(tenant, arjun, { hidden: true }),
			await addFlashDesign(tenant, mira, { hidden: true }),
			await addFlashDesign(tenant, mira),
		]);
		const ids = [sita.id, arjun.id, mira.id];

		await inTenant(tenant, async () => {
			assert.deepEqual(
				[...(await flash.artistsWithDesigns(tenant, ids))].sort(),
				[sita.id, mira.id].sort(),
			);
			assert.lengthOf(await flash.artistsWithDesigns(tenant, []), 0);
			assert.equal(
				(await flash.findShown(tenant, shown.id, ids))?.id,
				shown.id,
			);
			assert.isNull(await flash.findShown(tenant, hidden.id, ids));
			assert.isNull(await flash.findShown(tenant, shown.id, [arjun.id]));
			assert.isNull(await flash.findShown(tenant, shown.id, []));
			const all = await flash.forIds(tenant, [shown.id, hidden.id]);
			assert.deepEqual([...all.keys()].sort(), [shown.id, hidden.id].sort());
			assert.isTrue(all.get(hidden.id)?.hidden);
			assert.equal((await flash.forIds(tenant, [])).size, 0);
		});
	});

	test("an artist hidden or deleted after the caller read the visible ids, with a design added since, is in no page, no filter and no design read", async ({
		assert,
	}) => {
		const { tenant, owner: user } = await studioWithOwner();
		const staying = await addArtist(tenant, user);
		const hiding = await addArtist(tenant, user, {
			name: "Hiding",
			slug: "hiding",
		});
		const leaving = await addArtist(tenant, user, {
			name: "Leaving",
			slug: "leaving",
		});
		const { flash, artists } = makeService();
		// What the caller read: all three were visible then.
		const stale = [staying.id, hiding.id, leaving.id];
		const designs = await inTenant(tenant, async () => {
			await Artist.query().where("id", hiding.id).update({ visible: false });
			await artists.delete(tenant, leaving);
			return {
				staying: await addFlashDesign(tenant, staying),
				hiding: await addFlashDesign(tenant, hiding),
				leaving: await addFlashDesign(tenant, leaving),
			};
		});

		await inTenant(tenant, async () => {
			const page = await flash.page(tenant, { artistIds: stale }, null, 10);
			assert.deepEqual(
				page.designs.map((design) => design.id),
				[designs.staying.id],
			);
			for (const gone of [hiding, leaving]) {
				const own = await flash.page(
					tenant,
					{ artistIds: [gone.id] },
					null,
					10,
				);
				assert.lengthOf(own.designs, 0);
			}
			assert.deepEqual(
				[...(await flash.artistsWithDesigns(tenant, stale))],
				[staying.id],
			);
			assert.equal(
				(await flash.findShown(tenant, designs.staying.id, stale))?.id,
				designs.staying.id,
			);
			assert.isNull(await flash.findShown(tenant, designs.hiding.id, stale));
			assert.isNull(await flash.findShown(tenant, designs.leaving.id, stale));
		});
	});

	test("another tenant's designs never appear, from this tenant's context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("flash-svc-a", "Svc A");
		const b = await studioWithOwner("flash-svc-b", "Svc B");
		const artistA = await addArtist(a.tenant, a.owner);
		const artistB = await addArtist(b.tenant, b.owner);
		const { flash } = makeService();
		const [designB] = await seedDesigns(b.tenant, artistB, 1);
		await seedDesigns(a.tenant, artistA, 1);

		await inTenant(a.tenant, async () => {
			const page = await flash.page(
				a.tenant,
				{ artistIds: [artistB.id] },
				null,
				5,
			);
			assert.lengthOf(page.designs, 0);
			assert.isNull(await flash.findShown(a.tenant, designB.id, [artistB.id]));
			assert.equal((await flash.forIds(a.tenant, [designB.id])).size, 0);
			assert.lengthOf(
				await flash.artistsWithDesigns(a.tenant, [artistB.id]),
				0,
			);
		});
	});
});
