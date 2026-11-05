import { Fill } from "../../../../intake/components/fill.tsx";
import type { ArtistsDirectory } from "../../../artists.ts";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { artistsHref } from "../../../links.ts";
import { ArtistFeature, DirectoryCard } from "./artist-card.tsx";
import { inkNoirArtistsCopy } from "./copy.ts";

/**
 * The artists themselves, in the API's order: a grid of cards (one column on
 * a phone, two from 40rem, three from 64rem, every second column set a step
 * lower), one artist as a feature, or a sentence when there is nobody to show.
 * With a filter that keeps nobody (an old link to a style no one lists now) it
 * says so, names the style when it can, and offers the whole directory.
 */
export function ArtistDirectory({
	directory,
}: {
	directory: ArtistsDirectory;
}) {
	const { artists, shown, selected } = directory;
	if (artists.length === 0) {
		return (
			<div className="ink-container ink-dir-empty">
				<p className="ink-dir-empty-title">{inkNoirArtistsCopy.empty.title}</p>
				<p>{inkNoirArtistsCopy.empty.line}</p>
			</div>
		);
	}
	if (shown.length === 0) {
		const copy = inkNoirArtistsCopy.noMatch;
		return (
			<div className="ink-container ink-dir-empty">
				<p className="ink-dir-empty-title">
					{selected?.name ? (
						<Fill template={copy.named} values={{ style: selected.name }} />
					) : (
						copy.unknown
					)}
				</p>
				<p>
					<RouterAnchor
						className="ink-link"
						href={artistsHref({})}
						resetScroll={false}
					>
						{copy.reset}
					</RouterAnchor>
				</p>
			</div>
		);
	}
	if (artists.length === 1) {
		return (
			<div className="ink-container">
				<ArtistFeature artist={shown[0]} />
			</div>
		);
	}
	return (
		<div className="ink-container">
			{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
			<ul
				className={
					shown.length === 2 ? "ink-dir-grid ink-dir-grid-2" : "ink-dir-grid"
				}
				// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
				role="list"
			>
				{shown.map((artist) => (
					<li key={artist.id}>
						<DirectoryCard artist={artist} count={shown.length} />
					</li>
				))}
			</ul>
		</div>
	);
}
