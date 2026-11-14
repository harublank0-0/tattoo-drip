import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import ClientService from "#modules/clients/services/client_service";
import AlertService from "#modules/notifications/services/alert_service";
import GatewayPayment from "#modules/payments/models/gateway_payment";
import ProjectService from "#modules/projects/services/project_service";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; gatewayPaymentId: string };

/**
 * Alerts a studio's staff to a client's online payment through PayBridgeNP.
 * GatewayCheckoutService.confirmPayment queues it in the transaction that
 * records the payment as a deposit or holds it for review, so it exists
 * exactly when that decision does. It logs the ids only, then
 * AlertService.onlinePayment alerts the members in the dashboard and by
 * email, once each however often the job runs. A payment neither recorded
 * nor held needs no alert. A held payment whose project was deleted still
 * alerts the owners: the money arrived.
 */
export default class OnlinePaymentAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, gatewayPaymentId } = this.payload;
		const payment = await GatewayPayment.query()
			.where("tenant_id", tenantId)
			.where("id", gatewayPaymentId)
			.first();
		if (!payment || (!payment.paymentId && !payment.reviewReason)) return;
		const held = payment.paymentId === null;
		logger.info(
			{ tenantId, projectId: payment.projectId, gatewayPaymentId, held },
			"Online payment alert.",
		);

		const tenant = { id: tenantId };
		const projects = await app.container.make(ProjectService);
		const project = await projects.findLive(tenant, payment.projectId);
		const clients = await app.container.make(ClientService);
		const client = project
			? await clients.find(tenant, project.clientId)
			: null;
		const alerts = await app.container.make(AlertService);
		await alerts.onlinePayment(tenant, {
			gatewayPaymentId: payment.id,
			held,
			projectId: payment.projectId,
			artistId: project?.artistId ?? null,
			clientName: client?.name ?? "",
		});
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, gatewayPaymentId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, gatewayPaymentId },
			"Alerting staff to an online payment failed.",
		);
	}
}
