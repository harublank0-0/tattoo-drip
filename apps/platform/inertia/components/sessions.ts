/** What staff record on a scheduled session (TAT-85), as its new status. */
export type SessionOutcomeName = "completed" | "no_show" | "cancelled";

/** A button on a session's row: an outcome, or moving it. */
export type SessionAction = SessionOutcomeName | "move";

/** The row's buttons. */
export const ACTION_LABELS: Record<SessionAction, string> = {
	completed: "Done",
	no_show: "No-show",
	move: "Move",
	cancelled: "Cancel session",
};

/** The confirmation's button. */
export const OUTCOME_CONFIRMS: Record<SessionOutcomeName, string> = {
	completed: "Mark done",
	no_show: "Mark no-show",
	cancelled: "Cancel session",
};

/**
 * The row's buttons in order: Done and No-show (when the server offers
 * them), Move (when the member may move the session), Cancel session.
 */
export function sessionActions(
	outcomes: readonly SessionOutcomeName[],
	canMove: boolean,
): SessionAction[] {
	return [
		...outcomes.filter((outcome) => outcome !== "cancelled"),
		...(canMove ? (["move"] as const) : []),
		...outcomes.filter((outcome) => outcome === "cancelled"),
	];
}

/** The confirmation's question: which session, what changes, and that it's final. */
export function outcomeQuestion(
	outcome: SessionOutcomeName,
	whenText: string,
): string {
	if (outcome === "completed") {
		return `Mark the session on ${whenText} as done? An outcome can't be changed afterwards.`;
	}
	if (outcome === "no_show") {
		return `Mark the session on ${whenText} as a no-show? Its time is freed, and an outcome can't be changed afterwards.`;
	}
	return `Cancel the session on ${whenText}? Its time is freed, and an outcome can't be changed afterwards.`;
}
