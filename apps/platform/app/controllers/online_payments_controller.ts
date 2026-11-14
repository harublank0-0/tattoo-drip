import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { GatewayRuleError } from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
import { connectGatewayValidator } from "#modules/payments/validators/gateway";
import { formatDay } from "#modules/projects/quotes";

/**
 * Settings, Online payments (owners only): the studio's connection to its
 * own PayBridgeNP project. The key is never sent back to the browser; the
 * page shows its last four characters only.
 */
@inject()
export default class OnlinePaymentsController {
	constructor(private accounts: GatewayAccountService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const account = await this.accounts.current(tenant);
		const availability = await this.accounts.availability(tenant);
		return ctx.inertia.render("settings/online_payments", {
			mode: this.accounts.mode(),
			available: availability.available,
			account: account
				? {
						status: account.status,
						livemode: account.livemode,
						keyHint: account.keyHint,
						merchantName: account.providerMerchantName,
						projectName: account.providerProjectName,
						connectedText: formatDay(
							account.createdAt.setZone(tenant.timezone).toISODate() as string,
						),
						verifiedText: account.verifiedAt
							? formatDay(
									account.verifiedAt
										.setZone(tenant.timezone)
										.toISODate() as string,
								)
							: null,
					}
				: null,
		});
	}

	async connect(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { secretKey } = await ctx.request.validateUsing(
			connectGatewayValidator,
		);
		const user = ctx.auth.getUserOrFail();
		try {
			await this.accounts.connect(tenant, user.id, secretKey);
			ctx.session.flash(
				"success",
				"Connected. TattooDrip checks the connection before clients can pay online; we'll let you know.",
			);
		} catch (error) {
			if (!(error instanceof GatewayRuleError)) throw error;
			// The usual field error under the key's box (inputErrorsBag).
			throw new errors.E_VALIDATION_ERROR([
				{ field: "secretKey", message: error.message, rule: "gateway" },
			]);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.online_payments", { tenant: tenant.slug });
	}

	async disconnect(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		await this.accounts.disconnect(tenant);
		ctx.session.flash(
			"success",
			"Disconnected. Clients can't pay online any more; payments already started are still recorded.",
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.online_payments", { tenant: tenant.slug });
	}
}
