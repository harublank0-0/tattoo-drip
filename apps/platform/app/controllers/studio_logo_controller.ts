import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
import {
	LOGO_SAVED,
	LOGO_SAVED_ON_DARK_TILE,
	LOGO_TILE_SAVED,
} from "#modules/tenancy/look_messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	logoTileValidator,
	logoValidator,
} from "#modules/tenancy/validators/tenant";

/**
 * The studio's logo (TAT-56), set, replaced and removed by owners on
 * Settings, Page look (TENANT_ROUTE_ROLES: owners only). The cover's twin.
 * TAT-123: an upload also picks the tile the logo sits on (and says so when it
 * picked the dark one), and `tile` lets the owner switch it.
 */
@inject()
export default class StudioLogoController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(logoValidator);

		let saved: Awaited<ReturnType<TenancyService["setLogo"]>>;
		try {
			saved = await this.tenancy.setLogo(tenant, data.logo);
		} catch (error) {
			if (error instanceof InvalidImageError) {
				throw new errors.E_VALIDATION_ERROR([
					{ field: "logo", message: error.message, rule: "image" },
				]);
			}
			throw error;
		}

		ctx.session.flash(
			"success",
			saved.logoTile === "dark" ? LOGO_SAVED_ON_DARK_TILE : LOGO_SAVED,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.look", { tenant: tenant.slug });
	}

	async tile(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(logoTileValidator);

		await this.tenancy.setLogoTile(tenant, data.tile);

		ctx.session.flash("success", LOGO_TILE_SAVED);
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
