import {
	AllFreshInkLink,
	FreshInkDialog,
	FreshInkOpen,
} from "../../components/fresh-ink.tsx";
import {
	AllReviewsLink,
	RatingSummary,
	ReviewList,
} from "../../components/reviews.tsx";
import { studioCopy } from "../../copy.ts";
import {
	type FreshInkPostView,
	type FreshInkView,
	HOME_FRESH_INK_COUNT,
} from "../../fresh-ink.ts";
import { HOME_REVIEWS_COUNT, type ReviewsView } from "../../reviews.ts";
import { catalogueNumber } from "./pieces.tsx";
import { pieceSizes } from "./sizes.ts";

/**
 * Atelier's Fresh ink and Reviews (Reviews and Fresh ink, slice 3), in its
 * quiet-luxury idiom: centred, the Bodoni title over a brass hairline, the
 * link to all of them under it. Fresh ink is a numbered collection like the
 * work (each photo whole on the white mat, "No. 01" and who shows it in the
 * caption), each a button that opens the gallery's viewer with its angles.
 * Reviews are testimonials set in Bodoni's italic, one under another between
 * hairlines, the stars in bronze, the name as written. Brass stays
 * decoration. One light scheme, as the theme's. Nothing when there is
 * nothing to show.
 */

export function AtelierFreshInk({ view }: { view: FreshInkView }) {
	const posts = view.posts.slice(0, HOME_FRESH_INK_COUNT);
	if (posts.length === 0) return null;
	return (
		<section
			id="fresh-ink"
			className="atl-section atl-fresh"
			aria-labelledby="fresh-ink-title"
		>
			<div className="atl-container">
				<div className="atl-section-head">
					<h2 id="fresh-ink-title" className="atl-section-title">
						{studioCopy.freshInk.title}
					</h2>
					<p className="atl-fresh-intro">{studioCopy.freshInk.intro}</p>
					<AllFreshInkLink view={view} className="atl-link" />
				</div>
				<AtelierFreshInkPieces posts={posts} />
			</div>
		</section>
	);
}

function AtelierFreshInkPieces({
	posts,
}: {
	posts: readonly FreshInkPostView[];
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="atl-pieces" role="list">
			{posts.map((post, index) => (
				<li key={post.dialogId} className="atl-piece">
					<FreshInkOpen post={post} className="atl-piece-link">
						<span className="atl-piece-mat">
							<img
								className="atl-piece-photo"
								src={post.src}
								srcSet={post.srcSet}
								sizes={post.srcSet ? pieceSizes(post) : undefined}
								width={post.width}
								height={post.height}
								alt=""
								loading="lazy"
								decoding="async"
							/>
						</span>
						<span className="atl-piece-caption">
							<span className="atl-piece-number" aria-hidden="true">
								{catalogueNumber(index + 1)}
							</span>
							<span className="atl-piece-title user-text" dir="auto">
								{post.title}
							</span>
							{post.photosLabel ? (
								<span className="atl-piece-count">{post.photosLabel}</span>
							) : null}
						</span>
					</FreshInkOpen>
					<FreshInkDialog post={post} />
				</li>
			))}
		</ul>
	);
}

export function AtelierReviews({
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
			className="atl-section atl-reviews"
			aria-labelledby="reviews-title"
		>
			<div className="atl-container">
				<div className="atl-section-head">
					<h2 id="reviews-title" className="atl-section-title">
						{studioCopy.reviews.title}
					</h2>
					{view.rating ? <RatingSummary rating={view.rating} /> : null}
				</div>
				<ReviewList
					reviews={reviews}
					studioName={studioName}
					className="client-review-list atl-review-list"
				/>
				{view.nextCursor !== null ? (
					<p className="atl-reviews-all">
						<AllReviewsLink view={view} className="atl-link" />
					</p>
				) : null}
			</div>
		</section>
	);
}
