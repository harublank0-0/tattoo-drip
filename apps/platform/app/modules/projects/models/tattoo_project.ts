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
 * record. The transition rules arrive with TAT-46.
 */
export default class TattooProject extends compose(
	TattooProjectSchema,
	withSoftDeletes,
) {
	declare status: ProjectStatus;
}
