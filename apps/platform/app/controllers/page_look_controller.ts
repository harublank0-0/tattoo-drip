import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import {
	CLAIMED_FLASH_CHOICES,
	claimedFlashOf,
	FONTS,
	logoTileOf,
	lookOf,
	SECTION_KEYS,
	THEME_ACCENT,
	THEME_ACCENT_DARK,
	THEMES,
} from "#modules/storefront/look";
import { LOOK_SAVED_MESSAGE } from "#modules/tenancy/look_messages";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { updateLookValidator } from "#modules/tenancy/validators/tenant";
import { studioLinks } from "#services/studio_links";

/**
 * The logo's copy that Page look previews: the preview box is at most 192 px
 * wide, so a 2x screen wants 384 and the 640 copy is the narrowest that is
 * sharp there (an image narrower than that is shown as it is).
 */
const LOGO_PREVIEW_WIDTH = 640;

/**
 * Settings, Page look (TAT-56): how the studio page looks, set by owners
 * (TENANT_ROUTE_ROLES: owners only). The page reads everything from the
 * tenant row already loaded, so it makes no query of its own.
 */
@inject()
export default class PageLookController {
	constructor(
		private tenancy: TenancyService,
		private images: ImageService,
	) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const look = lookOf(tenant);

		return ctx.inertia.render("settings/look", {
			// What is served, so the form shows what clients get (a stored value
			// the page cannot use shows as its default).
			look: {
				theme: look.theme,
				accent: look.accent,
				accentDark: look.accentDark,
				font: look.font,
				sections: look.sections,
				// Not part of the served look (the flash reads apply it): the form's own.
				claimedFlash: claimedFlashOf(tenant),
			},
			claimedFlashChoices: [...CLAIMED_FLASH_CHOICES],
			themes: THEMES,
			fonts: FONTS,
			sectionKeys: [...SECTION_KEYS],
			// Where an empty colour box starts its swatch.
			swatches: { light: THEME_ACCENT, dark: THEME_ACCENT_DARK },
			// The logo's 640 px copy for the preview, never the key or the columns.
			logo:
				tenant.logoImageKey &&
				tenant.logoImageWidth !== null &&
				tenant.logoImageHeight !== null
					? await this.logoPreview(
							tenant,
							tenant.logoImageKey,
							tenant.logoImageWidth,
							tenant.logoImageHeight,
						)
					: null,
			hasCover: tenant.coverImageKey !== null,
			studioPage: studioLinks(tenant.slug),
		});
	}

	/**
	 * The preview's copy and its own size (the page draws it with `width` and
	 * `height`, so nothing shifts while it loads): the copy is the narrowest
	 * at least LOGO_PREVIEW_WIDTH wide, else the image itself, and a copy
	 * keeps the image's proportions.
	 */
	private async logoPreview(
		tenant: Tenant,
		key: string,
		width: number,
		height: number,
	) {
		const shownWidth = Math.min(LOGO_PREVIEW_WIDTH, width);
		return {
			// The tile it sits on (TAT-123), read from the row: no query.
			tile: logoTileOf(tenant.logoTile),
			previewUrl: await this.images.urlFor(
				"studio_logo",
				key,
				tenant,
				LOGO_PREVIEW_WIDTH,
			),
			width: shownWidth,
			height: Math.round((shownWidth * height) / width),
		};
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(updateLookValidator);

		await this.tenancy.updateLook(tenant, input);

		ctx.session.flash("success", LOOK_SAVED_MESSAGE);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.look", { tenant: tenant.slug });
	}
}
