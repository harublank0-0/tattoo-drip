import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { formatMoney } from "#modules/projects/quotes";
import type { SessionRuleReason } from "#modules/scheduling/errors";
import type { SessionKind } from "#modules/scheduling/models/project_session";

/**
 * The project statuses that take a new session from staff (TAT-85 part
 * 2): before booking, booked, and in progress (a long tattoo's next
 * sitting). Completed and healing-check projects wait for the
 * finish-project ticket; declined and cancelled ones are closed.
 */
export const SCHEDULABLE_STATUSES: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
];

/** Not accepted yet: a tattoo session holds the date. */
const BEFORE_ACCEPTANCE: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
];

/** Why a project in `status` takes no new session, or null when it does. */
export function scheduleRefusal(
	status: ProjectStatus,
): SessionRuleReason | null {
	if (SCHEDULABLE_STATUSES.includes(status)) return null;
	return status === "completed" || status === "healing_check"
		? "project_finished"
		: "project_closed";
}

/**
 * The flash's second sentence after scheduling, in the payments screen's
 * words: what a tattoo session did to the project, or what it still waits
 * for. `depositDue` is in paisa (DepositService.remaining).
 */
export function scheduledNote({
	kind,
	booked,
	projectStatus,
	depositDue,
}: {
	kind: SessionKind;
	booked: boolean;
	projectStatus: ProjectStatus;
	depositDue: number;
}): string {
	if (kind !== "tattoo") return "";
	if (booked) return " The project is booked.";
	if (projectStatus === "deposit_pending") {
		return depositDue > 0
			? ` ${formatMoney(depositDue)} of the deposit is still due: the project is booked once it's paid.`
			: " The project is booked once its deposit is settled.";
	}
	if (BEFORE_ACCEPTANCE.includes(projectStatus)) {
		return " It holds the date: the project is booked once the client accepts the quote and the deposit is settled.";
	}
	return "";
}

/**
 * The schedule form's hint: what a tattoo session will do to the project.
 * For `deposit_pending` it reads the booking rule's own inputs
 * (DepositService.isSettled): `hasQuote` is whether the project has a quote
 * and `depositDue` what is left of its deposit. A project with no quote is
 * not settled, so the session would not book it; scheduledNote says the
 * same in the flash.
 */
export function schedulingHint(
	status: ProjectStatus,
	depositDue: number,
	hasQuote: boolean,
): string | null {
	if (BEFORE_ACCEPTANCE.includes(status)) {
		return "A tattoo session holds the date. The project is booked once the client accepts the quote and the deposit is settled.";
	}
	if (status === "deposit_pending") {
		if (!hasQuote) {
			return "A tattoo session holds the date. The project is booked once its deposit is settled.";
		}
		return depositDue > 0
			? `A tattoo session holds the date. The project is booked once the deposit is paid: ${formatMoney(depositDue)} still due.`
			: "Scheduling a tattoo session books the project.";
	}
	if (status === "in_progress") {
		return "Scheduling the next tattoo session books the project again.";
	}
	return null;
}
