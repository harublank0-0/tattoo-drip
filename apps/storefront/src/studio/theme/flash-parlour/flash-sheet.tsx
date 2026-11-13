import { Fill } from "../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import { studioCopy } from "../../copy.ts";
import { closedNoteFor, type FlashDesignView } from "../../flash.ts";
import { isAllowedHref } from "../../links.ts";
import type { ArtistView } from "../../view-model.ts";
import { flashParlourCopy } from "./copy.ts";
import { flashSheetSizes } from "./sizes.ts";

const copy = flashParlourCopy.wall;

/**
 * Flash designs pinned up as sheets on a wall: a tight grid of square cells,
 * each a sheet with its picture drawn whole (`object-fit: contain` in a square
 * cell, never cropped: the picture's own width and height are its `<img>`'s),
 * then its name (the sheet's link to the design's page, the picture being
 * decoration inside it, `alt=""`), its size and its price (or "Ask for a
 * price"), whose design it is (`showArtist`), and "Request this design" into
 * the flash request flow while it can be asked for. A design that can't be
 * asked for now says why in the artist's own words, else ours; one someone
 * has claimed is greyed, stamped "Claimed" and asks for nothing (its page
 * offers something similar). Nothing for no designs.
 *
 * `wall` is the home page's wall (six across from 80rem; on a phone the
 * first six only, the rest a link away); `eager` the number of pictures the
 * first screen shows, loaded at once.
 */
export function FlashSheet({
	designs,
	artists,
	showArtist = true,
	wall = false,
	eager = 0,
}: {
	designs: readonly FlashDesignView[];
	artists: readonly ArtistView[];
	showArtist?: boolean;
	wall?: boolean;
	eager?: number;
}) {
	if (designs.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		<ul
			className={wall ? "fp-flash-grid fp-flash-grid-wall" : "fp-flash-grid"}
			// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
			role="list"
		>
			{designs.map((design, index) => (
				<FlashCard
					key={design.id}
					design={design}
					note={closedNoteFor(design, artists)}
					showArtist={showArtist}
					wall={wall}
					eager={index < eager}
				/>
			))}
		</ul>
	);
}

function FlashCard({
	design,
	note,
	showArtist,
	wall,
	eager,
}: {
	design: FlashDesignView;
	note: string | null;
	showArtist: boolean;
	wall: boolean;
	eager: boolean;
}) {
	const requestable =
		!design.claimed && note === null && isAllowedHref(design.requestHref);
	const state = design.claimed
		? " fp-card-claimed"
		: note === null
			? ""
			: " fp-card-closed";
	const picture = (
		<span className="fp-card-sheet">
			<img
				className="fp-card-picture"
				src={design.image.src}
				srcSet={design.image.srcSet}
				sizes={design.image.srcSet ? flashSheetSizes(wall) : undefined}
				width={design.image.width}
				height={design.image.height}
				alt=""
				loading={eager ? "eager" : "lazy"}
				decoding="async"
			/>
		</span>
	);
	return (
		<li className={`fp-card${state}`}>
			{isAllowedHref(design.href) ? (
				<RouterAnchor className="fp-card-link" href={design.href}>
					{picture}
					<span className="fp-card-name user-text" dir="auto">
						{design.name}
					</span>
					{design.claimed ? (
						<span className="fp-card-stamp">{studioCopy.flash.claimed}</span>
					) : null}
				</RouterAnchor>
			) : null}
			<p className="fp-card-facts">
				<span className="fp-card-size user-text" dir="auto">
					{design.size}
				</span>
				{design.priceText ? (
					<span className="fp-card-price">{design.priceText}</span>
				) : design.claimed ? null : (
					<span className="fp-card-price fp-card-price-ask">
						{copy.askPrice}
					</span>
				)}
			</p>
			{showArtist && design.artist ? (
				<p className="fp-card-by">
					<Fill
						template={studioCopy.flash.by}
						values={{ name: design.artist.name }}
					/>
				</p>
			) : null}
			{note !== null && !design.claimed ? (
				<p className="fp-card-note user-text" dir="auto">
					{note}
				</p>
			) : null}
			{requestable ? (
				<RouterAnchor className="fp-card-request" href={design.requestHref}>
					<span>
						{copy.request}
						<span className="sr-only">
							<Fill template={copy.requestOf} values={{ name: design.name }} />
						</span>
					</span>
				</RouterAnchor>
			) : null}
		</li>
	);
}
