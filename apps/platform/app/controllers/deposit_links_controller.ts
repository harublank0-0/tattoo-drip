import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { DEPOSIT_LINK_PROBLEMS } from "#modules/payments/deposit_links";
import { DepositLinkRuleError } from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/**
 * Making or replacing a project's deposit link from its page (TAT-65). The
 * :id loads through ProjectService.findFor first, so another tenant's
 * project, or another artist's, is a 404; DepositLinkService then lets only
 * owners through (an assigned artist gets the same 404).
 */
@inject()
export default class DepositLinksController {
	constructor(
		private projects: ProjectService,
		private links: DepositLinkService,
	) {}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		try {
			const { replaced } = await this.links.issue(tenant, membership, project);
			ctx.session.flash(
				"success",
				replaced
					? "New link made. The old one no longer works."
					: "Deposit link ready: send it to the client.",
			);
		} catch (error) {
			if (!(error instanceof DepositLinkRuleError)) throw error;
			ctx.session.flash("error", DEPOSIT_LINK_PROBLEMS[error.reason]);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}
}
