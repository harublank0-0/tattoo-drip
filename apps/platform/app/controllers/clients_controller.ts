import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import type { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { chatLinks, telLink } from "#modules/clients/contact_links";
import { ClientRuleError } from "#modules/clients/errors";
import type Client from "#modules/clients/models/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { updateClientValidator } from "#modules/clients/validators/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { daysAgoText } from "#modules/projects/contact";
import { formatDay } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/**
 * The clients pages (TAT-41): owners only (the route group's role check).
 * Every :id loads through ClientService.findFor, so another tenant's or a
 * deleted client is a 404. The history comes from the projects and
 * inquiries services; this controller reads no table itself.
 */
@inject()
export default class ClientsController {
	constructor(
		private clients: ClientService,
		private projects: ProjectService,
		private inquiries: InquiryService,
		private artists: ArtistService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const query = ctx.request.qs();
		const search = typeof query.q === "string" ? query.q.trim() : "";
		const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);

		const { clients, total, lastPage } = await this.clients.list(tenant, {
			search,
			page,
		});
		const ids = clients.map(({ id }) => id);
		const counts = await this.projects.countsForClients(tenant, ids);
		const projectChanges = await this.projects.lastChangeForClients(
			tenant,
			ids,
		);
		const inquiryTimes = await this.inquiries.latestForClients(tenant, ids);

		return ctx.inertia.render("clients/index", {
			search,
			clients: clients.map((client) => ({
				id: client.id,
				name: client.name,
				phone: client.phone,
				projects: counts.get(client.id) ?? 0,
				lastActivityText: daysAgoText(
					latest([
						client.createdAt,
						projectChanges.get(client.id),
						inquiryTimes.get(client.id),
					]),
					tenant.timezone,
				),
			})),
			page: { current: page, last: lastPage, total },
		});
	}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const client = await this.clients.findFor(tenant, ctx.params.id);
		const projects = await this.projects.forClient(tenant, client.id);
		const inquiries = await this.inquiries.forClient(tenant, client.id);
		const images = await this.inquiries.imagesFor(tenant, {
			inquiryIds: inquiries.map(({ id }) => id),
			projectIds: projects.map(({ id }) => id),
		});
		const artistName = new Map(
			(await this.artists.list(tenant)).map(({ id, name }) => [id, name]),
		);
		const anonymized = client.anonymizedAt !== null;
		const day = (time: DateTime) =>
			formatDay(time.setZone(tenant.timezone).toFormat("yyyy-MM-dd"));

		return ctx.inertia.render("clients/show", {
			client: {
				id: client.id,
				name: client.name,
				phone: anonymized ? null : client.phone,
				email: anonymized ? null : client.email,
				notes: anonymized ? null : client.notes,
				anonymized,
				sinceText: day(client.createdAt),
			},
			links:
				client.phone && !anonymized
					? { ...chatLinks(client.phone), call: telLink(client.phone) }
					: null,
			projects: projects.map((project) => ({
				id: project.id,
				brief: project.brief,
				status: project.status,
				artistName: project.artistId
					? (artistName.get(project.artistId) ?? null)
					: null,
				createdText: day(project.createdAt),
			})),
			inquiries: inquiries.map((inquiry) => ({
				id: inquiry.id,
				idea: inquiry.idea,
				status: inquiry.status,
				receivedText: day(inquiry.createdAt),
			})),
			references: await Promise.all(
				images.map(async (image) => ({
					id: image.id,
					url: await this.images.url("reference_image", image.imageKey),
					width: image.width,
					height: image.height,
				})),
			),
		});
	}

	async edit(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const client = await this.clients.findFor(tenant, ctx.params.id);
		if (client.anonymizedAt) return refuseAnonymized(ctx, tenant, client);

		return ctx.inertia.render("clients/edit", {
			client: {
				id: client.id,
				name: client.name,
				phone: client.phone ?? "",
				email: client.email,
				notes: client.notes,
			},
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const client = await this.clients.findFor(tenant, ctx.params.id);
		const input = await ctx.request.validateUsing(updateClientValidator);
		try {
			await this.clients.update(tenant, client, input);
		} catch (error) {
			if (!(error instanceof ClientRuleError)) throw error;
			if (error.reason === "anonymized") {
				return refuseAnonymized(ctx, tenant, client);
			}
			const holder = await this.clients.findByPhone(tenant, input.phone);
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "phone",
					message: `Another client already has this number: ${holder?.name ?? "another client"}.`,
					rule: "unique",
				},
			]);
		}
		ctx.session.flash("success", "Client updated.");
		return ctx.response
			.redirect()
			.toRoute("tenant.clients.show", { tenant: tenant.slug, id: client.id });
	}
}

/** The latest of these times (the first one is always set). */
function latest(times: [DateTime, ...(DateTime | undefined)[]]): DateTime {
	return times.reduce<DateTime>(
		(max, time) => (time && time > max ? time : max),
		times[0],
	);
}

/** Back to the profile: a client whose details were deleted stays deleted. */
function refuseAnonymized(
	ctx: HttpContext,
	tenant: { slug: string },
	client: Client,
) {
	ctx.session.flash(
		"error",
		"This client's details were deleted and can't be edited.",
	);
	return ctx.response
		.redirect()
		.toRoute("tenant.clients.show", { tenant: tenant.slug, id: client.id });
}
