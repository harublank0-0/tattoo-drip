import { BaseTransformer } from "@adonisjs/core/transformers";
import type ClientPost from "#modules/reviews/models/client_post";
import type ClientReview from "#modules/reviews/models/client_review";
import {
	postContentEditable,
	TAKEDOWN_SENTENCES,
	type TakedownReason,
} from "#modules/reviews/rules";
import type { ReviewPage } from "#modules/reviews/services/review_page_service";

/**
 * The client's review page (openapi.yaml, ReviewPage; Reviews and Fresh
 * ink, slice 1), field by field: what the link's holder wrote and posted,
 * the studio's name, the artist's and the day. Never the client's full
 * name, phone or email, the studio's reply or report (later slices), the
 * operator's takedown note, file keys, or the post's declined/unpublished
 * difference (ruling 7: the client reads "not shown by the studio").
 */
export default class PublicReviewPageTransformer extends BaseTransformer<ReviewPage> {
	toObject() {
		const page = this.resource;
		return {
			studio: { name: page.studioName, onDiscover: page.listedOnDiscover },
			project: {
				artistName: page.artistName,
				tattooedOn: page.tattooedOn,
			},
			link: { expiresAt: page.linkExpiresAt.toUTC().toISO() },
			styles: page.styles.map(({ slug, name }) => ({ slug, name })),
			defaults: {
				shownName: page.defaults.shownName,
				styles: [...page.defaults.styles],
				placement: page.defaults.placement,
			},
			review: page.review ? reviewOf(page.review) : null,
			post: page.post ? postOf(page.post.post, page.post.media) : null,
			blocks: { review: page.blocks.review, post: page.blocks.post },
		};
	}
}

function reviewOf(review: ClientReview) {
	return {
		rating: review.rating,
		body: review.body,
		shownName: review.shownName,
		consentStudioPage: review.consentStudioPage,
		consentDiscover: review.consentDiscover,
		takenDown: takedownOf(review),
		createdAt: review.createdAt.toUTC().toISO(),
		updatedAt: (review.updatedAt ?? review.createdAt).toUTC().toISO(),
	};
}

function postOf(
	post: ClientPost,
	media: NonNullable<ReviewPage["post"]>["media"],
) {
	return {
		status:
			post.submittedAt === null
				? "draft"
				: post.status === "waiting" || post.status === "approved"
					? post.status
					: "not_shown",
		caption: post.caption,
		styles: [...post.styles],
		placement: post.placement,
		shownName: post.shownName,
		consentStudioPage: post.consentStudioPage,
		consentDiscover: post.consentDiscover,
		takenDown: takedownOf(post),
		editable: postContentEditable(post),
		media: media.map((item) => ({
			id: item.id,
			kind: item.kind,
			state: item.state,
			failure: item.failure,
			image: item.image
				? {
						url: item.image.url,
						width: item.image.width,
						height: item.image.height,
						alt: null,
						variants: item.image.variants.map(({ url, width }) => ({
							url,
							width,
						})),
					}
				: null,
			sources: item.sources.map(({ url, type, width, height }) => ({
				url,
				type,
				width,
				height,
			})),
			durationMs: item.durationMs,
		})),
	};
}

function takedownOf(item: {
	takenDownAt: ClientReview["takenDownAt"];
	takedownReason: TakedownReason | null;
}) {
	if (!item.takenDownAt || !item.takedownReason) return null;
	return {
		reason: item.takedownReason,
		sentence:
			TAKEDOWN_SENTENCES[item.takedownReason] ?? TAKEDOWN_SENTENCES.other,
		at: item.takenDownAt.toUTC().toISO(),
	};
}
