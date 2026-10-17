import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import PublicStudioTransformer from "#transformers/public_studio_transformer";

/** The public API's tenant resource (getStudio in openapi.yaml). */
export default class PublicStudioController {
	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		return ctx.serialize(PublicStudioTransformer.transform(tenant));
	}
}
