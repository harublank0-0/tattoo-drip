import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { logoValidator } from "#modules/tenancy/validators/tenant";

/**
 * The studio's logo (TAT-56), set, replaced and removed by owners on
 * Settings, Page look (TENANT_ROUTE_ROLES: owners only). The cover's twin.
 */
@inject()
export default class StudioLogoController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(logoValidator);

		try {
			await this.tenancy.setLogo(tenant, data.logo);
		} catch (error) {
			if (error instanceof InvalidImageError) {
				throw new errors.E_VALIDATION_ERROR([
					{ field: "logo", message: error.message, rule: "image" },
				]);
			}
			throw error;
		}

		ctx.session.flash("success", "Logo saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.look", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);

		try {
			await this.tenancy.removeLogo(tenant);
		} catch (error) {
			// A file could not be deleted: the logo stays (and is still public).
			if (!(error instanceof ImageDeleteError)) throw error;
			ctx.session.flash("error", "Couldn't remove the logo, try again.");
			return ctx.response
				.redirect()
				.toRoute("tenant.settings.look", { tenant: tenant.slug });
		}

		ctx.session.flash("success", "Logo removed.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.look", { tenant: tenant.slug });
	}
}
