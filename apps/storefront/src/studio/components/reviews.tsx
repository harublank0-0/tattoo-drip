import { ArrowRight } from "lucide-react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { studioCopy } from "../copy.ts";
import type { FreshInkPostView } from "../fresh-ink.ts";
import { showPhoto } from "../lightbox.ts";
import { isAllowedHref, reviewsHref } from "../links.ts";
import {
	HOME_REVIEWS_COUNT,
	type RatingView,
	type ReviewsView,
	type ReviewView,
} from "../reviews.ts";
import type { BrandImage } from "../theme/config.ts";

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

import { FreshInkDialog } from "./fresh-ink.tsx";
import { ReviewStars } from "./review-stars.tsx";

// The stars live in review-stars.tsx (the Fresh ink viewer draws them too).
export { ReviewStars } from "./review-stars.tsx";

/** "Tattoo by " before the artist's link: the name itself is the link. */
const TATTOO_BY = studioCopy.reviews.tattooBy.replace("{artist}", "");

/**
 * The studio's average from 3 reviews: "4.7 from 12 reviews", which a screen
 * reader hears as "4.7 out of 5 from 12 reviews", beside the average's whole
 * stars rounded down (decoration: the words say it).
 */
export function RatingSummary({ rating }: { rating: RatingView }) {
	return (
		<p className="client-review-summary">
			<ReviewStars rating={rating.stars} label={null} />
			<span className="client-review-summary-text">
				{rating.averageText}
				<span className="sr-only">{studioCopy.reviews.outOfFive}</span>{" "}
				{rating.fromText}
			</span>
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
			{review.freshInk ? (
				<>
					<ReviewPhotos post={review.freshInk} name={review.name} />
					<FreshInkDialog post={review.freshInk} />
				</>
			) : null}
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

/** The most thumbnails a review's Fresh ink strip shows; past that, "+N". */
const STRIP_THUMBS = 3;
/** A thumbnail's drawn width (styles.css, `.client-review-thumb`): the smallest copy suits it. */
const THUMB_SIZES = "88px";

/**
 * A review's Fresh ink (the link design, 2026-11-19): one button that opens
 * the post's viewer, holding its main photo and up to two more (a video's
 * poster for a video), with "+N" on the last when the post has more. The
 * thumbnails are decoration: the button's name says what it opens.
 */
export function ReviewPhotos({
	post,
	name,
}: {
	post: FreshInkPostView;
	name: string;
}) {
	const thumbs: BrandImage[] = [
		post,
		...post.angles.map((angle) =>
			angle.kind === "video" ? angle.poster : angle,
		),
	];
	const more = thumbs.length - STRIP_THUMBS;
	return (
		<button
			type="button"
			className="client-review-photos"
			aria-haspopup="dialog"
			aria-controls={post.dialogId}
			aria-label={fill(studioCopy.reviews.photos, { name })}
			onClick={() => showPhoto(post.dialogId)}
		>
			{thumbs.slice(0, STRIP_THUMBS).map((image, index) => (
				<span key={image.src} className="client-review-thumb">
					<img
						className="client-review-thumb-img"
						src={image.src}
						srcSet={image.srcSet}
						sizes={image.srcSet ? THUMB_SIZES : undefined}
						width={image.width}
						height={image.height}
						alt=""
						loading="lazy"
						decoding="async"
					/>
					{more > 0 && index === STRIP_THUMBS - 1 ? (
						<span className="client-review-more" aria-hidden="true">
							{fill(studioCopy.reviews.more, { count: more })}
						</span>
					) : null}
				</span>
			))}
		</button>
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
	arrow = true,
}: {
	view: ReviewsView;
	className?: string;
	/**
	 * Stencil & Ink's and Ink Noir's links end in an arrow; Irezumi's, Atelier's
	 * and Flash Parlour's "All work" links are plain words, and so are these there.
	 */
	arrow?: boolean;
}) {
	if (view.nextCursor === null) return null;
	if (!arrow) {
		return (
			<a className={className} href={reviewsHref({})}>
				{studioCopy.reviews.all}
			</a>
		);
	}
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
 * there are none (none allowed on the studio's page, a failed read): no empty heading.
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
