import { DateTime } from "luxon";
import type { ProjectRuleReason } from "#modules/projects/errors";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { formatDay, formatMoney } from "#modules/projects/quotes";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

/**
 * Finishing a project (TAT-111, which also covers TAT-87): the owner marks
 * the tattoo finished (`in_progress` to `healing_check`), then closes its
 * healing check (`healing_check` to `completed`). Pure, so the rules are
 * unit-tested; ProjectService applies them under the project's row lock and
 * the project page offers only what they allow.
 */
export const FINISH_STEPS = {
	finish: { from: "in_progress", to: "healing_check" },
	complete: { from: "healing_check", to: "completed" },
} as const;
export type FinishStep = keyof typeof FINISH_STEPS;

/** A finished project: in its healing check, or completed. */
export const FINISHED_STATUSES: readonly ProjectStatus[] = [
	"healing_check",
	"completed",
];

/** Days from the last tattoo session to its healing check. */
export const HEALING_CHECK_DAYS = 28;

/** Why a step is refused: the status moved on, a session waits, or the balance changed. */
export type FinishRefusal = Extract<
	ProjectRuleReason,
	"move_not_allowed" | "session_scheduled" | "balance_changed"
>;

/** What finishRefusal reads, from the locked project. */
export type FinishFacts = {
	status: ProjectStatus;
	/** A session of any kind is still scheduled. */
	sessionScheduled: boolean;
	/** What is still owed now, in paisa (owed): 0n when nothing is. */
	due: bigint;
	/** What the owner's confirmation named, in paisa; null when the page sent nothing. */
	confirmedDue: bigint | null;
};

/** What a step did, for its flash. */
export type FinishResult = {
	/** The healing check's day (yyyy-MM-dd), or null without a completed tattoo session. */
	dueOn: string | null;
	/** What is still owed, in paisa. */
	due: bigint;
	/** The balance is an hourly estimate. */
	estimated: boolean;
};

/** The step a project in `status` offers, or null. */
export function finishStepFor(status: ProjectStatus): FinishStep | null {
	if (status === FINISH_STEPS.finish.from) return "finish";
	if (status === FINISH_STEPS.complete.from) return "complete";
	return null;
}

/**
 * Why `step` can't be taken now, or null when it can; the first rule that
 * fails wins. The project must still be in the step's status (a second tap
 * or a stale tab finds it moved on), no session may be scheduled, and money
 * still owed must be exactly what the owner confirmed: a payment recorded or
 * reversed since the page loaded changes it. Nothing owed needs no
 * confirmation.
 */
export function finishRefusal(
	step: FinishStep,
	facts: FinishFacts,
): FinishRefusal | null {
	if (facts.status !== FINISH_STEPS[step].from) return "move_not_allowed";
	if (facts.sessionScheduled) return "session_scheduled";
	if (facts.due > 0n && facts.confirmedDue !== facts.due) {
		return "balance_changed";
	}
	return null;
}

/**
 * What is still owed of a balance due (Balance.due): the amount when above
 * zero, else 0n (paid in full, overpaid, or no price).
 */
export function owed(due: bigint | null): bigint {
	return due !== null && due > 0n ? due : 0n;
}

/** What healingCheckDueOn reads of a session. */
type SessionFacts = {
	kind: SessionKind;
	status: SessionStatus;
	endsAt: DateTime;
};

/**
 * The day the healing check is due (yyyy-MM-dd in the studio's timezone):
 * HEALING_CHECK_DAYS after the local day the latest completed tattoo session
 * ended, or null without one. Touch-ups and consultations don't move it.
 * Computed on every read, never stored.
 */
export function healingCheckDueOn(
	sessions: readonly SessionFacts[],
	timezone: string,
): string | null {
	let last: DateTime | null = null;
	for (const session of sessions) {
		if (session.kind !== "tattoo" || session.status !== "completed") continue;
		if (last === null || session.endsAt.toMillis() > last.toMillis()) {
			last = session.endsAt;
		}
	}
	if (last === null) return null;
	const day = last.setZone(timezone).toFormat("yyyy-MM-dd");
	return DateTime.fromISO(day, { zone: "utc" })
		.plus({ days: HEALING_CHECK_DAYS })
		.toFormat("yyyy-MM-dd");
}

/** The flash's sentence about money still owed; "" when nothing is. */
export function owedNote(due: bigint, estimated: boolean): string {
	if (due <= 0n) return "";
	return ` ${formatMoney(due)} of the ${estimated ? "estimated " : ""}balance is still due: record it under Payments when it's paid.`;
}

/** The flash after a step. */
export function finishedFlash(step: FinishStep, result: FinishResult): string {
	const owing = owedNote(result.due, result.estimated);
	if (step === "complete") {
		return `Healing check done: the project is completed.${owing}`;
	}
	const check = result.dueOn
		? `the healing check is due ${formatDay(result.dueOn)}`
		: "the healing check is next";
	return `Tattoo finished: ${check}. Send the aftercare message from Message the client.${owing}`;
}
