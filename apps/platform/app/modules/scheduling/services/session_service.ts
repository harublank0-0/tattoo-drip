import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type { Member } from "#modules/projects/services/project_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
import {
	mayChangeSession,
	outcomeRefusal,
	type SessionOutcome,
} from "#modules/scheduling/outcomes";
import { scheduleRefusal } from "#modules/scheduling/schedule_rules";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isExclusionViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

export type SessionTimes = { startsAt: DateTime; endsAt: DateTime };
export type NewSession = SessionTimes & {
	artistId: string;
	kind: SessionKind;
};

/** A calendar window: half-open [from, to), one artist or (null) all. */
export type SessionWindow = {
	from: DateTime;
	to: DateTime;
	artistId: string | null;
};

/**
 * What recording an outcome did (TAT-85): the session as stored, the
 * project's status afterwards, and whether the outcome moved the project.
 */
export type Recorded = {
	session: ProjectSession;
	projectStatus: ProjectStatus;
	projectMoved: boolean;
};

/**
 * What scheduling did (TAT-85 part 2): the session, the project's status
 * afterwards, and whether this call booked the project.
 */
export type Scheduled = {
	session: ProjectSession;
	projectStatus: ProjectStatus;
	booked: boolean;
};

/** Sessions per status, every status present (0 when none). */
export type StatusCounts = Record<SessionStatus, number>;

/** countByStatus's answer: the studio's counts, and each artist's who has a session in the window. */
export type SessionCounts = {
	studio: StatusCounts;
	byArtist: Map<string, StatusCounts>;
};

const noCounts = (): StatusCounts => ({
	scheduled: 0,
	completed: 0,
	no_show: 0,
	cancelled: 0,
});

/** A member recording an outcome, and the clock to judge its start by (tests pass one). */
type Actor = { member: Member; now?: DateTime };

const OVERLAP = "project_sessions_artist_no_overlap";

/** Projects that take no new sessions. */
const CLOSED: ProjectStatus[] = ["declined", "cancelled"];

/**
 * The way to read and change a tenant's sessions. Every call is scoped to
 * the tenant, and every write runs in a transaction that first locks the
 * project row and then the session row, always in that order. Overlaps are
 * settled by the database: the exclusion constraint raises, and the error
 * becomes SessionOverlapError after the failed savepoint has rolled back.
 * Members record outcomes and move sessions through findChangeable,
 * recordOutcome and move (TAT-85), which check mayChangeSession; complete,
 * markNoShow, cancel and reschedule are the system's calls.
 */
@inject()
export default class SessionService {
	constructor(
		private artists: ArtistService,
		private deposits: DepositService,
	) {}

	/**
	 * The tenant's live session with this id. An unknown id, a deleted
	 * session and another tenant's session all throw E_ROW_NOT_FOUND (a 404).
	 */
	async findFor(tenant: TenantRef, id: string): Promise<ProjectSession> {
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * The live session with this id if `member` may change it (TAT-85):
	 * owners any session of a live project; an artist only a session with
	 * their own linked live profile, on a project assigned to that profile
	 * (mayChangeSession). Anything else, another tenant's id, a deleted
	 * session and a session of a deleted project included, throws
	 * E_ROW_NOT_FOUND (a 404). Controllers call it before reading the form;
	 * recordOutcome and move check again under the row locks.
	 */
	async findChangeable(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<ProjectSession> {
		const session = await this.findFor(tenant, id);
		const project = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", session.projectId)
			.firstOrFail();
		await this.assertMayChange(tenant, member, project, session);
		return session;
	}

	/**
	 * The project's live sessions, earliest first.
	 */
	async listForProject(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<ProjectSession[]> {
		assertProjectOf(tenant, project);
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * The project's next session (TAT-110, the paid deposit page): its
	 * earliest live `scheduled` session that hasn't ended at `now`, of any
	 * kind, or null. One query on the (tenant_id, project_id) index.
	 */
	async nextScheduled(
		tenant: TenantRef,
		project: TattooProject,
		now: DateTime = DateTime.utc(),
	): Promise<ProjectSession | null> {
		assertProjectOf(tenant, project);
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("status", "scheduled")
			.where("ends_at", ">", now.toJSDate())
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc")
			.first();
	}

	/**
	 * The tenant's active sessions (scheduled or completed, not deleted) that
	 * take time in the half-open window, earliest first: the calendar
	 * (TAT-50). The overlap is the no-overlap constraint's own expression, so
	 * its gist index (artist, time range, where active) serves one artist's
	 * window; no other index was added.
	 */
	async listInRange(
		tenant: TenantRef,
		{ from, to, artistId }: SessionWindow,
	): Promise<ProjectSession[]> {
		const query = ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("active", true)
			.whereRaw(
				"tstzrange(starts_at, ends_at) && tstzrange(?::timestamptz, ?::timestamptz)",
				[from.toJSDate(), to.toJSDate()],
			);
		if (artistId !== null) query.where("artist_id", artistId);
		return query.orderBy("starts_at", "asc").orderBy("id", "asc");
	}

	/**
	 * The ids among `projectIds` that have a `scheduled` tattoo session: the
	 * projects board flags a booked project that has none.
	 */
	async projectsWithScheduledTattoo(
		tenant: TenantRef,
		projectIds: string[],
	): Promise<Set<string>> {
		if (projectIds.length === 0) return new Set();
		const rows = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.whereIn("project_id", projectIds)
			.where("kind", "tattoo")
			.where("status", "scheduled")
			.select("project_id");
		return new Set(rows.map(({ projectId }) => projectId));
	}

	/**
	 * The first scheduled session that has not started yet (any kind) of each of
	 * `projectIds`, by project id; a project without one has no entry. One
	 * query for many projects: the Projects list's "Next session" (TAT-109).
	 * Pass only projects the member may open.
	 */
	async nextScheduledFor(
		tenant: TenantRef,
		projectIds: string[],
		now: DateTime = DateTime.now(),
	): Promise<Map<string, ProjectSession>> {
		if (projectIds.length === 0) return new Map();
		const rows = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.whereIn("project_id", projectIds)
			.where("status", "scheduled")
			// Not started: one under way is not "next" (the calendar and Today show it).
			.where("starts_at", ">", now.toJSDate())
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc");
		const next = new Map<string, ProjectSession>();
		for (const session of rows) {
			if (!next.has(session.projectId)) next.set(session.projectId, session);
		}
		return next;
	}

	/**
	 * How many of the tenant's live sessions start in the half-open window
	 * [from, to), per status, for the studio and per artist: the pilot's
	 * no-show rate (TAT-70) and the no-show report (TAT-76). Counted by
	 * `starts_at`, so a session recorded late counts in the period it was
	 * booked for; one grouped query, served by the (tenant_id, starts_at)
	 * index. The rate is no_show / (completed + no_show), the caller's.
	 */
	async countByStatus(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<SessionCounts> {
		const rows = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("starts_at", ">=", from.toJSDate())
			.where("starts_at", "<", to.toJSDate())
			.select("artist_id", "status")
			.count("* as total")
			.groupBy("artist_id", "status");
		const studio = noCounts();
		const byArtist = new Map<string, StatusCounts>();
		for (const row of rows) {
			// count(*) is int8, which node-pg returns as a string.
			const total = Number(row.$extras.total);
			studio[row.status] += total;
			const artist = byArtist.get(row.artistId) ?? noCounts();
			artist[row.status] += total;
			byArtist.set(row.artistId, artist);
		}
		return { studio, byArtist };
	}

	/**
	 * Adds a `scheduled` session: the system's call (TAT-43's booking). A
	 * declined or cancelled project refuses (SessionRuleError
	 * "project_closed"); a project without an artist gets this session's
	 * artist. Throws SessionOverlapError when the artist is busy, and
	 * E_ROW_NOT_FOUND for an unknown or deleted artist or project.
	 */
	async schedule(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
	): Promise<ProjectSession> {
		return (await this.add(tenant, project, input, null)).session;
	}

	/**
	 * schedule for a member, from the project page (TAT-85 part 2). Under the
	 * project's lock `member` must be allowed the new session
	 * (mayChangeSession: owners any; an artist only with their own profile
	 * on a project assigned to it; E_ROW_NOT_FOUND otherwise), and the
	 * project must take new sessions (scheduleRefusal: SessionRuleError
	 * "project_closed", "project_finished", or "touch_ups_only" for anything
	 * but a touch-up during a healing check). A tattoo session then books
	 * the project when it can, in the same transaction: in_progress to
	 * booked, or deposit_pending to booked once the deposit is settled
	 * (moveToBooked). SessionOverlapError after the savepoint rolled back.
	 */
	scheduleFor(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		input: NewSession,
	): Promise<Scheduled> {
		return this.add(tenant, project, input, member);
	}

	/**
	 * Moves a scheduled session to another time (the same artist; another
	 * artist is cancel plus schedule). The system's call: no member check.
	 */
	reschedule(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		return this.changeTime(tenant, session, times, null);
	}

	/**
	 * reschedule for a member (TAT-85): under the row locks `member` must
	 * still be allowed to change the session (mayChangeSession, a 404
	 * otherwise); then the time changes. SessionOverlapError when the artist
	 * is busy, after the savepoint rolled back; SessionRuleError
	 * "not_scheduled" once the session has an outcome. The project's status
	 * never changes.
	 */
	move(
		tenant: TenantRef,
		member: Member,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		return this.changeTime(tenant, session, times, member);
	}

	/** `scheduled` to `completed`. The time it occupied stays blocked. */
	async complete(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "completed", null)).session;
	}

	/** `scheduled` to `no_show`. The time is free again. */
	async markNoShow(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "no_show", null)).session;
	}

	/** `scheduled` to `cancelled`. The time is free again. */
	async cancel(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "cancelled", null)).session;
	}

	/**
	 * Records what happened to a scheduled session, for a member (TAT-85).
	 * Under the row locks `member` must still be allowed to change it (a 404
	 * otherwise); then outcomeRefusal decides: SessionRuleError
	 * "not_scheduled" once it has an outcome, "not_started" before its start
	 * (the server's clock, read after the locks), "not_booked" for tattoo
	 * work on a project that isn't booked yet. A tattoo session's outcome
	 * then applies the work rule (followTattooWork).
	 */
	recordOutcome(
		tenant: TenantRef,
		member: Member,
		session: ProjectSession,
		outcome: SessionOutcome,
		now?: DateTime,
	): Promise<Recorded> {
		return this.finish(tenant, session, outcome, { member, now });
	}

	/**
	 * Moves a `deposit_pending` project to `booked` when it has a scheduled
	 * tattoo session and its deposit is settled. Returns whether it moved.
	 * `schedule` calls it; so does whatever verifies a deposit (TAT-65), so
	 * the move happens at the later of the two events. Calling it again, or
	 * for a project in another status, changes nothing.
	 */
	async settleBooking(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			return this.moveToBooked(tenant, live);
		});
	}

	/**
	 * Inserts a scheduled session under the project's lock: schedule's body
	 * (member null: only declined and cancelled projects refuse) and
	 * scheduleFor's (the member check, then scheduleRefusal).
	 */
	private async add(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
		member: Member | null,
	): Promise<Scheduled> {
		assertRange(input);
		assertProjectOf(tenant, project);
		const artist = await this.artists.findFor(tenant, input.artistId);
		try {
			return await withTransaction(async (trx) => {
				const live = await lockProject(trx, tenant, project.id);
				if (member) {
					await this.assertMayChange(tenant, member, live, {
						artistId: artist.id,
					});
					const refusal = scheduleRefusal(live.status, input.kind);
					if (refusal) throw new SessionRuleError(refusal);
				} else if (CLOSED.includes(live.status)) {
					throw new SessionRuleError("project_closed");
				}
				if (!live.artistId) {
					live.artistId = artist.id;
					await live.save();
				}
				const session = await ProjectSession.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						artistId: artist.id,
						kind: input.kind,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
					},
					{ client: trx },
				);
				// Lucid reads nothing back after an insert: load the column default
				// and the generated `active`, so the session we return is true.
				await session.refresh();
				const before = live.status;
				if (input.kind === "tattoo") {
					if (live.status === "in_progress") await setStatus(live, "booked");
					else await this.moveToBooked(tenant, live);
				}
				return {
					session,
					projectStatus: live.status,
					booked: before !== "booked" && live.status === "booked",
				};
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * A new time for a scheduled session, under the project's lock and then
	 * the session's; with a member, mayChangeSession is checked first.
	 */
	private async changeTime(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
		member: Member | null,
	): Promise<ProjectSession> {
		assertRange(times);
		assertSessionOf(tenant, session);
		try {
			return await withTransaction(async (trx) => {
				const project = await lockProject(trx, tenant, session.projectId);
				const live = await lockSession(trx, tenant, session.id);
				if (member) await this.assertMayChange(tenant, member, project, live);
				assertScheduled(live);
				live.merge({ startsAt: times.startsAt, endsAt: times.endsAt });
				await live.save();
				// Lucid reads nothing back after an update either; `active` is the
				// database's to compute.
				await live.refresh();
				return live;
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * Sets a scheduled session's outcome, under the project's lock and then
	 * the session's. With an actor (recordOutcome) the member check and the
	 * outcome rules come first; without one it is the system's call. An
	 * outcome on a tattoo session then applies the work rule.
	 */
	private async finish(
		tenant: TenantRef,
		session: ProjectSession,
		to: SessionOutcome,
		actor: Actor | null,
	): Promise<Recorded> {
		assertSessionOf(tenant, session);
		return withTransaction(async (trx) => {
			const project = await lockProject(trx, tenant, session.projectId);
			const live = await lockSession(trx, tenant, session.id);
			if (actor) {
				await this.assertMayChange(tenant, actor.member, project, live);
				// The clock is read once the locks are held: waiting for them can
				// outlast a start time.
				const refusal = outcomeRefusal(
					live,
					project.status,
					to,
					actor.now ?? DateTime.now(),
				);
				if (refusal) throw new SessionRuleError(refusal);
			}
			assertScheduled(live);
			live.status = to;
			await live.save();
			// The status change flips the generated `active`: read it back.
			await live.refresh();
			const before = project.status;
			if (live.kind === "tattoo") await this.followTattooWork(tenant, project);
			return {
				session: live,
				projectStatus: project.status,
				projectMoved: project.status !== before,
			};
		});
	}

	/**
	 * The work rule (TAT-85): a booked project whose tattoo work has started
	 * (a completed tattoo session) and has no tattoo session still scheduled
	 * is in progress. With another tattoo session scheduled it stays booked,
	 * the status scheduling that session gives it anyway (the in_progress to
	 * booked shortcut), so the status doesn't depend on the order things
	 * happened in. A booked project with no completed tattoo session (its
	 * only one was missed or cancelled) stays booked, and the projects list
	 * flags it. The caller holds the project's lock and passes the live row.
	 */
	private async followTattooWork(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<void> {
		if (project.status !== "booked") return;
		const tattoo = () =>
			ProjectSession.query()
				.where("tenant_id", tenant.id)
				.where("project_id", project.id)
				.where("kind", "tattoo");
		if (await tattoo().where("status", "scheduled").first()) return;
		if (await tattoo().where("status", "completed").first()) {
			await setStatus(project, "in_progress");
		}
	}

	/**
	 * mayChangeSession for `member`; an artist's own profile is the live one
	 * linked to their account. E_ROW_NOT_FOUND (a 404) when they may not.
	 */
	private async assertMayChange(
		tenant: TenantRef,
		member: Member,
		project: Pick<TattooProject, "artistId">,
		session: Pick<ProjectSession, "artistId">,
	): Promise<void> {
		const own =
			member.role === "owner"
				? null
				: ((await this.artists.list(tenant)).find(
						({ userId }) => userId === member.userId,
					)?.id ?? null);
		if (!mayChangeSession(member, own, session, project)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(ProjectSession);
		}
	}

	/**
	 * The `deposit_pending` to `booked` rule. The caller holds the project's
	 * row lock and passes the live row.
	 */
	private async moveToBooked(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		if (project.status !== "deposit_pending") return false;
		const tattoo = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "tattoo")
			.where("status", "scheduled")
			.first();
		if (!tattoo) return false;
		if (!(await this.deposits.isSettled(tenant, project))) return false;
		await setStatus(project, "booked");
		return true;
	}
}

/**
 * Changes a locked project's status. The row came from `lockProject`, so it
 * saves in the same transaction.
 */
async function setStatus(project: TattooProject, status: ProjectStatus) {
	project.status = status;
	await project.save();
}

/**
 * Written so that an invalid DateTime (NaN milliseconds) fails too.
 */
function assertRange({ startsAt, endsAt }: SessionTimes) {
	if (!(endsAt.toMillis() > startsAt.toMillis())) {
		throw new SessionRuleError("invalid_range");
	}
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
 * Locks the live session row. The copy a caller holds can be stale: the
 * locked row decides.
 */
function lockSession(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return ProjectSession.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/** Only a scheduled session changes; the other statuses are final. */
function assertScheduled(session: ProjectSession) {
	if (session.status !== "scheduled") {
		throw new SessionRuleError("not_scheduled");
	}
}

/**
 * Turns the exclusion violation into the error callers handle. Runs after
 * withTransaction rolled its savepoint back.
 */
function rethrowOverlap(error: unknown): never {
	if (isExclusionViolation(error, OVERLAP)) throw new SessionOverlapError();
	throw error;
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}

function assertSessionOf(tenant: TenantRef, session: ProjectSession) {
	if (session.tenantId !== tenant.id) {
		throw new Error(`Session ${session.id} belongs to another tenant`);
	}
}
