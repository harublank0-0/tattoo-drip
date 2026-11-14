import type { ComponentProps } from "react";
import { Fill } from "../../../../intake/components/fill.tsx";
import {
	AllFreshInkLink,
	FreshInkDialog,
	FreshInkOpen,
} from "../../../components/fresh-ink.tsx";
import {
	type ClientPageHeadProps,
	type ClientPageLayout,
	FreshInkPage,
	ReviewsPage,
} from "../../../components/pages.tsx";
import { studioCopy } from "../../../copy.ts";
import {
	type FreshInkPostView,
	type FreshInkView,
	HOME_FRESH_INK_COUNT,
} from "../../../fresh-ink.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { freshInkSizes } from "./home-view.ts";
import { SectionHead } from "./parts.tsx";

/**
 * Ink Noir's Fresh ink (Reviews and Fresh ink, slice 3): clients' healed
 * tattoos as dark portrait tiles, each a button that opens the post in the
 * gallery's own viewer with its angles. Who shows it and the artist sit on
 * a scrim at the photo's foot, as the featured work's facts do (shown on
 * hover and focus where there is a pointer, always on a touch screen, and
 * always part of the button's name). Nothing when there is nothing to show.
 */
export function InkNoirFreshInk({ view }: { view: FreshInkView }) {
	const posts = view.posts.slice(0, HOME_FRESH_INK_COUNT);
	if (posts.length === 0) return null;
	return (
		<section
			id="fresh-ink"
			className="ink-section ink-fresh"
			aria-labelledby="fresh-ink-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead
						id="fresh-ink-title"
						label={inkNoirHomeCopy.freshInk.eyebrow}
					>
						{studioCopy.freshInk.title}
					</SectionHead>
					<AllFreshInkLink view={view} className="ink-link" />
				</div>
				<p className="ink-fresh-intro">{studioCopy.freshInk.intro}</p>
				<InkNoirFreshInkTiles posts={posts} />
			</div>
		</section>
	);
}

/**
 * The posts as Ink Noir's portrait tiles (the home section's and `/fresh-ink`'s),
 * each a button that opens its viewer: its photo is decoration, as the scrim's
 * words (who shows it, whose tattoo) name the post.
 */
export function InkNoirFreshInkTiles({
	posts,
}: {
	posts: readonly FreshInkPostView[];
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="ink-fresh-grid" role="list">
			{posts.map((post) => (
				<li key={post.dialogId} className="ink-fresh-tile">
					<FreshInkOpen post={post} className="ink-tile-open">
						{/* The scrim's words name the post (who shows it, whose tattoo), so the photo is decoration. */}
						<img
							className="ink-fresh-photo"
							src={post.src}
							srcSet={post.srcSet}
							sizes={post.srcSet ? freshInkSizes(post) : undefined}
							width={post.width}
							height={post.height}
							alt=""
							loading="lazy"
							decoding="async"
						/>
						{post.photosLabel ? (
							<span className="ink-tile-count">{post.photosLabel}</span>
						) : null}
						<span className="ink-tile-facts">
							<span className="ink-tile-artist">
								<Fill
									template={studioCopy.freshInk.shownBy}
									values={{ name: post.name }}
								/>
							</span>
							{post.artist ? (
								<span className="ink-tile-styles">
									<Fill
										template={studioCopy.freshInk.tattooBy}
										values={{ artist: post.artist.name }}
									/>
								</span>
							) : null}
						</span>
					</FreshInkOpen>
					<FreshInkDialog post={post} />
				</li>
			))}
		</ul>
	);
}

/** Ink Noir's head of `/reviews` and `/fresh-ink`, as its gallery's: the accent-stroked label, the large title, the lede. */
function InkNoirClientHead({ id, label, title, line }: ClientPageHeadProps) {
	return (
		<header className="ink-dir-hero ink-client-hero">
			<div className="ink-container ink-dir-hero-grid">
				<p className="ink-label">{label}</p>
				<h1 id={id} className="ink-dir-title">
					{title}
				</h1>
				<p className="ink-dir-lede">{line}</p>
			</div>
		</header>
	);
}

/**
 * Ink Noir's composition of `/reviews` and `/fresh-ink`: its own head, the
 * page's column, the reviews as its home section's raised cards and the posts
 * as its portrait tiles, its own links; no studio block, as its gallery has
 * none (its footer carries the studio).
 */
export const INK_NOIR_CLIENT_PAGES: ClientPageLayout = {
	mainClassName: "ink-home ink-client-main",
	Head: InkNoirClientHead,
	bodyClassName: "ink-container ink-reviews ink-client-body",
	listClassName: "client-review-list ink-review-list",
	Posts: InkNoirFreshInkTiles,
	linkClassName: "ink-link",
	moreClassName: "action action-secondary",
	aside: false,
};

/** `/reviews` in Ink Noir's idiom. */
export function InkNoirReviewsPage(props: ComponentProps<typeof ReviewsPage>) {
	return <ReviewsPage {...props} layout={INK_NOIR_CLIENT_PAGES} />;
}

/** `/fresh-ink` in Ink Noir's idiom. */
export function InkNoirFreshInkPage(
	props: ComponentProps<typeof FreshInkPage>,
) {
	return <FreshInkPage {...props} layout={INK_NOIR_CLIENT_PAGES} />;
}
