import type { ComponentProps } from "react";
import {
	AllFreshInkLink,
	FreshInkDialog,
	FreshInkOpen,
} from "../../components/fresh-ink.tsx";
import {
	type ClientPageHeadProps,
	type ClientPageLayout,
	FreshInkPage,
	ReviewsPage,
} from "../../components/pages.tsx";
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
import { RibbonTitle, StarRow } from "./ornaments.tsx";
import { PageHead } from "./page-head.tsx";
import { pieceSizes } from "./sizes.ts";

/**
 * Flash Parlour's Fresh ink and Reviews (Reviews and Fresh ink, slice 3), in
 * the shop's own idiom: the ribbon title, the link to all of them beside it.
 * Fresh ink hangs like the work (each photo whole on the sheet with the
 * heavy ink outline, the mustard tag for a post of several photos), each a
 * button that opens the gallery's viewer with its angles; who shows it is
 * the caption. Reviews are tickets pinned to the wall: the sheet, a 3px ink
 * outline and an offset ink shadow, red stars outlined in ink, the client's
 * words in the body face and their name in Shrikhand; the studio's reply
 * is a stub under a dashed tear line. Mustard stays a fill. One light
 * scheme, as the theme's. Nothing when there is nothing to show.
 */

export function FlashParlourFreshInk({ view }: { view: FreshInkView }) {
	const posts = view.posts.slice(0, HOME_FRESH_INK_COUNT);
	if (posts.length === 0) return null;
	return (
		<section
			id="fresh-ink"
			className="fp-section fp-fresh"
			aria-labelledby="fresh-ink-title"
		>
			<div className="fp-container">
				<div className="fp-section-head">
					<RibbonTitle id="fresh-ink-title">
						{studioCopy.freshInk.title}
					</RibbonTitle>
					<AllFreshInkLink view={view} className="fp-link" arrow={false} />
				</div>
				<p className="fp-fresh-intro">{studioCopy.freshInk.intro}</p>
				<FlashParlourFreshInkPieces posts={posts} />
			</div>
		</section>
	);
}

export function FlashParlourFreshInkPieces({
	posts,
}: {
	posts: readonly FreshInkPostView[];
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="fp-pieces" role="list">
			{posts.map((post) => (
				<li key={post.dialogId} className="fp-piece">
					<FreshInkOpen post={post} className="fp-piece-link">
						<span className="fp-piece-mat">
							<img
								className="fp-piece-photo"
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
						<span className="fp-piece-caption">
							<span className="fp-piece-title user-text" dir="auto">
								{post.title}
							</span>
							{post.photosLabel ? (
								<span className="fp-piece-count">{post.photosLabel}</span>
							) : null}
						</span>
					</FreshInkOpen>
					<FreshInkDialog post={post} />
				</li>
			))}
		</ul>
	);
}

export function FlashParlourReviews({
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
			className="fp-section fp-reviews"
			aria-labelledby="reviews-title"
		>
			<div className="fp-container">
				<div className="fp-section-head">
					<RibbonTitle id="reviews-title">
						{studioCopy.reviews.title}
					</RibbonTitle>
					<AllReviewsLink view={view} className="fp-link" arrow={false} />
				</div>
				{view.rating ? <RatingSummary rating={view.rating} /> : null}
				<ReviewList
					reviews={reviews}
					studioName={studioName}
					className="client-review-list fp-review-list"
				/>
				<StarRow className="fp-reviews-rule" />
			</div>
		</section>
	);
}

/** Flash Parlour's head of `/reviews` and `/fresh-ink`: its own page head (the kicker, the starred title, the line). */
function FlashParlourClientHead({
	id,
	label,
	title,
	line,
}: ClientPageHeadProps) {
	return <PageHead label={label} title={title} line={line} titleId={id} />;
}

/**
 * FlashParlour's composition of `/reviews` and `/fresh-ink`: its own page head,
 * the page's column, the reviews as its home section draws them (the
 * section's classes on the body) and the posts in its own pieces, its plain
 * links; no studio block, as its gallery has none.
 */
const FLASH_PARLOUR_CLIENT_PAGES: ClientPageLayout = {
	mainClassName: "fp-main",
	Head: FlashParlourClientHead,
	bodyClassName: "fp-section fp-container fp-reviews fp-client-body",
	listClassName: "client-review-list fp-review-list",
	Posts: FlashParlourFreshInkPieces,
	linkClassName: "fp-link",
	moreClassName: "action action-secondary",
	aside: false,
};

/** `/reviews` in FlashParlour's idiom. */
export function FlashParlourReviewsPage(
	props: ComponentProps<typeof ReviewsPage>,
) {
	return <ReviewsPage {...props} layout={FLASH_PARLOUR_CLIENT_PAGES} />;
}

/** `/fresh-ink` in FlashParlour's idiom. */
export function FlashParlourFreshInkPage(
	props: ComponentProps<typeof FreshInkPage>,
) {
	return <FreshInkPage {...props} layout={FLASH_PARLOUR_CLIENT_PAGES} />;
}
