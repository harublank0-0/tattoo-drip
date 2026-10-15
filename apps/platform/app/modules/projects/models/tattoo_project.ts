import { compose } from "@adonisjs/core/helpers";
import { TattooProjectSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const PROJECT_STATUSES = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
	"completed",
	"healing_check",
	"declined",
	"cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The sale of one tattoo: a client, an optional artist, the brief and a
 * lifecycle status. There is no `inquiry` status: the inquiry is its own
 * record. The quote moves (to `quoted`, `deposit_pending`, and `cancelled` on
 * expiry) live in ProjectService (TAT-64); the manual moves (hold, resume,
 * decline, withdraw) are in moves.ts and ProjectService.move (TAT-46).
 * `softDelete()` does not cascade to the project's sessions or reference
 * images yet (only `Tenant.softDelete` does); nothing deletes projects from
 * the dashboard, and TAT-42 defines the cascade before anything does.
 */
export default class TattooProject extends compose(
	TattooProjectSchema,
	withSoftDeletes,
) {
	declare status: ProjectStatus;
}
