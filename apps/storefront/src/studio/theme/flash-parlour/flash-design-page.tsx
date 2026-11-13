import { Fill } from "../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { flashHref, isAllowedHref, requestHref } from "../../links.ts";
import type { FlashDesignPageData } from "../../loaders.ts";
import { flashParlourCopy } from "./copy.ts";
import { Star } from "./ornaments.tsx";
import { FlashParlourShell } from "./shell.tsx";
import { designSizes } from "./sizes.ts";

const copy = flashParlourCopy.flash;

/** The words before the artist's name in "by {name}": the name itself is a link here. */
const BY = studioCopy.flash.by.replace("{name}", "");

/**
 * One flash design's page (`/flash/$id`) in Flash Parlour: the design pinned
 * up large on its sheet, whole (`object-fit: contain`, the picture's own
 * width and height), eager and high priority; beside it from 60rem its
 * ticket: its name (the page's h1), whose it is, its size, its price or "Ask
 * for a price", and its state ("Available", the artist's own words why it
 * can't be asked for now, or "Claimed", when the studio shows claimed
 * designs, with the sheet greyed and stamped); then "Request this design"
 * while it can be, "Ask for something similar" (the artist) or "Send your
 * idea" (the studio) for a claimed one while someone takes work, and the
 * way to the rest of the artist's flash. The same data every theme gets
 * (loadFlashDesignPage).
 */
export function FlashParlourFlashDesignPage({
	data,
	Shell = FlashParlourShell,
}: {
	data: FlashDesignPageData;
	Shell?: Shell;
}) {
	const { studio, theme, design, closedNote, similar } = data;
	const artist =
		design.artist && isAllowedHref(design.artist.href) ? design.artist : null;
	const action = design.claimed
		? similar === "artist"
			? { href: design.requestHref, label: studioCopy.flash.similar }
			: similar === "studio"
				? { href: requestHref({}), label: studioCopy.sendIdea }
				: null
		: closedNote === null
			? { href: design.requestHref, label: studioCopy.flash.request }
			: null;
	const state = design.claimed
		? "claimed"
		: closedNote === null
			? "available"
			: "closed";
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="flash-design"
			artistsShown={data.hasArtists}
			mainClassName="fp-main fp-design"
		>
			<div className="fp-container fp-design-top">
				<p className="fp-crumb">
					<RouterAnchor className="fp-link" href={flashHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<article
					className="fp-design-grid"
					aria-labelledby="flash-design-title"
				>
					<figure
						className={
							design.claimed
								? "fp-design-sheet fp-design-sheet-claimed"
								: "fp-design-sheet"
						}
					>
						<img
							className="fp-design-picture"
							src={design.largeSrc}
							srcSet={design.image.srcSet}
							sizes={
								design.image.srcSet ? designSizes(design.image) : undefined
							}
							width={design.image.width}
							height={design.image.height}
							alt={design.alt}
							loading="eager"
							decoding="async"
							fetchPriority="high"
						/>
						{design.claimed ? (
							// The ticket says it in words: the stamp is the sheet's look.
							<span
								className="fp-card-stamp fp-design-stamp"
								aria-hidden="true"
							>
								{studioCopy.flash.claimed}
							</span>
						) : null}
					</figure>
					<div className="fp-ticket">
						<p className="fp-kicker">{copy.kicker}</p>
						<h1
							id="flash-design-title"
							className="fp-design-title user-text"
							dir="auto"
						>
							{design.name}
						</h1>
						{artist ? (
							<p className="fp-design-by">
								{BY}
								<RouterAnchor className="fp-link" href={artist.href}>
									<bdi>{artist.name}</bdi>
								</RouterAnchor>
							</p>
						) : null}
						<dl className="fp-facts">
							<div>
								<dt>{studioCopy.flash.size}</dt>
								<dd className="user-text" dir="auto">
									{design.size}
								</dd>
							</div>
							{design.priceText || !design.claimed ? (
								<div>
									<dt>{studioCopy.flash.price}</dt>
									<dd>{design.priceText ?? flashParlourCopy.wall.askPrice}</dd>
								</div>
							) : null}
							<div>
								<dt>{studioCopy.flash.status}</dt>
								<dd
									className={`fp-design-state fp-design-state-${state} user-text`}
									dir="auto"
								>
									{state === "available" ? (
										<Star tone="green" className="fp-state-star" />
									) : null}
									{design.claimed
										? studioCopy.flash.claimed
										: (closedNote ?? studioCopy.flash.available)}
								</dd>
							</div>
						</dl>
						{design.claimed ? (
							<p className="fp-design-note">{studioCopy.flash.claimedNote}</p>
						) : null}
						{action && isAllowedHref(action.href) ? (
							<div className="fp-hero-actions fp-ticket-actions">
								<RouterAnchor
									className="action action-primary fp-cta"
									href={action.href}
								>
									{action.label}
								</RouterAnchor>
							</div>
						) : null}
						{artist ? (
							<p>
								<RouterAnchor
									className="fp-link"
									href={flashHref({ artist: artist.slug })}
								>
									<span>
										<Fill
											template={studioCopy.flash.allBy}
											values={{ name: artist.name }}
										/>
									</span>
								</RouterAnchor>
							</p>
						) : null}
					</div>
				</article>
			</div>
		</Shell>
	);
}
