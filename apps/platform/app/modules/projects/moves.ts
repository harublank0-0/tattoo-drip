import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";

/**
 * The status changes staff make by hand (TAT-46). Quotes, sessions and
 * expiry make the others, in their own services.
 */
export const MANUAL_MOVE_NAMES = [
	"hold",
	"resume",
	"decline",
	"withdraw",
] as const;
export type ManualMove = (typeof MANUAL_MOVE_NAMES)[number];

export type MoveRule = {
	/** The statuses the move is allowed from. */
	from: readonly ProjectStatus[];
	to: ProjectStatus;
	/** Whether the project's scheduled sessions are cancelled first. */
	cancelsSessions: boolean;
};

/**
 * The manual moves, from the project rules in docs/requirements.md:
 * quoted ⇄ on_hold, reviewing → declined, and a client withdrawing before
 * booking. Declining and withdrawing cancel the scheduled sessions, so the
 * artist's time is free. Withdrawing after booking, or while the project
 * holds deposit money, waits for TAT-66, which records what happens to the
 * deposit (ProjectService.move refuses it as `deposit_paid`).
 */
export const MANUAL_MOVES: Record<ManualMove, MoveRule> = {
	hold: { from: ["quoted"], to: "on_hold", cancelsSessions: false },
	resume: { from: ["on_hold"], to: "quoted", cancelsSessions: false },
	decline: { from: ["reviewing"], to: "declined", cancelsSessions: true },
	withdraw: {
		from: ["reviewing", "quoted", "on_hold", "deposit_pending"],
		to: "cancelled",
		cancelsSessions: true,
	},
};

/** The manual moves a project in `status` can make, in the table's order. */
export function allowedMoves(status: ProjectStatus): ManualMove[] {
	return MANUAL_MOVE_NAMES.filter((move) =>
		MANUAL_MOVES[move].from.includes(status),
	);
}

/** Finished one way or another: out of the board's Active view. */
export const CLOSED_STATUSES: readonly ProjectStatus[] = [
	"declined",
	"cancelled",
	"completed",
];

/** Everything else, `healing_check` included: it still needs a follow-up. */
export const ACTIVE_STATUSES: readonly ProjectStatus[] =
	PROJECT_STATUSES.filter((status) => !CLOSED_STATUSES.includes(status));

/** What the projects list shows: the Active view, the Closed view or one status. */
export type ProjectFilter = "active" | "closed" | ProjectStatus;

/** A filter from the query string; anything unknown is the Active view. */
export function toProjectFilter(value: unknown): ProjectFilter {
	if (value === "active" || value === "closed") return value;
	const status = PROJECT_STATUSES.find((known) => known === value);
	return status ?? "active";
}
