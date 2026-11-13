import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; mediaId: string };

/**
 * Reviews and Fresh ink: fails one client video still `processing` an hour
 * after it was added (queued by SweepStuckVideosJob), with "Took too long to
 * process. Upload it again.", and deletes its upload once that has committed
 * (ClientPostService.failStuckVideo checks it again under the row's lock).
 */
export default class FailStuckClientVideoJob extends TenantJob<Payload> {
	protected async handle() {
		// Imported here: ClientPostService imports the video jobs.
		const { default: ClientPostService } = await import(
			"#modules/reviews/services/client_post_service"
		);
		const posts = await app.container.make(ClientPostService);
		const { tenantId, mediaId } = this.payload;
		if (await posts.failStuckVideo({ id: tenantId }, mediaId)) {
			logger.warn(
				{ tenantId, mediaId },
				"A client video took too long to process.",
			);
		}
	}

	async failed(error: Error): Promise<void> {
		const { tenantId, mediaId } = this.payload;
		logger.error(
			{ err: error, jobId: this.context.jobId, tenantId, mediaId },
			"Failing a stuck client video failed.",
		);
	}
}
