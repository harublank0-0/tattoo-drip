import { artworkTitle } from "../../artwork.ts";
import { PhotoDialog } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../gallery.ts";
import { showPhoto } from "../../lightbox.ts";
import { isAllowedHref } from "../../links.ts";
import { flashParlourCopy } from "./copy.ts";
import { pieceSizes } from "./sizes.ts";

/**
 * Flash Parlour's tattoos: each photo whole, in its own proportions (never
 * cropped), on a sheet with a heavy ink outline, one column on a phone, two
 * from 40rem and three from 64rem (pages.css). Reading and tab order are the
 * API's order.
 *
 * A piece with its own page (`/gallery/<id>`) is one link, its title naming it
 * (the photo is decoration inside it, `alt=""`); one without (an older API)
 * is a button that opens the shared viewer (PhotoDialog). The link or button
 * carries the photo's `openId` where `withIds`, so the paged gallery's "Show
 * more" can move focus to the first new piece. A tattoo of several photos or
 * videos (angles) says how many on a tag at the caption's end, inside the
 * link, so it is part of the link's name. Nothing for no photos.
 */
export function FlashParlourPieces({
	photos,
	showArtist = true,
	withIds = true,
	eagerFirst = false,
}: {
	photos: readonly GalleryPhotoView[];
	/** Whether each piece names its artist (an artist's own page doesn't). */
	showArtist?: boolean;
	withIds?: boolean;
	/** Whether the first photo loads at once (it is the page's first image). */
	eagerFirst?: boolean;
}) {
	if (photos.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="fp-pieces" role="list">
			{photos.map((photo, index) => (
				<FlashParlourPiece
					key={photo.href ?? photo.dialogId}
					photo={photo}
					showArtist={showArtist}
					withId={withIds}
					eager={eagerFirst && index === 0}
				/>
			))}
		</ul>
	);
}

function FlashParlourPiece({
	photo,
	showArtist,
	withId,
	eager,
}: {
	photo: GalleryPhotoView;
	showArtist: boolean;
	withId: boolean;
	eager: boolean;
}) {
	const title = artworkTitle(photo);
	const artist =
		showArtist && photo.artist && isAllowedHref(photo.artist.href)
			? photo.artist
			: null;
	const inside = (
		<>
			<span className="fp-piece-mat">
				<img
					className="fp-piece-photo"
					src={photo.src}
					srcSet={photo.srcSet}
					sizes={photo.srcSet ? pieceSizes(photo) : undefined}
					width={photo.width}
					height={photo.height}
					alt=""
					loading={eager ? "eager" : "lazy"}
					decoding="async"
				/>
			</span>
			<span className="fp-piece-caption">
				<span className="fp-piece-title user-text" dir="auto">
					{title}
				</span>
				{photo.photosLabel ? (
					<span className="fp-piece-count">{photo.photosLabel}</span>
				) : null}
			</span>
		</>
	);
	const linked = photo.href !== null && isAllowedHref(photo.href);
	return (
		<li className="fp-piece">
			{linked ? (
				<RouterAnchor
					className="fp-piece-link"
					href={photo.href as string}
					id={withId ? photo.openId : undefined}
				>
					{inside}
				</RouterAnchor>
			) : (
				<>
					<button
						type="button"
						className="fp-piece-link"
						id={withId ? photo.openId : undefined}
						aria-haspopup="dialog"
						aria-controls={photo.dialogId}
						onClick={() => showPhoto(photo.dialogId)}
					>
						{inside}
					</button>
					<PhotoDialog photo={photo} showArtist={showArtist} />
				</>
			)}
			{artist || photo.healed ? (
				<p className="fp-piece-meta">
					{artist ? (
						<RouterAnchor href={artist.href}>
							<bdi>{artist.name}</bdi>
						</RouterAnchor>
					) : null}
					{photo.healed ? (
						<span className="fp-piece-healed">
							{flashParlourCopy.gallery.healed}
						</span>
					) : null}
				</p>
			) : null}
		</li>
	);
}
