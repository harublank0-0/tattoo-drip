import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { asFieldErrors } from "#controllers/discover_settings_controller";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicationService from "#modules/discovery/services/publication_service";
import { artistDiscoverValidator } from "#modules/discovery/validators/publication";

/**
 * One artist's own Discover switch (Discover D04), on their profile page:
 * an owner any profile, an artist only their own (TENANT_ROUTE_ROLES,
 * ArtistService.findEditable, re-checked under the row lock). Turning it
 * back on for a profile someone else manages is refused by the service.
 */
@inject()
export default class ArtistDiscoverController {
	constructor(
		private artists: ArtistService,
		private publication: PublicationService,
	) {}

	async update(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		// Load first: another tenant's id, or a profile that isn't the
		// artist's, is a 404 even with a bad body.
		await this.artists.findEditable(tenant, membership, ctx.params.id);
		const { listed } = await ctx.request.validateUsing(artistDiscoverValidator);
		const artist = await asFieldErrors(() =>
			this.publication.setArtistListed(
				tenant,
				membership,
				ctx.params.id,
				listed,
			),
		);

		ctx.session.flash(
			"success",
			listed
				? `"${artist.name}" can show on Discover.`
				: `"${artist.name}" won't show on Discover.`,
		);
		return ctx.response.redirect().toRoute("tenant.artists.edit", {
			tenant: tenant.slug,
			id: artist.id,
		});
	}
}
