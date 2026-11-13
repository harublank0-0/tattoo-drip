import type { ArtworkView } from "../../artwork.ts";
import { ArtworkFigure } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { isAllowedHref, workHref } from "../../links.ts";
import type { ArtworkPageData } from "../../loaders.ts";
import type { StudioView } from "../../view-model.ts";
import { flashParlourCopy } from "./copy.ts";
import { RibbonTitle } from "./ornaments.tsx";
import { FlashParlourPieces } from "./pieces.tsx";
import { FlashParlourShell } from "./shell.tsx";
import { artworkSizes, fixedPortraitSizes } from "./sizes.ts";

const copy = flashParlourCopy.artwork;

/**
 * Flash Parlour's tattoo page (`/gallery/$photo`): the piece first, whole on its
 * sheet (the shared ArtworkFigure: a button to the full-screen viewer, with
 * the row of its photos and videos when it has angles), then beside it from
 * 60rem its ticket: its title (the page's h1), the
 * artist, its styles (each a link to the work filtered by it), whether
 * it was photographed healed, and the way to ask for something similar while
 * someone takes new work. Then its artist, and more work. Nothing the data
 * doesn't hold (placement, a date) is shown.
 */
export function FlashParlourArtworkPage({
	data,
	Shell = FlashParlourShell,
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
			mainClassName="fp-main fp-artwork"
		>
			<div className="fp-container fp-artwork-top">
				<p className="fp-crumb">
					<RouterAnchor className="fp-link" href={workHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div className="fp-artwork-grid">
					<ArtworkFigure
						photo={artwork.photo}
						sizes={artworkSizes(artwork.photo)}
						className="fp-plate fp-artwork-figure"
					/>
					<Colophon artwork={artwork} studio={studio} similar={similar} />
				</div>
			</div>
			<ArtworkArtist artwork={artwork} />
			{data.related.length > 0 ? (
				<section
					className="fp-section fp-container"
					aria-labelledby="fp-related-title"
				>
					<div className="fp-section-head">
						<RibbonTitle id="fp-related-title">{copy.related}</RibbonTitle>
						<RouterAnchor className="fp-link" href={workHref({})}>
							{flashParlourCopy.home.allWork}
						</RouterAnchor>
					</div>
					<FlashParlourPieces photos={data.related} withIds={false} />
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
		<div className="fp-ticket fp-colophon">
			<p className="fp-kicker user-text" dir="auto">
				{studio.name}
			</p>
			<h1 className="fp-artwork-title user-text" dir="auto">
				{artwork.title}
			</h1>
			{photo.caption && !artwork.titleIsCaption ? (
				<p className="user-text" dir="auto">
					{photo.caption}
				</p>
			) : null}
			<dl className="fp-facts">
				{by ? (
					<div>
						<dt>{copy.artist}</dt>
						<dd>
							<RouterAnchor className="fp-link" href={by.href}>
								<bdi>{by.name}</bdi>
							</RouterAnchor>
						</dd>
					</div>
				) : null}
				{photo.styleRefs.length > 0 ? (
					<div>
						<dt>{copy.style}</dt>
						<dd className="fp-facts-list">
							{photo.styleRefs.map((style) => (
								<RouterAnchor
									key={style.slug}
									className="fp-link"
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
				<div className="fp-colophon-ask">
					<p className="fp-label-strong">{copy.inspired}</p>
					<p>{copy.inspiredLine}</p>
					<div className="fp-hero-actions">
						<RouterAnchor
							className="action action-primary fp-cta"
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
			className="fp-section fp-container fp-artwork-artist"
			aria-labelledby="fp-artwork-artist-title"
		>
			<h2 className="fp-label" id="fp-artwork-artist-title">
				{copy.about}
			</h2>
			<div className="fp-artwork-artist-body">
				{artist.photo ? (
					<img
						className="fp-artist-small-portrait"
						src={artist.photo.src}
						srcSet={artist.photo.srcSet}
						sizes={
							artist.photo.srcSet
								? fixedPortraitSizes(artist.photo, 6)
								: undefined
						}
						width={artist.photo.width}
						height={artist.photo.height}
						alt={artist.photo.alt}
						loading="lazy"
						decoding="async"
					/>
				) : null}
				<div>
					<p className="fp-artwork-artist-name" dir="auto">
						{artist.name}
					</p>
					{artist.styles.length > 0 ? (
						<p className="fp-artist-styles">{artist.styles.join(" · ")}</p>
					) : null}
					{artist.bio ? (
						<p className="fp-artwork-artist-bio user-text" dir="auto">
							{artist.bio}
						</p>
					) : null}
					{linked ? (
						<RouterAnchor className="fp-link" href={artist.pageHref}>
							{copy.portfolio}
						</RouterAnchor>
					) : null}
				</div>
			</div>
		</section>
	);
}
