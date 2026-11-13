import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import type { JobOptions } from "@adonisjs/queue/types";

type Payload = { tenantId: string; mediaId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reviews and Fresh ink: turns one client video into its renditions and
 * poster (ClientPostService.processVideo), on the work videos' pipeline
 * unchanged: the same `video` queue and worker, VideoService and its tools,
 * one transcode at a time. Queued by ClientPostService.addVideo in the
 * transaction that adds the item. A plain Job, not a TenantJob, for the
 * reason ProcessWorkVideoJob gives: a transcode takes minutes and no
 * transaction may stay open that long; processVideo opens short
 * tenant-scoped ones around it. Safe to repeat. Once its retries are used
 * up, `failed()` marks the video failed if it is still processing.
 */
export default class ProcessClientPostVideoJob extends Job<Payload> {
	static readonly queueName = "video";

	static options: JobOptions = { queue: "video", timeout: "30m" };

	async execute(): Promise<void> {
		const { tenantId, mediaId } = checked(this.payload);
		const posts = await this.posts();
		await posts.processVideo({ id: tenantId }, mediaId, this.signal);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const tenantId = this.payload?.tenantId;
		const mediaId = this.payload?.mediaId;
		logger.error(
			{ err: error, jobId, tenantId, mediaId },
			"Processing a client video failed.",
		);
		if (typeof tenantId !== "string" || !UUID.test(tenantId)) return;
		if (typeof mediaId !== "string" || !UUID.test(mediaId)) return;
		try {
			const posts = await this.posts();
			await posts.giveUpVideo({ id: tenantId }, mediaId);
		} catch (err) {
			logger.error(
				{ err, jobId, tenantId, mediaId },
				"Marking a client video as failed failed.",
			);
		}
	}

	/** Imported here, not at the top: ClientPostService imports this job to queue it. */
	private async posts() {
		const { default: ClientPostService } = await import(
			"#modules/reviews/services/client_post_service"
		);
		return app.container.make(ClientPostService);
	}
}

function checked(payload: Payload | undefined): Payload {
	const tenantId: unknown = payload?.tenantId;
	const mediaId: unknown = payload?.mediaId;
	if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
		throw new Error("ProcessClientPostVideoJob needs a valid tenantId");
	}
	if (typeof mediaId !== "string" || !UUID.test(mediaId)) {
		throw new Error("ProcessClientPostVideoJob needs a valid mediaId");
	}
	return { tenantId, mediaId };
}
