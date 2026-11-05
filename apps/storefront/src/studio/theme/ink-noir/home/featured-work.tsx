import { PhotoDialog } from "../../../components/gallery.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../../gallery.ts";
import { showPhoto } from "../../../lightbox.ts";
import { isAllowedHref, linkRel, workHref } from "../../../links.ts";
import type { StudioView } from "../../../view-model.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { featuredSizes, featuredTiles } from "./home-view.ts";
import { SectionHead } from "./parts.tsx";

const copy = inkNoirHomeCopy.work;

/**
 * The featured work: the studio's newest photos as a mosaic, the first one
 * large. Each tile is a button that opens the photo in the gallery's own
 * viewer (PhotoDialog and showPhoto, as on Stencil & Ink's gallery: the browser's `<dialog>`),
 * with whose work it is and its styles over the photo's foot: shown on
 * hover and focus where there is a pointer, always on a touch screen, and
 * always part of the button's name. "View full gallery" leads to /gallery.
 *
 * With no photos it says there are none to show and points to the studio's
 * Instagram when it has one, rather than show anyone else's work. It does
 * not say the studio has published none: a failed gallery read also comes
 * here as no photos (loadStudioPage). The `recent-work` id keeps old `/#recent-work` links
 * landing here.
 */
export function FeaturedWork({
	photos,
	studio,
}: {
	photos: readonly GalleryPhotoView[];
	studio: StudioView;
}) {
	const tiles = featuredTiles(photos.length);
	const instagram = studio.links.find(
		(link) => link.kind === "instagram" && isAllowedHref(link.href),
	);
	return (
		<section
			id="recent-work"
			className="ink-section ink-work"
			aria-labelledby="recent-work-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead id="recent-work-title" label={copy.eyebrow}>
						{copy.title}
					</SectionHead>
					{photos.length > 0 ? (
						<RouterAnchor className="ink-link" href={workHref({})}>
							{copy.all}
						</RouterAnchor>
					) : null}
				</div>
				{photos.length > 0 ? (
					// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
					// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
					<ul className="ink-work-grid" role="list">
						{photos.map((photo, index) => {
							const tile = tiles[index];
							return (
								<li
									key={photo.dialogId}
									className={`ink-tile ink-tile-${tile.cols}x${tile.rows} ink-tile-m${tile.mobileCols}x${tile.mobileRows}`}
								>
									<button
										type="button"
										className="ink-tile-open"
										id={photo.openId}
										aria-haspopup="dialog"
										aria-controls={photo.dialogId}
										onClick={() => showPhoto(photo.dialogId)}
									>
										<img
											src={photo.src}
											srcSet={photo.srcSet}
											sizes={
												photo.srcSet ? featuredSizes(tile, photo) : undefined
											}
											width={photo.width}
											height={photo.height}
											alt={photo.alt}
											loading="lazy"
											decoding="async"
										/>
										{photo.artist || photo.styles.length > 0 ? (
											<span className="ink-tile-facts">
												{photo.artist ? (
													<span className="ink-tile-artist">
														<bdi>{photo.artist.name}</bdi>
													</span>
												) : null}
												{photo.styles.length > 0 ? (
													<span className="ink-tile-styles">
														{photo.styles.join(", ")}
													</span>
												) : null}
											</span>
										) : null}
									</button>
									<PhotoDialog photo={photo} showArtist />
								</li>
							);
						})}
					</ul>
				) : (
					<div className="ink-work-empty">
						<p className="ink-work-empty-title">{copy.emptyTitle}</p>
						{instagram ? (
							<p>
								<a
									className="ink-link"
									href={instagram.href}
									rel={linkRel(instagram.href)}
								>
									{copy.follow}
								</a>
							</p>
						) : null}
					</div>
				)}
			</div>
		</section>
	);
}
