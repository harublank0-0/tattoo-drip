import { artworkTitle } from "../../../artwork.ts";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../../gallery.ts";
import { isAllowedHref } from "../../../links.ts";
import { inkNoirGalleryCopy } from "./copy.ts";
import { pieceSizes, shapeClass } from "./sizes.ts";

/**
 * One piece of the collection: its photo, whole (its width follows its shape:
 * sizes.ts), and its title, one link to its own page; under it whose it is
 * (a link to their page) and the healed mark. The photo is decoration inside
 * a link its title names (`alt=""`, as the artist roster's thumbnails); the
 * title is the studio's description or built from the photo's styles and
 * artist. On a screen with hover the title rises over the photo on hover and
 * focus; on touch it sits under it, always there. The link carries the
 * photo's `openId`, so "Show more" can put the keyboard on the first new
 * piece. A tattoo of several photos (angles) carries "3 photos" in the link,
 * on the photo's corner, so it is part of the link's name. Nothing for a
 * photo without its own page.
 */
export function ArtworkCard({
	photo,
	withId = true,
}: {
	photo: GalleryPhotoView;
	/** Whether the link carries the photo's `openId` (the gallery's, for "Show more"); related pieces don't: their numbers can repeat the page's own. */
	withId?: boolean;
}) {
	if (!photo.href || !isAllowedHref(photo.href)) return null;
	const artist =
		photo.artist && isAllowedHref(photo.artist.href) ? photo.artist : null;
	return (
		<li className={`ink-piece ${shapeClass(photo)}`}>
			<RouterAnchor
				className="ink-piece-link"
				href={photo.href}
				id={withId ? photo.openId : undefined}
			>
				<span className="ink-piece-frame">
					<img
						className="ink-piece-photo"
						src={photo.src}
						srcSet={photo.srcSet}
						sizes={photo.srcSet ? pieceSizes(photo) : undefined}
						width={photo.width}
						height={photo.height}
						alt=""
						loading="lazy"
						decoding="async"
					/>
				</span>
				<span className="ink-piece-title user-text" dir="auto">
					{artworkTitle(photo)}
				</span>
				{photo.photosLabel ? (
					<span className="ink-piece-count">{photo.photosLabel}</span>
				) : null}
			</RouterAnchor>
			{artist || photo.healed ? (
				<p className="ink-piece-meta">
					{artist ? (
						<RouterAnchor href={artist.href}>
							<bdi>{artist.name}</bdi>
						</RouterAnchor>
					) : null}
					{photo.healed ? (
						<span className="ink-piece-healed">
							{inkNoirGalleryCopy.card.healed}
						</span>
					) : null}
				</p>
			) : null}
		</li>
	);
}

/** Pieces as the collection's justified rows; nothing for none. `withIds` as ArtworkCard's `withId`. */
export function ArtworkRows({
	photos,
	withIds = true,
}: {
	photos: readonly GalleryPhotoView[];
	withIds?: boolean;
}) {
	if (photos.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="ink-collection" role="list">
			{photos.map((photo) => (
				<ArtworkCard
					key={photo.href ?? photo.openId}
					photo={photo}
					withId={withIds}
				/>
			))}
		</ul>
	);
}
