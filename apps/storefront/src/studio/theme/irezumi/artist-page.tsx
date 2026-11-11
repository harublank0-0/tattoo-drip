import { ArtistFlash } from "../../components/flash.tsx";
import { HealedFilter } from "../../components/gallery.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { GalleryPhotoView } from "../../gallery.ts";
import type { InquiryState } from "../../inquiry.ts";
import {
	artistsHref,
	isAllowedHref,
	linkRel,
	portfolioHref,
	workHref,
} from "../../links.ts";
import type { ArtistPageData } from "../../loaders.ts";
import { type MoreWork, PagedGallery } from "../../paging.tsx";
import type { WorkPhotoView } from "../../view-model.ts";
import { IrezumiStatus } from "./artist-index.tsx";
import { irezumiCopy } from "./copy.ts";
import { IrezumiInvite } from "./invite.tsx";
import { IrezumiPieces } from "./pieces.tsx";
import { IrezumiShell } from "./shell.tsx";
import { leadSizes, smallPortraitSizes } from "./sizes.ts";

const copy = irezumiCopy.artist;

/**
 * Irezumi's artist page (`/artists/$slug`). A signature piece leads (first
 * on a phone, beside the facts from 60rem): the newest piece of the
 * portfolio shown (else the artist's own newest work photo), whole and
 * large, then the artist's name, portrait, styles,
 * status, links and the way to book them; with no work the portrait leads
 * instead, and with neither the name stands alone. Then their bio, the whole
 * portfolio a page at a time (the shared PagedGallery: "Show more", All /
 * Healed, the `work` id), their flash, their styles (each a link to the
 * gallery filtered by artist and style), the invitation and the artists
 * either side. The same data every theme gets (loadArtistPage).
 */
export function IrezumiArtistPage({
	data,
	more,
	Shell = IrezumiShell,
}: {
	data: ArtistPageData;
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, artist, theme, portfolio } = data;
	const signature: WorkPhotoView | GalleryPhotoView | null =
		portfolio.gallery.photos[0] ?? artist.workPhotos[0] ?? null;
	const signatureHref =
		signature && "href" in signature && signature.href !== null
			? signature.href
			: null;
	const lead = signature ?? artist.photo;
	const links = artist.links.filter((link) => isAllowedHref(link.href));
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artist"
			artistsShown
			mainClassName="irz-main irz-artist"
		>
			<header className="irz-container irz-artist-hero">
				<p className="irz-crumb">
					<RouterAnchor className="irz-link" href={artistsHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div
					className={
						lead ? "irz-artist-grid" : "irz-artist-grid irz-artist-solo"
					}
				>
					{lead ? (
						<figure className="irz-artist-lead">
							<img
								className="irz-artist-lead-photo"
								src={lead.src}
								srcSet={lead.srcSet}
								sizes={lead.srcSet ? leadSizes() : undefined}
								width={lead.width}
								height={lead.height}
								alt={lead.alt}
								loading="eager"
								decoding="async"
								fetchPriority="high"
							/>
							{signature ? (
								<figcaption className="irz-hero-caption">
									{signatureHref && isAllowedHref(signatureHref) ? (
										<RouterAnchor className="irz-link" href={signatureHref}>
											{copy.signature}
										</RouterAnchor>
									) : (
										copy.signature
									)}
								</figcaption>
							) : null}
						</figure>
					) : null}
					<div className="irz-artist-facts">
						{signature && artist.photo ? (
							<img
								className="irz-artist-small-portrait"
								src={artist.photo.src}
								srcSet={artist.photo.srcSet}
								sizes={
									artist.photo.srcSet
										? smallPortraitSizes(artist.photo)
										: undefined
								}
								width={artist.photo.width}
								height={artist.photo.height}
								alt={artist.photo.alt}
								loading="eager"
								decoding="async"
							/>
						) : null}
						<h1 className="irz-artist-title" dir="auto">
							{artist.name}
						</h1>
						{artist.styles.length > 0 ? (
							<p className="irz-artist-styles">{artist.styles.join(" · ")}</p>
						) : null}
						<p className="irz-kicker user-text" dir="auto">
							{studio.location
								? `${studio.name} · ${studio.location}`
								: studio.name}
						</p>
						<IrezumiStatus artist={artist} />
						<div className="irz-hero-actions">
							{artist.accepting ? (
								<BookingCta link={data.requestLink} className="irz-cta" />
							) : null}
							{portfolio.gallery.photos.length > 0 ? (
								<a className="action irz-action-quiet" href="#work">
									{copy.portfolio}
								</a>
							) : null}
						</div>
						{links.length > 0 ? (
							// biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none
							<ul
								className="irz-inline-links"
								// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
								role="list"
								aria-label={studioCopy.artist.links}
							>
								{links.map((link) => (
									<li key={`${link.kind}:${link.href}`}>
										<a
											className="irz-link"
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
			{artist.bio ? (
				<section
					className="irz-section irz-intro"
					aria-labelledby="irz-bio-title"
				>
					<div className="irz-container irz-split">
						<h2 id="irz-bio-title" className="irz-label">
							{copy.about}
						</h2>
						<p className="irz-intro-text user-text" dir="auto">
							{artist.bio}
						</p>
					</div>
				</section>
			) : null}
			<Portfolio data={data} more={more} />
			{data.flash.designs.length > 0 ? (
				<div className="irz-container irz-shared">
					<ArtistFlash artist={artist} list={data.flash} />
				</div>
			) : null}
			{data.styles.length > 0 ? (
				<section
					className="irz-section irz-container"
					aria-labelledby="irz-styles-title"
				>
					<h2 id="irz-styles-title" className="irz-label">
						{copy.styles}
					</h2>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						className="irz-filter-list"
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{data.styles.map((style) => (
							<li key={style.slug}>
								<RouterAnchor
									className="irz-filter"
									href={workHref({ artist: artist.slug, style: style.slug })}
								>
									{style.name}
								</RouterAnchor>
							</li>
						))}
					</ul>
				</section>
			) : null}
			<IrezumiInvite state={inviteState(data)} link={data.requestLink} />
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
			className="irz-section irz-portfolio"
			aria-labelledby="work-title"
		>
			<div className="irz-container">
				<div className="irz-section-head">
					<h2 id="work-title" className="irz-section-title">
						{copy.portfolio}
					</h2>
					{!empty ? (
						<RouterAnchor
							className="irz-link"
							href={workHref({ artist: slug })}
						>
							{irezumiCopy.home.allWork}
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
						<a className="irz-link" href={portfolioHref(slug, filter)}>
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
							<IrezumiPieces photos={photos} showArtist={false} />
						)}
					/>
				) : (
					<p className="irz-empty">
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
			className="irz-container irz-neighbours"
			aria-label={irezumiCopy.artists.label}
		>
			{items.map((item) => (
				<RouterAnchor
					key={item.key}
					className={`irz-neighbour irz-neighbour-${item.key}`}
					href={item.artist.href}
					rel={item.key === "previous" ? "prev" : "next"}
				>
					<span className="irz-kicker">{item.label}</span>
					<span className="irz-neighbour-name" dir="auto">
						{item.artist.name}
					</span>
				</RouterAnchor>
			))}
		</nav>
	);
}
