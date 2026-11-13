import { readdir, readFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { VIDEO_REFUSALS } from "#modules/media/video";
import ProcessClientPostVideoJob from "#modules/reviews/jobs/process_client_post_video_job";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import { assertApiError } from "#tests/helpers/api";
import {
	publicFiles,
	reviewRequest,
	stageReviewClip,
} from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
import { makeClip, probeStored } from "#tests/helpers/videos";
import { processQueued, registerJob } from "#tests/helpers/worker";

/**
 * A client's Fresh ink videos, end to end on the work videos' pipeline
 * (VideoService, the video queue, real ffprobe and ffmpeg): sign, PUT to the
 * local stand-in, finish, process. The clips have a sine tone and a phone's
 * metadata; what is kept has neither.
 */

async function staged(studio: Studio) {
	try {
		return await readdir(
			app.tmpPath(
				"storage",
				"private",
				"work_video_upload",
				"tenants",
				studio.tenant.id,
			),
		);
	} catch {
		return [];
	}
}

function mediaRow(studio: Studio, id: string) {
	return inTenant(studio.tenant, () =>
		ClientPostMedia.query().where("id", id).firstOrFail(),
	);
}

test.group("Review page: Fresh ink videos", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ProcessClientPostVideoJob));
	group.each.timeout(120_000);

	test("sign, PUT, finish, process: H.264 renditions with no sound under client_post_video, a poster, the upload gone", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const clip = await makeClip({ width: 640, height: 480, seconds: 2 });
		const signed = await reviewRequest(
			client,
			"POST",
			a.tenant.slug,
			"/videos/sign",
			a.reviewToken,
		).json({ type: clip.type, size: clip.size });
		signed.assertStatus(200);
		assert.equal(signed.header("cache-control"), "no-store");
		const { upload, token } = signed.body().data;
		assert.equal(upload.method, "PUT");
		assert.deepEqual(upload.headers, { "Content-Type": "video/mp4" });
		assert.match(
			upload.url,
			new RegExp(
				`^/api/v1/tenants/${a.tenant.slug}/review/videos/stage\\?upload=`,
			),
		);
		assert.notInclude(
			upload.url,
			a.reviewToken,
			"the link's token is never in a URL",
		);

		const bytes = await readFile(clip.path);
		const put = (data: Buffer, type = clip.type) => {
			const request = client.put(upload.url);
			request.type(type);
			request.request.send(data);
			return request;
		};
		assertApiError(await put(bytes.subarray(1)), 422, "validation_failed");
		assertApiError(await put(bytes, "video/webm"), 422, "validation_failed");
		(await put(bytes)).assertStatus(204);
		assertApiError(await put(bytes), 422, "validation_failed");

		const finished = await reviewRequest(
			client,
			"POST",
			a.tenant.slug,
			"/videos",
			a.reviewToken,
		).json({ upload: token });
		finished.assertStatus(201);
		const added = finished.body().data.post.media[1];
		assert.equal(added.kind, "video");
		assert.equal(added.state, "processing");
		// Finishing twice is refused: an upload is added once.
		const twice = await reviewRequest(
			client,
			"POST",
			a.tenant.slug,
			"/videos",
			a.reviewToken,
		).json({ upload: token });
		assertApiError(twice, 422, "validation_failed");

		await processQueued(["video"]);
		const ready = await mediaRow(a, added.id);
		assert.equal(ready.videoState, "ready");
		assert.equal(ready.videoDurationMs, 2000);
		const keys = ready.videoKeys ?? [];
		assert.isAbove(keys.length, 0);
		for (const key of keys) {
			assert.match(
				key,
				new RegExp(`^tenants/${a.tenant.id}/client_post_video/`),
			);
			const probed = await probeStored(key);
			assert.deepEqual(
				probed.streams.map((stream) => stream.codec_type),
				["video"],
				"the sound is stripped",
			);
			assert.notProperty(probed.format.tags ?? {}, "location");
		}
		assert.match(ready.imageKey ?? "", /\/client_post_video\//);
		assert.deepEqual(await staged(a), [], "the upload is gone");

		const page = (
			await reviewRequest(client, "GET", a.tenant.slug, "", a.reviewToken)
		).body().data;
		const shown = page.post.media[1];
		assert.equal(shown.state, "ready");
		assert.isAbove(shown.sources.length, 0);
		assert.equal(shown.sources[0].type, "video/mp4");
		assert.match(shown.image.url, /client_post_video/);

		// Removing it deletes its renditions and poster first.
		(
			await reviewRequest(
				client,
				"DELETE",
				a.tenant.slug,
				`/media/${added.id}`,
				a.reviewToken,
			)
		).assertStatus(200);
		assert.deepEqual(await publicFiles(a.tenant, "client_post_video"), []);
	});

	test("a clip over 60 seconds is refused with its reason, which the page shows", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const clip = await makeClip({ width: 320, height: 240, seconds: 62 });
		const { token } = await stageReviewClip(a.tenant, a.clientPost.id, clip);
		const finished = await reviewRequest(
			client,
			"POST",
			a.tenant.slug,
			"/videos",
			a.reviewToken,
		).json({ upload: token });
		finished.assertStatus(201);
		await processQueued(["video"]);
		const page = (
			await reviewRequest(client, "GET", a.tenant.slug, "", a.reviewToken)
		).body().data;
		assert.equal(page.post.media[1].state, "failed");
		assert.equal(page.post.media[1].failure, VIDEO_REFUSALS.tooLong);
		assert.deepEqual(await publicFiles(a.tenant, "client_post_video"), []);
	});

	test("a video removed while processing: the worker finds no row and keeps nothing", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const clip = await makeClip({ width: 320, height: 240, seconds: 1 });
		const { token } = await stageReviewClip(a.tenant, a.clientPost.id, clip);
		const added = (
			await reviewRequest(
				client,
				"POST",
				a.tenant.slug,
				"/videos",
				a.reviewToken,
			).json({ upload: token })
		).body().data.post.media[1];
		(
			await reviewRequest(
				client,
				"DELETE",
				a.tenant.slug,
				`/media/${added.id}`,
				a.reviewToken,
			)
		).assertStatus(200);
		await processQueued(["video"]);
		assert.deepEqual(await publicFiles(a.tenant, "client_post_video"), []);
	});

	test("another studio's upload token is refused, and so is one for a deleted post", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const clip = await makeClip({ width: 320, height: 240, seconds: 1 });
		const theirs = await stageReviewClip(b.tenant, b.clientPost.id, clip);
		assertApiError(
			await reviewRequest(
				client,
				"POST",
				a.tenant.slug,
				"/videos",
				a.reviewToken,
			).json({
				upload: theirs.token,
			}),
			422,
			"validation_failed",
		);
		const ours = await stageReviewClip(a.tenant, a.clientPost.id, clip);
		(
			await reviewRequest(
				client,
				"DELETE",
				a.tenant.slug,
				"/post",
				a.reviewToken,
			)
		).assertStatus(200);
		assertApiError(
			await reviewRequest(
				client,
				"POST",
				a.tenant.slug,
				"/videos",
				a.reviewToken,
			).json({
				upload: ours.token,
			}),
			422,
			"validation_failed",
		);
		const rows = await inTenant(b.tenant, () => ClientPostMedia.query());
		assert.lengthOf(rows, 1, "B's post is as it was");
	});
});
