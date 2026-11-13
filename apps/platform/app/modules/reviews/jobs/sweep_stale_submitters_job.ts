import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import ClearSubmittersJob from "#modules/reviews/jobs/clear_submitters_job";
import { dbClient } from "#services/db_context";

/**
 * Reviews and Fresh ink, the disputes record's 90 days (finding 12): once a
 * day lists the tenants holding a review or post submitter digest older
 * than SUBMITTER_KEEP_DAYS, through stale_submitter_tenants() (ids only),
 * and queues one ClearSubmittersJob per tenant, which clears them in that
 * tenant's context. Reads and writes no tenant table itself.
 */
export default class SweepStaleSubmittersJob extends Job<
	Record<string, never>
> {
	static readonly scheduleId = "sweep-stale-submitters";

	/** Daily at 03:17 UTC. */
	static readonly cron = "17 3 * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id from public.stale_submitter_tenants()",
		);
		for (const row of rows as { tenant_id: string }[]) {
			await ClearSubmittersJob.dispatch({ tenantId: row.tenant_id }).run();
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Sweeping stale review submitters failed.",
		);
	}
}
