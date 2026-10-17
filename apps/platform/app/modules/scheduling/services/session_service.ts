import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
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

const OVERLAP = "project_sessions_artist_no_overlap";

/** Projects that take no new sessions. */
const CLOSED: ProjectStatus[] = ["declined", "cancelled"];

/**
 * The way to read and change a tenant's sessions. Every call is scoped to
 * the tenant, and every write runs in a transaction that first locks the
 * project row and then the session row, always in that order. Overlaps are
 * settled by the database: the exclusion constraint raises, and the error
 * becomes SessionOverlapError after the failed savepoint has rolled back.
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
	 * Adds a `scheduled` session. A declined or cancelled project refuses
	 * (SessionRuleError "project_closed"); a project without an artist gets
	 * this session's artist. Throws SessionOverlapError when the artist is
	 * busy, and E_ROW_NOT_FOUND for an unknown or deleted artist or project.
	 */
	async schedule(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
	): Promise<ProjectSession> {
		assertRange(input);
		assertProjectOf(tenant, project);
		const artist = await this.artists.findFor(tenant, input.artistId);
		try {
			return await withTransaction(async (trx) => {
				const live = await lockProject(trx, tenant, project.id);
				if (CLOSED.includes(live.status)) {
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
				if (input.kind === "tattoo") {
					if (live.status === "in_progress") await setStatus(live, "booked");
					else await this.moveToBooked(tenant, live);
				}
				return session;
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * Moves a scheduled session to another time (the same artist; another
	 * artist is cancel plus schedule).
	 */
	async reschedule(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		assertRange(times);
		assertSessionOf(tenant, session);
		try {
			return await withTransaction(async (trx) => {
				await lockProject(trx, tenant, session.projectId);
				const live = await lockScheduled(trx, tenant, session.id);
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

	/** `scheduled` to `completed`. The time it occupied stays blocked. */
	complete(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "completed");
	}

	/** `scheduled` to `no_show`. The time is free again. */
	markNoShow(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "no_show");
	}

	/** `scheduled` to `cancelled`. The time is free again. */
	cancel(tenant: TenantRef, session: ProjectSession) {
		return this.finish(tenant, session, "cancelled");
	}

	private async finish(
		tenant: TenantRef,
		session: ProjectSession,
		to: Exclude<SessionStatus, "scheduled">,
	): Promise<ProjectSession> {
		assertSessionOf(tenant, session);
		return withTransaction(async (trx) => {
			const project = await lockProject(trx, tenant, session.projectId);
			const live = await lockScheduled(trx, tenant, session.id);
			live.status = to;
			await live.save();
			// The status change flips the generated `active`: read it back.
			await live.refresh();
			if (
				to === "completed" &&
				live.kind === "tattoo" &&
				project.status === "booked"
			) {
				await setStatus(project, "in_progress");
			}
			return live;
		});
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
 * Locks the live session row and checks it is still `scheduled`: the copy a
 * caller holds can be stale, the row decides.
 */
async function lockScheduled(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	const session = await ProjectSession.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
	if (session.status !== "scheduled") {
		throw new SessionRuleError("not_scheduled");
	}
	return session;
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
