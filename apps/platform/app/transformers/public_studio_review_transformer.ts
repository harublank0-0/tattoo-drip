import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownStudioReview } from "#modules/reviews/services/public_review_service";

/**
 * A client's review as the studio's own page shows it (openapi.yaml,
 * StudioReview; Reviews and Fresh ink, slice 3). Every field is written out
 * here: a new one needs the contract, a ruling and the exact-fields test.
 * The review's own id is shown (the page's cursor already carries it); never
 * the client's id, full name, phone or email, the project's id, the consents,
 * the report, the takedown record or the dispute record. The artist is a
 * visible artist's slug and name, never their id.
 */
export default class PublicStudioReviewTransformer extends BaseTransformer<ShownStudioReview> {
	toObject() {
		const review = this.resource;
		return {
			id: review.id,
			rating: review.rating,
			body: review.body,
			shownName: review.shownName,
			date: review.date,
			artist: review.artist
				? { slug: review.artist.slug, name: review.artist.name }
				: null,
			reply: review.reply
				? { body: review.reply.body, date: review.reply.date }
				: null,
		};
	}
}
