import type { ArtworkView } from "../../artwork.ts";
import { ArtworkFigure } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { isAllowedHref, workHref } from "../../links.ts";
import type { ArtworkPageData } from "../../loaders.ts";
import type { StudioView } from "../../view-model.ts";
import { atelierCopy } from "./copy.ts";
import { AtelierPieces } from "./pieces.tsx";
import { AtelierShell } from "./shell.tsx";
import { archSizes, artworkSizes } from "./sizes.ts";

const copy = atelierCopy.artwork;

/**
 * Atelier's tattoo page (`/gallery/$photo`): the piece first, whole on its
 * plate (the shared ArtworkFigure: a button to the full-screen viewer), then
 * its catalogue entry centred beneath it: its title (the page's h1), the
 * artist, its styles (each a link to the collection filtered by it), whether
 * it was photographed healed, and the way to ask for something similar while
 * someone takes new work. Then its artist, and more work. Nothing the data
 * doesn't hold (placement, a date) is shown.
 */
export function AtelierArtworkPage({
	data,
	Shell = AtelierShell,
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
			mainClassName="atl-main atl-artwork"
		>
			<div className="atl-container atl-artwork-top">
				<p className="atl-crumb">
					<RouterAnchor className="atl-link" href={workHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div className="atl-artwork-grid">
					<ArtworkFigure
						photo={artwork.photo}
						sizes={artworkSizes(artwork.photo)}
						className="atl-plate atl-artwork-figure"
					/>
					<Colophon artwork={artwork} studio={studio} similar={similar} />
				</div>
			</div>
			<ArtworkArtist artwork={artwork} />
			{data.related.length > 0 ? (
				<section
					className="atl-section atl-container"
					aria-labelledby="atl-related-title"
				>
					<div className="atl-section-head">
						<h2 id="atl-related-title" className="atl-section-title">
							{copy.related}
						</h2>
						<RouterAnchor className="atl-link" href={workHref({})}>
							{atelierCopy.home.allWork}
						</RouterAnchor>
					</div>
					<AtelierPieces photos={data.related} withIds={false} />
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
		<div className="atl-colophon">
			<p className="atl-kicker user-text" dir="auto">
				{studio.name}
			</p>
			<h1 className="atl-artwork-title user-text" dir="auto">
				{artwork.title}
			</h1>
			{photo.caption && !artwork.titleIsCaption ? (
				<p className="user-text" dir="auto">
					{photo.caption}
				</p>
			) : null}
			<dl className="atl-facts">
				{by ? (
					<div>
						<dt>{copy.artist}</dt>
						<dd>
							<RouterAnchor className="atl-link" href={by.href}>
								<bdi>{by.name}</bdi>
							</RouterAnchor>
						</dd>
					</div>
				) : null}
				{photo.styleRefs.length > 0 ? (
					<div>
						<dt>{copy.style}</dt>
						<dd className="atl-facts-list">
							{photo.styleRefs.map((style) => (
								<RouterAnchor
									key={style.slug}
									className="atl-link"
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
				<div className="atl-colophon-ask">
					<p className="atl-label-strong">{copy.inspired}</p>
					<p>{copy.inspiredLine}</p>
					<div className="atl-hero-actions">
						<RouterAnchor
							className="action action-primary atl-cta"
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
			className="atl-section atl-container atl-artwork-artist"
			aria-labelledby="atl-artwork-artist-title"
		>
			<h2 className="atl-label" id="atl-artwork-artist-title">
				{copy.about}
			</h2>
			<div className="atl-artwork-artist-body">
				{artist.photo ? (
					<img
						className="atl-artist-small-portrait"
						src={artist.photo.src}
						srcSet={artist.photo.srcSet}
						sizes={artist.photo.srcSet ? archSizes(artist.photo, 7) : undefined}
						width={artist.photo.width}
						height={artist.photo.height}
						alt={artist.photo.alt}
						loading="lazy"
						decoding="async"
					/>
				) : null}
				<div>
					<p className="atl-artwork-artist-name" dir="auto">
						{artist.name}
					</p>
					{artist.styles.length > 0 ? (
						<p className="atl-artist-styles">{artist.styles.join(" · ")}</p>
					) : null}
					{artist.bio ? (
						<p className="atl-artwork-artist-bio user-text" dir="auto">
							{artist.bio}
						</p>
					) : null}
					{linked ? (
						<RouterAnchor className="atl-link" href={artist.pageHref}>
							{copy.portfolio}
						</RouterAnchor>
					) : null}
				</div>
			</div>
		</section>
	);
}
