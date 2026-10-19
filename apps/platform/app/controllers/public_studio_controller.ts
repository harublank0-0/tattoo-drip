import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import PublicStudioTransformer from "#transformers/public_studio_transformer";

/** The public API's tenant resource (getStudio in openapi.yaml, TAT-44). */
@inject()
export default class PublicStudioController {
	constructor(private pages: StudioPageService) {}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const studio = await this.pages.studio(tenant);
		return ctx.serialize(PublicStudioTransformer.transform(studio));
	}
}
