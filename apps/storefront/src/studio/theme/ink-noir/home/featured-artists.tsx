import { Fill } from "../../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { studioCopy } from "../../../copy.ts";
import { isAllowedHref } from "../../../links.ts";
import type { ArtistView } from "../../../view-model.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { artistPortraitSizes } from "./home-view.ts";
import { SectionHead } from "./parts.tsx";

const copy = inkNoirHomeCopy.artists;

/**
 * The artists, led by their portraits. Every shown artist is here (there is
 * no directory page to send the rest to), each linking to their own page
 * (`/artists/<slug>`): the name is the link, and it covers the portrait too.
 * One artist (an independent artist, or a studio of one) gets the whole
 * width: portrait beside name, styles, bio and their portfolio, so the page
 * never looks like a roster with gaps.
 *
 * The "Request {name}" links follow the roster's rule (ArtistRoster): each
 * open artist has one when there is more than one artist, or while the studio
 * as a whole is closed, since then nothing else on the page asks for them.
 * The `artists` id is the header's Artists link (`/#artists`).
 */
export function FeaturedArtists({
	artists,
	studioAccepting,
}: {
	artists: readonly ArtistView[];
	studioAccepting: boolean;
}) {
	if (artists.length === 0) return null;
	const one = artists.length === 1;
	const askLinks = !one || !studioAccepting;
	return (
		<section
			id="artists"
			className="ink-section ink-artists"
			aria-labelledby="artists-title"
		>
			<div className="ink-container">
				<SectionHead
					id="artists-title"
					label={one ? copy.eyebrow.one : copy.eyebrow.many}
				>
					{one ? copy.title.one : copy.title.many}
				</SectionHead>
				{one ? (
					<ArtistCard
						artist={artists[0]}
						count={1}
						askLink={askLinks && artists[0].accepting}
						feature
					/>
				) : (
					// biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none
					<ul
						className={`ink-artist-list ink-artist-list-${Math.min(artists.length, 4)}`}
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{artists.map((artist) => (
							<li key={artist.id}>
								<ArtistCard
									artist={artist}
									count={artists.length}
									askLink={askLinks && artist.accepting}
									feature={false}
								/>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function ArtistCard({
	artist,
	count,
	askLink,
	feature,
}: {
	artist: ArtistView;
	count: number;
	askLink: boolean;
	feature: boolean;
}) {
	const titleId = `artist-${artist.slug}`;
	return (
		<article
			className={feature ? "ink-artist ink-artist-feature" : "ink-artist"}
			aria-labelledby={titleId}
		>
			<figure className="ink-artist-photo">
				{artist.photo ? (
					<img
						src={artist.photo.src}
						srcSet={artist.photo.srcSet}
						sizes={
							artist.photo.srcSet
								? artistPortraitSizes(count, artist.photo)
								: undefined
						}
						width={artist.photo.width}
						height={artist.photo.height}
						alt={artist.photo.alt}
						loading="lazy"
						decoding="async"
					/>
				) : (
					// No portrait: the name's first letter, set large, holds the place. It says nothing new.
					<span className="ink-artist-initial" aria-hidden="true">
						{Array.from(artist.name)[0]}
					</span>
				)}
			</figure>
			<div className="ink-artist-text">
				<h3 id={titleId} className="ink-artist-name" dir="auto">
					<RouterAnchor className="ink-artist-link" href={artist.pageHref}>
						{artist.name}
					</RouterAnchor>
				</h3>
				{artist.styles.length > 0 ? (
					<p className="ink-artist-styles">{artist.styles.join(", ")}</p>
				) : null}
				{artist.accepting ? (
					<p className="ink-artist-status ink-open">{studioCopy.status.open}</p>
				) : artist.closedMessage ? (
					<p className="ink-artist-status user-text" dir="auto">
						{artist.closedMessage}
					</p>
				) : (
					<p className="ink-artist-status">{studioCopy.status.closed}</p>
				)}
				{artist.bio ? (
					<p className="ink-artist-bio user-text" dir="auto">
						{artist.bio}
					</p>
				) : null}
				{feature || askLink ? (
					<div className="ink-artist-actions">
						{feature ? (
							<RouterAnchor
								className="action ink-action-quiet"
								href={artist.pageHref}
							>
								{copy.portfolio}
							</RouterAnchor>
						) : null}
						{askLink && isAllowedHref(artist.requestHref) ? (
							<RouterAnchor
								className="action action-primary"
								href={artist.requestHref}
							>
								<span>
									<Fill
										template={copy.request}
										values={{ name: artist.name }}
									/>
								</span>
							</RouterAnchor>
						) : null}
					</div>
				) : null}
			</div>
		</article>
	);
}
