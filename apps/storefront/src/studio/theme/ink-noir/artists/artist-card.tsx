import { ArrowUpRight } from "lucide-react";
import type { DirectoryArtist } from "../../../artists.ts";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { studioCopy } from "../../../copy.ts";
import type { ArtistPhoto, WorkPhotoView } from "../../../view-model.ts";
import { inkNoirArtistsCopy } from "./copy.ts";
import {
	featurePortraitSizes,
	featureWorkSizes,
	portraitSizes,
	thumbSizes,
} from "./sizes.ts";

/** A card shows this many of the artist's newest work photos; a lone artist's feature, this many. */
const CARD_WORK = 3;
const FEATURE_WORK = 6;

/**
 * One artist in the grid: the portrait first and largest, then the name,
 * their styles, a few lines of their bio, whether they take new work and
 * three of their newest work photos. The whole card is one link to their page
 * (`/artists/<slug>`): the name is the link and stretches over the card, so
 * there is no link inside a link. The photos are a preview of that page, not
 * links of their own, so screen readers skip them (`aria-hidden`); their
 * descriptions are still there. Everything stays visible without hover: hover
 * and focus only zoom the portrait, darken it a little and show the arrow.
 */
export function DirectoryCard({
	artist,
	count,
}: {
	artist: DirectoryArtist;
	/** How many artists the grid shows: the portrait's column width follows from it. */
	count: number;
}) {
	const titleId = `artist-${artist.slug}`;
	return (
		<article className="ink-dir-card" aria-labelledby={titleId}>
			<figure className="ink-dir-portrait">
				<Portrait
					artist={artist}
					sizes={(photo) => portraitSizes(count, photo)}
				/>
				<span className="ink-dir-arrow" aria-hidden="true">
					<ArrowUpRight />
				</span>
			</figure>
			<div className="ink-dir-text">
				<h3 id={titleId} className="ink-dir-name" dir="auto">
					<RouterAnchor className="ink-dir-link" href={artist.pageHref}>
						{artist.name}
					</RouterAnchor>
				</h3>
				{artist.styleRefs.length > 0 ? (
					<p className="ink-dir-styles">
						{artist.styleRefs.map((style) => style.name).join(", ")}
					</p>
				) : null}
				<Status artist={artist} />
				{artist.bio ? (
					<p className="ink-dir-bio user-text" dir="auto">
						{artist.bio}
					</p>
				) : null}
				<WorkPreview
					photos={artist.workPhotos.slice(0, CARD_WORK)}
					className="ink-dir-work"
					sizes={thumbSizes}
				/>
			</div>
		</article>
	);
}

/**
 * A studio of one: the artist as a feature rather than a lone card. The
 * portrait beside the name set large, their styles, the whole bio, whether
 * they take new work, six of their newest work photos and the way to their
 * portfolio. The page's closing invitation asks for them by name.
 */
export function ArtistFeature({ artist }: { artist: DirectoryArtist }) {
	const titleId = `artist-${artist.slug}`;
	return (
		<article className="ink-dir-feature" aria-labelledby={titleId}>
			<figure className="ink-dir-portrait">
				<Portrait artist={artist} sizes={featurePortraitSizes} eager />
			</figure>
			<div className="ink-dir-feature-text">
				<h3 id={titleId} className="ink-dir-feature-name" dir="auto">
					{artist.name}
				</h3>
				{artist.styleRefs.length > 0 ? (
					<p className="ink-dir-styles">
						{artist.styleRefs.map((style) => style.name).join(", ")}
					</p>
				) : null}
				<Status artist={artist} />
				{artist.bio ? (
					<p className="ink-dir-feature-bio user-text" dir="auto">
						{artist.bio}
					</p>
				) : null}
				<WorkPreview
					photos={artist.workPhotos.slice(0, FEATURE_WORK)}
					className="ink-dir-feature-work"
					sizes={featureWorkSizes}
				/>
				<p className="ink-dir-feature-actions">
					<RouterAnchor
						className="action ink-action-quiet"
						href={artist.pageHref}
					>
						{inkNoirArtistsCopy.card.portfolio}
					</RouterAnchor>
				</p>
			</div>
		</article>
	);
}

/**
 * The artist's photo, or with none their name's first letter set large on the
 * raised surface, hidden from screen readers (the name is right below it).
 * Never a stand-in photograph.
 */
function Portrait({
	artist,
	sizes,
	eager = false,
}: {
	artist: DirectoryArtist;
	/** The portrait's `sizes` (sizes.ts), from its own size. */
	sizes: (photo: ArtistPhoto) => string;
	/** The page's largest image (a lone artist's feature): fetched first. */
	eager?: boolean;
}) {
	if (!artist.photo) {
		return (
			<span className="ink-dir-initial" aria-hidden="true">
				{Array.from(artist.name)[0]}
			</span>
		);
	}
	return (
		<img
			src={artist.photo.src}
			srcSet={artist.photo.srcSet}
			sizes={artist.photo.srcSet ? sizes(artist.photo) : undefined}
			width={artist.photo.width}
			height={artist.photo.height}
			alt={artist.photo.alt}
			loading={eager ? "eager" : "lazy"}
			decoding="async"
			fetchPriority={eager ? "high" : undefined}
		/>
	);
}

/** Taking new work, else the artist's own closed message, else the plain one. */
function Status({ artist }: { artist: DirectoryArtist }) {
	if (artist.accepting) {
		return <p className="ink-dir-status ink-open">{studioCopy.status.open}</p>;
	}
	return artist.closedMessage ? (
		<p className="ink-dir-status user-text" dir="auto">
			{artist.closedMessage}
		</p>
	) : (
		<p className="ink-dir-status">{studioCopy.status.closed}</p>
	);
}

/** A few of the artist's newest work photos, or nothing when they have none. */
function WorkPreview({
	photos,
	className,
	sizes,
}: {
	photos: readonly WorkPhotoView[];
	className: string;
	sizes: (photo: WorkPhotoView) => string;
}) {
	if (photos.length === 0) return null;
	return (
		<div className={className} aria-hidden="true">
			{photos.map((photo) => (
				<img
					key={photo.dialogId}
					src={photo.src}
					srcSet={photo.srcSet}
					sizes={photo.srcSet ? sizes(photo) : undefined}
					width={photo.width}
					height={photo.height}
					alt={photo.alt}
					loading="lazy"
					decoding="async"
				/>
			))}
		</div>
	);
}
