import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import type Inquiry from "#modules/inquiries/models/inquiry";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import { acceptInquiryValidator } from "#modules/inquiries/validators/inquiry";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { daysAgoText } from "#modules/projects/contact";
import { formatDay } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

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

		return ctx.inertia.render("inquiries/index", {
			view,
			newCount: await this.inquiries.countNew(tenant),
			inquiries: inquiries.map((inquiry) => ({
				id: inquiry.id,
				contactName: inquiry.contactName,
				idea: inquiry.idea,
				placement: inquiry.placement,
				approximateSize: inquiry.approximateSize,
				preferredArtistName: inquiry.preferredArtistId
					? (artistName.get(inquiry.preferredArtistId) ?? null)
					: null,
				receivedText: receivedText(inquiry, tenant.timezone),
				references: counts.get(inquiry.id) ?? 0,
				status: inquiry.status,
				decidedOn: decidedOn(inquiry, tenant.timezone),
				projectId: projectIds.get(inquiry.id) ?? null,
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

		return ctx.inertia.render("inquiries/show", {
			inquiry: {
				id: inquiry.id,
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
			references: await Promise.all(
				images.map(async (image) => ({
					id: image.id,
					url: await this.images.url("reference_image", image.imageKey),
					width: image.width,
					height: image.height,
				})),
			),
			accept:
				inquiry.status === "new"
					? {
							artistId: preferred?.id ?? null,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			projectId,
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
