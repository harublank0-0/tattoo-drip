import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { formatMoney } from "#modules/projects/quotes";
import type { SessionRuleReason } from "#modules/scheduling/errors";
import type { SessionKind } from "#modules/scheduling/models/project_session";

/**
 * The project statuses that take every kind of session from staff (TAT-85
 * part 2): before booking, booked, and in progress (a long tattoo's next
 * sitting). A healing check takes touch-ups only (TAT-111); completed,
 * declined and cancelled projects take none (schedulableKinds).
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

/** Every session kind, in the schedule form's order. */
const ALL_KINDS: readonly SessionKind[] = [
	"tattoo",
	"consultation",
	"touch_up",
];

/**
 * The session kinds staff may schedule on a project in `status`, in the
 * schedule form's order: every kind while it is open, touch-ups only during
 * its healing check (TAT-111), none once it is completed, declined or
 * cancelled. The Sessions card offers exactly these.
 */
export function schedulableKinds(
	status: ProjectStatus,
): readonly SessionKind[] {
	if (SCHEDULABLE_STATUSES.includes(status)) return ALL_KINDS;
	return status === "healing_check" ? ["touch_up"] : [];
}

/**
 * Why a project in `status` takes no new `kind` session, or null when it
 * does: "touch_ups_only" during a healing check, "project_finished" once
 * completed, "project_closed" when declined or cancelled.
 */
export function scheduleRefusal(
	status: ProjectStatus,
	kind: SessionKind,
): SessionRuleReason | null {
	if (schedulableKinds(status).includes(kind)) return null;
	if (status === "healing_check") return "touch_ups_only";
	return status === "completed" ? "project_finished" : "project_closed";
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
	withAmount = true,
}: {
	kind: SessionKind;
	booked: boolean;
	projectStatus: ProjectStatus;
	depositDue: number;
	/** False for an artist: they are sent no money (TAT-108), so the note says "due", not how much. */
	withAmount?: boolean;
}): string {
	if (kind !== "tattoo") return "";
	if (booked) return " The project is booked.";
	if (projectStatus === "deposit_pending") {
		if (depositDue <= 0) {
			return " The project is booked once its deposit is settled.";
		}
		return withAmount
			? ` ${formatMoney(depositDue)} of the deposit is still due: the project is booked once it's paid.`
			: " The deposit is still due: the project is booked once it's paid.";
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
	withAmount = true,
): string | null {
	if (status === "healing_check") {
		return "The healing check takes touch-up sessions only.";
	}
	if (BEFORE_ACCEPTANCE.includes(status)) {
		return "A tattoo session holds the date. The project is booked once the client accepts the quote and the deposit is settled.";
	}
	if (status === "deposit_pending") {
		if (!hasQuote) {
			return "A tattoo session holds the date. The project is booked once its deposit is settled.";
		}
		if (depositDue <= 0)
			return "Scheduling a tattoo session books the project.";
		return withAmount
			? `A tattoo session holds the date. The project is booked once the deposit is paid: ${formatMoney(depositDue)} still due.`
			: "A tattoo session holds the date. The project is booked once the deposit is paid.";
	}
	if (status === "in_progress") {
		return "Scheduling the next tattoo session books the project again.";
	}
	return null;
}
