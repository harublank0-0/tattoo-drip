import { Job } from "@adonisjs/queue";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import { dbClient } from "#services/db_context";

type Candidate = { tenant_id: string; project_id: string; quote_id: string };

/**
 * The expiry safety net (TAT-83). ExpireQuoteJob runs once per quote, at its
 * expiry; one that used up its retries or was never queued would leave its
 * project with an expired quote. Every 5 minutes (start/scheduler.ts) this
 * lists the current quotes that expired between 24 hours and 2 minutes ago
 * on `quoted`, `on_hold` or `deposit_pending` projects, across tenants,
 * through expired_quote_candidates() (ids only: the app role can't read
 * other tenants' rows), and queues an ExpireQuoteJob for each, in that row's
 * tenant. It reads and writes no tenant table: ProjectService.expireQuote
 * re-checks every rule under the project lock, so a quote listed again, or
 * one whose deposit was paid, changes nothing.
 */
export default class SweepExpiredQuotesJob extends Job<Record<string, never>> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-expired-quotes";

	/** Every 5 minutes, UTC. */
	static readonly cron = "*/5 * * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, project_id, quote_id from public.expired_quote_candidates()",
		);
		for (const row of rows as Candidate[]) {
			await ExpireQuoteJob.dispatch({
				tenantId: row.tenant_id,
				projectId: row.project_id,
				quoteId: row.quote_id,
			}).run();
		}
	}
}
