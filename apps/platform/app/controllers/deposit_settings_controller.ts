import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { updateDepositSettingsValidator } from "#modules/tenancy/validators/tenant";

/**
 * The deposit defaults on the Payments settings page, owners only.
 */
@inject()
export default class DepositSettingsController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(
			updateDepositSettingsValidator,
		);

		await this.tenancy.updateDepositSettings(tenant, input);

		ctx.session.flash("success", "Deposit settings saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}
}
