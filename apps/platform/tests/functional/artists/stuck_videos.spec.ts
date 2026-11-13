import { readFile } from "node:fs/promises";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import FailStuckVideoJob from "#modules/artists/jobs/fail_stuck_video_job";
import SweepStuckVideosJob from "#modules/artists/jobs/sweep_stuck_videos_job";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { STUCK_AFTER_MINUTES, VIDEO_STUCK } from "#modules/media/video";
import { dispatchInTransaction } from "#services/queue";
import { addArtist, addWorkPhoto, addWorkVideo } from "#tests/helpers/artists";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { makeClip, stagedFiles } from "#tests/helpers/videos";
import { processQueued, registerJob } from "#tests/helpers/worker";

/**
 * Video angles' safety net: a video still `processing` an hour after it was
 * added is failed by the sweep ("Took too long to process. Upload it
 * again.") and its upload deleted; a younger one, a ready one and a failed
 * one are left alone. stuck_video_candidates() sees every tenant's committed
 * rows (the dev database's too), so the tests filter its rows to their own
 * tenants and send only their own jobs through the worker.
 */

const trx = () => db.connection() as TransactionClientContract;
type Candidate = { tenant_id: string; photo_id: string };

async function studioWithVideos(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug);
	const sita = await addArtist(tenant, owner);
	const old = DateTime.utc().minus({ minutes: STUCK_AFTER_MINUTES + 5 });
	const rows = await inTenant(tenant, async () => {
		const lead = await addWorkPhoto(tenant, sita);
		return {
			stuck: await addWorkVideo(tenant, sita, lead, 1, {
				state: "processing",
				createdAt: old,
			}),
			young: await addWorkVideo(tenant, sita, lead, 2, {
				state: "processing",
				createdAt: DateTime.utc().minus({ minutes: 20 }),
			}),
			ready: await addWorkVideo(tenant, sita, lead, 3, { createdAt: old }),
			failed: await addWorkVideo(tenant, sita, lead, 4, {
				state: "failed",
				createdAt: old,
			}),
		};
	});
	// The stuck one's upload is still staged.
	const clip = await makeClip({ width: 160, height: 120, seconds: 1 });
	await drive
		.use("private")
		.put(rows.stuck.videoStagingKey as string, await readFile(clip.path));
	return { owner, tenant, ...rows };
}

async function candidatesOf(...tenants: { id: string }[]) {
	const ids = new Set(tenants.map(({ id }) => id));
	const { rows } = await sql(
		{},
		"select * from public.stuck_video_candidates()",
	);
	return (rows as Candidate[]).filter(({ tenant_id }) => ids.has(tenant_id));
}

function hydratedSweep() {
	const job = new SweepStuckVideosJob();
	job.$hydrate(
		{},
		{
			jobId: "sweep-videos-spec",
			name: "SweepStuckVideosJob",
			attempt: 1,
			queue: "default",
			priority: 0,
			acquiredAt: new Date(),
			stalledCount: 0,
		},
	);
	return job;
}

const stateOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, async () => {
		const row = await ArtistWorkPhoto.findOrFail(id);
		return [row.videoState, row.videoFailure];
	});

test.group("Video angles: the stuck-video sweep", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(FailStuckVideoJob));
	group.each.teardown(() => queue.restore());

	test("stuck_video_candidates() lists, as ids, every tenant's videos still processing after an hour, though the app role alone sees none", async ({
		assert,
	}) => {
		const a = await studioWithVideos("stuck-videos-a");
		const b = await studioWithVideos("stuck-videos-b");
		assert.sameDeepMembers(await candidatesOf(a.tenant, b.tenant), [
			{ tenant_id: a.tenant.id, photo_id: a.stuck.id },
			{ tenant_id: b.tenant.id, photo_id: b.stuck.id },
		]);
		// With no context the app role reads no row of either.
		const { rows } = await sql(
			{},
			"select id from artist_work_photos where tenant_id in (?, ?)",
			[a.tenant.id, b.tenant.id],
		);
		assert.deepEqual(rows, []);
	});

	test("the sweep queues one FailStuckVideoJob per stuck video, in its tenant; through the worker each is failed and its upload deleted, and the others are left alone", async ({
		assert,
	}) => {
		const a = await studioWithVideos("stuck-videos-c");
		const b = await studioWithVideos("stuck-videos-d");

		const fake = queue.fake();
		await hydratedSweep().execute();
		const mine = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === FailStuckVideoJob.name)
			.map(({ payload }) => payload as { tenantId: string; photoId: string })
			.filter(({ tenantId }) => [a.tenant.id, b.tenant.id].includes(tenantId));
		queue.restore();
		assert.sameDeepMembers(mine, [
			{ tenantId: a.tenant.id, photoId: a.stuck.id },
			{ tenantId: b.tenant.id, photoId: b.stuck.id },
		]);

		for (const payload of mine) {
			await dispatchInTransaction(FailStuckVideoJob.dispatch(payload), trx());
		}
		// Twice: a repeat changes nothing.
		await dispatchInTransaction(FailStuckVideoJob.dispatch(mine[0]), trx());
		await processQueued();

		for (const studio of [a, b]) {
			assert.deepEqual(await stateOf(studio.tenant, studio.stuck.id), [
				"failed",
				VIDEO_STUCK,
			]);
			assert.deepEqual(await stateOf(studio.tenant, studio.young.id), [
				"processing",
				null,
			]);
			assert.deepEqual(await stateOf(studio.tenant, studio.ready.id), [
				"ready",
				null,
			]);
			assert.equal(
				(await stateOf(studio.tenant, studio.failed.id))[1],
				"It's longer than 60 seconds.",
			);
			assert.deepEqual(await stagedFiles(studio), [], "its upload is gone");
		}
		assert.deepEqual(await candidatesOf(a.tenant, b.tenant), []);
	});
});
