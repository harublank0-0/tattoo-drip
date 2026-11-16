import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import PackageNoticeJob from "#modules/packages/jobs/package_notice_job";
import { dbClient } from "#services/db_context";

/**
 * Package notices (studio packages, phase 3): once a day
 * (start/scheduler.ts) queues one PackageNoticeJob per live studio, through
 * package_tenants() (ids only: the app role can't read other studios'
 * rows). The window of `dueNotice` is this interval, so each notice falls
 * in exactly one run.
 */
export default class SweepPackageNoticesJob extends Job<Record<string, never>> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-package-notices";

	/** Daily at 03:17 UTC (09:02 in Kathmandu), away from the hour's rush. */
	static readonly cron = "17 3 * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id from public.package_tenants()",
		);
		for (const row of rows as { tenant_id: string }[]) {
			await PackageNoticeJob.dispatch({ tenantId: row.tenant_id }).run();
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Sweeping package notices failed.",
		);
	}
}
