import { BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { BillingRuleError } from "#modules/billing/errors";
import BillingService from "#modules/billing/services/billing_service";

/**
 * Creates TattooDrip's plans (#modules/billing/plans) at PayBridgeNP in the
 * mode of PAYBRIDGE_SECRET_KEY, once, and stores their ids
 * (docs/payments-paybridgenp.md). Safe to rerun: existing plans are kept,
 * and one whose package or allowance bundle differs from the catalogue is
 * reported (exit code 1), never changed: that change needs a new plan code.
 * Live Billing needs a PayBridgeNP Growth plan or higher.
 *
 *   node ace billing:sync-plans           (development)
 *   node build/ace.js billing:sync-plans  (production)
 */
export default class BillingSyncPlans extends BaseCommand {
	static commandName = "billing:sync-plans";
	static description =
		"Create TattooDrip's subscription plans at PayBridgeNP (once per mode)";
	static options: CommandOptions = { startApp: true };

	async run() {
		const billing = await this.app.container.make(BillingService);
		try {
			for (const plan of await billing.syncPlans()) {
				this.logger.info(
					`${plan.code}: ${plan.providerPlanId}${plan.created ? " (created)" : ""}`,
				);
				if (plan.mismatch) {
					this.logger.error(`${plan.code}: ${plan.mismatch}`);
					this.exitCode = 1;
				}
			}
		} catch (error) {
			if (!(error instanceof BillingRuleError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
