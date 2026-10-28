import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	DepositFloorError,
	QuoteRuleError,
	type QuoteRuleReason,
} from "#modules/projects/errors";
import { depositFloorMessage } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	acceptQuoteValidator,
	priceValidator,
	quoteValidator,
	toQuoteInput,
} from "#modules/projects/validators/quote";

/** What a broken quote rule tells the user. */
const RULE_MESSAGES: Record<QuoteRuleReason, string> = {
	project_closed: "This project can no longer be quoted.",
	not_quoted: "This project is not waiting for the client's answer.",
	quote_changed: "The quote changed: check the new version.",
	expired: "This quote has expired: revise it first.",
	price_locked: "This project already has a price, or isn't booked yet.",
};

/** What an artist is told when an owner has to confirm the quote (TAT-16). */
export const OWNER_ACCEPTS_MESSAGE =
	"Only an owner can confirm this quote: its deposit is below what an artist can offer.";

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

		try {
			await flashRuleErrors(ctx, async () => {
				const quote = await this.projects.issueQuote(
					tenant,
					membership,
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
		} catch (error) {
			// An artist's deposit under their floor is a field error, so the form
			// keeps what was typed and the Revise sheet stays open (TAT-16).
			if (error instanceof DepositFloorError) {
				throw new errors.E_VALIDATION_ERROR([
					{
						field: "depositAmount",
						message: depositFloorMessage(error.floor, error.percent),
						rule: "min",
					},
				]);
			}
			throw error;
		}
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

		try {
			await flashRuleErrors(ctx, async () => {
				const status = await this.projects.acceptQuote(
					tenant,
					membership,
					project,
					quoteId,
				);
				ctx.session.flash(
					"success",
					status === "booked"
						? "Accepted and booked."
						: "Accepted: waiting for the deposit.",
				);
			});
		} catch (error) {
			// The quote's deposit is under what an artist can offer: an owner confirms.
			if (!(error instanceof DepositFloorError)) throw error;
			ctx.session.flash("error", OWNER_ACCEPTS_MESSAGE);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	async price(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { fixedPrice } = await ctx.request.validateUsing(priceValidator);

		await flashRuleErrors(ctx, async () => {
			await this.projects.setPrice(
				tenant,
				membership,
				project,
				fixedPrice * 100,
			);
			ctx.session.flash("success", "Price set.");
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
