import { Fill } from "../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import { studioCopy } from "../../copy.ts";
import { isAllowedHref } from "../../links.ts";
import type { ArtistView } from "../../view-model.ts";
import { irezumiCopy } from "./copy.ts";
import { portraitSizes } from "./sizes.ts";

/**
 * Whether an artist takes new work, in their own words when they wrote some
 * (the shared rule: "Taking new work", else their closed message, else "Not
 * taking new work right now").
 */
export function IrezumiStatus({ artist }: { artist: ArtistView }) {
	if (artist.accepting) {
		return (
			<p className="irz-status irz-status-open">{studioCopy.status.open}</p>
		);
	}
	return (
		<p className="irz-status irz-status-closed user-text" dir="auto">
			{artist.closedMessage ?? studioCopy.status.closed}
		</p>
	);
}

/**
 * The artists as an index of entries: each the artist's portrait (cropped to
 * 4:5: a person, not a composition), else nothing, beside their name (the
 * link to their page), their styles, whether they take new work, and up to
 * three of their recent pieces drawn whole as small previews. `headingLevel`
 * follows the page: h2 under the directory's h1, h3 under a section's h2.
 */
export function ArtistIndex({
	artists,
	headingLevel,
}: {
	artists: readonly ArtistView[];
	headingLevel: 2 | 3;
}) {
	if (artists.length === 0) return null;
	const Name = headingLevel === 2 ? "h2" : "h3";
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="irz-artist-index" role="list">
			{artists.map((artist) => {
				const titleId = `irz-artist-${artist.slug}`;
				const linked = isAllowedHref(artist.pageHref);
				const previews = artist.workPhotos.slice(0, 3);
				return (
					<li key={artist.slug} className="irz-artist-entry">
						<article aria-labelledby={titleId}>
							{artist.photo ? (
								<img
									className="irz-artist-portrait"
									src={artist.photo.src}
									srcSet={artist.photo.srcSet}
									sizes={
										artist.photo.srcSet
											? portraitSizes(artist.photo)
											: undefined
									}
									width={artist.photo.width}
									height={artist.photo.height}
									alt={artist.photo.alt}
									loading="lazy"
									decoding="async"
								/>
							) : null}
							<div className="irz-artist-body">
								<Name id={titleId} className="irz-artist-name" dir="auto">
									{linked ? (
										<RouterAnchor
											className="irz-artist-link"
											href={artist.pageHref}
										>
											{artist.name}
										</RouterAnchor>
									) : (
										artist.name
									)}
								</Name>
								{artist.styles.length > 0 ? (
									<p className="irz-artist-styles">
										{artist.styles.join(" · ")}
									</p>
								) : null}
								<IrezumiStatus artist={artist} />
								{previews.length > 0 ? (
									<div className="irz-artist-previews" aria-hidden="true">
										{previews.map((photo) => (
											<img
												key={photo.src}
												className="irz-preview"
												src={photo.src}
												srcSet={photo.srcSet}
												sizes={
													photo.srcSet
														? "(min-width: 48rem) 8rem, 6rem"
														: undefined
												}
												width={photo.width}
												height={photo.height}
												alt=""
												loading="lazy"
												decoding="async"
											/>
										))}
									</div>
								) : null}
								{linked ? (
									<p className="irz-artist-more" aria-hidden="true">
										{previews.length > 1 ? (
											<Fill
												template={irezumiCopy.artists.pieces}
												values={{ count: String(artist.workPhotos.length) }}
											/>
										) : (
											irezumiCopy.artists.portfolio
										)}
									</p>
								) : null}
							</div>
						</article>
					</li>
				);
			})}
		</ul>
	);
}
