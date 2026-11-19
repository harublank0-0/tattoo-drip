import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownStudioReview } from "#modules/reviews/services/public_review_service";
import { freshInkPostObject } from "#transformers/public_fresh_ink_post_transformer";

/**
 * A client's review as the studio's own page shows it (openapi.yaml,
 * StudioReview; Reviews and Fresh ink, slice 3). Every field is written out
 * here: a new one needs the contract, a ruling and the exact-fields test.
 * The review's own id is shown (the page's cursor already carries it); never
 * the client's id, full name, phone or email, the project's id, the consents,
 * the report, the takedown record or the dispute record. The artist is a
 * visible artist's slug and name, never their id. `freshInk` is the
 * client's post of the same project while the page shows it too (the link
 * design, docs/superpowers/specs/2026-11-19-review-fresh-ink-link-design.md).
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
			// The client's Fresh ink of the same project, exactly as listFreshInk writes it.
			freshInk: review.freshInk ? freshInkPostObject(review.freshInk) : null,
		};
	}
}
