import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import ImageService from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { withDbContext } from "#services/db_context";
import { makeClip, videoFiles } from "#tests/helpers/videos";

/**
 * Video angles: a removal and the worker's write of a video's outcome race
 * on real, committed rows (two connections, outside the suite's global
 * transaction; seeded and removed through the owner connection). Both lock
 * the row FOR UPDATE (WorkPhotoService.lockedPhoto and tattooRows, and
 * settleVideo after the lead FOR SHARE), so they serialise, whichever comes
 * first, and no file is ever left without its row.
 */

type Gate = { opened: Promise<void>; open: () => void };
function gate(): Gate {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

const later = (ms: number) =>
	new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), ms));

/** WorkPhotoService whose settle holds its transaction open (its locks taken) until `release` opens. */
class HeldSettle extends WorkPhotoService {
	settled = gate();
	release = gate();
	protected async settleVideo(
		tenant: { id: string },
		photoId: string,
		stagingKey: string,
		values: Record<string, string | number | string[]>,
	): Promise<boolean> {
		const done = await super.settleVideo(tenant, photoId, stagingKey, values);
		this.settled.open();
		await this.release.opened;
		return done;
	}
}

const owner = () => db.connection("owner");

/** A committed tenant, artist and lead photo, and a video angle processing with its upload staged. */
async function world() {
	const slug = `video-race-${randomUUID().slice(0, 8)}`;
	const { rows: tenants } = await owner().rawQuery(
		"insert into tenants (type, name, slug, contact_phone, contact_email, default_deposit_percent, created_at) values ('studio', 'Race', ?, '+9779800000000', ?, 30, now()) returning id",
		[slug, `${slug}@example.com`],
	);
	const tenant = { id: tenants[0].id as string };
	const { rows: artists } = await owner().rawQuery(
		"insert into artists (tenant_id, name, slug, created_at) values (?, 'Sita', 'sita', now()) returning id",
		[tenant.id],
	);
	const artistId = artists[0].id as string;
	const { rows: leads } = await owner().rawQuery(
		"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, created_at) values (?, ?, ?, 1, 1, now()) returning id",
		[tenant.id, artistId, `tenants/${tenant.id}/artist_work_photo/lead.jpg`],
	);
	const videos = new VideoService(new ImageService());
	const stagingKey = videos.stagingKey(tenant);
	const clip = await makeClip({ width: 320, height: 240, seconds: 1 });
	await drive.use("private").put(stagingKey, await readFile(clip.path));
	const { rows } = await owner().rawQuery(
		`insert into artist_work_photos (tenant_id, artist_id, kind, video_state, video_staging_key, lead_photo_id, angle_position, created_at)
		 values (?, ?, 'video', 'processing', ?, ?, 1, now()) returning id`,
		[tenant.id, artistId, stagingKey, leads[0].id],
	);
	return { tenant, artistId, videoId: rows[0].id as string };
}

async function forget(tenantId: string) {
	await owner().transaction(async (trx) => {
		await trx.rawQuery("set local session_replication_role = replica");
		for (const table of ["artist_work_photos", "artists", "tenant_slugs"]) {
			await trx.rawQuery(`delete from ${table} where tenant_id = ?`, [
				tenantId,
			]);
		}
		await trx.rawQuery("delete from tenants where id = ?", [tenantId]);
	});
}

const editor = { userId: randomUUID(), role: "owner" as const };

async function rowOf(tenantId: string, id: string) {
	const { rows } = await owner().rawQuery(
		"select id from artist_work_photos where tenant_id = ? and id = ?",
		[tenantId, id],
	);
	return rows[0] ?? null;
}

test.group("Video angles: a removal and the worker's write race", (group) => {
	group.each.timeout(60_000);

	test("the worker's write first: the removal waits for it, then deletes the video's files and its row", async ({
		assert,
	}) => {
		const { tenant, videoId } = await world();
		try {
			const images = new ImageService();
			const photos = new HeldSettle(images, new ArtistService(images));
			const processing = photos.processVideo(tenant, videoId);
			await photos.settled.opened;

			const video = await withDbContext({ tenantId: tenant.id }, () =>
				ArtistWorkPhoto.findOrFail(videoId),
			);
			const removal = withDbContext({ tenantId: tenant.id }, () =>
				photos.remove(tenant, editor, video, { scope: "photo" }),
			);
			// It waits on the row the worker holds.
			assert.equal(await Promise.race([removal, later(400)]), "waiting");

			photos.release.open();
			assert.equal(await processing, "ready");
			assert.equal(await removal, 1);
			assert.isNull(await rowOf(tenant.id, videoId));
			assert.deepEqual(
				await videoFiles({ tenant }),
				[],
				"no file without a row",
			);
		} finally {
			await forget(tenant.id);
		}
	});

	test("the removal first: the worker's write waits for it, finds no row and deletes what it made", async ({
		assert,
	}) => {
		const { tenant, videoId } = await world();
		try {
			const images = new ImageService();
			const photos = new WorkPhotoService(images, new ArtistService(images));
			const removed = gate();
			const commit = gate();
			const removal = withDbContext({ tenantId: tenant.id }, async () => {
				const video = await ArtistWorkPhoto.findOrFail(videoId);
				const count = await photos.remove(tenant, editor, video, {
					scope: "photo",
				});
				removed.open();
				// Its locks held until this outer transaction commits.
				await commit.opened;
				return count;
			});
			await removed.opened;

			const processing = photos.processVideo(tenant, videoId);
			assert.equal(await Promise.race([processing, later(4000)]), "waiting");

			commit.open();
			assert.equal(await removal, 1);
			assert.equal(await processing, "skipped");
			assert.isNull(await rowOf(tenant.id, videoId));
			assert.deepEqual(
				await videoFiles({ tenant }),
				[],
				"no file without a row",
			);
		} finally {
			await forget(tenant.id);
		}
	});
});
