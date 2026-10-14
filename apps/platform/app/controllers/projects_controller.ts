import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import type Quote from "#modules/projects/models/quote";
import {
	chatLinks,
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
	) {}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const client = await this.clients.find(tenant, project.clientId);
		const artist = project.artistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === project.artistId,
				)
			: undefined;
		const versions = await this.quotes.history(tenant, project);
		const current = versions.at(0) ?? null;
		const live = current && !isExpired(current) ? current : null;
		const { timezone } = tenant;
		const today = DateTime.fromISO(todayIn(timezone), { zone: "utc" });

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
			message:
				live && client?.phone
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
