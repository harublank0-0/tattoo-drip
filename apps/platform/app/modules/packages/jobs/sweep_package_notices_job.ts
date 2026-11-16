import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import { DateTime } from "luxon";
import PackageNoticeJob from "#modules/packages/jobs/package_notice_job";
import { sweepMoment } from "#modules/packages/notices";
import { dbClient } from "#services/db_context";

/**
 * Package notices (studio packages, phase 3): once a day
 * (start/scheduler.ts) queues one PackageNoticeJob per live studio, through
 * package_tenants() (ids only: the app role can't read other studios'
 * rows). Every job judges at this sweep's nominal moment (`sweepMoment`,
 * 03:17 UTC that day), so consecutive days' windows tile however late the
 * worker runs them.
 */
export default class SweepPackageNoticesJob extends Job<Record<string, never>> {
	/** The schedule's id in queue_schedules. */
	static readonly scheduleId = "sweep-package-notices";

	/** Daily at 03:17 UTC (09:02 in Kathmandu), away from the hour's rush; `sweepMoment` follows it. */
	static readonly cron = "17 3 * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id from public.package_tenants()",
		);
		const at = sweepMoment(DateTime.utc()).toISO() as string;
		for (const row of rows as { tenant_id: string }[]) {
			await PackageNoticeJob.dispatch({ tenantId: row.tenant_id, at }).run();
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Sweeping package notices failed.",
		);
	}
}
