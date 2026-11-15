import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; generationId: string };

/**
 * AI Design Lab: fails one generation no run has touched for 30 minutes
 * (GenerationRunner.failStuck checks again under the row's lock) and
 * releases its reservation. Queued by SweepStuckDesignGenerationsJob, in the
 * generation's tenant.
 */
export default class FailStuckDesignGenerationJob extends TenantJob<Payload> {
	protected async handle() {
		const { default: GenerationRunner } = await import(
			"#modules/design_lab/services/generation_runner"
		);
		const runner = await app.container.make(GenerationRunner);
		const { tenantId, generationId } = this.payload;
		await runner.failStuck({ id: tenantId }, generationId);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, generationId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, generationId },
			"Failing a stuck Design Lab generation failed.",
		);
	}
}
