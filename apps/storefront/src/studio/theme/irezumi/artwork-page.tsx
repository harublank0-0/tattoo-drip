import type { ArtworkView } from "../../artwork.ts";
import { ArtworkFigure } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { isAllowedHref, workHref } from "../../links.ts";
import type { ArtworkPageData } from "../../loaders.ts";
import type { StudioView } from "../../view-model.ts";
import { irezumiCopy } from "./copy.ts";
import { IrezumiPieces } from "./pieces.tsx";
import { IrezumiShell } from "./shell.tsx";
import { artworkSizes, smallPortraitSizes } from "./sizes.ts";

const copy = irezumiCopy.artwork;

/**
 * Irezumi's tattoo page (`/gallery/$photo`): the piece first, whole and as
 * large as the screen allows (the shared ArtworkFigure: a button to the
 * full-screen viewer), with a quiet colophon beside it (beneath on a phone):
 * its title (the page's h1), the artist, its styles (each a link to the
 * gallery filtered by it), whether it was photographed healed, and the way to
 * ask for something similar while someone takes new work. Then its artist,
 * and more work. Nothing the data doesn't hold (placement, a date) is shown.
 */
export function IrezumiArtworkPage({
	data,
	Shell = IrezumiShell,
}: {
	data: ArtworkPageData;
	Shell?: Shell;
}) {
	const { studio, theme, artwork, similar } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
			mainClassName="irz-main irz-artwork"
		>
			<div className="irz-container irz-artwork-top">
				<p className="irz-crumb">
					<RouterAnchor className="irz-link" href={workHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div className="irz-artwork-grid">
					<ArtworkFigure
						photo={artwork.photo}
						sizes={artworkSizes()}
						className="irz-artwork-figure"
					/>
					<Colophon artwork={artwork} studio={studio} similar={similar} />
				</div>
			</div>
			<ArtworkArtist artwork={artwork} />
			{data.related.length > 0 ? (
				<section
					className="irz-section irz-container"
					aria-labelledby="irz-related-title"
				>
					<div className="irz-section-head">
						<h2 id="irz-related-title" className="irz-section-title">
							{copy.related}
						</h2>
						<RouterAnchor className="irz-link" href={workHref({})}>
							{irezumiCopy.home.allWork}
						</RouterAnchor>
					</div>
					<IrezumiPieces photos={data.related} withIds={false} />
				</section>
			) : null}
		</Shell>
	);
}

function Colophon({
	artwork,
	studio,
	similar,
}: {
	artwork: ArtworkView;
	studio: StudioView;
	similar: ArtworkPageData["similar"];
}) {
	const { photo } = artwork;
	const by =
		photo.artist && isAllowedHref(photo.artist.href) ? photo.artist : null;
	return (
		<div className="irz-colophon">
			<p className="irz-kicker" dir="auto">
				{studio.name}
			</p>
			<h1 className="irz-artwork-title user-text" dir="auto">
				{artwork.title}
			</h1>
			{photo.caption && !artwork.titleIsCaption ? (
				<p className="user-text" dir="auto">
					{photo.caption}
				</p>
			) : null}
			<dl className="irz-facts">
				{by ? (
					<div>
						<dt>{copy.artist}</dt>
						<dd>
							<RouterAnchor className="irz-link" href={by.href}>
								<bdi>{by.name}</bdi>
							</RouterAnchor>
						</dd>
					</div>
				) : null}
				{photo.styleRefs.length > 0 ? (
					<div>
						<dt>{copy.style}</dt>
						<dd className="irz-facts-list">
							{photo.styleRefs.map((style) => (
								<RouterAnchor
									key={style.slug}
									className="irz-link"
									href={workHref({ style: style.slug })}
								>
									{style.name}
								</RouterAnchor>
							))}
						</dd>
					</div>
				) : null}
				{photo.healed ? (
					<div>
						<dt>{copy.state}</dt>
						<dd>{copy.healed}</dd>
					</div>
				) : null}
			</dl>
			{similar && isAllowedHref(similar.href) ? (
				<div className="irz-colophon-ask">
					<p className="irz-label-strong">{copy.inspired}</p>
					<p>{copy.inspiredLine}</p>
					<div className="irz-hero-actions">
						<RouterAnchor
							className="action action-primary irz-cta"
							href={similar.href}
						>
							{copy.similar}
						</RouterAnchor>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** The piece's artist: their portrait, name, styles and bio, and their portfolio; nothing when the piece names nobody the studio lists. */
function ArtworkArtist({ artwork }: { artwork: ArtworkView }) {
	const artist = artwork.artist;
	if (!artist) return null;
	const linked = isAllowedHref(artist.pageHref);
	return (
		<section
			className="irz-section irz-container irz-artwork-artist"
			aria-labelledby="irz-artwork-artist-title"
		>
			<h2 className="irz-label" id="irz-artwork-artist-title">
				{copy.about}
			</h2>
			<div className="irz-artwork-artist-body">
				{artist.photo ? (
					<img
						className="irz-artist-small-portrait"
						src={artist.photo.src}
						srcSet={artist.photo.srcSet}
						sizes={
							artist.photo.srcSet ? smallPortraitSizes(artist.photo) : undefined
						}
						width={artist.photo.width}
						height={artist.photo.height}
						alt={artist.photo.alt}
						loading="lazy"
						decoding="async"
					/>
				) : null}
				<div>
					<p className="irz-artwork-artist-name" dir="auto">
						{artist.name}
					</p>
					{artist.styles.length > 0 ? (
						<p className="irz-artist-styles">{artist.styles.join(" · ")}</p>
					) : null}
					{artist.bio ? (
						<p className="irz-artwork-artist-bio user-text" dir="auto">
							{artist.bio}
						</p>
					) : null}
					{linked ? (
						<RouterAnchor className="irz-link" href={artist.pageHref}>
							{copy.portfolio}
						</RouterAnchor>
					) : null}
				</div>
			</div>
		</section>
	);
}
