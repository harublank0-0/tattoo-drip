import {
	AllFreshInkLink,
	FreshInkDialog,
	FreshInkOpen,
} from "../../../components/fresh-ink.tsx";
import { studioCopy } from "../../../copy.ts";
import { type FreshInkView, HOME_FRESH_INK_COUNT } from "../../../fresh-ink.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { SectionHead } from "./parts.tsx";

/** Two portrait columns on a phone, three from 48rem, inside the 72rem column. */
const SIZES = "(min-width: 48rem) min(24rem, 33vw), 50vw";

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
				{/* biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none */}
				{/* biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none */}
				<ul className="ink-fresh-grid" role="list">
					{posts.map((post) => (
						<li key={post.dialogId} className="ink-fresh-tile">
							<FreshInkOpen post={post} className="ink-tile-open">
								<img
									src={post.src}
									srcSet={post.srcSet}
									sizes={post.srcSet ? SIZES : undefined}
									width={post.width}
									height={post.height}
									alt={post.alt}
									loading="lazy"
									decoding="async"
								/>
								{post.photosLabel ? (
									<span className="ink-tile-count">{post.photosLabel}</span>
								) : null}
								<span className="ink-tile-facts">
									<span className="ink-tile-artist">
										<bdi>{post.shownBy}</bdi>
									</span>
									{post.artist ? (
										<span className="ink-tile-styles">
											<bdi>{post.artist.name}</bdi>
										</span>
									) : null}
								</span>
							</FreshInkOpen>
							<FreshInkDialog post={post} />
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
