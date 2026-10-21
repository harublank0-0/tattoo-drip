import type { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { BOOKED_STATUSES } from "#modules/projects/quotes";
import type { SessionRuleReason } from "#modules/scheduling/errors";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

/** What staff record on a scheduled session (TAT-85), as its new status. */
export const SESSION_OUTCOMES = ["completed", "no_show", "cancelled"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

/** What the rules read of a session. */
type Subject = { status: SessionStatus; kind: SessionKind; startsAt: DateTime };

/**
 * Why `outcome` can't be recorded on `session` now, or null when it can.
 * An outcome is final ("not_scheduled"); done and no-show wait for the
 * session's start ("not_started"; there is no later limit, so yesterday's
 * session is recorded today); and tattoo work is done only on a project
 * that is booked or later ("not_booked": custom work is never booked
 * before its deposit, and the expiry would cancel a deposit_pending project
 * with finished work). SessionService enforces it under its row locks; the
 * project page offers only what it allows.
 */
export function outcomeRefusal(
	session: Subject,
	projectStatus: ProjectStatus,
	outcome: SessionOutcome,
	now: DateTime,
): SessionRuleReason | null {
	if (session.status !== "scheduled") return "not_scheduled";
	if (outcome === "cancelled") return null;
	if (session.startsAt.toMillis() > now.toMillis()) return "not_started";
	if (
		outcome === "completed" &&
		session.kind === "tattoo" &&
		!BOOKED_STATUSES.includes(projectStatus)
	) {
		return "not_booked";
	}
	return null;
}

/** The outcomes that can be recorded on `session` now, in button order. */
export function outcomesFor(
	session: Subject,
	projectStatus: ProjectStatus,
	now: DateTime,
): SessionOutcome[] {
	return SESSION_OUTCOMES.filter(
		(outcome) => outcomeRefusal(session, projectStatus, outcome, now) === null,
	);
}

/**
 * Who may record an outcome on a session or move it: owners any session;
 * an artist member only a session with their own linked live profile
 * (`ownArtistId`, null without one), on a project assigned to that profile
 * (the project page they can open). The record rule behind the sessions
 * entries of TENANT_ROUTE_ROLES (#modules/tenancy/access, TAT-30).
 */
export function mayChangeSession(
	member: { role: string },
	ownArtistId: string | null,
	session: { artistId: string },
	project: { artistId: string | null },
): boolean {
	if (member.role === "owner") return true;
	return (
		ownArtistId !== null &&
		session.artistId === ownArtistId &&
		project.artistId === ownArtistId
	);
}
