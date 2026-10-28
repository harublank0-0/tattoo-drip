import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	TIMEZONES,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";
import { studioAddress, studioLinks } from "#services/studio_links";

/**
 * The cover's copy that Settings, Profile previews: the preview box is 448 px
 * wide, so a 2x screen wants about 900 px and the 960 copy is the narrowest
 * that is sharp there (an image narrower than that is shown as it is).
 */
const COVER_PREVIEW_WIDTH = 960;

/**
 * The studio's public profile, edited by its owners.
 */
@inject()
export default class StudioProfileController {
	constructor(
		private tenancy: TenancyService,
		private images: ImageService,
	) {}

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
			// The studio's cover (TAT-116): its 640 px copy for the preview, never
			// the key or the size.
			cover:
				tenant.coverImageKey &&
				tenant.coverImageWidth !== null &&
				tenant.coverImageHeight !== null
					? await this.coverPreview(
							tenant,
							tenant.coverImageKey,
							tenant.coverImageWidth,
							tenant.coverImageHeight,
						)
					: null,
			timezones: TIMEZONES,
			// The studio page link, always (TAT-101), and the host the web
			// address form draws around the slug.
			studioPage: studioLinks(tenant.slug),
			addressHost: studioAddress(),
		});
	}

	/**
	 * The preview's copy and its own size (the page draws it with `width` and
	 * `height`, so nothing shifts while it loads): the copy is the narrowest
	 * at least COVER_PREVIEW_WIDTH wide, else the image itself, and a copy
	 * keeps the image's proportions. Never the key.
	 */
	private async coverPreview(
		tenant: Tenant,
		key: string,
		width: number,
		height: number,
	) {
		const shownWidth = Math.min(COVER_PREVIEW_WIDTH, width);
		return {
			previewUrl: await this.images.urlFor(
				"studio_cover",
				key,
				tenant,
				COVER_PREVIEW_WIDTH,
			),
			width: shownWidth,
			height: Math.round((shownWidth * height) / width),
		};
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
