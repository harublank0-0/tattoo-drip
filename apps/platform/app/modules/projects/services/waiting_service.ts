import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import {
	sinceOf,
	WAITING_HASH,
	type Waiting,
	type WaitingFacts,
	waitingOf,
	waitingText,
} from "#modules/projects/waiting";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantZone = Pick<Tenant, "id" | "timezone">;

/** One project and what waits on it. `facts` stays on the server: it holds owner facts. */
export type ProjectWaiting = {
	project: TattooProject;
	facts: WaitingFacts;
	waiting: Waiting | null;
	/** waitingText, or null when nothing waits. */
	text: string | null;
	/** The card on the project page where the member acts (WAITING_HASH), or null. */
	hash: string | null;
	/** How long it has waited: the sort key (sinceOf). */
	since: DateTime;
};

/** A project that something waits on: `waiting` and `text` are set. */
export type WaitingItem<W extends Waiting = Waiting> = ProjectWaiting & {
	waiting: W;
	text: string;
};

type StudioWaiting = Extract<Waiting, { side: "studio" }>;
type ClientWaiting = Extract<Waiting, { side: "client" }>;

/**
 * What waits on a studio's projects, and on whom (TAT-107): Today's "Needs you" and "Waiting on
 * clients", its tab badge, and TAT-109's list line. Asks each module's own service, in at most
 * five queries however many projects: QuoteService.currentFor, DepositService.depositStates,
 * DepositLinkService.statesFor (owners only: artists never get link facts) and
 * SessionService.projectsWithScheduledTattoo, after ProjectService.listActive. The rules are
 * waitingOf (#modules/projects/waiting).
 */
@inject()
export default class WaitingService {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private links: DepositLinkService,
		private sessions: SessionService,
	) {}

	/**
	 * What waits on each of `projects`, by project id (an entry for every one). Pass only projects
	 * `member` may see (ProjectService.list or listActive). `work` calls it for the active projects;
	 * the project page calls it for its one project (TAT-108), so its Next step card says what
	 * Today and the list say: at most four queries either way.
	 */
	async forProjects(
		tenant: TenantZone,
		member: Member,
		projects: TattooProject[],
		now: DateTime = DateTime.now(),
	): Promise<Map<string, ProjectWaiting>> {
		const isOwner = member.role === "owner";
		const idsIn = (statuses: readonly ProjectStatus[]) =>
			projects
				.filter(({ status }) => statuses.includes(status))
				.map(({ id }) => id);
		const quotes = await this.quotes.currentFor(
			tenant,
			idsIn(["quoted", "on_hold", "deposit_pending"]),
		);
		const deposits = await this.deposits.depositStates(
			tenant,
			projects.map(({ id }) => id),
			quotes,
		);
		const links = isOwner
			? await this.links.statesFor(tenant, idsIn(["deposit_pending"]))
			: new Map<string, { madeAt: DateTime; works: boolean }>();
		const withTattoo = await this.sessions.projectsWithScheduledTattoo(
			tenant,
			idsIn(["booked", "deposit_pending"]),
		);
		const context = { isOwner, now, timezone: tenant.timezone };
		return new Map(
			projects.map((project): [string, ProjectWaiting] => {
				const quote = quotes.get(project.id) ?? null;
				const deposit = deposits.get(project.id);
				const facts: WaitingFacts = {
					status: project.status,
					since: project.createdAt,
					proofWaiting: deposit?.proofWaiting ?? false,
					proofSince: deposit?.proofSince ?? null,
					expirySpared: deposit?.expirySpared ?? false,
					quote: quote && {
						issuedAt: quote.createdAt,
						expiresAt: quote.expiresAt,
						depositAmount: quote.depositAmount,
					},
					depositSettled: deposit?.settled ?? false,
					depositLink: links.get(project.id) ?? null,
					scheduledTattoo: withTattoo.has(project.id),
				};
				const waiting = waitingOf(facts, context);
				return [
					project.id,
					{
						project,
						facts,
						waiting,
						text: waiting && waitingText(waiting, facts, now, tenant.timezone),
						hash: waiting && WAITING_HASH[waiting.reason],
						since: waiting ? sinceOf(waiting, facts) : project.createdAt,
					},
				];
			}),
		);
	}

	/**
	 * Every active project `member` may see, split into what needs them and what waits on the
	 * client, each sorted by how long it has waited (oldest first, then by id).
	 */
	async work(
		tenant: TenantZone,
		member: Member,
		now: DateTime = DateTime.now(),
	): Promise<{
		needsYou: WaitingItem<StudioWaiting>[];
		onClient: WaitingItem<ClientWaiting>[];
	}> {
		const projects = await this.projects.listActive(tenant, member);
		const states = await this.forProjects(tenant, member, projects, now);
		const needsYou: WaitingItem<StudioWaiting>[] = [];
		const onClient: WaitingItem<ClientWaiting>[] = [];
		for (const state of states.values()) {
			const { waiting, text } = state;
			if (!waiting || text === null) continue;
			if (waiting.side === "studio") needsYou.push({ ...state, waiting, text });
			else onClient.push({ ...state, waiting, text });
		}
		const oldestFirst = (a: ProjectWaiting, b: ProjectWaiting) =>
			a.since.toMillis() - b.since.toMillis() ||
			a.project.id.localeCompare(b.project.id);
		return {
			needsYou: needsYou.sort(oldestFirst),
			onClient: onClient.sort(oldestFirst),
		};
	}

	/** How many projects need `member` now: the Today tab's badge. */
	async needsYouCount(
		tenant: TenantZone,
		member: Member,
		now: DateTime = DateTime.now(),
	): Promise<number> {
		return (await this.work(tenant, member, now)).needsYou.length;
	}
}
