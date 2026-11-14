import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	DEFAULT_TEMPLATES,
	KIND_PLACEHOLDERS,
	MESSAGE_KINDS,
	MESSAGE_LABELS,
	MESSAGE_OFFERED,
	PLACEHOLDER_HELP,
	sampleValues,
} from "#modules/notifications/messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import {
	messageTemplatesValidator,
	messageTemplatesWithoutReviewValidator,
} from "#modules/notifications/validators/message_templates";
import { reviewsEnabled } from "#modules/reviews/review_links";

/** The kinds the page shows: the review request only while reviews are on (slice 2). */
function shownKinds() {
	return MESSAGE_KINDS.filter(
		(kind) => kind !== "review_request" || reviewsEnabled(),
	);
}

/**
 * Settings, Messages (TAT-52): the studio's chat messages, and the review
 * request while reviews are on. Owners only (the settings group's role
 * check).
 */
@inject()
export default class MessageTemplatesController {
	constructor(private templates: MessageTemplateService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const texts = await this.templates.textsFor(tenant);

		return ctx.inertia.render("settings/messages", {
			messages: shownKinds().map((kind) => ({
				kind,
				label: MESSAGE_LABELS[kind],
				offered: MESSAGE_OFFERED[kind],
				text: texts[kind],
				defaultText: DEFAULT_TEMPLATES[kind],
				placeholders: KIND_PLACEHOLDERS[kind].map((name) => ({
					name,
					help: PLACEHOLDER_HELP[name],
				})),
			})),
			sample: sampleValues({ name: tenant.name, address: tenant.address }),
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		// Off, the review request isn't on the page: its stored text stays.
		const texts = reviewsEnabled()
			? await ctx.request.validateUsing(messageTemplatesValidator)
			: await ctx.request.validateUsing(messageTemplatesWithoutReviewValidator);
		await this.templates.save(tenant, texts);
		ctx.session.flash("success", "Messages saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.messages", { tenant: tenant.slug });
	}
}
