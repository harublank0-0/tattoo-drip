import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { QuoteRuleError, type QuoteRuleReason } from "#modules/projects/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	acceptQuoteValidator,
	quoteValidator,
	toQuoteInput,
} from "#modules/projects/validators/quote";

/** What a broken quote rule tells the user. */
const RULE_MESSAGES: Record<QuoteRuleReason, string> = {
	project_closed: "This project can no longer be quoted.",
	not_quoted: "This project is not waiting for the client's answer.",
	quote_changed: "The quote changed: check the new version.",
	expired: "This quote has expired: revise it first.",
};

/**
 * Issuing, revising and accepting a project's quote from its page. Every
 * :id loads through ProjectService.findFor first, so another tenant's
 * project, or another artist's, is a 404 even with a bad body.
 */
@inject()
export default class QuotesController {
	constructor(private projects: ProjectService) {}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(quoteValidator);
		const input = toQuoteInput(form, tenant.timezone);

		await flashRuleErrors(ctx, async () => {
			const quote = await this.projects.issueQuote(
				tenant,
				project,
				input,
				form.baseQuoteId ?? null,
			);
			ctx.session.flash(
				"success",
				quote.version === 1
					? "Quote issued."
					: `Quote revised (version ${quote.version}).`,
			);
		});
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	async accept(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { quoteId } = await ctx.request.validateUsing(acceptQuoteValidator);

		await flashRuleErrors(ctx, async () => {
			const status = await this.projects.acceptQuote(tenant, project, quoteId);
			ctx.session.flash(
				"success",
				status === "booked"
					? "Accepted and booked."
					: "Accepted: waiting for the deposit.",
			);
		});
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}
}

/**
 * Runs `work`, turning a broken quote rule into a flash error. The service
 * already rolled its savepoint back, so the request goes on.
 */
async function flashRuleErrors(ctx: HttpContext, work: () => Promise<void>) {
	try {
		await work();
	} catch (error) {
		if (!(error instanceof QuoteRuleError)) throw error;
		ctx.session.flash("error", RULE_MESSAGES[error.reason]);
	}
}
