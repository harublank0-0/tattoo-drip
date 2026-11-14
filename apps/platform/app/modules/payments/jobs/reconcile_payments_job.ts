import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import SyncBillingJob from "#modules/billing/jobs/sync_billing_job";
import SyncGatewayCheckoutJob from "#modules/payments/jobs/sync_gateway_checkout_job";
import { dbClient } from "#services/db_context";

type Row = { tenant_id: string; checkout_id: string };

/**
 * The payments safety net (docs/payments-paybridgenp.md), every 15 minutes
 * (start/scheduler.ts): one check per online checkout still open 10 minutes
 * to 2 days after it began and not checked in the last 10 minutes
 * (gateway_checkouts_to_reconcile(), ids only), and once a day, at 03:00
 * UTC, one sync per studio with a TattooDrip subscription (billing_tenants()).
 * It reads no tenant table itself: each check is a TenantJob in its studio's
 * context. No tight polling: at most one read per checkout per 10 minutes.
 */
export default class ReconcilePaymentsJob extends Job<Record<string, never>> {
	static readonly scheduleId = "reconcile-payments";
	static readonly cron = "*/15 * * * *";

	async execute(): Promise<void> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, checkout_id from public.gateway_checkouts_to_reconcile()",
		);
		for (const row of rows as Row[]) {
			await SyncGatewayCheckoutJob.dispatch({
				tenantId: row.tenant_id,
				checkoutId: row.checkout_id,
			}).run();
		}
		const now = new Date();
		if (now.getUTCHours() === 3 && now.getUTCMinutes() < 15) {
			const studios = await dbClient().rawQuery(
				"select tenant_id from public.billing_tenants()",
			);
			for (const row of studios.rows as { tenant_id: string }[]) {
				await SyncBillingJob.dispatch({ tenantId: row.tenant_id }).run();
			}
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, jobId: this.context.jobId },
			"Reconciling payments failed.",
		);
	}
}
