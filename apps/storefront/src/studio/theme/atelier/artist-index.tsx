import { RouterAnchor } from "../../components/router-anchor.tsx";
import { studioCopy } from "../../copy.ts";
import { isAllowedHref } from "../../links.ts";
import type { ArtistView } from "../../view-model.ts";
import { portraitSizes } from "./sizes.ts";

/**
 * Whether an artist takes new work, in their own words when they wrote some
 * (the shared rule: "Taking new work", else their closed message, else "Not
 * taking new work right now").
 */
export function AtelierStatus({ artist }: { artist: ArtistView }) {
	if (artist.accepting) {
		return (
			<p className="atl-status atl-status-open">{studioCopy.status.open}</p>
		);
	}
	return (
		<p className="atl-status atl-status-closed user-text" dir="auto">
			{artist.closedMessage ?? studioCopy.status.closed}
		</p>
	);
}

/**
 * The first letter of a name as a reader sees it (one grapheme: "श्री" keeps
 * its conjunct, a decomposed "É" its accent), for the arch of an artist
 * without a portrait (decoration).
 */
export function initialOf(name: string): string {
	const first = new Intl.Segmenter(undefined, { granularity: "grapheme" })
		.segment(name.trim())
		[Symbol.iterator]()
		.next();
	return first.done ? "" : first.value.segment;
}

/**
 * An artist's portrait in an arch (cropped to 4:5: a person, not a
 * composition), or for an artist without one their initial set in the
 * display face inside the same arch: decoration, never a made-up photo.
 */
export function ArtistArch({
	artist,
	sizes,
	loading = "lazy",
	className = "atl-arch",
}: {
	artist: ArtistView;
	sizes?: string;
	loading?: "lazy" | "eager";
	className?: string;
}) {
	if (!artist.photo) {
		return (
			<span className={`${className} atl-arch-initial`} aria-hidden="true">
				{initialOf(artist.name)}
			</span>
		);
	}
	return (
		<span className={className}>
			<img
				src={artist.photo.src}
				srcSet={artist.photo.srcSet}
				sizes={
					artist.photo.srcSet
						? (sizes ?? portraitSizes(artist.photo))
						: undefined
				}
				width={artist.photo.width}
				height={artist.photo.height}
				alt={artist.photo.alt}
				loading={loading}
				decoding="async"
			/>
		</span>
	);
}

/**
 * The artists as a row of arches: each the artist's arch, their name (the
 * card's one link, stretched over it), the styles they list and whether they
 * take new work. As many 16rem arches as fit on a line, centred (a lone
 * artist's a little wider).
 * `headingLevel` follows the page: h2 under the directory's h1, h3 under a
 * section's h2.
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
		<ul
			className="atl-artist-index"
			// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
			role="list"
			data-count={Math.min(artists.length, 4)}
		>
			{artists.map((artist) => {
				const titleId = `atl-artist-${artist.slug}`;
				const linked = isAllowedHref(artist.pageHref);
				return (
					<li key={artist.slug} className="atl-artist-entry">
						<article aria-labelledby={titleId}>
							<ArtistArch artist={artist} />
							<Name id={titleId} className="atl-artist-name" dir="auto">
								{linked ? (
									<RouterAnchor
										className="atl-artist-link"
										href={artist.pageHref}
									>
										{artist.name}
									</RouterAnchor>
								) : (
									artist.name
								)}
							</Name>
							{artist.styles.length > 0 ? (
								<p className="atl-artist-styles">{artist.styles.join(" · ")}</p>
							) : null}
							<AtelierStatus artist={artist} />
						</article>
					</li>
				);
			})}
		</ul>
	);
}
