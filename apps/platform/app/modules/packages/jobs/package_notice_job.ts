import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
import TenantJob from "#services/tenant_job";

/** `at`: the sweep's nominal moment (ISO), which the notice is judged at. */
type Payload = { tenantId: string; at?: string };

/**
 * One studio's package notice (studio packages, phase 3; spec, Notices),
 * queued daily by SweepPackageNoticesJob: resolves the studio's
 * entitlement at the sweep's moment and logs the notice due in the day
 * before it ("Package notice would be sent"). Nothing is sent yet: the in-app alert and the email come
 * with enforcement (phase 4).
 */
export default class PackageNoticeJob extends TenantJob<Payload> {
	protected async handle() {
		// Imported here, not at the top: the sweep imports this job, and the
		// entitlement service pulls in billing and tenancy.
		const { default: EntitlementService } = await import(
			"#modules/packages/services/entitlement_service"
		);
		const { dueNotice, sweepMoment } = await import(
			"#modules/packages/notices"
		);
		const entitlements = await app.container.make(EntitlementService);
		const tenant = { id: this.payload.tenantId };
		// The sweep's moment, not this run's clock: a job that runs late still
		// judges the day it was queued for.
		const at = this.payload.at
			? DateTime.fromISO(this.payload.at, { zone: "utc" })
			: sweepMoment(DateTime.utc());
		const entitlement = await entitlements.for(tenant, at);
		const notice = dueNotice(entitlement, at);
		if (!notice) return;
		logger.info(
			{
				tenantId: tenant.id,
				notice,
				state: entitlement.state,
				package: entitlement.package,
				until: entitlement.until?.toUTC().toISO() ?? null,
			},
			"Package notice would be sent",
		);
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{
				err: error,
				jobId: this.context.jobId,
				tenantId: this.payload.tenantId,
			},
			"Working out a package notice failed.",
		);
	}
}
