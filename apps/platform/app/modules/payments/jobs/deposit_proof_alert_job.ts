import logger from "@adonisjs/core/services/logger";
import Payment from "#modules/payments/models/payment";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; paymentId: string };

/**
 * Alerts a studio's owners that a client sent a deposit proof from the
 * deposit page. DepositPageService.submitProof (TAT-65) queues it in the
 * payment's transaction, so it exists exactly when the payment does. For
 * now it logs the ids (never the link, the token, a URL or the amount):
 * TAT-52 sends the owners' email and in-app alert from here; the dashboard's
 * Projects badge already counts the proofs that wait. Safe to repeat; a
 * payment that is gone or already decided needs no alert.
 */
export default class DepositProofAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, paymentId } = this.payload;
		const payment = await Payment.query()
			.where("tenant_id", tenantId)
			.where("id", paymentId)
			.first();
		if (!payment || payment.status !== "submitted") return;
		logger.info(
			{ tenantId, projectId: payment.projectId, paymentId },
			"Deposit proof received.",
		);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, paymentId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, paymentId },
			"Alerting owners to a deposit proof failed.",
		);
	}
}
