import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { BillingRuleError } from "#modules/billing/errors";
import BillingService from "#modules/billing/services/billing_service";
import TenantJob from "#services/tenant_job";

/**
 * Reads one studio's TattooDrip subscription and invoices back from
 * PayBridgeNP (BillingService.syncTenant): the daily safety net for a
 * missed webhook, queued by ReconcilePaymentsJob. Billing switched off is
 * not a failure.
 */
export default class SyncBillingJob extends TenantJob<{ tenantId: string }> {
	protected async handle(): Promise<void> {
		const billing = await app.container.make(BillingService);
		if (!billing.configured()) return;
		try {
			await billing.syncTenant({ id: this.payload.tenantId });
		} catch (error) {
			// A refusal the owner would read is a provider problem here: retry.
			if (error instanceof BillingRuleError) throw new Error(error.reason);
			throw error;
		}
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{ err: error, tenantId: this.payload.tenantId },
			"Syncing a studio's billing with PayBridgeNP failed.",
		);
	}
}
