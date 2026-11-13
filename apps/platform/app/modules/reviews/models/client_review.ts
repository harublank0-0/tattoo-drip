import { compose } from "@adonisjs/core/helpers";
import { ClientReviewSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import type { ReportReason, TakedownReason } from "#modules/reviews/rules";

/**
 * A client's review of a project (Reviews and Fresh ink, rulings 5 and 6):
 * one live review per project, written through the project's review link.
 * The client's delete is a soft delete for the studio's record; nothing
 * public reads a deleted one. Read and change it through ClientReviewService.
 */
export default class ClientReview extends compose(
	ClientReviewSchema,
	withSoftDeletes,
) {
	declare reportReason: ReportReason | null;
	declare takedownReason: TakedownReason | null;
}
