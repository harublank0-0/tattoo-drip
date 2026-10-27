import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { coverValidator } from "#modules/tenancy/validators/tenant";

/**
 * The studio's cover photo (TAT-116), set, replaced and removed by owners
 * on Settings, Profile (TENANT_ROUTE_ROLES: owners only).
 */
@inject()
export default class StudioCoverController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(coverValidator);

		try {
			await this.tenancy.setCover(tenant, data.cover);
		} catch (error) {
			if (error instanceof InvalidImageError) {
				throw new errors.E_VALIDATION_ERROR([
					{ field: "cover", message: error.message, rule: "image" },
				]);
			}
			throw error;
		}

		ctx.session.flash("success", "Cover photo saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.profile", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);

		await this.tenancy.removeCover(tenant);

		ctx.session.flash("success", "Cover photo removed.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.profile", { tenant: tenant.slug });
	}
}
