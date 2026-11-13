import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import FailStuckVideoJob from "#modules/artists/jobs/fail_stuck_video_job";
import { dbClient } from "#services/db_context";

type Candidate = { tenant_id: string; photo_id: string };

/**
 * Video angles' safety net. A video stays `processing` only while its
 * ProcessWorkVideoJob runs; one whose worker died with it, or whose job was
 * lost, would stay there for good. Every 10 minutes (start/scheduler.ts)
 * this lists the videos still processing an hour after they were added,
 * across tenants, through stuck_video_candidates() (ids only: the app role
 * can't read other tenants' rows) and queues a FailStuckVideoJob for each,
 * in that row's tenant. It reads and writes no tenant table itself:
 * WorkPhotoService.failStuckVideo checks again under the row's lock.
 */
export default class SweepStuckVideosJob extends Job<Record<string, never>> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-stuck-videos";

	/** Every 10 minutes, UTC. */
	static readonly cron = "*/10 * * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, photo_id from public.stuck_video_candidates()",
		);
		for (const row of rows as Candidate[]) {
			await FailStuckVideoJob.dispatch({
				tenantId: row.tenant_id,
				photoId: row.photo_id,
			}).run();
		}
	}

	/** The sweep is the safety net itself: one that keeps failing must not be silent. */
	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Sweeping stuck videos failed.",
		);
	}
}
