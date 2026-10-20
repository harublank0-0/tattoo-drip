import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	TIMEZONES,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";
import { studioAddress, studioLinks } from "#services/studio_links";

/**
 * The studio's public profile, edited by its owners.
 */
@inject()
export default class StudioProfileController {
	constructor(private tenancy: TenancyService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);

		return ctx.inertia.render("settings/profile", {
			profile: {
				name: tenant.name,
				timezone: tenant.timezone,
				intro: tenant.intro,
				contactPhone: tenant.contactPhone,
				contactEmail: tenant.contactEmail,
				address: tenant.address,
				instagramUrl: tenant.instagramUrl,
				facebookUrl: tenant.facebookUrl,
				tiktokUrl: tenant.tiktokUrl,
				websiteUrl: tenant.websiteUrl,
			},
			timezones: TIMEZONES,
			// The studio page link, always (TAT-101), and the host the web
			// address form draws around the slug.
			studioPage: studioLinks(tenant.slug),
			addressHost: studioAddress(),
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(updateProfileValidator);

		await this.tenancy.updateProfile(tenant, input);

		ctx.session.flash("success", "Profile saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.profile", { tenant: tenant.slug });
	}
}
