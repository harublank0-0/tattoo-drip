import { compose } from "@adonisjs/core/helpers";
import { ClientPostSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import type {
	PostStatus,
	ReportReason,
	TakedownReason,
} from "#modules/reviews/rules";

/**
 * A client's Fresh ink post (Reviews and Fresh ink, rulings 5 and 7): one
 * live post per project, its photos and videos in ClientPostMedia. A post
 * the client is still putting together has no `submittedAt`; the studio
 * decides on a submitted one (`status`). Soft-deleted (its media rows and
 * files are deleted). Read and change it through ClientPostService.
 */
export default class ClientPost extends compose(
	ClientPostSchema,
	withSoftDeletes,
) {
	declare status: PostStatus;
	declare reportReason: ReportReason | null;
	declare takedownReason: TakedownReason | null;
}
