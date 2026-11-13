import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import type { JobOptions } from "@adonisjs/queue/types";

type Payload = { tenantId: string; photoId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Video angles: turns one uploaded video into its renditions and poster
 * (WorkPhotoService.processVideo). Queued by WorkPhotoService.addVideo in
 * the transaction that creates the row, so it exists exactly when the row
 * does.
 *
 * A plain Job, not a TenantJob, on purpose: a TenantJob runs `handle()` in
 * ONE transaction, and a transcode takes minutes while production ends a
 * transaction idle for 3 (`idle_in_transaction_session_timeout`). This job
 * opens none itself; processVideo reads and writes the row in short
 * transactions scoped to `tenantId` (`withDbContext`), with no transaction
 * open while ffmpeg runs, and VideoService.process refuses to run inside one.
 * It is safe to repeat (delivery is at least once): only a row still
 * `processing` that same upload is worked on and written.
 *
 * Bounded three ways: each ffmpeg and ffprobe run has its own wall-clock
 * timeout and is killed on it (video_tools.ts), only one transcode runs at a
 * time per worker process, and the whole job has `timeout` (its signal
 * stops a running ffmpeg); a timed-out run follows the normal retries. Once
 * the retries are used up, `failed()` marks the video failed (if it is still
 * processing) so the studio can remove it and upload it again.
 */
export default class ProcessWorkVideoJob extends Job<Payload> {
	/** Its own queue (config/queue.ts): only the video worker runs it, one at a time. */
	static readonly queueName = "video";

	static options: JobOptions = { queue: "video", timeout: "30m" };

	async execute(): Promise<void> {
		const { tenantId, photoId } = checked(this.payload);
		const photos = await this.photos();
		await photos.processVideo({ id: tenantId }, photoId, this.signal);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const tenantId = this.payload?.tenantId;
		const photoId = this.payload?.photoId;
		logger.error(
			{ err: error, jobId, tenantId, photoId },
			"Processing a video failed.",
		);
		if (typeof tenantId !== "string" || !UUID.test(tenantId)) return;
		if (typeof photoId !== "string" || !UUID.test(photoId)) return;
		try {
			const photos = await this.photos();
			await photos.giveUpVideo({ id: tenantId }, photoId);
		} catch (err) {
			logger.error(
				{ err, jobId, tenantId, photoId },
				"Marking a video as failed failed.",
			);
		}
	}

	/** Imported here, not at the top: WorkPhotoService imports this job to queue it. */
	private async photos() {
		const { default: WorkPhotoService } = await import(
			"#modules/artists/services/work_photo_service"
		);
		return app.container.make(WorkPhotoService);
	}
}

function checked(payload: Payload | undefined): Payload {
	const tenantId: unknown = payload?.tenantId;
	const photoId: unknown = payload?.photoId;
	if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
		throw new Error("ProcessWorkVideoJob needs a valid tenantId");
	}
	if (typeof photoId !== "string" || !UUID.test(photoId)) {
		throw new Error("ProcessWorkVideoJob needs a valid photoId");
	}
	return { tenantId, photoId };
}
