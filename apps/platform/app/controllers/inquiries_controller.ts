import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { flashCard } from "#modules/flash/flash_card";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import FlashService from "#modules/flash/services/flash_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import type Inquiry from "#modules/inquiries/models/inquiry";
import { referenceView } from "#modules/inquiries/reference_view";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import { acceptInquiryValidator } from "#modules/inquiries/validators/inquiry";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { excerpt } from "#modules/notifications/alerts";
import { chatMessage, contactLinks } from "#modules/notifications/chat";
import {
	firstName,
	MESSAGE_LABELS,
	renderMessage,
} from "#modules/notifications/messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import {
	contactValidator,
	toContactVia,
} from "#modules/notifications/validators/contact";
import { daysAgoText, lastContactText } from "#modules/projects/contact";
import { formatDay } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import { studioLinks } from "#services/studio_links";

/** The Inbox row shows two lines of the idea (line-clamp-2): enough to fill both at 1280 px. */
const IDEA_PREVIEW_LENGTH = 280;

/**
 * The inquiry inbox (TAT-46): owners only (the route group's role check).
 * Every :id loads through InquiryService.findFor, so another tenant's
 * inquiry is a 404.
 */
@inject()
export default class InquiriesController {
	constructor(
		private inquiries: InquiryService,
		private projects: ProjectService,
		private artists: ArtistService,
		private images: ImageService,
		private clients: ClientService,
		private templates: MessageTemplateService,
		private flash: FlashService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const query = ctx.request.qs();
		const view = query.view === "decided" ? "decided" : "new";
		const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);

		const { inquiries, total, lastPage } =
			view === "new"
				? await this.inquiries.listNew(tenant, page)
				: await this.inquiries.listDecided(tenant, page);
		const ids = inquiries.map(({ id }) => id);
		const counts =
			view === "new"
				? await this.inquiries.imageCounts(tenant, ids)
				: new Map<string, number>();
		const projectIds =
			view === "decided"
				? await this.projects.projectIdsForInquiries(tenant, ids)
				: new Map<string, string>();
		const artistName = await this.artistNames(tenant);
		// The flash designs the page's requests name (TAT-129): one query.
		const designs = await this.flash.forIds(
			tenant,
			inquiries.flatMap(({ flashDesignId }) =>
				flashDesignId ? [flashDesignId] : [],
			),
		);
		const flashOf = async (inquiry: Inquiry) => {
			const design = inquiry.flashDesignId
				? designs.get(inquiry.flashDesignId)
				: undefined;
			return design
				? {
						name: design.name,
						thumbnailUrl: await this.images.urlFor(
							"flash_design",
							design.imageKey,
							tenant,
							THUMBNAIL_WIDTH,
						),
					}
				: null;
		};
		const flashRows = await Promise.all(inquiries.map(flashOf));

		return ctx.inertia.render("inquiries/index", {
			view,
			// The studio link (TAT-101) for the empty New view. The setup checklist
			// and the pilot numbers moved to Today (TAT-107).
			studioPage: view === "new" ? studioLinks(tenant.slug) : null,
			newCount: await this.inquiries.countNew(tenant),
			inquiries: inquiries.map((inquiry, index) => ({
				id: inquiry.id,
				contactName: inquiry.contactName,
				idea: excerpt(inquiry.idea, IDEA_PREVIEW_LENGTH),
				placement: inquiry.placement,
				approximateSize: inquiry.approximateSize,
				preferredArtistName: inquiry.preferredArtistId
					? (artistName.get(inquiry.preferredArtistId) ?? null)
					: null,
				// The flash design asked for, with its picture (TAT-129).
				flash: flashRows[index],
				receivedText: receivedText(inquiry, tenant.timezone),
				references: counts.get(inquiry.id) ?? 0,
				status: inquiry.status,
				decidedOn: decidedOn(inquiry, tenant.timezone),
				projectId: projectIds.get(inquiry.id) ?? null,
				// The last contact (TAT-52): a new inquiry staff already answered.
				contactedText: inquiry.lastContactedAt
					? lastContactText(inquiry.lastContactedAt, tenant.timezone, {
							channel: inquiry.lastContactChannel,
							kind: inquiry.lastContactKind,
						})
					: null,
			})),
			page: { current: page, last: lastPage, total },
		});
	}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const images = await this.inquiries.images(tenant, {
			inquiryId: inquiry.id,
		});
		const artists = await this.artists.list(tenant);
		const preferred = artists.find(
			({ id }) => id === inquiry.preferredArtistId,
		);
		const projectId =
			inquiry.status === "accepted"
				? ((
						await this.projects.projectIdsForInquiries(tenant, [inquiry.id])
					).get(inquiry.id) ?? null)
				: null;

		// The flash design the request names (TAT-129), hidden or not.
		const design = inquiry.flashDesignId
			? (await this.flash.forIds(tenant, [inquiry.flashDesignId])).get(
					inquiry.flashDesignId,
				)
			: undefined;
		const flash = design
			? await flashCard(
					this.images,
					tenant,
					design,
					artists.find(({ id }) => id === design.artistId)?.name ?? null,
				)
			: null;

		// "Message the client" (TAT-52): the client's stored phone (an owner
		// may have corrected it since), and while the inquiry is new the
		// "received" message, greeting the name it was sent with.
		const client = await this.clients.find(tenant, inquiry.clientId);
		const phone = client?.phone ?? null;
		const texts = await this.templates.textsFor(tenant);

		return ctx.inertia.render("inquiries/show", {
			inquiry: {
				id: inquiry.id,
				clientId: inquiry.clientId,
				status: inquiry.status,
				contactName: inquiry.contactName,
				contactPhone: inquiry.contactPhone,
				contactEmail: inquiry.contactEmail,
				idea: inquiry.idea,
				placement: inquiry.placement,
				approximateSize: inquiry.approximateSize,
				preferredDates: inquiry.preferredDates,
				budget: inquiry.budget,
				source: inquiry.sourceChannel,
				preferredArtistName: preferred?.name ?? null,
				receivedText: receivedText(inquiry, tenant.timezone),
				decidedOn: decidedOn(inquiry, tenant.timezone),
			},
			flash,
			references: await Promise.all(
				images.map((image) => referenceView(this.images, tenant, image)),
			),
			accept:
				inquiry.status === "new"
					? {
							artistId: preferred?.id ?? null,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			projectId,
			contact: phone ? contactLinks(phone) : null,
			message:
				phone && inquiry.status === "new"
					? {
							kind: "inquiry_received" as const,
							label: MESSAGE_LABELS.inquiry_received,
							...chatMessage(
								renderMessage("inquiry_received", texts.inquiry_received, {
									client_name: firstName(inquiry.contactName),
									studio_name: tenant.name,
								}),
								phone,
							),
						}
					: null,
			contactedText: lastContactText(inquiry.lastContactedAt, tenant.timezone, {
				channel: inquiry.lastContactChannel,
				kind: inquiry.lastContactKind,
			}),
			// The card leads with the channel used last (TAT-104).
			lastChannel: inquiry.lastContactChannel,
		});
	}

	async accept(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const { artistId } = await ctx.request.validateUsing(
			acceptInquiryValidator,
		);
		try {
			const project = await this.inquiries.accept(tenant, inquiry, artistId);
			ctx.session.flash("success", "Inquiry accepted: project created.");
			return ctx.response.redirect().toRoute("tenant.projects.show", {
				tenant: tenant.slug,
				id: project.id,
			});
		} catch (error) {
			if (!(error instanceof InquiryRuleError)) throw error;
			if (error.reason === "artist_unavailable") {
				throw new errors.E_VALIDATION_ERROR([
					{
						field: "artistId",
						message: "Choose an artist from the list.",
						rule: "exists",
					},
				]);
			}
			return alreadyDecided(ctx, tenant, inquiry);
		}
	}

	async decline(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		try {
			await this.inquiries.decline(tenant, inquiry);
			ctx.session.flash("success", "Inquiry declined.");
			return ctx.response
				.redirect()
				.toRoute("tenant.inbox.index", { tenant: tenant.slug });
		} catch (error) {
			if (!(error instanceof InquiryRuleError)) throw error;
			return alreadyDecided(ctx, tenant, inquiry);
		}
	}

	/** The inquiry page's chat links record the contact in the background (TAT-52). */
	async contacted(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const via = toContactVia(await ctx.request.validateUsing(contactValidator));
		await this.inquiries.markContacted(tenant, inquiry, via);
		ctx.session.flash("success", "Marked as contacted.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inbox.show", { tenant: tenant.slug, id: inquiry.id });
	}

	/** The tenant's live artists' names, by id. */
	private async artistNames(tenant: { id: string }) {
		const artists = await this.artists.list(tenant);
		return new Map(artists.map(({ id, name }) => [id, name]));
	}
}

/** A stale page: someone decided it first. Back to the inquiry's page. */
function alreadyDecided(
	ctx: HttpContext,
	tenant: { slug: string },
	inquiry: Inquiry,
) {
	ctx.session.flash("error", "This inquiry was already decided.");
	return ctx.response
		.redirect()
		.toRoute("tenant.inbox.show", { tenant: tenant.slug, id: inquiry.id });
}

function receivedText(inquiry: Inquiry, timezone: string) {
	return `received ${daysAgoText(inquiry.createdAt, timezone)}`;
}

function decidedOn(inquiry: Inquiry, timezone: string) {
	return inquiry.decidedAt
		? formatDay(inquiry.decidedAt.setZone(timezone).toFormat("yyyy-MM-dd"))
		: null;
}
