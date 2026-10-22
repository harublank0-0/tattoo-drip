import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import type Inquiry from "#modules/inquiries/models/inquiry";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import { ALERT_EXCERPT_LENGTH, excerpt } from "#modules/notifications/alerts";
import { daysAgoText, lastContactText } from "#modules/projects/contact";
import { todayIn } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WaitingService, {
	type WaitingItem,
} from "#modules/projects/services/waiting_service";
import {
	groupOf,
	TODAY_GROUP_ORDER,
	TODAY_ROWS,
	type TodayGroupKey,
} from "#modules/projects/waiting";
import { CARD_DAYS, lastDays, pilotCard } from "#modules/reports/pilot_metrics";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
import { dayBounds, sessionRow } from "#modules/scheduling/calendar";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CalendarService from "#modules/scheduling/services/calendar_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SetupService from "#modules/tenancy/services/setup_service";
import { studioLinks } from "#services/studio_links";

type Target = {
	route: "tenant.projects.show" | "tenant.inbox.show";
	id: string;
	hash: string | null;
};
type Row = {
	id: string;
	name: string;
	detail: string;
	meta: string | null;
	target: Target;
};
type More = {
	route: "tenant.inbox.index" | "tenant.projects.index";
	status: string | null;
} | null;
type Group = { key: TodayGroupKey; count: number; rows: Row[]; more: More };

/**
 * Groups that show every row, never five and a link: an owner's screenshots to check. An
 * unresolved payment is never hidden behind "See all", and the Projects list can't show
 * the closed (withdrawn) projects that sit in this group (TAT-109 adds a way to list them).
 */
const UNCAPPED_GROUPS: readonly TodayGroupKey[] = ["proofs"];

/** Where "See all" goes for a capped group, and the one project status that holds the whole group. */
const SEE_ALL: Partial<Record<TodayGroupKey, Exclude<More, null>>> = {
	requests: { route: "tenant.inbox.index", status: null },
	prices: { route: "tenant.projects.index", status: "reviewing" },
	ending: { route: "tenant.projects.index", status: null },
	deposits: { route: "tenant.projects.index", status: "deposit_pending" },
	sessions: { route: "tenant.projects.index", status: null },
};

/**
 * Today (TAT-107): what needs the member right now, who is in the chair
 * today, and which clients are being waited on. Every member's home; an
 * artist's is their own projects and sessions only, and never requests,
 * screenshots, deposit links, the setup checklist or the pilot numbers.
 * The server decides every group, row, count, word and target; the page
 * only lays them out. What waits on a project is WaitingService's.
 */
@inject()
export default class TodayController {
	constructor(
		private waiting: WaitingService,
		private inquiries: InquiryService,
		private clients: ClientService,
		private calendar: CalendarService,
		private setup: SetupService,
		private metrics: PilotMetricsService,
	) {}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { timezone } = tenant;
		const isOwner = membership.role === "owner";
		const now = DateTime.now();
		const date = todayIn(timezone, now);

		const work = await this.waiting.work(tenant, membership, now);
		const agenda = await this.calendar.load(tenant, membership, {
			artistId: null,
			...dayBounds(date, timezone),
		});
		// Owners get the artist list with the calendar; an artist sees no artist names.
		const artistName = new Map(
			agenda.artists.map(({ id, name }) => [id, name]),
		);
		const requests = isOwner ? await this.inquiries.listNew(tenant, 1) : null;

		const byGroup = new Map<TodayGroupKey, WaitingItem[]>();
		for (const item of work.needsYou) {
			const key = groupOf(item.waiting.reason);
			byGroup.set(key, [...(byGroup.get(key) ?? []), item]);
		}
		const shown = {
			groups: new Map<TodayGroupKey, WaitingItem[]>(
				[...byGroup].map(([key, items]) => [
					key,
					UNCAPPED_GROUPS.includes(key) ? items : items.slice(0, TODAY_ROWS),
				]),
			),
			waiting: work.onClient.slice(0, TODAY_ROWS),
		};

		const clientIds = [
			...new Set(
				[...shown.groups.values(), shown.waiting]
					.flat()
					.map(({ project }) => project.clientId),
			),
		];
		const clientName = new Map(
			(await this.clients.findMany(tenant, clientIds)).map(({ id, name }) => [
				id,
				name,
			]),
		);

		const projectRow = (item: WaitingItem, withContact: boolean): Row => {
			const { project } = item;
			const artist =
				isOwner && project.artistId ? artistName.get(project.artistId) : null;
			const parts = [
				artist ? `With ${artist}` : null,
				withContact
					? lastContactText(
							project.lastContactedAt,
							timezone,
							{
								channel: project.lastContactChannel,
								kind: project.lastContactKind,
							},
							now,
						)
					: null,
			].filter((part): part is string => part !== null);
			return {
				id: project.id,
				name: clientName.get(project.clientId) ?? "Unknown client",
				detail: item.text,
				meta: parts.length > 0 ? upperFirst(parts.join(" · ")) : null,
				target: {
					route: "tenant.projects.show",
					id: project.id,
					hash: item.hash,
				},
			};
		};
		const requestRow = (inquiry: Inquiry): Row => {
			const artist = inquiry.preferredArtistId
				? artistName.get(inquiry.preferredArtistId)
				: null;
			return {
				id: inquiry.id,
				name: inquiry.contactName,
				detail: excerpt(inquiry.idea, ALERT_EXCERPT_LENGTH),
				meta: `Sent ${daysAgoText(inquiry.createdAt, timezone, now)}${artist ? ` · for ${artist}` : ""}`,
				target: { route: "tenant.inbox.show", id: inquiry.id, hash: null },
			};
		};

		const needsYou: Group[] = [];
		for (const key of TODAY_GROUP_ORDER) {
			const count =
				key === "requests"
					? (requests?.total ?? 0)
					: (byGroup.get(key)?.length ?? 0);
			if (count === 0) continue;
			const rows =
				key === "requests"
					? (requests?.inquiries ?? []).slice(0, TODAY_ROWS).map(requestRow)
					: (shown.groups.get(key) ?? []).map((item) =>
							projectRow(item, false),
						);
			needsYou.push({
				key,
				count,
				rows,
				more: count > rows.length ? (SEE_ALL[key] ?? null) : null,
			});
		}

		// The checklist shows until the four steps are done; the studio link
		// goes with it (its last step opens the page).
		const checklist = isOwner ? await this.setup.checklist(tenant) : null;
		const setup = checklist && !checklist.complete ? checklist : null;

		return ctx.inertia.render("today/index", {
			dateText: now
				.setZone(timezone)
				.setLocale("en-GB")
				.toFormat("cccc d LLLL"),
			date,
			timezone,
			needsYou,
			sessions: {
				scope: agenda.scope.kind,
				rows: agenda.entries.map((entry) => sessionRow(entry, date, timezone)),
			},
			waiting: {
				count: work.onClient.length,
				rows: shown.waiting.map((item) => projectRow(item, true)),
				more:
					work.onClient.length > shown.waiting.length
						? ({ route: "tenant.projects.index", status: null } as const)
						: null,
			},
			setup,
			studioPage: setup ? studioLinks(tenant.slug) : null,
			// The owners' pilot numbers (TAT-70), moved here from the Inbox.
			pilotMetrics: isOwner
				? pilotCard(
						await this.metrics.forStudio(tenant, lastDays(CARD_DAYS)),
						CARD_DAYS,
					)
				: null,
		});
	}
}

/** The first letter in capitals ("contacted today" becomes "Contacted today"). */
function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
