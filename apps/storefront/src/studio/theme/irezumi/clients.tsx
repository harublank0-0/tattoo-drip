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
import { pieceSizes } from "./sizes.ts";

/**
 * Irezumi's Fresh ink and Reviews (Reviews and Fresh ink, slice 3), drawn as
 * its other sections are: the vermilion square before the title, the link to
 * all of them across from it, the column of the page. Fresh ink hangs like
 * the selected work (each photo whole on a mat of raised paper, the middle
 * column set lower), each a button that opens the gallery's viewer with its
 * angles; under it, who shows it in the serif. Reviews read like quoted
 * passages on washi: the client's words in the serif, the stars in
 * vermilion, a hairline above each, the studio's reply indented under a
 * rule. Both follow the device, light or dark, through the theme's tokens.
 * Nothing when there is nothing to show.
 */

export function IrezumiFreshInk({ view }: { view: FreshInkView }) {
	const posts = view.posts.slice(0, HOME_FRESH_INK_COUNT);
	if (posts.length === 0) return null;
	return (
		<section
			id="fresh-ink"
			className="irz-section irz-fresh"
			aria-labelledby="fresh-ink-title"
		>
			<div className="irz-container">
				<div className="irz-section-head">
					<h2 id="fresh-ink-title" className="irz-section-title">
						{studioCopy.freshInk.title}
					</h2>
					<AllFreshInkLink view={view} className="irz-link" arrow={false} />
				</div>
				<p className="irz-kicker irz-fresh-intro">
					{studioCopy.freshInk.intro}
				</p>
				<IrezumiFreshInkPieces posts={posts} />
			</div>
		</section>
	);
}

/** The posts as Irezumi's hung pieces. */
export function IrezumiFreshInkPieces({
	posts,
}: {
	posts: readonly FreshInkPostView[];
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="irz-pieces" role="list">
			{posts.map((post) => (
				<li key={post.dialogId} className="irz-piece">
					<FreshInkOpen post={post} className="irz-piece-link">
						<span className="irz-piece-mat">
							<img
								className="irz-piece-photo"
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
						<span className="irz-piece-title user-text" dir="auto">
							{post.title}
						</span>
						{post.photosLabel ? (
							<span className="irz-piece-count">{post.photosLabel}</span>
						) : null}
					</FreshInkOpen>
					<FreshInkDialog post={post} />
				</li>
			))}
		</ul>
	);
}

export function IrezumiReviews({
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
			className="irz-section irz-reviews"
			aria-labelledby="reviews-title"
		>
			<div className="irz-container">
				<div className="irz-section-head">
					<h2 id="reviews-title" className="irz-section-title">
						{studioCopy.reviews.title}
					</h2>
					<AllReviewsLink view={view} className="irz-link" arrow={false} />
				</div>
				{view.rating ? <RatingSummary rating={view.rating} /> : null}
				<ReviewList
					reviews={reviews}
					studioName={studioName}
					className="client-review-list irz-review-list"
				/>
			</div>
		</section>
	);
}

/** Irezumi's head of `/reviews` and `/fresh-ink`, as its gallery's: the kicker, the title, the line. */
function IrezumiClientHead({ id, label, title, line }: ClientPageHeadProps) {
	return (
		<header className="irz-page-head">
			<div className="irz-container">
				<p className="irz-kicker">{label}</p>
				<h1 id={id} className="irz-page-title">
					{title}
				</h1>
				<p className="irz-page-line">{line}</p>
			</div>
		</header>
	);
}

/**
 * Irezumi's composition of `/reviews` and `/fresh-ink`: its own page head,
 * the page's column, the reviews as its home section draws them (the
 * section's classes on the body) and the posts in its own pieces, its plain
 * links; no studio block, as its gallery has none.
 */
const IREZUMI_CLIENT_PAGES: ClientPageLayout = {
	mainClassName: "irz-main",
	Head: IrezumiClientHead,
	bodyClassName: "irz-section irz-container irz-reviews irz-client-body",
	listClassName: "client-review-list irz-review-list",
	Posts: IrezumiFreshInkPieces,
	linkClassName: "irz-link",
	moreClassName: "action irz-action-quiet",
	aside: false,
};

/** `/reviews` in Irezumi's idiom. */
export function IrezumiReviewsPage(props: ComponentProps<typeof ReviewsPage>) {
	return <ReviewsPage {...props} layout={IREZUMI_CLIENT_PAGES} />;
}

/** `/fresh-ink` in Irezumi's idiom. */
export function IrezumiFreshInkPage(
	props: ComponentProps<typeof FreshInkPage>,
) {
	return <FreshInkPage {...props} layout={IREZUMI_CLIENT_PAGES} />;
}
