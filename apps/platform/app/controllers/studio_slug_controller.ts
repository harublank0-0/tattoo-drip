import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { SlugLimitError, SlugTakenError } from "#modules/tenancy/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { MAX_TENANT_SLUGS } from "#modules/tenancy/slugs";
import { changeSlugValidator } from "#modules/tenancy/validators/tenant";

function slugError(message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field: "slug", message, rule }]);
}

/**
 * The studio's web address (TAT-24), changed by its owners on the profile
 * page. Old addresses keep redirecting (the tenant middleware).
 */
@inject()
export default class StudioSlugController {
	constructor(private tenancy: TenancyService) {}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { slug } = await ctx.request.validateUsing(changeSlugValidator);
		const previous = tenant.slug;

		let changed: typeof tenant;
		try {
			changed = await this.tenancy.changeSlug(tenant, slug);
		} catch (error) {
			if (error instanceof SlugTakenError) {
				throw slugError(
					"This address is already taken. Try another one.",
					"unique",
				);
			}
			if (error instanceof SlugLimitError) {
				throw slugError(
					`Your studio has used ${MAX_TENANT_SLUGS} addresses, the most allowed. You can still switch back to an earlier one.`,
					"slug_limit",
				);
			}
			throw error;
		}

		if (changed.slug !== previous) {
			ctx.session.flash(
				"success",
				"Address changed. Links to the old address still work.",
			);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.profile", { tenant: changed.slug });
	}
}
