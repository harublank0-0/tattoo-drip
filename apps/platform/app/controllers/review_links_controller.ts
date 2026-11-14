import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { ReviewLinkRuleError } from "#modules/reviews/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewLinkService from "#modules/reviews/services/review_link_service";
import { LINK_DONE, LINK_RULE_MESSAGES } from "#modules/reviews/studio_copy";

/**
 * "Ask for a review" on the project page (Reviews and Fresh ink, slice 2,
 * ruling 3): make the project's review link, or get the one it has, and
 * revoke it. Owners and the project's artist: ReviewLinkService opens the
 * project through ProjectService.findFor, so another studio's project, or
 * another artist's, is a 404. Behind REVIEWS_ENABLED (the `reviewsOn`
 * middleware). The page then shows the link and the chat links that send
 * it; the token is never in a flash or a log.
 */
@inject()
export default class ReviewLinksController {
	constructor(private links: ReviewLinkService) {}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		try {
			const { created } = await this.links.linkFor(
				tenant,
				membership,
				ctx.params.id,
			);
			ctx.session.flash("success", created ? LINK_DONE.made : LINK_DONE.same);
		} catch (error) {
			if (!(error instanceof ReviewLinkRuleError)) throw error;
			ctx.session.flash("error", LINK_RULE_MESSAGES[error.reason]);
		}
		return ctx.response.redirect().toRoute("tenant.projects.show", {
			tenant: tenant.slug,
			id: ctx.params.id,
		});
	}

	async destroy(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const revoked = await this.links.revoke(tenant, membership, ctx.params.id);
		ctx.session.flash("success", revoked ? LINK_DONE.revoked : LINK_DONE.none);
		return ctx.response.redirect().toRoute("tenant.projects.show", {
			tenant: tenant.slug,
			id: ctx.params.id,
		});
	}
}
