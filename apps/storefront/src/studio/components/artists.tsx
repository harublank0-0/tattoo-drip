import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import {
	profilePhotoSizes,
	rosterPhotoSizes,
	workStripSizes,
} from "../srcset.ts";
import type { ArtistPhoto, ArtistView, StudioView } from "../view-model.ts";

/**
 * Photos are the stored image (up to 2048 px, TAT-44): width and height are
 * always set and CSS crops them to 4:5, so nothing shifts while they load.
 * When the API sent smaller copies the browser picks one by `srcset` and
 * `sizes` (the width the browser must ask for to fill the 4:5 box without
 * enlarging the copy, from this photo's own size: srcset.ts); `src` stays the
 * stored image. The artist page's photo is its largest element and loads
 * first; roster photos are below the fold and load lazily.
 */
function PhotoFigure({
	photo,
	priority,
	sizes,
}: {
	photo: ArtistPhoto;
	priority: boolean;
	sizes: string;
}) {
	return (
		<figure className="artist-photo">
			<img
				src={photo.src}
				srcSet={photo.srcSet}
				sizes={photo.srcSet ? sizes : undefined}
				width={photo.width}
				height={photo.height}
				alt={photo.alt}
				loading={priority ? "eager" : "lazy"}
				decoding="async"
				fetchPriority={priority ? "high" : "low"}
			/>
		</figure>
	);
}

/** The roster shows this many of an artist's work photos. */
const STRIP_PHOTOS = 3;

/**
 * The first three work photos of an artist (TAT-116), as small squares in one
 * link to their page's work grid. The squares are decorative (`alt=""`): the
 * link's own text names where it goes.
 */
function WorkStrip({ artist }: { artist: ArtistView }) {
	if (artist.workPhotos.length === 0) return null;
	return (
		<a className="work-link" href={`${artist.pageHref}#work`}>
			<span className="work-strip">
				{artist.workPhotos.slice(0, STRIP_PHOTOS).map((photo) => (
					<img
						key={photo.dialogId}
						className="work-thumb"
						src={photo.src}
						srcSet={photo.srcSet}
						sizes={photo.srcSet ? workStripSizes(photo) : undefined}
						width={photo.width}
						height={photo.height}
						alt=""
						loading="lazy"
						decoding="async"
						fetchPriority="low"
					/>
				))}
			</span>
			<span className="work-link-text">
				<Fill
					template={studioCopy.work.seeWork}
					values={{ name: artist.name }}
				/>
			</span>
		</a>
	);
}

function ArtistStatus({ accepting }: { accepting: boolean }) {
	return accepting ? (
		<p className="status status-open">Taking new inquiries</p>
	) : (
		<p className="status status-closed">Not taking new inquiries</p>
	);
}

function ArtistEntry({
	artist,
	askLink,
}: {
	artist: ArtistView;
	askLink: boolean;
}) {
	const titleId = `artist-${artist.slug}`;
	return (
		<article
			className={artist.photo ? "artist" : "artist artist-no-photo"}
			aria-labelledby={titleId}
		>
			{artist.photo ? (
				<PhotoFigure
					photo={artist.photo}
					priority={false}
					sizes={rosterPhotoSizes(artist.photo)}
				/>
			) : null}
			<div className="artist-head">
				<h3 id={titleId} className="artist-name" dir="auto">
					{artist.name}
				</h3>
				<ArtistStatus accepting={artist.accepting} />
			</div>
			<div className="artist-body">
				{artist.bio ? (
					<p className="user-text measure" dir="auto">
						{artist.bio}
					</p>
				) : null}
				{artist.closedMessage ? (
					<p className="note user-text measure" dir="auto">
						{artist.closedMessage}
					</p>
				) : null}
				<WorkStrip artist={artist} />
				{askLink ? (
					<div className="actions">
						<a className="action action-secondary" href={artist.inquiryHref}>
							<span>
								Ask for <bdi>{artist.name}</bdi>
							</span>
						</a>
					</div>
				) : null}
			</div>
		</article>
	);
}

/** The studio page's artists (TAT-48). Nothing when the studio shows none. */
export function ArtistRoster({ artists }: { artists: readonly ArtistView[] }) {
	if (artists.length === 0) return null;
	// With one artist, "Send your idea" already asks for them.
	const askLinks = artists.length > 1;
	return (
		<section id="artists" className="section" aria-labelledby="artists-title">
			<h2 id="artists-title" className="section-title">
				{artists.length === 1 ? "Artist" : "Artists"}
			</h2>
			<ul className="roster">
				{artists.map((artist) => (
					<li key={artist.id}>
						<ArtistEntry
							artist={artist}
							askLink={askLinks && artist.accepting}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The artist page's profile (TAT-48): the photo first, then who they are. */
export function ArtistProfile({
	artist,
	studio,
}: {
	artist: ArtistView;
	studio: StudioView;
}) {
	return (
		<article
			className={
				artist.photo ? "artist-profile" : "artist-profile artist-no-photo"
			}
			aria-labelledby="artist-title"
		>
			{artist.photo ? (
				<PhotoFigure
					photo={artist.photo}
					priority
					sizes={profilePhotoSizes(artist.photo)}
				/>
			) : null}
			<div className="artist-profile-text">
				<h1 id="artist-title" className="artist-title" dir="auto">
					{artist.name}
				</h1>
				<p className="profile-type">
					{studio.type === "independent" ? (
						"Independent tattoo artist"
					) : (
						<>
							Tattoo artist at <bdi>{studio.name}</bdi>
						</>
					)}
				</p>
				<ArtistStatus accepting={artist.accepting} />
				{artist.bio ? (
					<p className="user-text measure" dir="auto">
						{artist.bio}
					</p>
				) : null}
				{artist.closedMessage ? (
					<p className="note user-text measure" dir="auto">
						{artist.closedMessage}
					</p>
				) : null}
				{artist.accepting ? (
					<div className="actions">
						<a className="action action-primary" href="#inquiry">
							{studioCopy.sendIdea}
						</a>
					</div>
				) : null}
			</div>
		</article>
	);
}
