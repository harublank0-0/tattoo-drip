import { Fill } from "../../../../intake/components/fill.tsx";
import type { ArtworkView } from "../../../artwork.ts";
import { ArtworkFigure } from "../../../components/gallery.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { GalleryPhotoView } from "../../../gallery.ts";
import { isAllowedHref, workHref } from "../../../links.ts";
import type { ArtistView, StudioView } from "../../../view-model.ts";
import { Lines, SectionHead } from "../home/parts.tsx";
import { ArtworkRows } from "./artwork-card.tsx";
import { inkNoirGalleryCopy } from "./copy.ts";
import { artworkSizes, attributionSizes } from "./sizes.ts";

const copy = inkNoirGalleryCopy.piece;

type Similar = { readonly href: string; readonly artist: ArtistView | null };

/**
 * The piece itself: the breadcrumb back to the gallery, the photo large (the
 * page's main image, whole, a button to the full-screen viewer), and beside it
 * (beneath it on a phone) its first style as the line above the title, the
 * title (the page's one h1), what the API knows of it (artist, styles, healed,
 * studio) and the two ways on. Placement, technique and a date are not in the
 * data, so they are not on the page.
 */
export function ArtworkHero({
	artwork,
	studio,
	similar,
}: {
	artwork: ArtworkView;
	studio: StudioView;
	similar: Similar | null;
}) {
	const { photo, artist } = artwork;
	const by =
		photo.artist && isAllowedHref(photo.artist.href) ? photo.artist : null;
	return (
		<header className="ink-artwork-hero">
			<div className="ink-container ink-artwork-grid">
				<nav className="ink-breadcrumb" aria-label={copy.breadcrumb}>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ol
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						<li>
							<RouterAnchor href={workHref({})}>{copy.gallery}</RouterAnchor>
						</li>
						<li>
							<span aria-current="page" dir="auto">
								{artwork.title}
							</span>
						</li>
					</ol>
				</nav>
				<ArtworkFigure
					photo={photo}
					sizes={artworkSizes()}
					className="ink-artwork-figure"
				/>
				<div className="ink-artwork-text">
					<p className="ink-label">{photo.styles[0] ?? copy.tattoo}</p>
					<h1 className="ink-artwork-title user-text" dir="auto">
						{artwork.title}
					</h1>
					<dl className="ink-hero-meta ink-artwork-meta">
						{by ? (
							<div>
								<dt>{copy.meta.artist}</dt>
								<dd>
									<RouterAnchor href={by.href}>
										<bdi>{by.name}</bdi>
									</RouterAnchor>
								</dd>
							</div>
						) : null}
						{photo.styleRefs.length > 0 ? (
							<div>
								<dt>{copy.meta.styles}</dt>
								<dd className="ink-artwork-styles">
									{photo.styleRefs.map((style) => (
										<RouterAnchor
											key={style.slug}
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
								<dt>{copy.meta.healed}</dt>
								<dd>{copy.meta.healedValue}</dd>
							</div>
						) : null}
						<div>
							<dt>{copy.meta.studio}</dt>
							<dd dir="auto">
								{studio.type === "independent" ? copy.independent : studio.name}
							</dd>
						</div>
					</dl>
					<div className="ink-hero-actions">
						{similar && isAllowedHref(similar.href) ? (
							<RouterAnchor
								className="action action-primary ink-cta"
								href={similar.href}
							>
								{copy.similar}
							</RouterAnchor>
						) : null}
						{artist && isAllowedHref(artist.pageHref) ? (
							<RouterAnchor
								className="action ink-action-quiet"
								href={artist.pageHref}
							>
								{copy.viewArtist}
							</RouterAnchor>
						) : null}
					</div>
				</div>
			</div>
		</header>
	);
}

/**
 * Who made it: the artist's portrait when they have one, their name, their
 * first listed style, the start of their own bio, their portfolio and their
 * own request while they take new work (else their own closed words). The
 * artist as the studio's list has them; nothing when the photo names no
 * artist the list has.
 */
export function ArtworkArtist({ artist }: { artist: ArtistView | null }) {
	if (!artist) return null;
	return (
		<section
			className="ink-section ink-artwork-artist"
			aria-labelledby="artwork-artist-title"
		>
			<div className="ink-container ink-artwork-artist-grid">
				{artist.photo ? (
					<img
						className="ink-artwork-artist-photo"
						src={artist.photo.src}
						srcSet={artist.photo.srcSet}
						sizes={artist.photo.srcSet ? attributionSizes() : undefined}
						width={artist.photo.width}
						height={artist.photo.height}
						alt={artist.photo.alt}
						loading="lazy"
						decoding="async"
					/>
				) : null}
				<div className="ink-artwork-artist-text">
					<SectionHead id="artwork-artist-title" label={copy.artist.label}>
						<bdi>{artist.name}</bdi>
					</SectionHead>
					{artist.styles[0] ? (
						<p className="ink-artwork-artist-style">{artist.styles[0]}</p>
					) : null}
					{artist.bio ? (
						<p className="ink-artwork-artist-bio user-text" dir="auto">
							{artist.bio}
						</p>
					) : null}
					<div className="ink-hero-actions">
						{isAllowedHref(artist.pageHref) ? (
							<RouterAnchor className="ink-link" href={artist.pageHref}>
								{copy.artist.portfolio}
							</RouterAnchor>
						) : null}
						{artist.accepting && isAllowedHref(artist.requestHref) ? (
							<RouterAnchor className="ink-link" href={artist.requestHref}>
								{copy.artist.request}
							</RouterAnchor>
						) : artist.closedMessage ? (
							<p className="status status-closed user-text" dir="auto">
								{artist.closedMessage}
							</p>
						) : null}
					</div>
				</div>
			</div>
		</section>
	);
}

/**
 * The invitation: "Inspired by this piece?", and "Request a similar tattoo"
 * to the artist's own form while they take new work, else the studio's while
 * it does (the form starts with a link to the piece, nothing is sent until
 * the client sends it). Never a promise of the same tattoo. While nobody
 * takes new work it says so, with no button.
 */
export function ArtworkBooking({
	similar,
	artist,
	studio,
}: {
	similar: Similar | null;
	artist: ArtistView | null;
	studio: StudioView;
}) {
	const open = similar !== null && isAllowedHref(similar.href);
	return (
		<section
			id="inquiry"
			className="ink-section ink-close"
			aria-labelledby="artwork-booking-title"
		>
			<div className="ink-container ink-close-grid">
				<h2 id="artwork-booking-title" className="ink-close-title">
					<Lines lines={copy.booking.lines} />
				</h2>
				<div className="ink-close-body">
					{open ? (
						<>
							<p className="ink-close-line">{copy.booking.line}</p>
							<div className="ink-hero-actions">
								<RouterAnchor
									className="action action-primary ink-cta"
									href={similar.href}
								>
									{copy.similar}
								</RouterAnchor>
							</div>
						</>
					) : (
						<p className="ink-close-line">
							<Fill
								template={copy.booking.closed}
								values={{ name: artist?.name ?? studio.name }}
							/>
						</p>
					)}
				</div>
			</div>
		</section>
	);
}

/** Up to six related pieces (relatedArtwork), as the gallery shows them, and the way back to all of them; nothing for none. */
export function RelatedArtwork({
	related,
}: {
	related: readonly GalleryPhotoView[];
}) {
	if (related.length === 0) return null;
	return (
		<section
			className="ink-section ink-related"
			aria-labelledby="artwork-related-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead id="artwork-related-title" label={copy.related.label}>
						{copy.related.title}
					</SectionHead>
					<RouterAnchor className="ink-link" href={workHref({})}>
						{copy.related.all}
					</RouterAnchor>
				</div>
				<ArtworkRows photos={related} />
			</div>
		</section>
	);
}
