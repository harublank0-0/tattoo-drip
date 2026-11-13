import { RouterAnchor } from "../../components/router-anchor.tsx";
import { studioCopy } from "../../copy.ts";
import { isAllowedHref } from "../../links.ts";
import type { ArtistView } from "../../view-model.ts";
import { Star } from "./ornaments.tsx";
import { portraitSizes } from "./sizes.ts";

/**
 * Whether an artist takes new work, in their own words when they wrote some
 * (the shared rule: "Taking new work", else their closed message, else "Not
 * taking new work right now"): the open line in the deep green, a closed one
 * in the muted ink.
 */
export function FlashParlourStatus({ artist }: { artist: ArtistView }) {
	if (artist.accepting) {
		return <p className="fp-status fp-status-open">{studioCopy.status.open}</p>;
	}
	return (
		<p className="fp-status fp-status-closed user-text" dir="auto">
			{artist.closedMessage ?? studioCopy.status.closed}
		</p>
	);
}

/**
 * The first letter of a name as a reader sees it (one grapheme: "श्री" keeps
 * its conjunct, a decomposed "É" its accent), for the frame of an artist
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
 * An artist's portrait in a heavy ink frame (cropped to 4:5: a person, not a
 * composition), or for an artist without one their initial on a mustard star
 * in the same frame: decoration, never a made-up photo.
 */
export function ArtistFrame({
	artist,
	sizes,
	loading = "lazy",
	className = "fp-frame",
}: {
	artist: ArtistView;
	sizes?: string;
	loading?: "lazy" | "eager";
	className?: string;
}) {
	if (!artist.photo) {
		return (
			<span className={`${className} fp-frame-initial`} aria-hidden="true">
				<Star tone="mustard" className="fp-frame-star" />
				<span className="fp-frame-letter">{initialOf(artist.name)}</span>
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
 * The artists as cards on the wall: each the artist's frame, their name (the
 * card's one link, stretched over it), the styles they list and whether they
 * take new work. One column on a narrow phone, up to four across.
 * `headingLevel` follows the page: h2 under the directory's h1, h3 under a
 * section's h2.
 */
export function ArtistGrid({
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
			className="fp-artist-grid"
			// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
			role="list"
		>
			{artists.map((artist) => {
				const titleId = `fp-artist-${artist.slug}`;
				const linked = isAllowedHref(artist.pageHref);
				return (
					<li key={artist.slug} className="fp-artist-card">
						<article aria-labelledby={titleId}>
							<ArtistFrame artist={artist} />
							<Name id={titleId} className="fp-artist-name" dir="auto">
								{linked ? (
									<RouterAnchor
										className="fp-artist-link"
										href={artist.pageHref}
									>
										{artist.name}
									</RouterAnchor>
								) : (
									artist.name
								)}
							</Name>
							{artist.styles.length > 0 ? (
								<p className="fp-artist-styles">{artist.styles.join(" · ")}</p>
							) : null}
							<FlashParlourStatus artist={artist} />
						</article>
					</li>
				);
			})}
		</ul>
	);
}
