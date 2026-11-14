import { compose } from "@adonisjs/core/helpers";
import { DesignProjectSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import type { ReviewState } from "#modules/design_lab/rules";

/** An artist's Design Lab workspace for one idea (docs/design-lab.md). */
export default class DesignProject extends compose(
	DesignProjectSchema,
	withSoftDeletes,
) {
	declare reviewState: ReviewState;
}
