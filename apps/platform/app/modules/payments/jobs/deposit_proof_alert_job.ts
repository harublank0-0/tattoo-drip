import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import ClientService from "#modules/clients/services/client_service";
import AlertService from "#modules/notifications/services/alert_service";
import Payment from "#modules/payments/models/payment";
import ProjectService from "#modules/projects/services/project_service";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; paymentId: string };

/**
 * Alerts a studio's staff that a client sent a deposit proof from the
 * deposit page. DepositPageService.submitProof (TAT-65) queues it in the
 * payment's transaction, so it exists exactly when the payment does. It logs
 * the ids (never the link, the token, a URL or the amount), then
 * AlertService.depositProof alerts the owners and the project's artist's
 * member in the dashboard and by email (TAT-88), once each however often
 * the job runs. A payment that is gone or already decided, or a deleted
 * project, needs no alert.
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

		const tenant = { id: tenantId };
		const projects = await app.container.make(ProjectService);
		const project = await projects.findLive(tenant, payment.projectId);
		if (!project) return;
		const clients = await app.container.make(ClientService);
		const client = await clients.find(tenant, project.clientId);
		const alerts = await app.container.make(AlertService);
		await alerts.depositProof(tenant, {
			paymentId: payment.id,
			projectId: project.id,
			artistId: project.artistId,
			clientName: client?.name ?? "",
		});
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, paymentId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, paymentId },
			"Alerting staff to a deposit proof failed.",
		);
	}
}
