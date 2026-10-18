import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import { ApiException } from "#services/public_api_errors";
import PublicArtistTransformer from "#transformers/public_artist_transformer";

/**
 * The studio's visible artists on the public API (listArtists and
 * getArtist in openapi.yaml, TAT-44). A hidden, deleted or unknown artist
 * is the one 404; the route's matcher already turned away a slug of the
 * wrong shape.
 */
@inject()
export default class PublicArtistsController {
	constructor(private pages: StudioPageService) {}

	async index(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const artists = await this.pages.visibleArtists(tenant);
		return ctx.serialize(PublicArtistTransformer.transform(artists));
	}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const artist = await this.pages.visibleArtist(tenant, ctx.params.artist);
		if (!artist) throw ApiException.notFound();
		return ctx.serialize(PublicArtistTransformer.transform(artist));
	}
}
