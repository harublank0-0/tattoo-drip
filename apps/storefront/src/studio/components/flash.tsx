import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import {
	closedNoteFor,
	type FlashDesignView,
	type FlashListView,
} from "../flash.ts";
import { flashHref, isAllowedHref } from "../links.ts";
import { flashGridSizes } from "../srcset.ts";
import type { ArtistView } from "../view-model.ts";

/**
 * The flash designs' pieces (TAT-129): the grid of cards, and an artist's
 * Flash section. Props only and no state, script or focus handling: a card is
 * a plain link to the design's own page, and "Show more" is a link too.
 */

/**
 * Designs as a grid of cards, newest first. A card links to the design's page
 * and holds the picture (drawn whole, from its copies), the name, the artist
 * (`showArtist`: an artist's own page does not name them on each card), the
 * price when the studio set one and, for a design that can't be requested
 * now, the words why (the card is then greyed but still a link). Nothing when
 * there are no designs.
 */
export function FlashGrid({
	designs,
	showArtist,
	artists,
}: {
	designs: readonly FlashDesignView[];
	showArtist: boolean;
	artists: readonly ArtistView[];
}) {
	if (designs.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="flash-grid" role="list">
			{designs.map((design) => {
				const note = closedNoteFor(design, artists);
				return (
					<li
						key={design.id}
						className={
							note === null ? "flash-card" : "flash-card flash-card-closed"
						}
					>
						<a
							href={isAllowedHref(design.href) ? design.href : undefined}
							className="flash-card-link"
						>
							<img
								className="flash-card-picture"
								src={design.image.src}
								srcSet={design.image.srcSet}
								sizes={design.image.srcSet ? flashGridSizes() : undefined}
								width={design.image.width}
								height={design.image.height}
								alt={design.alt}
								loading="lazy"
								decoding="async"
							/>
							<span className="flash-card-name user-text" dir="auto">
								<bdi>{design.name}</bdi>
							</span>
							{showArtist && design.artist ? (
								<span className="flash-card-artist">
									<Fill
										template={studioCopy.flash.by}
										values={{ name: design.artist.name }}
									/>
								</span>
							) : null}
							{design.priceText ? (
								<span className="flash-card-price">{design.priceText}</span>
							) : null}
							{note ? (
								<p className="note user-text" dir="auto">
									{note}
								</p>
							) : null}
						</a>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * An artist's Flash section (TAT-129): their newest designs, at most 12, and
 * "All flash by {name}" when more follow. Nothing when they have no shown
 * design.
 */
export function ArtistFlash({
	artist,
	list,
}: {
	artist: ArtistView;
	list: FlashListView;
}) {
	if (list.designs.length === 0) return null;
	return (
		<section id="flash" className="section" aria-labelledby="flash-title">
			<h2 id="flash-title" className="section-title">
				{studioCopy.flash.title}
			</h2>
			<FlashGrid designs={list.designs} showArtist={false} artists={[artist]} />
			{list.nextCursor !== null ? (
				<p className="flash-all">
					<a className="text-link" href={flashHref({ artist: artist.slug })}>
						<span>
							<Fill
								template={studioCopy.flash.allBy}
								values={{ name: artist.name }}
							/>
						</span>
					</a>
				</p>
			) : null}
		</section>
	);
}
