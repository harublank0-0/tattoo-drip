import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; photoId: string };

/**
 * Video angles: fails one video still `processing` an hour after it was
 * added (queued by SweepStuckVideosJob), with "Took too long to process.
 * Upload it again.", and deletes its upload once that has committed
 * (WorkPhotoService.failStuckVideo checks it again under the row's lock, so
 * a video that finished meanwhile, a removed one and a repeat change
 * nothing). Short: one transaction, no ffmpeg.
 */
export default class FailStuckVideoJob extends TenantJob<Payload> {
	protected async handle() {
		// Imported here: WorkPhotoService imports the video jobs.
		const { default: WorkPhotoService } = await import(
			"#modules/artists/services/work_photo_service"
		);
		const photos = await app.container.make(WorkPhotoService);
		const { tenantId, photoId } = this.payload;
		if (await photos.failStuckVideo({ id: tenantId }, photoId)) {
			logger.warn({ tenantId, photoId }, "A video took too long to process.");
		}
	}

	async failed(error: Error): Promise<void> {
		const { tenantId, photoId } = this.payload;
		logger.error(
			{ err: error, jobId: this.context.jobId, tenantId, photoId },
			"Failing a stuck video failed.",
		);
	}
}
