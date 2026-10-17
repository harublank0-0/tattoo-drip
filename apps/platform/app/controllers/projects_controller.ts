import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { chatLinks } from "#modules/clients/contact_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { contactedText } from "#modules/projects/contact";
import type Quote from "#modules/projects/models/quote";
import {
	ACTIVE_STATUSES,
	allowedMoves,
	CLOSED_STATUSES,
	toProjectFilter,
} from "#modules/projects/moves";
import {
	formatDay,
	formatMoney,
	isExpired,
	priceText,
	QUOTABLE_STATUSES,
	quoteMessage,
	quoteTotal,
	todayIn,
	validUntil,
} from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";

/** How long a new quote is valid by default, in days. */
const DEFAULT_VALID_DAYS = 14;

/**
 * A project's page: its quote, the quote's history and the quote form.
 * Owners open any project, artists the ones assigned to them; anyone else
 * gets a 404 (ProjectService.findFor).
 */
@inject()
export default class ProjectsController {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private clients: ClientService,
		private artists: ArtistService,
		private sessions: SessionService,
		private inquiries: InquiryService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const query = ctx.request.qs();
		const filter = toProjectFilter(query.status);
		const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);

		const { projects, total, lastPage } = await this.projects.list(
			tenant,
			membership,
			filter,
			page,
		);
		const counts = await this.projects.countByStatus(tenant, membership);
		const clients = await this.clients.findMany(
			tenant,
			projects.map(({ clientId }) => clientId),
		);
		const artists = await this.artists.list(tenant);
		const withSession = await this.sessions.projectsWithScheduledTattoo(
			tenant,
			projects.map(({ id }) => id),
		);
		const clientName = new Map(clients.map(({ id, name }) => [id, name]));
		const artistName = new Map(artists.map(({ id, name }) => [id, name]));
		const sum = (statuses: readonly (keyof typeof counts)[]) =>
			statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);

		return ctx.inertia.render("projects/index", {
			filter,
			counts: {
				active: sum(ACTIVE_STATUSES),
				closed: sum(CLOSED_STATUSES),
				byStatus: Object.fromEntries(
					ACTIVE_STATUSES.map((status) => [status, counts[status] ?? 0]),
				),
			},
			projects: projects.map((project) => ({
				id: project.id,
				clientName: clientName.get(project.clientId) ?? null,
				artistName: project.artistId
					? (artistName.get(project.artistId) ?? null)
					: null,
				status: project.status,
				contactedText: contactedText(project.lastContactedAt, tenant.timezone),
				noSession: project.status === "booked" && !withSession.has(project.id),
			})),
			page: { current: page, last: lastPage, total },
		});
	}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const client = await this.clients.find(tenant, project.clientId);
		const artists = await this.artists.list(tenant);
		const artist = project.artistId
			? artists.find(({ id }) => id === project.artistId)
			: undefined;
		const scheduled = (
			await this.sessions.listForProject(tenant, project)
		).filter(({ status }) => status === "scheduled");
		const depositHeld = await this.projects.depositHeld(tenant, project);
		const versions = await this.quotes.history(tenant, project);
		const current = versions.at(0) ?? null;
		const live = current && !isExpired(current) ? current : null;
		const { timezone } = tenant;
		const today = DateTime.fromISO(todayIn(timezone), { zone: "utc" });

		const inquiry = project.inquiryId
			? await this.inquiries.find(tenant, project.inquiryId)
			: null;
		const request = inquiry
			? {
					placement: inquiry.placement,
					approximateSize: inquiry.approximateSize,
					preferredDates: inquiry.preferredDates,
					budget: inquiry.budget,
					source: inquiry.sourceChannel,
					references: await Promise.all(
						(
							await this.inquiries.images(tenant, { projectId: project.id })
						).map(async (image) => ({
							id: image.id,
							url: await this.images.url("reference_image", image.imageKey),
							width: image.width,
							height: image.height,
						})),
					),
				}
			: null;

		return ctx.inertia.render("projects/show", {
			project: {
				id: project.id,
				status: project.status,
				brief: project.brief,
				clientName: client?.name ?? null,
				artistName: artist?.name ?? null,
			},
			quote: current ? quoteProps(current, timezone) : null,
			history: versions.slice(1).map((quote) => quoteProps(quote, timezone)),
			canQuote: QUOTABLE_STATUSES.includes(project.status),
			canAccept: project.status === "quoted" && live !== null,
			// Only while the client's answer is awaited: not after acceptance, and
			// not for a project that was declined or withdrawn.
			message:
				live &&
				client?.phone &&
				(project.status === "quoted" || project.status === "on_hold")
					? messageProps(live, client.name, client.phone, tenant.name, timezone)
					: null,
			form: {
				depositPercent: tenant.defaultDepositPercent,
				defaultValidUntil: today
					.plus({ days: DEFAULT_VALID_DAYS })
					.toFormat("yyyy-MM-dd"),
				minDate: today.toFormat("yyyy-MM-dd"),
				maxDate: today.plus({ years: 1 }).toFormat("yyyy-MM-dd"),
			},
			// Withdrawing is hidden while the project holds deposit money (the
			// server refuses it too); the page says why.
			moves: allowedMoves(project.status).filter(
				(move) => !(move === "withdraw" && depositHeld),
			),
			withdrawBlocked:
				depositHeld && allowedMoves(project.status).includes("withdraw"),
			scheduledSessionCount: scheduled.length,
			bookedWithoutSession:
				project.status === "booked" &&
				!scheduled.some(({ kind }) => kind === "tattoo"),
			notes: project.notes,
			contactedText: contactedText(project.lastContactedAt, timezone),
			assignment:
				membership.role === "owner"
					? {
							artistId: project.artistId,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			request,
		});
	}
}

/**
 * What the page gets for one quote version: display text in the studio's
 * timezone, and the amounts in the form's units for a revision.
 */
function quoteProps(quote: Quote, timezone: string) {
	const lastDay = validUntil(quote.expiresAt, timezone);
	return {
		id: quote.id,
		version: quote.version,
		kind: quote.kind,
		priceText: priceText(quote),
		totalText: formatMoney(quoteTotal(quote)),
		depositText:
			quote.depositAmount === 0
				? "No deposit"
				: formatMoney(quote.depositAmount),
		validUntil: lastDay,
		validUntilText: formatDay(lastDay),
		issuedText: formatDay(
			quote.createdAt.setZone(timezone).toFormat("yyyy-MM-dd"),
		),
		expired: isExpired(quote),
		fixedPrice: quote.fixedPrice === null ? null : quote.fixedPrice / 100,
		hourlyRate: quote.hourlyRate === null ? null : quote.hourlyRate / 100,
		estimatedHours:
			quote.estimatedMinutes === null ? null : quote.estimatedMinutes / 60,
		depositAmount: quote.depositAmount / 100,
	};
}

/** The chat message for a live quote, and the links that send it. */
function messageProps(
	quote: Quote,
	clientName: string,
	phone: string,
	studioName: string,
	timezone: string,
) {
	const text = quoteMessage({ clientName, studioName, quote, timezone });
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}
