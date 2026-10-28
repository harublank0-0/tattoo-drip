import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { type ContactVia, NO_VIA } from "#modules/notifications/messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import {
	DepositFloorError,
	ProjectRuleError,
	QuoteRuleError,
} from "#modules/projects/errors";
import { EXPIRING_STATUSES, expiryCancels } from "#modules/projects/expiry";
import {
	FINISH_STEPS,
	type FinishResult,
	type FinishStep,
	finishRefusal,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import type Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	ACTIVE_STATUSES,
	CLOSED_STATUSES,
	MANUAL_MOVES,
	type ManualMove,
	type ProjectFilter,
} from "#modules/projects/moves";
import {
	artistDepositFloor,
	BOOKED_STATUSES,
	expiresAtFor,
	isExpired,
	newQuoteAmounts,
	QUOTABLE_STATUSES,
	type QuoteAmounts,
	quoteTotal,
	todayIn,
} from "#modules/projects/quotes";
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

/** A tenant with its default deposit: the artist's deposit floor is a share of it (TAT-16). */
type TenantDeposit = Pick<Tenant, "id" | "defaultDepositPercent">;

/** A tenant with its timezone: the healing check's day is the studio's. */
type TenantZone = Pick<Tenant, "id" | "timezone">;

/** What a finish step did (TAT-111): the new status and what its flash needs. */
export type Finished = FinishResult & { status: ProjectStatus };

/** Who is asking: their user and their role in the tenant. */
export type Member = Pick<TenantMembership, "userId" | "role">;

/** The project columns `listActive` reads: what waiting.ts and Today's rows use. */
const WAITING_COLUMNS = [
	"id",
	"tenant_id",
	"client_id",
	"artist_id",
	"status",
	"created_at",
	"last_contacted_at",
	"last_contact_channel",
	"last_contact_kind",
];

/** Projects per page on the projects list. */
export const PROJECTS_PER_PAGE = 25;

type ProjectQuery = ReturnType<typeof TattooProject.query>;

/**
 * The way to find and list a tenant's projects and move them through their
 * lifecycle: the quote steps (TAT-64: issue, accept and expire) and the
 * manual moves (TAT-46: hold, resume, decline, withdraw), finishing (TAT-111:
 * finish and close the healing check), plus the artist, notes and contact
 * time. Every write locks the project row first, the
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
		const query = TattooProject.query().where("id", id);
		await this.scopeTo(query, tenant, member);
		return query.firstOrFail();
	}

	/**
	 * The live projects among `ids` that `member` may open (the `findFor`
	 * rule), in no particular order: the calendar shows a session's client
	 * and brief only for these (TAT-50).
	 */
	async findManyFor(
		tenant: TenantRef,
		member: Member,
		ids: string[],
	): Promise<TattooProject[]> {
		if (ids.length === 0) return [];
		const query = TattooProject.query().whereIn("id", ids);
		await this.scopeTo(query, tenant, member);
		return query;
	}

	/**
	 * The tenant's live project with this id, for code that acts for no
	 * member (the public deposit page, TAT-65), or null for an unknown,
	 * deleted or other tenant's id. Never use it to answer a member: findFor
	 * applies their role.
	 */
	async findLive(tenant: TenantRef, id: string): Promise<TattooProject | null> {
		return TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
	}

	/**
	 * findLive with the row locked until `trx` ends: the lock every project
	 * write takes first, so a deposit proof serializes with an accept, a
	 * revision, an expiry or a verification of the same project.
	 */
	async lockLive(
		trx: TransactionClientContract,
		tenant: TenantRef,
		id: string,
	): Promise<TattooProject | null> {
		return TattooProject.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.forUpdate()
			.first();
	}

	/**
	 * A page of the projects `member` may see (the `findFor` rule), for the
	 * Active view, the Closed view or one status. Active and open
	 * single-status views sort for follow-up: never contacted first, then the
	 * longest since contact; the Closed view and each closed status (declined,
	 * cancelled, completed) sort the most recently changed first.
	 */
	async list(
		tenant: TenantRef,
		member: Member,
		filter: ProjectFilter,
		page: number,
	): Promise<{ projects: TattooProject[]; total: number; lastPage: number }> {
		const query = TattooProject.query();
		await this.scopeTo(query, tenant, member);
		if (filter === "active") query.whereIn("status", [...ACTIVE_STATUSES]);
		else if (filter === "closed") query.whereIn("status", [...CLOSED_STATUSES]);
		else query.where("status", filter);

		if (
			filter === "closed" ||
			(filter !== "active" && CLOSED_STATUSES.includes(filter))
		) {
			query
				.orderByRaw("coalesce(updated_at, created_at) desc")
				.orderBy("id", "desc");
		} else {
			query
				.orderByRaw("last_contacted_at asc nulls first")
				.orderBy("created_at", "asc")
				.orderBy("id", "asc");
		}
		const result = await query.paginate(page, PROJECTS_PER_PAGE);
		return {
			projects: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/**
	 * Today's read (TAT-107): every live active project `member` may see (the
	 * `findFor` rule), oldest first, not paginated: it is a studio's open
	 * work, a few dozen rows at a pilot's scale. An owner also gets a closed
	 * project that still holds a deposit screenshot nobody decided (the client
	 * withdrew while it waited): the money is theirs to settle, so it stays
	 * their work until they do. Artists never act on money, so a closed project
	 * stays closed for them. Rows carry only the columns the waiting rules and
	 * Today's rows read (`WAITING_COLUMNS`): the badge asks for this on every
	 * page, so it skips the brief and notes.
	 */
	async listActive(
		tenant: TenantRef,
		member: Member,
	): Promise<TattooProject[]> {
		const query = TattooProject.query().select(WAITING_COLUMNS);
		await this.scopeTo(query, tenant, member);
		query.where((open) => {
			open.whereIn("status", [...ACTIVE_STATUSES]);
			if (member.role === "owner") {
				open.orWhereIn("id", this.deposits.pendingProofProjects(tenant));
			}
		});
		return query.orderBy("created_at", "asc").orderBy("id", "asc");
	}

	/**
	 * The sort keys of every live project in an open view that `member` may
	 * see (the `findFor` rule), oldest first: the Projects list's Active and
	 * single-status views (TAT-109). Unpaginated because the list orders them
	 * by what waits (WaitingService.work) and cuts the page afterwards; the
	 * page's full rows come from `findManyFor`.
	 */
	async listKeys(
		tenant: TenantRef,
		member: Member,
		filter: "active" | ProjectStatus,
	): Promise<
		Pick<TattooProject, "id" | "status" | "createdAt" | "lastContactedAt">[]
	> {
		const query = TattooProject.query().select(
			"id",
			"status",
			"created_at",
			"last_contacted_at",
		);
		await this.scopeTo(query, tenant, member);
		if (filter === "active") query.whereIn("status", [...ACTIVE_STATUSES]);
		else query.where("status", filter);
		return query.orderBy("created_at", "asc").orderBy("id", "asc");
	}

	/** How many live projects `member` may see, per status. */
	async countByStatus(
		tenant: TenantRef,
		member: Member,
	): Promise<Partial<Record<ProjectStatus, number>>> {
		const query = TattooProject.query();
		await this.scopeTo(query, tenant, member);
		const rows = await query
			.select("status")
			.count("* as total")
			.groupBy("status");
		return Object.fromEntries(
			rows.map((row) => [row.status, Number(row.$extras.total)]),
		);
	}

	/**
	 * A `reviewing` project for an accepted inquiry. InquiryService.accept
	 * calls it inside its own transaction, holding the inquiry's lock; the
	 * artist was already checked there. The project is new, so there is
	 * nothing to lock. It starts from the inquiry's last contact (TAT-52), so
	 * the "received" message staff sent shows on the project too.
	 */
	async createFromInquiry(
		tenant: TenantRef,
		input: {
			clientId: string;
			inquiryId: string;
			brief: string;
			artistId: string | null;
			lastContact?: { at: DateTime | null } & ContactVia;
		},
	): Promise<TattooProject> {
		return TattooProject.create({
			tenantId: tenant.id,
			clientId: input.clientId,
			inquiryId: input.inquiryId,
			brief: input.brief,
			artistId: input.artistId,
			status: "reviewing",
			lastContactedAt: input.lastContact?.at ?? null,
			lastContactChannel: input.lastContact?.channel ?? null,
			lastContactKind: input.lastContact?.kind ?? null,
		});
	}

	/** The live projects made from these inquiries, by inquiry id. */
	async projectIdsForInquiries(
		tenant: TenantRef,
		inquiryIds: string[],
	): Promise<Map<string, string>> {
		if (inquiryIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("inquiry_id", inquiryIds)
			.select("id", "inquiry_id");
		return new Map(rows.map((row) => [row.inquiryId as string, row.id]));
	}

	/**
	 * How many live projects were booked at the desk in [from, to): made
	 * directly (TAT-43), with no inquiry. The pilot's link share (TAT-70).
	 */
	async countBookedAtDesk(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<number> {
		const [row] = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereNull("inquiry_id")
			.where("created_at", ">=", from.toJSDate())
			.where("created_at", "<", to.toJSDate())
			// The soft-delete scope is a fetch hook; say it here too, for the aggregate.
			.whereNull("deleted_at")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The inquiry each of these live projects was made from, by project id; desk bookings are left out (TAT-70). */
	async inquiryIdsFor(
		tenant: TenantRef,
		projectIds: string[],
	): Promise<Map<string, string>> {
		if (projectIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("id", projectIds)
			.whereNotNull("inquiry_id")
			.select("id", "inquiry_id");
		return new Map(rows.map((row) => [row.id, row.inquiryId as string]));
	}

	/**
	 * The client's live projects, newest first (the client profile, TAT-41).
	 * The clients pages are owners only, so there is no member scoping here.
	 */
	async forClient(
		tenant: TenantRef,
		clientId: string,
	): Promise<TattooProject[]> {
		return TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("client_id", clientId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
	}

	/** How many live projects each of these clients has. */
	async countsForClients(
		tenant: TenantRef,
		clientIds: string[],
	): Promise<Map<string, number>> {
		if (clientIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("client_id", clientIds)
			.select("client_id")
			.count("* as total")
			.groupBy("client_id");
		return new Map(
			rows.map((row) => [row.clientId, Number(row.$extras.total)]),
		);
	}

	/** When each of these clients' live projects last changed. */
	async lastChangeForClients(
		tenant: TenantRef,
		clientIds: string[],
	): Promise<Map<string, DateTime>> {
		if (clientIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("client_id", clientIds)
			.select("client_id")
			.max("updated_at as latest")
			.groupBy("client_id");
		return new Map(
			rows.map((row) => [row.clientId, toDateTime(row.$extras.latest)]),
		);
	}

	/**
	 * Issues the project's next quote version. There are no drafts: saving is
	 * sending. Allowed while the project is `reviewing`, `quoted`, `on_hold`
	 * or `deposit_pending` (else QuoteRuleError "project_closed"), and only
	 * for a quote that has not expired yet ("expired", checked again once the
	 * lock is held: waiting for it can outlast the expiry). `baseQuoteId` is
	 * the quote the form was showing (null when it showed none): when the
	 * project's current quote is a different one, someone else revised first
	 * and saving this form would resurrect stale terms ("quote_changed"). The
	 * project becomes `quoted`, so a revision after the client accepted must
	 * be accepted again. Queues ExpireQuoteJob for the quote's expiry in the
	 * same transaction, so a rolled-back save leaves no job. An artist's
	 * deposit must be at least the studio's default share of the total
	 * (artistDepositFloor; DepositFloorError, checked under the lock after the
	 * assignment and status checks and before anything is stored), so only an
	 * owner quotes less or no deposit (TAT-16); artists keep quoting.
	 */
	async issueQuote(
		tenant: TenantDeposit,
		member: Member,
		project: TattooProject,
		input: NewQuote,
		baseQuoteId: string | null,
	): Promise<Quote> {
		assertProjectOf(tenant, project);
		if (isExpired(input)) throw new QuoteRuleError("expired");
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			if (!QUOTABLE_STATUSES.includes(live.status)) {
				throw new QuoteRuleError("project_closed");
			}
			// After the assignment and status checks, so a project that can't be quoted
			// says so; before anything is written.
			assertDepositFloor(
				tenant,
				member,
				newQuoteAmounts(input),
				input.depositAmount,
			);
			const current = await this.quotes.current(tenant, live);
			if ((current?.id ?? null) !== baseQuoteId) {
				throw new QuoteRuleError("quote_changed");
			}
			if (isExpired(input)) throw new QuoteRuleError("expired");
			const quote = await this.quotes.create(trx, tenant, live, input);
			await setStatus(live, "quoted");
			await queueExpiry(trx, tenant, quote);
			return quote;
		});
	}

	/**
	 * The client accepted the quote they were shown (`quoteId`): the project
	 * moves from `quoted` to `deposit_pending`, then settleBooking books it at
	 * once if the deposit is already settled (or zero) and a tattoo session
	 * is scheduled. QuoteRuleError "not_quoted" outside `quoted`,
	 * "quote_changed" when `quoteId` is no longer the current quote (revised
	 * since the page loaded), "expired" once its expiry has passed. An artist
	 * may mark accepted only a quote that meets their deposit floor, by the
	 * studio's default now (DepositFloorError; otherwise an owner confirms it,
	 * TAT-16). Returns the project's new status.
	 */
	async acceptQuote(
		tenant: TenantDeposit,
		member: Member,
		project: TattooProject,
		quoteId: string,
	): Promise<ProjectStatus> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			if (live.status !== "quoted") throw new QuoteRuleError("not_quoted");
			const quote = await this.quotes.current(tenant, live);
			if (!quote || quote.id !== quoteId) {
				throw new QuoteRuleError("quote_changed");
			}
			if (isExpired(quote)) throw new QuoteRuleError("expired");
			assertDepositFloor(tenant, member, quote, quote.depositAmount);

			await setStatus(live, "deposit_pending");
			const booked = await this.sessions.settleBooking(tenant, live);
			return booked ? "booked" : "deposit_pending";
		});
	}

	/**
	 * Records the price of a project booked without one (TAT-43's direct
	 * booking): quote version 1, fixed, no deposit, valid through today in
	 * the studio's timezone. Only for a booked-or-later project with no quote
	 * (QuoteRuleError "price_locked" otherwise, checked under the lock), so
	 * quotes stay locked once a project is booked: the price is set once. No
	 * status change and no ExpireQuoteJob (expiry never acts from booked on).
	 * Owners and the assigned artist, as for quotes.
	 */
	async setPrice(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		project: TattooProject,
		fixedPrice: number,
	): Promise<Quote> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			if (
				!BOOKED_STATUSES.includes(live.status) ||
				(await this.quotes.current(tenant, live))
			) {
				throw new QuoteRuleError("price_locked");
			}
			return this.quotes.create(trx, tenant, live, {
				kind: "fixed",
				fixedPrice,
				depositAmount: 0,
				expiresAt: expiresAtFor(todayIn(tenant.timezone), tenant.timezone),
			});
		});
	}

	/**
	 * What ExpireQuoteJob does once a quote's expiry passes. Cancels the
	 * project if `quoteId` is still its current quote, that quote has
	 * expired, and the client never accepted it (`quoted`, `on_hold`) or
	 * accepted but never paid (`deposit_pending` with the deposit not
	 * settled). A deposit that was paid is never cancelled by expiry, not
	 * even on a `quoted` project that was revised after the client paid. Nor
	 * is a project whose deposit screenshot waits, or whose deposit the
	 * studio verified, recorded, rejected or reversed after the expiry
	 * (TAT-66): the owner who decided late chooses what happens next, so a
	 * later sweep run changes nothing. The
	 * project's scheduled sessions are cancelled first, so the artist's time
	 * is free. A run before the current quote's expiry (this process's clock
	 * behind the one that queued the job) queues the job again for the rest
	 * of the time. Anything else, a missing or deleted project included,
	 * changes nothing: the job is safe to repeat, and the jobs of revised
	 * quotes do nothing. Returns whether it cancelled.
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
			if (!quote || quote.id !== quoteId) return false;
			if (!isExpired(quote)) {
				// Early: this clock is behind the one that queued the job (skew
				// between hosts, or a clock stepped back). Run again at the expiry
				// instead of finishing.
				await queueExpiry(trx, tenant, quote);
				return false;
			}
			if (!(await this.expiryCancels(tenant, project, quote))) return false;

			await this.cancelScheduledSessions(tenant, project);
			await setStatus(project, "cancelled");
			return true;
		});
	}

	/**
	 * A manual move (TAT-46): hold, resume, decline or the client withdrew.
	 * The project's live status must be one the moves table allows, else
	 * ProjectRuleError "move_not_allowed" (a stale page, or another tab got
	 * there first). A client may withdraw while the project holds deposit
	 * money: the owner then records the deposit's outcome
	 * (PaymentService.recordOutcome, TAT-66). Declining and withdrawing cancel
	 * the project's
	 * scheduled sessions first, so the artist's time is free. Returns the new
	 * status.
	 */
	async move(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		move: ManualMove,
	): Promise<ProjectStatus> {
		assertProjectOf(tenant, project);
		const rule = MANUAL_MOVES[move];
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			if (!rule.from.includes(live.status)) {
				throw new ProjectRuleError("move_not_allowed");
			}
			if (rule.cancelsSessions) {
				await this.cancelScheduledSessions(tenant, live);
			}
			await setStatus(live, rule.to);
			return rule.to;
		});
	}

	/**
	 * Owners only (TAT-111's finish routes): anyone else gets E_ROW_NOT_FOUND
	 * (a 404). The controller calls it before it validates a body, so the
	 * assigned artist gets the same 404 whatever they post; finish and
	 * completeHealingCheck check again. TAT-30 turns it into a capability.
	 */
	requireOwner(member: Member): void {
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
		}
	}

	/**
	 * The owner marks the tattoo finished (TAT-111): `in_progress` to
	 * `healing_check`. `confirmedDue` is the balance due the page's
	 * confirmation named, in paisa (null when it named none). See finishStep.
	 */
	finish(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		return this.finishStep(tenant, member, project, "finish", confirmedDue);
	}

	/**
	 * The owner closes the healing check (TAT-111): `healing_check` to
	 * `completed`, with the same rules as finish.
	 */
	completeHealingCheck(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		return this.finishStep(tenant, member, project, "complete", confirmedDue);
	}

	/**
	 * Whether the project holds verified deposit money: the current quote's
	 * deposit payments, net of reversals, are above zero in the quote's
	 * currency. A project with no quote holds none. The withdraw flash asks
	 * for the deposit's outcome when it is true.
	 */
	async depositHeld(
		tenant: TenantRef,
		project: Pick<TattooProject, "id">,
	): Promise<boolean> {
		const quote = await this.quotes.current(tenant, project);
		if (!quote) return false;
		return (
			(await this.deposits.verifiedPaid(tenant, project, quote.currency)) > 0
		);
	}

	/**
	 * Assigns the project's artist, or none (`artistId` null). Owners only:
	 * anyone else gets E_ROW_NOT_FOUND (a 404, like another artist's
	 * project). The artist must be one of the tenant's live profiles
	 * (ArtistService.findFor, a 404 otherwise). The project's sessions keep
	 * their own artist.
	 */
	async assignArtist(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		artistId: string | null,
	): Promise<void> {
		assertProjectOf(tenant, project);
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
		}
		const artist =
			artistId === null ? null : await this.artists.findFor(tenant, artistId);
		await withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			live.artistId = artist?.id ?? null;
			await live.save();
		});
	}

	/** Replaces the project's notes; blank notes clear them. */
	async updateNotes(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		notes: string | null,
	): Promise<void> {
		assertProjectOf(tenant, project);
		const text = notes?.trim() || null;
		await withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			live.notes = text;
			await live.save();
		});
	}

	/**
	 * Records that the client was contacted now: the chat links call it as
	 * they open, with the channel and the message (TAT-52), and staff tap
	 * "Mark contacted" after a call or a visit (`NO_VIA`).
	 */
	async markContacted(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		via: ContactVia = NO_VIA,
	): Promise<void> {
		assertProjectOf(tenant, project);
		await withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			live.lastContactedAt = DateTime.now();
			live.lastContactChannel = via.channel;
			live.lastContactKind = via.kind;
			await live.save();
		});
	}

	/**
	 * Whether the expired `quote` cancels a project in its current status.
	 * Only `quoted`, `on_hold` and `deposit_pending` projects can be
	 * cancelled, and none whose deposit decision is owed or came late
	 * (DepositService.expirySpared: a screenshot waits, or the studio verified,
	 * recorded, rejected or reversed a deposit after the expiry; TAT-66): the
	 * owner decides what happens next. What the money decides is `expiryCancels`
	 * (#modules/projects/expiry), which Today's rules share.
	 */
	private async expiryCancels(
		tenant: TenantRef,
		project: TattooProject,
		quote: Quote,
	): Promise<boolean> {
		if (!EXPIRING_STATUSES.includes(project.status)) return false;
		if (await this.deposits.expirySpared(tenant, project, quote)) return false;
		// The money rule is shared with Today (TAT-107): see expiryCancels.
		return expiryCancels({
			status: project.status,
			depositAmount: quote.depositAmount,
			depositSettled: await this.deposits.isSettled(tenant, project),
		});
	}

	/**
	 * One finish step (TAT-111), owners only (E_ROW_NOT_FOUND for anyone else,
	 * before the lock). Under the project's row lock, which every project
	 * write takes first, so a session scheduled or a payment recorded in
	 * another tab either came first and is seen here or waits: finishRefusal
	 * decides from the live row, its live sessions and its balance
	 * (ProjectRuleError "move_not_allowed" when the status moved on, as after
	 * a second tap or from a stale tab; "session_scheduled"; "balance_changed"
	 * when money is owed and `confirmedDue` isn't exactly it). Only the status
	 * changes: sessions, payments, quotes and deposit outcomes stay as they
	 * are.
	 */
	private async finishStep(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		step: FinishStep,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		assertProjectOf(tenant, project);
		this.requireOwner(member);
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			const sessions = await this.sessions.listForProject(tenant, live);
			const { balance, estimated } = await this.deposits.balance(tenant, live);
			const due = owed(balance.due);
			const refusal = finishRefusal(step, {
				status: live.status,
				sessionScheduled: sessions.some(({ status }) => status === "scheduled"),
				due,
				confirmedDue,
			});
			if (refusal) throw new ProjectRuleError(refusal);
			await setStatus(live, FINISH_STEPS[step].to);
			return {
				status: live.status,
				due,
				estimated,
				dueOn: healingCheckDueOn(sessions, tenant.timezone),
			};
		});
	}

	/**
	 * Locks the live project and re-checks, under the lock, that `member` may
	 * still act on it. `findFor` authorized the caller before the lock, and a
	 * request that waited for the lock (an owner reassigning the project, say)
	 * would otherwise write to a project that is no longer theirs: a
	 * non-owner needs the project assigned to their own live artist profile
	 * now, else E_ROW_NOT_FOUND (a 404).
	 */
	private async lockFor(
		trx: TransactionClientContract,
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<TattooProject> {
		const live = await lockProject(trx, tenant, id);
		if (member.role !== "owner") {
			const profiles = await this.artists.list(tenant);
			const mine = profiles.find(({ userId }) => userId === member.userId);
			if (!mine || live.artistId !== mine.id) {
				throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
			}
		}
		return live;
	}

	/**
	 * Narrows a projects query to the tenant and to what `member` may see:
	 * everything for an owner, else only the projects assigned to their own
	 * live artist profile (none without one).
	 */
	private async scopeTo(
		query: ProjectQuery,
		tenant: TenantRef,
		member: Member,
	): Promise<void> {
		query.where("tenant_id", tenant.id);
		if (member.role === "owner") return;
		const profiles = await this.artists.list(tenant);
		const mine = profiles.find(({ userId }) => userId === member.userId);
		if (mine) query.where("artist_id", mine.id);
		else query.whereRaw("false");
	}

	/**
	 * Cancels the project's scheduled sessions; completed, no-show and
	 * cancelled ones are history and stay. The caller holds the project lock.
	 */
	private async cancelScheduledSessions(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<void> {
		for (const session of await this.sessions.listForProject(tenant, project)) {
			if (session.status === "scheduled") {
				await this.sessions.cancel(tenant, session);
			}
		}
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
 * Queues ExpireQuoteJob in `trx` for the moment `quote` expires on this
 * process's clock (the one isExpired reads), so the job exists only if the
 * transaction commits.
 */
function queueExpiry(
	trx: TransactionClientContract,
	tenant: TenantRef,
	quote: Quote,
) {
	return dispatchInTransaction(
		ExpireQuoteJob.dispatch({
			tenantId: tenant.id,
			projectId: quote.projectId,
			quoteId: quote.id,
		}).in(Math.max(0, quote.expiresAt.toMillis() - DateTime.now().toMillis())),
		trx,
	);
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

/**
 * The artist deposit floor (TAT-16): an owner may offer any deposit up to the
 * total; an artist at least artistDepositFloor of the studio's default. Reads
 * the member's role, never a request value. Throws before anything is stored.
 */
function assertDepositFloor(
	tenant: TenantDeposit,
	member: Member,
	amounts: QuoteAmounts,
	depositAmount: number,
) {
	if (member.role === "owner") return;
	const percent = tenant.defaultDepositPercent;
	const floor = artistDepositFloor(quoteTotal(amounts), percent);
	if (BigInt(depositAmount) < floor)
		throw new DepositFloorError(floor, percent);
}

/** An aggregate's timestamp, as node-pg returns it (a Date), as a DateTime. */
function toDateTime(value: Date | string): DateTime {
	return value instanceof Date
		? DateTime.fromJSDate(value)
		: DateTime.fromISO(value);
}
