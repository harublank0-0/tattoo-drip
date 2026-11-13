import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; checkoutId: string };

/**
 * Reads one online checkout back from PayBridgeNP, once, and records what
 * it says (GatewayCheckoutService.syncCheckout): the safety net for a
 * webhook that never arrived. Queued by ReconcilePaymentsJob. Safe to
 * repeat: recording is idempotent by the provider's payment id.
 */
export default class SyncGatewayCheckoutJob extends TenantJob<Payload> {
	protected async handle(): Promise<void> {
		const checkouts = await app.container.make(GatewayCheckoutService);
		await checkouts.syncCheckout(
			{ id: this.payload.tenantId },
			this.payload.checkoutId,
		);
	}

	async failed(error: Error): Promise<void> {
		logger.error(
			{
				err: error,
				tenantId: this.payload.tenantId,
				checkoutId: this.payload.checkoutId,
			},
			"Checking an online checkout with PayBridgeNP failed.",
		);
	}
}
