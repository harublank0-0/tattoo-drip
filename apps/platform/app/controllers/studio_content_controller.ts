import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { lookOf } from "#modules/storefront/look";
import { ContentLimitError } from "#modules/studio_content/errors";
import {
	MAX_FAQ_ENTRIES,
	MAX_POLICY_SECTIONS,
} from "#modules/studio_content/limits";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioContentService from "#modules/studio_content/services/studio_content_service";
import {
	faqValidator,
	policiesValidator,
} from "#modules/studio_content/validators/studio_content";

/**
 * Settings, FAQ & policies: the studio's own FAQ entries and policy
 * sections, owners only (the settings group's role check). One page with
 * two lists, each saved whole, so every write redirects back to it.
 */
@inject()
export default class StudioContentController {
	constructor(private content: StudioContentService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		return ctx.inertia.render("settings/faq_policies", {
			faq: await this.content.faq(tenant),
			policies: await this.content.policySections(tenant),
			policiesUpdatedOn:
				tenant.policiesUpdatedAt
					?.setZone(tenant.timezone)
					.toFormat("d MMMM yyyy") ?? null,
			// Whether Page look lists Good to know among the sections shown.
			shownOnPage: lookOf(tenant).sections.includes("info"),
		});
	}

	async updateFaq(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { entries } = await ctx.request.validateUsing(faqValidator);
		await this.limited("entries", MAX_FAQ_ENTRIES, () =>
			this.content.saveFaq(tenant, entries),
		);
		ctx.session.flash("success", "FAQ saved.");
		return this.back(ctx, tenant.slug);
	}

	async updatePolicies(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { sections } = await ctx.request.validateUsing(policiesValidator);
		await this.limited("sections", MAX_POLICY_SECTIONS, () =>
			this.content.savePolicies(tenant, sections),
		);
		ctx.session.flash("success", "Policies saved.");
		return this.back(ctx, tenant.slug);
	}

	/** A list over its limit as the form's error on the list. */
	private async limited(
		field: string,
		max: number,
		save: () => Promise<unknown>,
	) {
		try {
			await save();
		} catch (error) {
			if (!(error instanceof ContentLimitError)) throw error;
			throw new errors.E_VALIDATION_ERROR([
				{ field, message: `You can have up to ${max}.`, rule: "limit" },
			]);
		}
	}

	private back(ctx: HttpContext, tenant: string) {
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.faq_policies", { tenant });
	}
}
