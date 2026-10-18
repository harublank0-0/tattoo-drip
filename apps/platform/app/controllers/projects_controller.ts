import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { chatLinks } from "#modules/clients/contact_links";
import type Client from "#modules/clients/models/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import {
	DEPOSIT_LINK_PROBLEMS,
	depositMessage,
	storefrontTemplate,
} from "#modules/payments/deposit_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import { contactedText } from "#modules/projects/contact";
import type Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import {
	ACTIVE_STATUSES,
	allowedMoves,
	CLOSED_STATUSES,
	toProjectFilter,
} from "#modules/projects/moves";
import {
	BOOKED_STATUSES,
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
import { sessionTimeText } from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import { pointsAtThisMachine } from "#services/storefront_url";

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
		private depositLinks: DepositLinkService,
		private deposits: DepositService,
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
		const sessions = await this.sessions.listForProject(tenant, project);
		const scheduled = sessions.filter(({ status }) => status === "scheduled");
		const versions = await this.quotes.history(tenant, project);
		const current = versions.at(0) ?? null;
		const held = current
			? await this.deposits.verifiedPaid(tenant, project, current.currency)
			: 0;
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
							url: await this.images.url(
								"reference_image",
								image.imageKey,
								tenant,
							),
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
			// From booked on, the quote's expiry no longer means anything.
			quoteExpiryShown: !BOOKED_STATUSES.includes(project.status),
			canQuote: QUOTABLE_STATUSES.includes(project.status),
			canAccept: project.status === "quoted" && live !== null,
			// A booking made without a price can get one once (TAT-66).
			canSetPrice: BOOKED_STATUSES.includes(project.status) && current === null,
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
			moves: allowedMoves(project.status),
			// The withdraw confirm names the deposit the project holds (TAT-66).
			depositHeldText: held > 0 ? formatMoney(held) : null,
			scheduledSessionCount: scheduled.length,
			bookedWithoutSession:
				project.status === "booked" &&
				!scheduled.some(({ kind }) => kind === "tattoo"),
			sessions: sessions.map((session) => ({
				id: session.id,
				whenText: sessionTimeText(session.startsAt, session.endsAt, timezone),
				kind: session.kind,
				status: session.status,
				artistName:
					artists.find(({ id }) => id === session.artistId)?.name ?? null,
			})),
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
			// Owners only: the clients pages are theirs.
			clientId: membership.role === "owner" ? project.clientId : null,
			// Owners only, while the project waits for its deposit (TAT-65).
			deposit:
				membership.role === "owner" && project.status === "deposit_pending"
					? await this.depositPanel(tenant, project, client)
					: null,
		});
	}

	/**
	 * The deposit panel (TAT-65): the project's link, rebuilt from its nonce
	 * (`url` null once it no longer works), why a link can't be made now,
	 * the chat message that sends it (with a working link and a phone), the
	 * day a screenshot came, while one waits, and whether links point at this
	 * machine (the dev host).
	 */
	private async depositPanel(
		tenant: Tenant,
		project: TattooProject,
		client: Pick<Client, "name" | "phone"> | null,
	) {
		const day = (at: DateTime) =>
			formatDay(at.setZone(tenant.timezone).toFormat("yyyy-MM-dd"));
		const link = await this.depositLinks.forProject(tenant, project);
		const problem = await this.depositLinks.issueProblem(tenant, project);
		const quote = await this.quotes.current(tenant, project);
		const due = quote
			? await this.deposits.remaining(tenant, project, quote)
			: 0;
		const pending = await this.deposits.pendingProof(tenant, project);
		const url = link?.url ?? null;
		return {
			link: link
				? {
						url,
						referenceCode: link.referenceCode,
						// The last day it works: the day before the instant it expires.
						expiresText: formatDay(validUntil(link.expiresAt, tenant.timezone)),
					}
				: null,
			problem: problem ? DEPOSIT_LINK_PROBLEMS[problem] : null,
			message:
				link && url && client?.phone
					? chatMessage(
							depositMessage({
								clientName: client.name,
								studioName: tenant.name,
								dueText: formatMoney(due),
								referenceCode: link.referenceCode,
								url,
							}),
							client.phone,
						)
					: null,
			proofReceivedText: pending ? day(pending.createdAt) : null,
			// Links that open on this machine reach no client: the card warns.
			devHost: pointsAtThisMachine(storefrontTemplate()),
		};
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
	return chatMessage(
		quoteMessage({ clientName, studioName, quote, timezone }),
		phone,
	);
}

/** A chat message and the links that send it: WhatsApp prefilled, Viber to paste. */
function chatMessage(text: string, phone: string) {
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}
