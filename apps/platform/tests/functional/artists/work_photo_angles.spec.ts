import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import {
	TattooChangedError,
	TattooGroupError,
	TattooPhotoLimitError,
	WorkPhotoLimitError,
} from "#modules/artists/errors";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { groupSummary } from "#modules/artists/portfolio";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import { ImageDeleteError } from "#modules/media/errors";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

/**
 * Angles: one tattoo shown with several photos (a lead and up to seven
 * angles). The service's rules (WorkPhotoService: group, add to a tattoo,
 * arrange, ungroup, and the tattoo-wide remove, publish, details and move)
 * and the dashboard's routes (the upload's `lead`, `order`, `ungroup`, the
 * bulk "group" and the portfolio's tiles). The database's own rules (the
 * guard trigger, the checks, the deferrable unique) are pinned in
 * tests/functional/rls/artist_work_photo_angles.spec.ts.
 */

const PURPOSE = "artist_work_photo";
const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
const at = (minutes: number) => T0.plus({ minutes });
const upload = async () => uploadOf(await testImages.jpeg(800, 600));

function makeService() {
	const images = new RecordingImageService();
	const artists = new ArtistService(images);
	return { images, artists, photos: new WorkPhotoService(images, artists) };
}

const ownerOf = (owner: User): ProfileEditor => ({
	userId: owner.id,
	role: "owner",
});

/** The tattoo `leadId` leads as its rows: the lead first, then its angles in order. */
const tattoo = (tenant: Tenant, leadId: string) =>
	inTenant(tenant, () =>
		ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where((rows) => {
				rows.where("id", leadId).orWhere("lead_photo_id", leadId);
			})
			.orderByRaw("angle_position asc nulls first"),
	);

const idsOf = (rows: { id: string }[]) => rows.map(({ id }) => id);

/** Three photos of one artist, oldest first: a, b, c (c the newest). */
async function threePhotos(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug);
	const sita = await addArtist(tenant, owner);
	const [a, b, c] = await inTenant(tenant, async () => [
		await addWorkPhoto(tenant, sita, {
			createdAt: at(1),
			alt: "Side",
			styles: ["blackwork"],
		}),
		await addWorkPhoto(tenant, sita, { createdAt: at(2), hidden: true }),
		await addWorkPhoto(tenant, sita, {
			createdAt: at(3),
			alt: "Front",
			styles: ["realism", "fine-line"],
			healed: true,
		}),
	]);
	return { owner, tenant, sita, a, b, c };
}

test.group("Angles: grouping photos as one tattoo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the newest selected photo leads and the others follow newest first, each taking the lead's published state, styles and healed mark; descriptions stay their own", async ({
		assert,
	}) => {
		const { owner, tenant, a, b, c } = await threePhotos("angles-group-a");
		const { photos } = makeService();

		const result = await inTenant(tenant, () =>
			photos.group(tenant, ownerOf(owner), [a, b, c]),
		);

		assert.equal(result.lead.id, c.id);
		assert.deepEqual(idsOf(result.angles), [b.id, a.id]);
		const rows = await tattoo(tenant, c.id);
		assert.deepEqual(idsOf(rows), [c.id, b.id, a.id]);
		assert.deepEqual(
			rows.map((row) => [row.leadPhotoId, row.anglePosition]),
			[
				[null, null],
				[c.id, 1],
				[c.id, 2],
			],
		);
		for (const row of rows) {
			assert.isFalse(row.hidden, row.id);
			assert.deepEqual(row.styles, ["realism", "fine-line"], row.id);
			assert.isTrue(row.healed, row.id);
		}
		assert.deepEqual(
			rows.map((row) => row.alt),
			["Front", null, "Side"],
		);
	});

	test("refuses too few or too many photos, two artists, an angle and a tattoo of several photos, and changes nothing", async ({
		assert,
	}) => {
		const { owner, tenant, sita, a, b, c } =
			await threePhotos("angles-group-b");
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const { photos } = makeService();
		const editor = ownerOf(owner);
		const [binas, nine, angleOfA] = await inTenant(tenant, async () => {
			const binas = await addWorkPhoto(tenant, bina);
			const nine: ArtistWorkPhoto[] = [];
			for (let i = 0; i < 9; i += 1) {
				nine.push(await addWorkPhoto(tenant, sita));
			}
			const angleOfA = await addWorkPhoto(tenant, sita, {
				angleOf: { lead: a, position: 1 },
			});
			return [binas, nine, angleOfA];
		});
		const reasonOf = async (list: ArtistWorkPhoto[]) => {
			try {
				await inTenant(tenant, () => photos.group(tenant, editor, list));
			} catch (error) {
				if (error instanceof TattooGroupError) return error.reason;
				throw error;
			}
			return "grouped";
		};

		assert.equal(await reasonOf([c]), "count");
		assert.equal(await reasonOf(nine), "count");
		assert.equal(await reasonOf([c, binas]), "artists");
		assert.equal(await reasonOf([c, angleOfA]), "angle");
		// a leads a tattoo of its own: nothing is merged silently.
		assert.equal(await reasonOf([b, a]), "has_angles");
		assert.deepEqual(idsOf(await tattoo(tenant, a.id)), [a.id, angleOfA.id]);
		assert.isNull((await tattoo(tenant, b.id))[0].leadPhotoId);
		assert.isNull((await tattoo(tenant, c.id))[0].leadPhotoId);
	});

	test("a photo removed meanwhile groups nothing (a 404 for the request)", async ({
		assert,
	}) => {
		const { owner, tenant, a, b } = await threePhotos("angles-group-c");
		const { photos } = makeService();
		await inTenant(tenant, () =>
			ArtistWorkPhoto.query().where("id", b.id).delete(),
		);

		await assert.rejects(
			() =>
				inTenant(tenant, () => photos.group(tenant, ownerOf(owner), [a, b])),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		assert.isNull((await tattoo(tenant, a.id))[0].leadPhotoId);
	});
});

test.group("Angles: adding photos to a tattoo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an upload with a lead is the tattoo's next angle, with the tattoo's state whatever details are sent, and its own description", async ({
		assert,
	}) => {
		const { owner, tenant, sita, a, b, c } = await threePhotos("angles-add-a");
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [b, c]));

		const added = await inTenant(tenant, async () =>
			photos.add(
				tenant,
				editor,
				sita,
				await upload(),
				{ alt: "Close up", styles: ["blackwork"], healed: false, hidden: true },
				c,
			),
		);

		assert.equal(added.leadPhotoId, c.id);
		assert.equal(added.anglePosition, 2);
		assert.equal(added.alt, "Close up");
		assert.isFalse(added.hidden);
		assert.deepEqual(added.styles, ["realism", "fine-line"]);
		assert.isTrue(added.healed);
		assert.deepEqual(idsOf(await tattoo(tenant, c.id)), [c.id, b.id, added.id]);
		// a stays a tattoo of its own.
		assert.isNull((await tattoo(tenant, a.id))[0].leadPhotoId);
	});

	test("a ninth photo is refused before any decode, and a lead that became an angle meanwhile is refused under the lock", async ({
		assert,
	}) => {
		const { owner, tenant, sita, a, c } = await threePhotos("angles-add-b");
		const { images, photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, async () => {
			for (let position = 1; position <= 7; position += 1) {
				await addWorkPhoto(tenant, sita, {
					styles: ["realism", "fine-line"],
					healed: true,
					angleOf: { lead: c, position },
				});
			}
		});

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					photos.add(tenant, editor, sita, await upload(), undefined, c),
				),
			TattooPhotoLimitError,
		);
		assert.lengthOf(images.keys, 0);

		// a is grouped under another lead after the page loaded.
		const newer = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { createdAt: at(9) }),
		);
		await inTenant(tenant, () => photos.group(tenant, editor, [a, newer]));
		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					photos.add(tenant, editor, sita, await upload(), undefined, a),
				),
			TattooChangedError,
		);
	});

	test("angles count toward the artist's 100", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("angles-add-c");
		const sita = await addArtist(tenant, owner);
		const { photos } = makeService();
		const lead = await inTenant(tenant, async () => {
			const lead = await addWorkPhoto(tenant, sita);
			for (let position = 1; position <= 7; position += 1) {
				await addWorkPhoto(tenant, sita, { angleOf: { lead, position } });
			}
			for (let i = 0; i < MAX_WORK_PHOTOS - 8; i += 1) {
				await addWorkPhoto(tenant, sita);
			}
			return lead;
		});
		const counts = await inTenant(tenant, () =>
			photos.counts(tenant, [sita.id]),
		);
		assert.deepEqual(counts.get(sita.id), {
			photos: MAX_WORK_PHOTOS,
			tattoos: MAX_WORK_PHOTOS - 7,
		});

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					photos.add(tenant, ownerOf(owner), sita, await upload()),
				),
			WorkPhotoLimitError,
		);
		assert.isDefined(lead);
	});
});

test.group("Angles: order, main photo and ungrouping", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new order can make an angle the main photo in one change, and the tattoo keeps its state", async ({
		assert,
	}) => {
		const { owner, tenant, a, b, c } = await threePhotos("angles-order-a");
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [a, b, c]));

		// Move a (place 2) earlier: c, a, b.
		await inTenant(tenant, () =>
			photos.arrange(tenant, editor, c, [c.id, a.id, b.id]),
		);
		assert.deepEqual(idsOf(await tattoo(tenant, c.id)), [c.id, a.id, b.id]);

		// Make b the main photo: b, c, a.
		const result = await inTenant(tenant, () =>
			photos.arrange(tenant, editor, c, [b.id, c.id, a.id]),
		);
		assert.equal(result.lead.id, b.id);
		const rows = await tattoo(tenant, b.id);
		assert.deepEqual(idsOf(rows), [b.id, c.id, a.id]);
		assert.deepEqual(
			rows.map((row) => row.anglePosition),
			[null, 1, 2],
		);
		for (const row of rows) {
			assert.isFalse(row.hidden, row.id);
			assert.deepEqual(row.styles, ["realism", "fine-line"], row.id);
			assert.isTrue(row.healed, row.id);
		}
	});

	test("an order that names other photos than the tattoo has, or a lead that is no longer one, changes nothing", async ({
		assert,
	}) => {
		const { owner, tenant, a, b, c } = await threePhotos("angles-order-b");
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [b, c]));

		for (const ids of [[b.id, c.id, a.id], [b.id], [c.id, c.id]]) {
			await assert.rejects(
				() => inTenant(tenant, () => photos.arrange(tenant, editor, c, ids)),
				TattooChangedError,
			);
		}
		await assert.rejects(
			() =>
				inTenant(tenant, () => photos.arrange(tenant, editor, b, [b.id, c.id])),
			TattooChangedError,
		);
		assert.deepEqual(idsOf(await tattoo(tenant, c.id)), [c.id, b.id]);
	});

	test("ungrouping an angle makes it a tattoo of its own, keeping the tattoo's state, and the later angles close the gap", async ({
		assert,
	}) => {
		const { owner, tenant, a, b, c } = await threePhotos("angles-ungroup");
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [a, b, c]));

		const alone = await inTenant(tenant, () =>
			photos.ungroup(tenant, editor, b),
		);

		assert.isNull(alone.leadPhotoId);
		assert.isNull(alone.anglePosition);
		assert.isFalse(alone.hidden);
		assert.deepEqual(alone.styles, ["realism", "fine-line"]);
		const rows = await tattoo(tenant, c.id);
		assert.deepEqual(idsOf(rows), [c.id, a.id]);
		assert.equal(rows[1].anglePosition, 1);
		// Not an angle (any more): refused, nothing changes.
		await assert.rejects(
			() => inTenant(tenant, () => photos.ungroup(tenant, editor, c)),
			TattooChangedError,
		);
	});
});

test.group("Angles: tattoo-wide changes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("publishing, unpublishing and the lead's details apply to the whole tattoo; an angle's details set only its description", async ({
		assert,
	}) => {
		const { owner, tenant, a, b, c } = await threePhotos("angles-state");
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [a, b, c]));

		await inTenant(tenant, () => photos.setHidden(tenant, editor, c, true));
		assert.deepEqual(
			(await tattoo(tenant, c.id)).map((row) => row.hidden),
			[true, true, true],
		);
		// An angle given stands for its tattoo.
		await inTenant(tenant, () => photos.setHidden(tenant, editor, a, false));
		assert.deepEqual(
			(await tattoo(tenant, c.id)).map((row) => row.hidden),
			[false, false, false],
		);

		await inTenant(tenant, () =>
			photos.updateDetails(tenant, editor, c, {
				alt: "Koi, front",
				styles: ["japanese"],
				healed: false,
			}),
		);
		await inTenant(tenant, () =>
			photos.updateDetails(tenant, editor, a, {
				alt: "Koi, side",
				styles: ["blackwork"],
				healed: true,
			}),
		);
		const rows = await tattoo(tenant, c.id);
		assert.deepEqual(
			rows.map((row) => [row.alt, row.styles, row.healed]),
			[
				["Koi, front", ["japanese"], false],
				[null, ["japanese"], false],
				["Koi, side", ["japanese"], false],
			],
		);
	});

	test("removing a lead removes the whole tattoo, every photo's files first; removing an angle removes it alone and closes the gap", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("angles-remove-a");
		const sita = await addArtist(tenant, owner);
		const { photos } = makeService();
		const editor = ownerOf(owner);
		const added = await inTenant(tenant, async () => {
			const list: ArtistWorkPhoto[] = [];
			for (let i = 0; i < 4; i += 1) {
				list.push(await photos.add(tenant, editor, sita, await upload()));
			}
			return list;
		});
		const [first, second, third, fourth] = added;
		const grouped = await inTenant(tenant, () =>
			photos.group(tenant, editor, [first, second, third, fourth]),
		);
		assert.equal(grouped.lead.id, fourth.id);
		const before = (await storedImages(tenant, PURPOSE)).length;

		// The angle at place 2 (second) goes alone; third moves up.
		const one = await inTenant(tenant, () =>
			photos.remove(tenant, editor, second),
		);
		assert.equal(one, 1);
		const rows = await tattoo(tenant, fourth.id);
		assert.deepEqual(idsOf(rows), [fourth.id, third.id, first.id]);
		assert.deepEqual(
			rows.map((row) => row.anglePosition),
			[null, 1, 2],
		);
		assert.isBelow((await storedImages(tenant, PURPOSE)).length, before);

		const all = await inTenant(tenant, () =>
			photos.remove(tenant, editor, fourth),
		);
		assert.equal(all, 3);
		assert.lengthOf(await tattoo(tenant, fourth.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("a tattoo whose files cannot all be deleted stays, every row of it, and the retry finishes the job", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("angles-remove-b");
		const sita = await addArtist(tenant, owner);
		const { photos } = makeService();
		const editor = ownerOf(owner);
		const [older, newer] = await inTenant(tenant, async () => [
			await photos.add(tenant, editor, sita, await upload()),
			await photos.add(tenant, editor, sita, await upload()),
		]);
		await inTenant(tenant, () => photos.group(tenant, editor, [older, newer]));

		const failing = failDeletes("public", (key) =>
			key.startsWith(newer.imageKey.replace(/\..*$/, "")),
		);
		try {
			await assert.rejects(
				() => inTenant(tenant, () => photos.remove(tenant, editor, newer)),
				ImageDeleteError,
			);
		} finally {
			failing.restore();
		}
		assert.lengthOf(await tattoo(tenant, newer.id), 2);

		assert.equal(
			await inTenant(tenant, () => photos.remove(tenant, editor, newer)),
			2,
		);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("moving a tattoo moves every photo of it, and needs room for all of them", async ({
		assert,
	}) => {
		const { owner, tenant, sita, a, b, c } = await threePhotos("angles-move");
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const { photos } = makeService();
		const editor = ownerOf(owner);
		await inTenant(tenant, () => photos.group(tenant, editor, [a, b, c]));

		// Bina has room for two more, the tattoo is three.
		await inTenant(tenant, async () => {
			for (let i = 0; i < MAX_WORK_PHOTOS - 2; i += 1) {
				await addWorkPhoto(tenant, bina);
			}
		});
		await assert.rejects(
			() => inTenant(tenant, () => photos.reassign(tenant, editor, a, bina.id)),
			WorkPhotoLimitError,
		);
		assert.deepEqual(
			(await tattoo(tenant, c.id)).map((row) => row.artistId),
			[sita.id, sita.id, sita.id],
		);

		// One of Bina's goes: room for three.
		await inTenant(tenant, async () => {
			const extra = await ArtistWorkPhoto.query()
				.where("artist_id", bina.id)
				.firstOrFail();
			await extra.delete();
		});
		// An angle given moves its whole tattoo.
		await inTenant(tenant, () => photos.reassign(tenant, editor, a, bina.id));
		assert.deepEqual(
			(await tattoo(tenant, c.id)).map((row) => row.artistId),
			[bina.id, bina.id, bina.id],
		);
	});
});

/** POST a file to an artist's photos, into the tattoo `lead` leads. */
const uploadTo = async (
	client: ApiClient,
	user: User,
	tenant: Tenant,
	artistId: string,
	lead: string,
) =>
	client
		.post(`/t/${tenant.slug}/artists/${artistId}/photos`)
		.file("photo", await testImages.jpeg(800, 600), { filename: "angle.jpg" })
		.field("lead", lead)
		.field("alt", "The back")
		.field("back", `/t/${tenant.slug}/portfolio`)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const flashOf = (response: { flashMessage(key: string): unknown }) => ({
	success: response.flashMessage("success") as string | undefined,
	error: response.flashMessage("error") as string | undefined,
});

/** A tattoo of two photos (lead, angle) of a new artist in a new studio. */
async function studioWithTattoo(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug);
	const sita = await addArtist(tenant, owner);
	const { lead, angle } = await inTenant(tenant, async () => {
		const lead = await addWorkPhoto(tenant, sita, { createdAt: at(2) });
		const angle = await addWorkPhoto(tenant, sita, {
			createdAt: at(1),
			angleOf: { lead, position: 1 },
		});
		return { lead, angle };
	});
	return { owner, tenant, sita, lead, angle };
}

test.group("Angles: the dashboard's routes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an upload with `lead` adds the photo to that tattoo; another studio's or another artist's lead is a 404 that adds nothing", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-a");
		const theirs = await studioWithTattoo("angles-http-b");
		const bina = await addArtist(mine.tenant, mine.owner, {
			name: "Bina",
			slug: "bina",
		});

		const added = await uploadTo(
			client,
			mine.owner,
			mine.tenant,
			mine.sita.id,
			mine.lead.id,
		);
		added.assertStatus(302);
		added.assertHeader("location", `/t/${mine.tenant.slug}/portfolio`);
		const rows = await tattoo(mine.tenant, mine.lead.id);
		assert.lengthOf(rows, 3);
		const stored = await storedImages(mine.tenant, PURPOSE);
		assert.isNotEmpty(stored);
		assert.equal(rows[2].alt, "The back");
		assert.equal(rows[2].anglePosition, 2);

		const foreign = await uploadTo(
			client,
			mine.owner,
			mine.tenant,
			mine.sita.id,
			theirs.lead.id,
		);
		foreign.assertStatus(404);
		const otherArtist = await uploadTo(
			client,
			mine.owner,
			mine.tenant,
			bina.id,
			mine.lead.id,
		);
		otherArtist.assertStatus(404);
		assert.lengthOf(await tattoo(mine.tenant, mine.lead.id), 3);
		assert.lengthOf(await tattoo(theirs.tenant, theirs.lead.id), 2);
		// The refused uploads stored nothing.
		assert.deepEqual(await storedImages(mine.tenant, PURPOSE), stored);
	});

	test("order makes the angle the main photo; a stale order changes nothing and says so; another studio's id is a 404", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-c");
		const theirs = await studioWithTattoo("angles-http-d");
		const order = (id: string, ids: string[]) =>
			client
				.put(`/t/${mine.tenant.slug}/artists/photos/${id}/order`)
				.json({ ids, back: `/t/${mine.tenant.slug}/portfolio` })
				.withCsrfToken()
				.loginAs(mine.owner)
				.redirects(0);

		const moved = await order(mine.lead.id, [mine.angle.id, mine.lead.id]);
		moved.assertStatus(302);
		assert.equal(flashOf(moved).success, "Order saved.");
		assert.deepEqual(idsOf(await tattoo(mine.tenant, mine.angle.id)), [
			mine.angle.id,
			mine.lead.id,
		]);

		// The page still thinks the old lead leads.
		const stale = await order(mine.lead.id, [mine.lead.id, mine.angle.id]);
		stale.assertStatus(302);
		assert.match(flashOf(stale).error ?? "", /changed meanwhile/);
		assert.deepEqual(idsOf(await tattoo(mine.tenant, mine.angle.id)), [
			mine.angle.id,
			mine.lead.id,
		]);

		(
			await order(theirs.lead.id, [theirs.angle.id, theirs.lead.id])
		).assertStatus(404);
		assert.deepEqual(idsOf(await tattoo(theirs.tenant, theirs.lead.id)), [
			theirs.lead.id,
			theirs.angle.id,
		]);
	});

	test("ungroup takes an angle out of its tattoo; another studio's angle is a 404", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-e");
		const theirs = await studioWithTattoo("angles-http-f");
		const ungroup = (id: string) =>
			client
				.post(`/t/${mine.tenant.slug}/artists/photos/${id}/ungroup`)
				.json({ back: `/t/${mine.tenant.slug}/portfolio` })
				.withCsrfToken()
				.loginAs(mine.owner)
				.redirects(0);

		const done = await ungroup(mine.angle.id);
		done.assertStatus(302);
		assert.match(flashOf(done).success ?? "", /tattoo of its own/);
		assert.lengthOf(await tattoo(mine.tenant, mine.lead.id), 1);

		(await ungroup(theirs.angle.id)).assertStatus(404);
		assert.lengthOf(await tattoo(theirs.tenant, theirs.lead.id), 2);
	});

	test("removing a lead removes its tattoo and says how many photos went", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-g");

		const response = await client
			.delete(
				`/t/${mine.tenant.slug}/artists/photos/${mine.lead.id}?back=/t/${mine.tenant.slug}/portfolio`,
			)
			.withCsrfToken()
			.loginAs(mine.owner)
			.redirects(0);

		response.assertStatus(302);
		assert.equal(flashOf(response).success, "Tattoo removed: 2 photos.");
		assert.lengthOf(await tattoo(mine.tenant, mine.lead.id), 0);
	});

	test("bulk group makes one tattoo of the selected photos; a tattoo of several, or another studio's id, groups nothing and says why", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-h");
		const theirs = await studioWithTattoo("angles-http-i");
		const [x, y] = await inTenant(mine.tenant, async () => [
			await addWorkPhoto(mine.tenant, mine.sita, { createdAt: at(5) }),
			await addWorkPhoto(mine.tenant, mine.sita, { createdAt: at(6) }),
		]);
		const bulk = (ids: string[]) =>
			client
				.post(`/t/${mine.tenant.slug}/portfolio/bulk`)
				.json({
					action: "group",
					ids,
					back: `/t/${mine.tenant.slug}/portfolio`,
				})
				.withCsrfToken()
				.loginAs(mine.owner)
				.redirects(0);

		const refused = await bulk([x.id, mine.lead.id]);
		refused.assertStatus(302);
		assert.equal(flashOf(refused).error, groupSummary("has_angles").message);
		const foreign = await bulk([x.id, theirs.lead.id]);
		assert.equal(flashOf(foreign).error, groupSummary("gone").message);
		assert.lengthOf(await tattoo(mine.tenant, x.id), 1);

		const grouped = await bulk([x.id, y.id]);
		grouped.assertStatus(302);
		assert.equal(flashOf(grouped).success, groupSummary({ photos: 2 }).message);
		assert.deepEqual(idsOf(await tattoo(mine.tenant, y.id)), [y.id, x.id]);
		assert.lengthOf(await tattoo(theirs.tenant, theirs.lead.id), 2);
	});

	test("the portfolio's tiles are tattoos: each lead with its angles in order, and the counts of photos and tattoos", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithTattoo("angles-http-j");
		await inTenant(mine.tenant, () =>
			addWorkPhoto(mine.tenant, mine.sita, {
				alt: "Second angle",
				angleOf: { lead: mine.lead, position: 2 },
			}),
		);

		const response = await client
			.get(`/t/${mine.tenant.slug}/portfolio`)
			.withInertia()
			.loginAs(mine.owner);

		response.assertStatus(200);
		const { photos, artists, page } = response.inertiaProps as {
			photos: { id: string; angles: { id: string; alt: string | null }[] }[];
			artists: { photoCount: number; tattooCount: number }[];
			page: { total: number };
		};
		assert.deepEqual(idsOf(photos), [mine.lead.id]);
		assert.deepEqual(
			photos[0].angles.map((angle) => [angle.id === mine.angle.id, angle.alt]),
			[
				[true, null],
				[false, "Second angle"],
			],
		);
		for (const angle of photos[0].angles) {
			assert.deepEqual(Object.keys(angle).sort(), [
				"alt",
				"fullUrl",
				"height",
				"id",
				"thumbUrl",
				"width",
			]);
		}
		assert.equal(page.total, 1);
		assert.deepEqual(
			artists.map(({ photoCount, tattooCount }) => [photoCount, tattooCount]),
			[[3, 1]],
		);
	});
});
