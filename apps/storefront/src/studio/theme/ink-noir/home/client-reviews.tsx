import {
	AllReviewsLink,
	RatingSummary,
	ReviewList,
} from "../../../components/reviews.tsx";
import { studioCopy } from "../../../copy.ts";
import { HOME_REVIEWS_COUNT, type ReviewsView } from "../../../reviews.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { SectionHead } from "./parts.tsx";

/**
 * Ink Noir's Reviews (Reviews and Fresh ink, slice 3): the average from 3
 * reviews set large in the display face beside the section's head, then the
 * newest reviews as raised dark cards on the 12-column idea, each opened by
 * an accent quotation mark, its stars in the accent. Newest first, never
 * "best first"; no structured data. Nothing when there is nothing to show.
 */
export function InkNoirReviews({
	view,
	studioName,
}: {
	view: ReviewsView;
	studioName: string;
}) {
	const reviews = view.reviews.slice(0, HOME_REVIEWS_COUNT);
	if (reviews.length === 0) return null;
	return (
		<section
			id="reviews"
			className="ink-section ink-reviews"
			aria-labelledby="reviews-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead
						id="reviews-title"
						label={inkNoirHomeCopy.reviews.eyebrow}
					>
						{studioCopy.reviews.title}
					</SectionHead>
					{view.rating ? <RatingSummary rating={view.rating} /> : null}
				</div>
				<ReviewList
					reviews={reviews}
					studioName={studioName}
					className="client-review-list ink-review-list"
				/>
				{view.nextCursor !== null ? (
					<p className="ink-reviews-all">
						<AllReviewsLink view={view} className="ink-link" />
					</p>
				) : null}
			</div>
		</section>
	);
}
