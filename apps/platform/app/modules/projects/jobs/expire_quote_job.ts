import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; projectId: string; quoteId: string };

/**
 * Runs once a quote's expiry passes: ProjectService.issueQuote queues it in
 * the issuing transaction, delayed until `expires_at`. ProjectService
 * .expireQuote re-checks everything under the project lock, so the old jobs
 * of revised quotes, a repeat run and a deleted project all do nothing. A
 * run that comes early (this worker's clock behind the issuer's) queues the
 * job again for the rest of the time; one that used up its retries or never
 * ran is queued again by SweepExpiredQuotesJob.
 */
export default class ExpireQuoteJob extends TenantJob<Payload> {
	protected async handle() {
		// Imported here, not at the top: ProjectService imports this job to
		// queue it, and a static import both ways would be a cycle.
		const { default: ProjectService } = await import(
			"#modules/projects/services/project_service"
		);
		const projects = await app.container.make(ProjectService);
		const { tenantId, projectId, quoteId } = this.payload;
		await projects.expireQuote({ id: tenantId }, projectId, quoteId);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, projectId, quoteId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, projectId, quoteId },
			"Expiring a quote failed.",
		);
	}
}
