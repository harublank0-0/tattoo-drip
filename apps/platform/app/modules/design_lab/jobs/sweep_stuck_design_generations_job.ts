import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import FailStuckDesignGenerationJob from "#modules/design_lab/jobs/fail_stuck_design_generation_job";
import { dbClient } from "#services/db_context";

type Candidate = { tenant_id: string; generation_id: string };

/**
 * AI Design Lab's safety net. A generation stays queued or processing only
 * while its runs keep it moving (each run rewrites the row); one whose jobs
 * were all lost would hold its studio's reservation for good. Every 10
 * minutes (start/scheduler.ts) this lists, across tenants, the unfinished
 * generations untouched for 30 minutes through
 * stuck_design_generation_candidates() (ids only) and queues one
 * FailStuckDesignGenerationJob per row in that row's tenant. It reads and
 * writes no tenant table itself.
 */
export default class SweepStuckDesignGenerationsJob extends Job<
	Record<string, never>
> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-stuck-design-generations";

	/** Every 10 minutes, UTC. */
	static readonly cron = "*/10 * * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, generation_id from public.stuck_design_generation_candidates()",
		);
		for (const row of rows as Candidate[]) {
			await FailStuckDesignGenerationJob.dispatch({
				tenantId: row.tenant_id,
				generationId: row.generation_id,
			}).run();
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Sweeping stuck Design Lab generations failed.",
		);
	}
}
