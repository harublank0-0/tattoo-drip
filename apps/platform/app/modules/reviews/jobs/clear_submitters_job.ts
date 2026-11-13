import logger from "@adonisjs/core/services/logger";
import ClientPost from "#modules/reviews/models/client_post";
import ClientReview from "#modules/reviews/models/client_review";
import { SUBMITTER_KEEP_DAYS } from "#modules/reviews/submitters";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string };

/**
 * Clears one tenant's review and post submitter digests older than
 * SUBMITTER_KEEP_DAYS (queued by SweepStaleSubmittersJob), deleted rows
 * included. Safe to repeat.
 */
export default class ClearSubmittersJob extends TenantJob<Payload> {
	protected async handle() {
		await clearStaleSubmitters(this.payload.tenantId);
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{
				err: error,
				jobId: this.context.jobId,
				tenantId: this.payload.tenantId,
			},
			"Clearing stale review submitters failed.",
		);
	}
}

/** The tenant's digests older than SUBMITTER_KEEP_DAYS, cleared; in the caller's tenant context. */
export async function clearStaleSubmitters(tenantId: string): Promise<void> {
	const before = new Date(Date.now() - SUBMITTER_KEEP_DAYS * 86_400_000);
	const cleared = { submitter_digest: null, submitter_recorded_at: null };
	await ClientReview.withTrashed()
		.where("tenant_id", tenantId)
		.where("submitter_recorded_at", "<=", before)
		.update(cleared);
	await ClientPost.withTrashed()
		.where("tenant_id", tenantId)
		.where("submitter_recorded_at", "<=", before)
		.update(cleared);
}
