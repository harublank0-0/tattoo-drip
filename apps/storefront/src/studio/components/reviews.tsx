import { ArrowRight, Star } from "lucide-react";
import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import { isAllowedHref, reviewsHref } from "../links.ts";
import {
	HOME_REVIEWS_COUNT,
	type RatingView,
	type ReviewsView,
	type ReviewView,
} from "../reviews.ts";

/**
 * Client reviews on the studio's own page (Reviews and Fresh ink, slice 3):
 * the pieces every theme draws them with (the stars, the average, one
 * review with its reply, the list) and Stencil & Ink's section. Props only
 * and no state, so `react-dom/server` tests render them. A review is plain
 * text (`user-text`: its line breaks kept, never markup); its stars say
 * "4 out of 5" to a screen reader and are drawn at least as text, so the
 * rating never rests on colour. Never review structured data: the studio's
 * own site is not eligible (ruling 10). A theme styles these by its own
 * classes around them (each theme's stylesheet scopes `.client-review*` under its
 * section), so the markup stays one.
 */

/** "Tattoo by " before the artist's link: the name itself is the link. */
const TATTOO_BY = studioCopy.reviews.tattooBy.replace("{artist}", "");

/**
 * Five stars, `rating` of them filled. With a `label` ("4 out of 5") a
 * screen reader hears it once, as text; without one the stars are
 * decoration beside words that already say it (the average's line).
 */
export function ReviewStars({
	rating,
	label,
}: {
	rating: number;
	label: string | null;
}) {
	const stars = (
		<span className="client-review-stars-row" aria-hidden="true">
			{[1, 2, 3, 4, 5].map((n) => (
				<Star
					key={n}
					data-on={n <= rating ? "" : undefined}
					fill={n <= rating ? "currentColor" : "none"}
					strokeWidth={1.75}
				/>
			))}
		</span>
	);
	if (label === null)
		return <span className="client-review-stars">{stars}</span>;
	return (
		<span className="client-review-stars">
			<span className="sr-only">{label}</span>
			{stars}
		</span>
	);
}

/** The studio's average from 3 reviews: its stars and "4.7 from 12 reviews". */
export function RatingSummary({ rating }: { rating: RatingView }) {
	return (
		<p className="client-review-summary">
			<ReviewStars rating={Math.round(rating.average)} label={null} />
			<span className="client-review-summary-text">{rating.text}</span>
		</p>
	);
}

/**
 * One review: its stars, the client's words, their shown name and the
 * month, the artist who made the tattoo (a link to their page, while the
 * studio shows them) and the studio's reply under it.
 */
export function ReviewItem({
	review,
	studioName,
}: {
	review: ReviewView;
	studioName: string;
}) {
	const artist =
		review.artist && isAllowedHref(review.artist.href) ? review.artist : null;
	return (
		<article className="client-review">
			<ReviewStars rating={review.rating} label={review.ratingText} />
			<p className="client-review-body user-text" dir="auto">
				{review.body}
			</p>
			<p className="client-review-by">
				<bdi className="client-review-name">{review.name}</bdi>
				{review.date ? (
					<>
						<span aria-hidden="true"> · </span>
						<time
							className="client-review-date"
							dateTime={review.date.dateTime}
						>
							{review.date.text}
						</time>
					</>
				) : null}
			</p>
			{artist ? (
				<p className="client-review-artist">
					{TATTOO_BY}
					<a className="text-link" href={artist.href}>
						<bdi>{artist.name}</bdi>
					</a>
				</p>
			) : null}
			{review.reply ? (
				<div className="client-review-reply">
					<p className="client-review-reply-label">
						<Fill
							template={studioCopy.reviews.reply}
							values={{ studio: studioName }}
						/>
					</p>
					<p className="client-review-reply-body user-text" dir="auto">
						{review.reply.body}
					</p>
				</div>
			) : null}
		</article>
	);
}

/** The reviews as a list, newest first, in the API's order (never "best first"). */
export function ReviewList({
	reviews,
	studioName,
	className = "client-review-list",
}: {
	reviews: readonly ReviewView[];
	studioName: string;
	className?: string;
}) {
	if (reviews.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className={className} role="list" aria-label={studioCopy.reviews.list}>
			{reviews.map((review) => (
				<li key={review.id}>
					<ReviewItem review={review} studioName={studioName} />
				</li>
			))}
		</ul>
	);
}

/** "All reviews", to `/reviews`: only when more follow than the section shows. */
export function AllReviewsLink({
	view,
	className = "text-link",
}: {
	view: ReviewsView;
	className?: string;
}) {
	if (view.nextCursor === null) return null;
	return (
		<a className={className} href={reviewsHref({})}>
			<span>{studioCopy.reviews.all}</span>
			<ArrowRight aria-hidden="true" />
		</a>
	);
}

/**
 * Stencil & Ink's Reviews section (the `reviews` key): the average from 3
 * reviews, the newest six, and "All reviews" when more follow. Nothing when
 * there are none (reviews off, none allowed on the studio's page, a failed
 * read): no empty heading.
 */
export function ReviewsSection({
	view,
	studioName,
}: {
	view: ReviewsView;
	studioName: string;
}) {
	const reviews = view.reviews.slice(0, HOME_REVIEWS_COUNT);
	if (reviews.length === 0) return null;
	return (
		<section id="reviews" className="section" aria-labelledby="reviews-title">
			<h2 id="reviews-title" className="section-title">
				{studioCopy.reviews.title}
			</h2>
			{view.rating ? <RatingSummary rating={view.rating} /> : null}
			<ReviewList reviews={reviews} studioName={studioName} />
			{view.nextCursor !== null ? (
				<p className="work-all">
					<AllReviewsLink view={view} />
				</p>
			) : null}
		</section>
	);
}
