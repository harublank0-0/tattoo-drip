import { artworkTitle } from "../../artwork.ts";
import { PhotoDialog } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../gallery.ts";
import { showPhoto } from "../../lightbox.ts";
import { isAllowedHref } from "../../links.ts";
import { irezumiCopy } from "./copy.ts";
import { pieceSizes } from "./sizes.ts";

/**
 * Irezumi's pieces: each photo whole, in its own proportions (never cropped:
 * a sleeve or a back piece is a composition), on a grid of one column on a
 * phone, two from 40rem and three from 64rem, with the middle column set
 * lower so the wall reads like a hung exhibition (pages.css). Reading and
 * tab order are the API's order.
 *
 * A piece with its own page (`/gallery/<id>`) is one link, its title naming
 * it (the photo is decoration inside it, `alt=""`); one without (an older
 * API) is a button that opens the shared viewer (PhotoDialog). The link or
 * button carries the photo's `openId` where `withIds`, so the paged gallery's
 * "Show more" can move focus to the first new piece. Nothing for no photos.
 */
export function IrezumiPieces({
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
		<ul className="irz-pieces" role="list">
			{photos.map((photo, index) => (
				<IrezumiPiece
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

function IrezumiPiece({
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
	const image = (
		<span className="irz-piece-mat">
			<img
				className="irz-piece-photo"
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
	);
	const linked = photo.href !== null && isAllowedHref(photo.href);
	return (
		<li className="irz-piece">
			{linked ? (
				<RouterAnchor
					className="irz-piece-link"
					href={photo.href as string}
					id={withId ? photo.openId : undefined}
				>
					{image}
					<span className="irz-piece-title user-text" dir="auto">
						{title}
					</span>
				</RouterAnchor>
			) : (
				<>
					<button
						type="button"
						className="irz-piece-link"
						id={withId ? photo.openId : undefined}
						aria-haspopup="dialog"
						aria-controls={photo.dialogId}
						onClick={() => showPhoto(photo.dialogId)}
					>
						{image}
						<span className="irz-piece-title user-text" dir="auto">
							{title}
						</span>
					</button>
					<PhotoDialog photo={photo} showArtist={showArtist} />
				</>
			)}
			{artist || photo.healed ? (
				<p className="irz-piece-meta">
					{artist ? (
						<RouterAnchor href={artist.href}>
							<bdi>{artist.name}</bdi>
						</RouterAnchor>
					) : null}
					{photo.healed ? (
						<span className="irz-piece-healed">
							{irezumiCopy.gallery.healed}
						</span>
					) : null}
				</p>
			) : null}
		</li>
	);
}
