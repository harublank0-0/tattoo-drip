import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import {
	TattooPhotoLimitError,
	VideoLeadError,
	VideoUploadError,
} from "#modules/artists/errors";
import ProcessWorkVideoJob from "#modules/artists/jobs/process_work_video_job";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import { readVideoUploadToken } from "#modules/artists/video_uploads";
import ImageService from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { VIDEO_GAVE_UP, VIDEO_REFUSALS } from "#modules/media/video";
import type Tenant from "#modules/tenancy/models/tenant";
import { currentClient, withTransaction } from "#services/db_context";
import { addArtist, addWorkPhoto, addWorkVideo } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	makeClip,
	probeStored,
	stageClip,
	stagedFiles,
	storedBytes,
	videoFiles,
} from "#tests/helpers/videos";
import { processQueued, registerJob } from "#tests/helpers/worker";

/**
 * Video angles, end to end with the real ffmpeg: a clip staged as the
 * browser leaves it, added to a tattoo (WorkPhotoService.addVideo, which
 * queues ProcessWorkVideoJob), then processed by the worker into its
 * renditions and poster (VideoService.process, outside any transaction).
 * The clips are made by ffmpeg here (tests/helpers/videos.ts): a test
 * pattern with a sine tone and a phone's metadata (a title, a GPS location,
 * a creation time).
 */

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });

const ownerOf = (owner: User): ProfileEditor => ({
	userId: owner.id,
	role: "owner",
});

function services(videos = new VideoService(new ImageService())) {
	const images = new ImageService();
	const artists = new ArtistService(images);
	return { videos, photos: new WorkPhotoService(images, artists, videos) };
}

/** A studio with an artist and a tattoo of one photo, its lead. */
async function tattooOfOne(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug);
	const sita = await addArtist(tenant, owner);
	const lead = await inTenant(tenant, () =>
		addWorkPhoto(tenant, sita, { createdAt: T0, styles: ["realism"] }),
	);
	return { owner, tenant, sita, lead };
}

/** A clip staged and added to the tattoo (processing, its job queued). */
async function addClip(
	studio: Awaited<ReturnType<typeof tattooOfOne>>,
	clip: { path: string; type: string; size: number },
	photos = services().photos,
) {
	const { token } = await stageClip(studio, studio.lead.id, clip);
	const upload = readVideoUploadToken(token, {
		tenantId: studio.tenant.id,
		leadId: studio.lead.id,
	});
	if (!upload) throw new Error("the test's token did not read back");
	const video = await inTenant(studio.tenant, () =>
		photos.addVideo(
			studio.tenant,
			ownerOf(studio.owner),
			studio.sita,
			studio.lead,
			upload,
			"Healed, in the sun",
		),
	);
	return { video, upload };
}

const reload = (tenant: Tenant, id: string) =>
	inTenant(tenant, () =>
		ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail(),
	);

/** Container tags a phone writes, any of which would leak where or when. */
const PRIVATE_TAGS = ["title", "location", "location-eng", "creation_time"];

test.group("Video angles: processing with ffmpeg", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ProcessWorkVideoJob));
	group.each.timeout(120_000);

	test("a phone's portrait clip with sound and GPS: the worker makes 720p and 1080p H.264, silent, metadata-free, faststart, and a poster with copies; the upload is deleted", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-portrait");
		const clip = await makeClip({ width: 1080, height: 1920, seconds: 2 });
		const { video, upload } = await addClip(studio, clip);
		assert.equal(video.videoState, "processing");
		assert.equal(video.anglePosition, 1);
		assert.deepEqual(video.styles, ["realism"]);
		assert.isNull(video.imageKey);

		// The real worker runs the real job.
		await processQueued();

		const ready = await reload(studio.tenant, video.id);
		assert.equal(ready.videoState, "ready");
		assert.isNull(ready.videoFailure);
		assert.equal(ready.width, 1080);
		assert.equal(ready.height, 1920);
		assert.equal(ready.videoDurationMs, 2000);
		assert.equal(ready.videoStagingKey, upload.key);
		const keys = ready.videoKeys ?? [];
		assert.lengthOf(keys, 2);
		assert.match(keys[0], /\.720x1280\.mp4$/);
		assert.match(keys[1], /\.1080x1920\.mp4$/);

		for (const [key, width, height] of [
			[keys[0], 720, 1280],
			[keys[1], 1080, 1920],
		] as const) {
			const probed = await probeStored(key);
			assert.deepEqual(
				probed.streams.map((stream) => stream.codec_type),
				["video"],
				"no audio, no data, no subtitles",
			);
			const [stream] = probed.streams;
			assert.equal(stream.codec_name, "h264");
			assert.equal(stream.pix_fmt, "yuv420p");
			assert.equal(stream.width, width);
			assert.equal(stream.height, height);
			assert.isUndefined(stream.side_data_list, "no rotation left");
			for (const tag of PRIVATE_TAGS) {
				assert.notProperty(probed.format.tags ?? {}, tag, `${key}: ${tag}`);
				assert.notProperty(stream.tags ?? {}, tag, `${key}: ${tag}`);
			}
			assert.notProperty(probed.format.tags ?? {}, "encoder");
			const bytes = await storedBytes(key);
			assert.isBelow(
				bytes.indexOf("moov"),
				bytes.indexOf("mdat"),
				"+faststart: the index comes first",
			);
			assert.notInclude(bytes.toString("latin1"), "Secret title");
			assert.notInclude(bytes.toString("latin1"), "+27.7172");
		}

		// The poster: a JPEG from the image pipeline, with a photo's copies.
		const poster = ready.imageKey ?? "";
		assert.match(poster, /^tenants\/[^/]+\/work_video\/[^/]+\.320-640\.jpg$/);
		const files = await videoFiles(studio);
		const base = poster.split("/").pop()?.split(".")[0] ?? "";
		assert.includeMembers(files, [
			`${base}.320-640.jpg`,
			`${base}.320w.jpg`,
			`${base}.640w.jpg`,
		]);
		assert.deepEqual(await stagedFiles(studio), [], "the upload is gone");

		// Removing it deletes its files first, then the row.
		const { photos } = services();
		await inTenant(studio.tenant, () =>
			photos.remove(studio.tenant, ownerOf(studio.owner), ready, {
				scope: "photo",
			}),
		);
		assert.deepEqual(await videoFiles(studio), []);
		assert.isNull(
			await inTenant(studio.tenant, () => ArtistWorkPhoto.find(video.id)),
		);
	});

	test("a rotated clip is turned upright and keeps no rotation; a clip under 720p gets one rendition at its own size", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-rotated");
		const { photos } = services();
		const rotated = await addClip(
			studio,
			await makeClip({ width: 1280, height: 720, seconds: 2, rotate: 90 }),
			photos,
		);
		const small = await addClip(
			studio,
			await makeClip({ width: 640, height: 480, seconds: 1, audio: false }),
			photos,
		);

		assert.equal(
			await photos.processVideo(studio.tenant, rotated.video.id),
			"ready",
		);
		assert.equal(
			await photos.processVideo(studio.tenant, small.video.id),
			"ready",
		);

		const upright = await reload(studio.tenant, rotated.video.id);
		assert.deepEqual([upright.width, upright.height], [720, 1280]);
		const [only] = upright.videoKeys ?? [];
		assert.lengthOf(
			upright.videoKeys ?? [],
			1,
			"720p only: no 1080p from a 720p clip",
		);
		const probed = await probeStored(only);
		assert.equal(probed.streams[0].width, 720);
		assert.equal(probed.streams[0].height, 1280);
		assert.isUndefined(probed.streams[0].side_data_list);

		const shrunk = await reload(studio.tenant, small.video.id);
		assert.deepEqual([shrunk.width, shrunk.height], [640, 480]);
		assert.lengthOf(shrunk.videoKeys ?? [], 1);
		assert.match(shrunk.videoKeys?.[0] ?? "", /\.640x480\.mp4$/);
		// Under 2 s: the poster is the first frame.
		assert.equal(shrunk.videoDurationMs, 1000);
		assert.equal(small.video.anglePosition, 2);
	});

	test("a WebM clip is taken and comes out as an MP4", async ({ assert }) => {
		const studio = await tattooOfOne("video-webm");
		const { photos } = services();
		const { video } = await addClip(
			studio,
			await makeClip({ width: 320, height: 240, seconds: 1, format: "webm" }),
			photos,
		);
		assert.equal(await photos.processVideo(studio.tenant, video.id), "ready");
		const ready = await reload(studio.tenant, video.id);
		assert.match(ready.videoKeys?.[0] ?? "", /\.320x240\.mp4$/);
		assert.deepEqual(
			(await probeStored(ready.videoKeys?.[0] ?? "")).streams.map(
				(stream) => stream.codec_name,
			),
			["h264"],
		);
	});

	test("over 60 seconds, measured, is refused with the reason; so is a file that is no video; nothing is kept but the reason", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-refused");
		const { photos } = services();
		const long = await addClip(
			studio,
			await makeClip({ width: 160, height: 120, seconds: 61, audio: false }),
			photos,
		);
		const textPath = join(tmpdir(), `not-a-video-${Date.now()}.mp4`);
		await writeFile(textPath, "this is not a video at all, only words");
		const fake = await addClip(
			studio,
			{ path: textPath, type: "video/mp4", size: 38 },
			photos,
		);

		assert.equal(
			await photos.processVideo(studio.tenant, long.video.id),
			"failed",
		);
		assert.equal(
			await photos.processVideo(studio.tenant, fake.video.id),
			"failed",
		);

		const tooLong = await reload(studio.tenant, long.video.id);
		assert.equal(tooLong.videoState, "failed");
		assert.equal(tooLong.videoFailure, VIDEO_REFUSALS.tooLong);
		assert.isNull(tooLong.imageKey);
		assert.isNull(tooLong.videoKeys);
		const notVideo = await reload(studio.tenant, fake.video.id);
		assert.equal(notVideo.videoFailure, VIDEO_REFUSALS.broken);
		assert.deepEqual(await videoFiles(studio), []);
		assert.deepEqual(await stagedFiles(studio), []);

		// A failed video can be removed.
		await inTenant(studio.tenant, () =>
			photos.remove(studio.tenant, ownerOf(studio.owner), tooLong, {
				scope: "photo",
			}),
		);
		assert.isNull(
			await inTenant(studio.tenant, () => ArtistWorkPhoto.find(long.video.id)),
		);
	});

	test("safe to repeat: a second run changes nothing, and a run whose video was removed meanwhile keeps no file", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-repeat");
		const { photos } = services();
		const clip = await makeClip({ width: 640, height: 480, seconds: 1 });
		const first = await addClip(studio, clip, photos);
		assert.equal(
			await photos.processVideo(studio.tenant, first.video.id),
			"ready",
		);
		const files = await videoFiles(studio);
		const row = (await reload(studio.tenant, first.video.id)).serialize();

		assert.equal(
			await photos.processVideo(studio.tenant, first.video.id),
			"skipped",
		);
		assert.deepEqual(await videoFiles(studio), files);
		assert.deepEqual(
			(await reload(studio.tenant, first.video.id)).serialize(),
			row,
		);

		// Removed while ffmpeg ran: the outcome finds no row, and its files go.
		class RemovedMeanwhile extends VideoService {
			async process(...args: Parameters<VideoService["process"]>) {
				const outcome = await super.process(...args);
				await inTenant(studio.tenant, () =>
					ArtistWorkPhoto.query().where("id", second.video.id).delete(),
				);
				return outcome;
			}
		}
		const raced = services(new RemovedMeanwhile(new ImageService())).photos;
		const second = await addClip(studio, clip, raced);
		assert.equal(
			await raced.processVideo(studio.tenant, second.video.id),
			"skipped",
		);
		assert.deepEqual(await videoFiles(studio), files, "only the first's files");
		assert.deepEqual(await stagedFiles(studio), []);
	});

	test("no transaction is open while ffmpeg runs: the job reads and writes in short ones around it, and process() refuses to run inside one", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-no-trx");
		const seen: unknown[] = [];
		class Watching extends VideoService {
			async process(...args: Parameters<VideoService["process"]>) {
				seen.push(currentClient());
				return super.process(...args);
			}
		}
		const { photos } = services(new Watching(new ImageService()));
		const { video, upload } = await addClip(
			studio,
			await makeClip({ width: 320, height: 240, seconds: 1 }),
			photos,
		);
		assert.equal(await photos.processVideo(studio.tenant, video.id), "ready");
		assert.deepEqual(seen, [undefined]);

		// Inside a transaction it refuses at once, before reading anything.
		const videos = new VideoService(new ImageService());
		await assert.rejects(
			() => withTransaction(() => videos.process(studio.tenant, upload.key)),
			/outside any database transaction/,
		);
	});

	test("a job that used up its retries leaves the video failed, asking for a new upload, and its upload deleted", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-gave-up");
		const { photos } = services();
		const { video } = await addClip(
			studio,
			await makeClip({ width: 320, height: 240, seconds: 1 }),
			photos,
		);
		await photos.giveUpVideo(studio.tenant, video.id);
		const failed = await reload(studio.tenant, video.id);
		assert.equal(failed.videoState, "failed");
		assert.equal(failed.videoFailure, VIDEO_GAVE_UP);
		assert.deepEqual(await stagedFiles(studio), []);
		// And the late job finds nothing to do.
		assert.equal(await photos.processVideo(studio.tenant, video.id), "skipped");
	});
});

test.group("Video angles: the rules", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a video counts toward the tattoo's eight and the artist's 100, and an upload finishes once", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-room");
		const { photos } = services();
		const clip = await makeClip({ width: 320, height: 240, seconds: 1 });
		const { upload } = await addClip(studio, clip, photos);
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					photos.addVideo(
						studio.tenant,
						ownerOf(studio.owner),
						studio.sita,
						studio.lead,
						upload,
						null,
					),
				),
			VideoUploadError,
		);
		await inTenant(studio.tenant, async () => {
			for (let place = 2; place <= 7; place++) {
				await addWorkVideo(studio.tenant, studio.sita, studio.lead, place, {
					state: "processing",
				});
			}
		});
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					photos.checkVideoRoom(
						studio.tenant,
						ownerOf(studio.owner),
						studio.sita,
						studio.lead,
					),
				),
			TattooPhotoLimitError,
		);
	});

	test("a video never leads a tattoo: not first in its order, not on its own, and the database refuses it either way", async ({
		assert,
	}) => {
		const studio = await tattooOfOne("video-never-leads");
		const { photos } = services();
		const video = await inTenant(studio.tenant, () =>
			addWorkVideo(studio.tenant, studio.sita, studio.lead, 1),
		);
		const editor = ownerOf(studio.owner);
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					photos.arrange(studio.tenant, editor, studio.lead, [
						video.id,
						studio.lead.id,
					]),
				),
			VideoLeadError,
		);
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					photos.ungroup(studio.tenant, editor, video),
				),
			VideoLeadError,
		);
		// The database: a video with no lead fails the check, and a photo
		// naming a video as its lead fails the guard.
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					withTransaction((trx) =>
						trx.rawQuery(
							"update artist_work_photos set lead_photo_id = null, angle_position = null where id = ?",
							[video.id],
						),
					),
				),
			/artist_work_photos_video_is_angle/,
		);
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					withTransaction(() =>
						addWorkPhoto(studio.tenant, studio.sita, {
							angleOf: { lead: video, position: 1 },
						}),
					),
				),
			/is an angle itself|is a video/,
		);
		// A photo row must have its image, and a video's columns stay a video's.
		await assert.rejects(
			() =>
				inTenant(studio.tenant, () =>
					withTransaction((trx) =>
						trx.rawQuery(
							"update artist_work_photos set video_state = 'ready' where id = ?",
							[studio.lead.id],
						),
					),
				),
			/artist_work_photos_photo_shape/,
		);
	});
});

test.group("Video angles: the dashboard's routes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const sign = (slug: string, id: string) =>
		`/t/${slug}/artists/photos/${id}/videos/sign`;

	test("sign, PUT to the local stand-in, finish: the video is added processing and its job queued; the PUT takes exactly what was signed, once", async ({
		client,
		assert,
	}) => {
		const studio = await tattooOfOne("video-routes");
		const clip = await makeClip({ width: 320, height: 240, seconds: 1 });

		const signed = await client
			.post(sign(studio.tenant.slug, studio.lead.id))
			.json({ type: clip.type, size: clip.size })
			.accept("json")
			.loginAs(studio.owner)
			.withCsrfToken();
		signed.assertStatus(200);
		const { upload, token } = signed.body();
		assert.equal(upload.method, "PUT");
		assert.deepEqual(upload.headers, { "Content-Type": "video/mp4" });
		assert.match(
			upload.url,
			new RegExp(
				`^/t/${studio.tenant.slug}/artists/photos/${studio.lead.id}/videos/stage\\?upload=`,
			),
		);
		assert.equal(signed.header("cache-control"), "no-store");

		const bytes = await import("node:fs/promises").then((fs) =>
			fs.readFile(clip.path),
		);
		const put = (data: Buffer, type = clip.type) => {
			const request = client.put(upload.url);
			request.type(type);
			request.request.send(data);
			return request.loginAs(studio.owner).withCsrfToken();
		};
		(await put(bytes.subarray(1))).assertStatus(403);
		(await put(bytes, "video/webm")).assertStatus(403);
		assert.deepEqual(await stagedFiles(studio), []);
		(await put(bytes)).assertStatus(204);
		assert.lengthOf(await stagedFiles(studio), 1);
		(await put(bytes)).assertStatus(409);

		const finished = await client
			.post(`/t/${studio.tenant.slug}/artists/photos/${studio.lead.id}/videos`)
			.form({ upload: token, alt: "From the side" })
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0);
		finished.assertStatus(302);
		const [video] = await inTenant(studio.tenant, () =>
			ArtistWorkPhoto.query()
				.where("tenant_id", studio.tenant.id)
				.where("kind", "video"),
		);
		assert.equal(video.videoState, "processing");
		assert.equal(video.alt, "From the side");
		assert.equal(video.leadPhotoId, studio.lead.id);
		const queued = await db
			.from("queue_jobs")
			.whereRaw("data::text like ?", [`%${video.id}%`]);
		assert.lengthOf(queued, 1);

		// The same token again is refused, and adds nothing.
		const again = await client
			.post(`/t/${studio.tenant.slug}/artists/photos/${studio.lead.id}/videos`)
			.form({ upload: token })
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0);
		again.assertStatus(302);
		assert.lengthOf(
			await inTenant(studio.tenant, () =>
				ArtistWorkPhoto.query().where("kind", "video"),
			),
			1,
		);
	});

	test("sign refuses what isn't a video we take, more than 100 MB, a full tattoo and an angle, before anything is staged", async ({
		client,
		assert,
	}) => {
		const studio = await tattooOfOne("video-sign-refusals");
		const post = (id: string, body: Record<string, unknown>) =>
			client
				.post(sign(studio.tenant.slug, id))
				.json(body)
				.accept("json")
				.loginAs(studio.owner)
				.withCsrfToken();

		const gif = await post(studio.lead.id, { type: "image/gif", size: 10 });
		gif.assertStatus(422);
		assert.equal(
			gif.body().errors[0].message,
			"Use an MP4, MOV or WebM video.",
		);
		(
			await post(studio.lead.id, {
				type: "video/mp4",
				size: 100 * 1024 * 1024 + 1,
			})
		).assertStatus(422);
		const angle = await inTenant(studio.tenant, async () => {
			const angle = await addWorkPhoto(studio.tenant, studio.sita, {
				angleOf: { lead: studio.lead, position: 1 },
			});
			for (let place = 2; place <= 7; place++) {
				await addWorkVideo(studio.tenant, studio.sita, studio.lead, place);
			}
			return angle;
		});
		const full = await post(studio.lead.id, { type: "video/mp4", size: 10 });
		full.assertStatus(422);
		assert.match(
			full.body().errors[0].message,
			/already has 8 photos and videos/,
		);
		(await post(angle.id, { type: "video/mp4", size: 10 })).assertStatus(404);
		assert.deepEqual(await stagedFiles(studio), []);
	});

	test("the order and ungroup routes refuse a video as the main photo, and say so", async ({
		client,
		assert,
	}) => {
		const studio = await tattooOfOne("video-routes-lead");
		const video = await inTenant(studio.tenant, () =>
			addWorkVideo(studio.tenant, studio.sita, studio.lead, 1),
		);
		const order = await client
			.put(`/t/${studio.tenant.slug}/artists/photos/${studio.lead.id}/order`)
			.form({ "ids[]": [video.id, studio.lead.id] })
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0);
		order.assertStatus(302);
		order.assertFlashMessage(
			"error",
			"A video can't be a tattoo's main photo, so nothing was changed.",
		);
		const ungroup = await client
			.post(`/t/${studio.tenant.slug}/artists/photos/${video.id}/ungroup`)
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0);
		ungroup.assertStatus(302);
		assert.equal(
			(await reload(studio.tenant, video.id)).leadPhotoId,
			studio.lead.id,
		);
	});

	test("the local PUT does not exist in production", async ({ assert }) => {
		const routes = await import("node:fs/promises").then((fs) =>
			fs.readFile(app.makePath("start", "routes.ts"), "utf8"),
		);
		assert.match(
			routes,
			/if \(!app\.inProduction\) \{\s*router\s*\.put\("photos\/:id\/videos\/stage"/,
		);
		const controller = await import("node:fs/promises").then((fs) =>
			fs.readFile(
				app.makePath("app", "controllers", "work_videos_controller.ts"),
				"utf8",
			),
		);
		assert.match(
			controller,
			/if \(app\.inProduction \|\| !this\.videos\.stagesLocally\(\)\)/,
		);
		const videos = new VideoService(new ImageService());
		assert.isTrue(videos.stagesLocally());
		assert.isNotNull(drive.use("private"));
	});
});
