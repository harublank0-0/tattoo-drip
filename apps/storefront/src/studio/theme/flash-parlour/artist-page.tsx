import { Fill } from "../../../intake/components/fill.tsx";
import { HealedFilter } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { InquiryState } from "../../inquiry.ts";
import {
	artistsHref,
	flashHref,
	isAllowedHref,
	linkRel,
	portfolioHref,
	workHref,
} from "../../links.ts";
import type { ArtistPageData } from "../../loaders.ts";
import { type MoreWork, PagedGallery } from "../../paging.tsx";
import { ArtistFrame, FlashParlourStatus } from "./artist-index.tsx";
import { flashParlourCopy } from "./copy.ts";
import { FlashSheet } from "./flash-sheet.tsx";
import { FlashParlourInvite } from "./invite.tsx";
import { RibbonTitle } from "./ornaments.tsx";
import { FlashParlourPieces } from "./pieces.tsx";
import { FlashParlourShell } from "./shell.tsx";
import { fixedPortraitSizes } from "./sizes.ts";

const copy = flashParlourCopy.artist;

/**
 * Flash Parlour's artist page (`/artists/$slug`): the artist's card (their
 * portrait in a heavy frame, else their initial on a star) beside their name,
 * styles, studio, status, the way to book them while they take new work and
 * their own links; then their flash first, as sheets on the wall (flash is
 * what a walk-in asks for), with "All flash by {name}" when more follow; then
 * their bio, their work a page at a time (the shared PagedGallery: "Show
 * more", All / Healed, the `work` id), their styles (each a link to the work
 * filtered by artist and style), the invitation and the artists either side.
 * The same data every theme gets (loadArtistPage).
 */
export function FlashParlourArtistPage({
	data,
	more,
	Shell = FlashParlourShell,
}: {
	data: ArtistPageData;
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, artist, theme } = data;
	const links = artist.links.filter((link) => isAllowedHref(link.href));
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artist"
			artistsShown
			mainClassName="fp-main fp-artist"
		>
			<header className="fp-container fp-artist-hero">
				<p className="fp-crumb">
					<RouterAnchor className="fp-link" href={artistsHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div className="fp-artist-top">
					<ArtistFrame
						artist={artist}
						className="fp-frame fp-frame-large"
						loading="eager"
						sizes={
							artist.photo ? fixedPortraitSizes(artist.photo, 14) : undefined
						}
					/>
					<div className="fp-artist-facts">
						<p className="fp-kicker user-text" dir="auto">
							{studio.location
								? `${studio.name} · ${studio.location}`
								: studio.name}
						</p>
						<h1 className="fp-artist-title" dir="auto">
							{artist.name}
						</h1>
						{artist.styles.length > 0 ? (
							<p className="fp-artist-styles">{artist.styles.join(" · ")}</p>
						) : null}
						<FlashParlourStatus artist={artist} />
						<div className="fp-hero-actions">
							{artist.accepting ? (
								<BookingCta link={data.requestLink} className="fp-cta" />
							) : null}
							{data.flash.designs.length > 0 ? (
								<a className="fp-button" href="#flash">
									{studioCopy.flash.title}
								</a>
							) : null}
							{data.portfolio.gallery.photos.length > 0 ? (
								<a className="fp-button" href="#work">
									{copy.work}
								</a>
							) : null}
						</div>
						{links.length > 0 ? (
							// biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none
							<ul
								className="fp-inline-links"
								// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
								role="list"
								aria-label={studioCopy.artist.links}
							>
								{links.map((link) => (
									<li key={`${link.kind}:${link.href}`}>
										<a
											className="fp-link"
											href={link.href}
											rel={linkRel(link.href)}
										>
											{link.label}
										</a>
									</li>
								))}
							</ul>
						) : null}
					</div>
				</div>
			</header>
			<ArtistFlashWall data={data} />
			{artist.bio ? (
				<section className="fp-section fp-intro" aria-labelledby="fp-bio-title">
					<div className="fp-container fp-intro-body">
						<h2 id="fp-bio-title" className="fp-label">
							{copy.about}
						</h2>
						<p className="fp-intro-text user-text" dir="auto">
							{artist.bio}
						</p>
					</div>
				</section>
			) : null}
			<Portfolio data={data} more={more} />
			{data.styles.length > 0 ? (
				<section
					className="fp-section fp-container"
					aria-labelledby="fp-styles-title"
				>
					<h2 id="fp-styles-title" className="fp-label">
						{copy.styles}
					</h2>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						className="fp-filter-list fp-filter-list-start"
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{data.styles.map((style) => (
							<li key={style.slug}>
								<RouterAnchor
									className="fp-filter"
									href={workHref({ artist: artist.slug, style: style.slug })}
								>
									{style.name}
								</RouterAnchor>
							</li>
						))}
					</ul>
				</section>
			) : null}
			<FlashParlourInvite
				state={inviteState(data)}
				link={data.requestLink}
				line={
					artist.accepting || data.requestLink === null ? undefined : (
						<Fill
							template={copy.closedInvite}
							values={{ name: artist.name, studio: studio.name }}
						/>
					)
				}
			/>
			<Neighbours data={data} />
		</Shell>
	);
}

/**
 * The invitation's state when it has no link to offer (nobody here takes new
 * work: the artist is closed and so is the studio): the studio's closed
 * words. With a link (`requestLink`) the state is not read.
 */
function inviteState(data: ArtistPageData): InquiryState {
	return { kind: "studio-closed", studioName: data.studio.name };
}

/** The artist's flash on the wall: their newest designs (at most 12), and all of it when more follow. Nothing without a design. */
function ArtistFlashWall({ data }: { data: ArtistPageData }) {
	const { artist, flash } = data;
	if (flash.designs.length === 0) return null;
	return (
		<section id="flash" className="fp-wall" aria-labelledby="flash-title">
			<div className="fp-container">
				<div className="fp-wall-head">
					<RibbonTitle id="flash-title">{studioCopy.flash.title}</RibbonTitle>
				</div>
				<FlashSheet
					designs={flash.designs}
					artists={[artist]}
					showArtist={false}
				/>
				{flash.nextCursor !== null ? (
					<p className="fp-wall-all">
						<RouterAnchor
							className="fp-button"
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
		</section>
	);
}

function Portfolio({
	data,
	more,
}: {
	data: ArtistPageData;
	more: MoreWork | undefined;
}) {
	const { artist, portfolio } = data;
	const { gallery, search } = portfolio;
	const healed = search.healed === true;
	const filter = healed ? { healed: true as const } : {};
	const slug = artist.slug;
	const empty = gallery.photos.length === 0;
	return (
		<section
			id="work"
			className="fp-section fp-portfolio"
			aria-labelledby="work-title"
		>
			<div className="fp-container">
				<div className="fp-section-head">
					<RibbonTitle id="work-title">{copy.work}</RibbonTitle>
					{!empty ? (
						<RouterAnchor className="fp-link" href={workHref({ artist: slug })}>
							{flashParlourCopy.home.allWork}
						</RouterAnchor>
					) : null}
				</div>
				{gallery.healed || healed ? (
					<HealedFilter
						allHref={portfolioHref(slug, {})}
						healedHref={portfolioHref(slug, { healed: true })}
						healed={healed}
					/>
				) : null}
				{search.cursor !== undefined ? (
					<p className="work-newest">
						<a className="fp-link" href={portfolioHref(slug, filter)}>
							{studioCopy.work.newest}
						</a>
					</p>
				) : null}
				{!empty ? (
					<PagedGallery
						key={portfolioHref(slug, search)}
						first={gallery}
						showArtist={false}
						moreHref={(cursor) => portfolioHref(slug, { ...filter, cursor })}
						more={more}
						renderPhotos={(photos) => (
							<FlashParlourPieces photos={photos} showArtist={false} />
						)}
					/>
				) : (
					<p className="fp-empty">
						{healed ? studioCopy.work.noHealed : copy.noWork}
					</p>
				)}
			</div>
		</section>
	);
}

function Neighbours({ data }: { data: ArtistPageData }) {
	const items = (
		[
			["previous", copy.previous, data.neighbours.previous],
			["next", copy.next, data.neighbours.next],
		] as const
	).flatMap(([key, label, artist]) =>
		artist && isAllowedHref(artist.href) ? [{ key, label, artist }] : [],
	);
	if (items.length === 0) return null;
	return (
		<nav
			className="fp-container fp-neighbours"
			aria-label={flashParlourCopy.artists.title}
		>
			{items.map((item) => (
				<RouterAnchor
					key={item.key}
					className={`fp-neighbour fp-neighbour-${item.key}`}
					href={item.artist.href}
					rel={item.key === "previous" ? "prev" : "next"}
				>
					<span className="fp-kicker">{item.label}</span>
					<span className="fp-neighbour-name" dir="auto">
						{item.artist.name}
					</span>
				</RouterAnchor>
			))}
		</nav>
	);
}
