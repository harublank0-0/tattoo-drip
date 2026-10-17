import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import { daysAgoText } from "#modules/projects/contact";
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
}

/** The latest of these times (the first one is always set). */
function latest(times: [DateTime, ...(DateTime | undefined)[]]): DateTime {
	return times.reduce<DateTime>(
		(max, time) => (time && time > max ? time : max),
		times[0],
	);
}
