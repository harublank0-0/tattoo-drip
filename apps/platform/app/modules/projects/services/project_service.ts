import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import { QuoteRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import type Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { isExpired, QUOTABLE_STATUSES } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService, {
	type NewQuote,
} from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";
import { withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

type TenantRef = Pick<Tenant, "id">;

/** Who is asking: their user and their role in the tenant. */
export type Member = Pick<TenantMembership, "userId" | "role">;

/**
 * The way to find a tenant's projects and move them through the quote steps
 * of their lifecycle (TAT-64): issue, accept and expire. TAT-46 adds the
 * rest (hold, decline, notes). Every write locks the project row first, the
 * same order as SessionService, so a concurrent accept, revision, expiry or
 * session change serializes on that row.
 */
@inject()
export default class ProjectService {
	constructor(
		private artists: ArtistService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private sessions: SessionService,
	) {}

	/**
	 * The tenant's live project with this id, if `member` may open it: owners
	 * see every project, an artist only the projects assigned to their own
	 * live artist profile. Anything else throws E_ROW_NOT_FOUND (a 404), the
	 * same as another tenant's project.
	 */
	async findFor(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<TattooProject> {
		const query = TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", id);
		if (member.role !== "owner") {
			const profiles = await this.artists.list(tenant);
			const mine = profiles.find(({ userId }) => userId === member.userId);
			// No profile of their own: no project is theirs.
			if (mine) query.where("artist_id", mine.id);
			else query.whereRaw("false");
		}
		return query.firstOrFail();
	}

	/**
	 * Issues the project's next quote version. There are no drafts: saving is
	 * sending. Allowed while the project is `reviewing`, `quoted`, `on_hold`
	 * or `deposit_pending` (else QuoteRuleError "project_closed"), and only
	 * for a quote that has not expired yet ("expired"). The project becomes
	 * `quoted`, so a revision after the client accepted must be accepted
	 * again. Queues ExpireQuoteJob for the quote's expiry in the same
	 * transaction, so a rolled-back save leaves no job.
	 */
	async issueQuote(
		tenant: TenantRef,
		project: TattooProject,
		input: NewQuote,
	): Promise<Quote> {
		assertProjectOf(tenant, project);
		if (isExpired(input)) throw new QuoteRuleError("expired");
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			if (!QUOTABLE_STATUSES.includes(live.status)) {
				throw new QuoteRuleError("project_closed");
			}
			const quote = await this.quotes.create(trx, tenant, live, input);
			await setStatus(live, "quoted");
			await dispatchInTransaction(
				ExpireQuoteJob.dispatch({
					tenantId: tenant.id,
					projectId: live.id,
					quoteId: quote.id,
				}).in(Math.max(0, quote.expiresAt.toMillis() - Date.now())),
				trx,
			);
			return quote;
		});
	}

	/**
	 * What ExpireQuoteJob does once a quote's expiry passes. Cancels the
	 * project if `quoteId` is still its current quote, that quote has
	 * expired, and the client never accepted it (`quoted`, `on_hold`) or
	 * accepted but never paid (`deposit_pending` with the deposit not
	 * settled). The project's scheduled sessions are cancelled first, so the
	 * artist's time is free. Anything else, a missing or deleted project
	 * included, changes nothing: the job is safe to repeat, and the jobs of
	 * revised quotes do nothing. Returns whether it cancelled.
	 */
	async expireQuote(
		tenant: TenantRef,
		projectId: string,
		quoteId: string,
	): Promise<boolean> {
		return withTransaction(async (trx) => {
			const project = await TattooProject.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", projectId)
				.forUpdate()
				.first();
			if (!project) return false;
			const quote = await this.quotes.current(tenant, project);
			if (!quote || quote.id !== quoteId || !isExpired(quote)) return false;
			if (!(await this.expiryCancels(tenant, project))) return false;

			for (const session of await this.sessions.listForProject(
				tenant,
				project,
			)) {
				if (session.status === "scheduled") {
					await this.sessions.cancel(tenant, session);
				}
			}
			await setStatus(project, "cancelled");
			return true;
		});
	}

	/** Whether an expired quote cancels a project in its current status. */
	private async expiryCancels(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		if (project.status === "quoted" || project.status === "on_hold") {
			return true;
		}
		if (project.status === "deposit_pending") {
			return !(await this.deposits.isSettled(tenant, project));
		}
		return false;
	}
}

/**
 * Changes a locked project's status. The row came from a `forUpdate` read in
 * the same transaction, so it saves there.
 */
async function setStatus(project: TattooProject, status: ProjectStatus) {
	project.status = status;
	await project.save();
}

/**
 * Locks the live project row. A deleted or other tenant's project is a 404.
 */
function lockProject(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return TattooProject.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}
