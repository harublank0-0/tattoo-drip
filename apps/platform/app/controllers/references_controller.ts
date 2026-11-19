import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import { ImageDeleteError } from "#modules/media/errors";

/**
 * A client's reference photo (the storage meter: freeing space). Owners
 * only (TENANT_ROUTE_ROLES, and InquiryService.deleteReference checks
 * again); another studio's photo, a deleted one and an artist all get a
 * 404. Goes back to the page it was deleted from: the inquiry, the project
 * or the client.
 */
@inject()
export default class ReferencesController {
	constructor(private inquiries: InquiryService) {}

	async destroy(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		try {
			await this.inquiries.deleteReference(tenant, membership, ctx.params.id);
			ctx.session.flash("success", "Photo deleted.");
		} catch (error) {
			if (!(error instanceof ImageDeleteError)) throw error;
			ctx.session.flash(
				"error",
				"The photo couldn't be deleted. Try again in a moment.",
			);
		}
		return ctx.response.redirect().back();
	}
}
