import { artworkTitle } from "../../artwork.ts";
import { PhotoDialog } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../gallery.ts";
import { showPhoto } from "../../lightbox.ts";
import { isAllowedHref } from "../../links.ts";
import { atelierCopy } from "./copy.ts";
import { pieceSizes } from "./sizes.ts";

/**
 * Atelier's pieces as a numbered catalogue: each photo whole, in its own
 * proportions (never cropped), on a white mat with a hairline, one column on
 * a phone and two from 48rem (pages.css), each numbered "No. 01" on in the
 * order shown (the number is the piece's place in this list, decoration
 * hidden from assistive technology: the title names the piece). Reading and tab order are the
 * API's order.
 *
 * A piece with its own page (`/gallery/<id>`) is one link, its title naming
 * it (the photo is decoration inside it, `alt=""`); one without (an older
 * API) is a button that opens the shared viewer (PhotoDialog). The link or
 * button carries the photo's `openId` where `withIds`, so the paged gallery's
 * "Show more" can move focus to the first new piece. Nothing for no photos.
 */
export function AtelierPieces({
	photos,
	showArtist = true,
	withIds = true,
	eagerFirst = false,
	numbered = true,
}: {
	photos: readonly GalleryPhotoView[];
	/** Whether each piece names its artist (an artist's own page doesn't). */
	showArtist?: boolean;
	withIds?: boolean;
	/** Whether the first photo loads at once (it is the page's first image). */
	eagerFirst?: boolean;
	/**
	 * Whether the pieces carry their catalogue numbers: only a list that
	 * starts at the newest (a later page, `?cursor=`, can't know where it
	 * starts, so it shows none rather than restart at "No. 01").
	 */
	numbered?: boolean;
}) {
	if (photos.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="atl-pieces" role="list">
			{photos.map((photo, index) => (
				<AtelierPiece
					key={photo.href ?? photo.dialogId}
					photo={photo}
					showArtist={showArtist}
					withId={withIds}
					eager={eagerFirst && index === 0}
					number={numbered ? index + 1 : null}
				/>
			))}
		</ul>
	);
}

function AtelierPiece({
	photo,
	showArtist,
	withId,
	eager,
	number,
}: {
	number: number | null;
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
		<span className="atl-piece-mat">
			<img
				className="atl-piece-photo"
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
		<li className="atl-piece">
			{linked ? (
				<RouterAnchor
					className="atl-piece-link"
					href={photo.href as string}
					id={withId ? photo.openId : undefined}
				>
					{image}
					<span className="atl-piece-caption">
						{number === null ? null : (
							<span className="atl-piece-number" aria-hidden="true">
								{catalogueNumber(number)}
							</span>
						)}
						<span className="atl-piece-title user-text" dir="auto">
							{title}
						</span>
					</span>
				</RouterAnchor>
			) : (
				<>
					<button
						type="button"
						className="atl-piece-link"
						id={withId ? photo.openId : undefined}
						aria-haspopup="dialog"
						aria-controls={photo.dialogId}
						onClick={() => showPhoto(photo.dialogId)}
					>
						{image}
						<span className="atl-piece-caption">
							{number === null ? null : (
								<span className="atl-piece-number" aria-hidden="true">
									{catalogueNumber(number)}
								</span>
							)}
							<span className="atl-piece-title user-text" dir="auto">
								{title}
							</span>
						</span>
					</button>
					<PhotoDialog photo={photo} showArtist={showArtist} />
				</>
			)}
			{artist || photo.healed ? (
				<p className="atl-piece-meta">
					{artist ? (
						<RouterAnchor href={artist.href}>
							<bdi>{artist.name}</bdi>
						</RouterAnchor>
					) : null}
					{photo.healed ? (
						<span className="atl-piece-healed">
							{atelierCopy.gallery.healed}
						</span>
					) : null}
				</p>
			) : null}
		</li>
	);
}

/** "No. 01": two digits at least, so a catalogue's numbers line up. */
export function catalogueNumber(n: number): string {
	return atelierCopy.gallery.number.replace("{n}", String(n).padStart(2, "0"));
}
