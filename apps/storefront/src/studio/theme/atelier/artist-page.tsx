import { Fill } from "../../../intake/components/fill.tsx";
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
import { ArtistArch, AtelierStatus } from "./artist-index.tsx";
import { atelierCopy } from "./copy.ts";
import { AtelierInvite } from "./invite.tsx";
import { AtelierPieces } from "./pieces.tsx";
import { AtelierShell } from "./shell.tsx";
import { archSizes, leadSizes } from "./sizes.ts";

const copy = atelierCopy.artist;

/**
 * Atelier's artist page (`/artists/$slug`), centred like a catalogue's
 * frontispiece: the artist's arch (their portrait, else their initial), name,
 * styles, studio, status, the way to book them while they take new work, the
 * way to their collection and their own links; then their signature piece
 * (the newest piece of the portfolio shown, else their own newest work photo)
 * whole on a plate, when they have one. Then their bio, the whole collection
 * a page at a time (the shared PagedGallery: "Show more", All / Healed, the
 * `work` id), their flash, their styles (each a link to the collection
 * filtered by artist and style), the invitation and the artists either side.
 * The same data every theme gets (loadArtistPage).
 */
export function AtelierArtistPage({
	data,
	more,
	Shell = AtelierShell,
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
	const links = artist.links.filter((link) => isAllowedHref(link.href));
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artist"
			artistsShown
			mainClassName="atl-main atl-artist"
		>
			<header className="atl-container atl-artist-hero">
				<p className="atl-crumb">
					<RouterAnchor className="atl-link" href={artistsHref({})}>
						{copy.back}
					</RouterAnchor>
				</p>
				<div className="atl-artist-facts">
					<ArtistArch
						artist={artist}
						className="atl-arch atl-arch-large"
						loading="eager"
						sizes={artist.photo ? archSizes(artist.photo, 10) : undefined}
					/>
					<h1 className="atl-artist-title" dir="auto">
						{artist.name}
					</h1>
					{artist.styles.length > 0 ? (
						<p className="atl-artist-styles">{artist.styles.join(" · ")}</p>
					) : null}
					<p className="atl-kicker user-text" dir="auto">
						{studio.location
							? `${studio.name} · ${studio.location}`
							: studio.name}
					</p>
					<AtelierStatus artist={artist} />
					<div className="atl-hero-actions">
						{artist.accepting ? (
							<BookingCta link={data.requestLink} className="atl-cta" />
						) : null}
						{portfolio.gallery.photos.length > 0 ? (
							<a className="action atl-action-quiet" href="#work">
								{copy.portfolio}
							</a>
						) : null}
					</div>
					{links.length > 0 ? (
						// biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none
						<ul
							className="atl-inline-links"
							// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
							role="list"
							aria-label={studioCopy.artist.links}
						>
							{links.map((link) => (
								<li key={`${link.kind}:${link.href}`}>
									<a
										className="atl-link"
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
				{signature ? (
					<figure className="atl-plate atl-artist-lead">
						<img
							className="atl-plate-photo"
							src={signature.src}
							srcSet={signature.srcSet}
							sizes={signature.srcSet ? leadSizes(signature) : undefined}
							width={signature.width}
							height={signature.height}
							alt={signature.alt}
							loading="eager"
							decoding="async"
							fetchPriority="high"
						/>
						<figcaption className="atl-plate-caption">
							{signatureHref && isAllowedHref(signatureHref) ? (
								<RouterAnchor className="atl-link" href={signatureHref}>
									{copy.signature}
								</RouterAnchor>
							) : (
								copy.signature
							)}
						</figcaption>
					</figure>
				) : null}
			</header>
			{artist.bio ? (
				<section
					className="atl-section atl-intro"
					aria-labelledby="atl-bio-title"
				>
					<div className="atl-container atl-split">
						<h2 id="atl-bio-title" className="atl-label">
							{copy.about}
						</h2>
						<p className="atl-intro-text user-text" dir="auto">
							{artist.bio}
						</p>
					</div>
				</section>
			) : null}
			<Portfolio data={data} more={more} />
			{data.flash.designs.length > 0 ? (
				<div className="atl-container atl-shared">
					<ArtistFlash artist={artist} list={data.flash} />
				</div>
			) : null}
			{data.styles.length > 0 ? (
				<section
					className="atl-section atl-container"
					aria-labelledby="atl-styles-title"
				>
					<h2 id="atl-styles-title" className="atl-label">
						{copy.styles}
					</h2>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						className="atl-filter-list"
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{data.styles.map((style) => (
							<li key={style.slug}>
								<RouterAnchor
									className="atl-filter"
									href={workHref({ artist: artist.slug, style: style.slug })}
								>
									{style.name}
								</RouterAnchor>
							</li>
						))}
					</ul>
				</section>
			) : null}
			<AtelierInvite
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
			className="atl-section atl-portfolio"
			aria-labelledby="work-title"
		>
			<div className="atl-container">
				<div className="atl-section-head">
					<h2 id="work-title" className="atl-section-title">
						{copy.portfolio}
					</h2>
					{!empty ? (
						<RouterAnchor
							className="atl-link"
							href={workHref({ artist: slug })}
						>
							{atelierCopy.home.allWork}
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
						<a className="atl-link" href={portfolioHref(slug, filter)}>
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
							<AtelierPieces
								photos={photos}
								showArtist={false}
								numbered={search.cursor === undefined}
							/>
						)}
					/>
				) : (
					<p className="atl-empty">
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
			className="atl-container atl-neighbours"
			aria-label={atelierCopy.artists.title}
		>
			{items.map((item) => (
				<RouterAnchor
					key={item.key}
					className={`atl-neighbour atl-neighbour-${item.key}`}
					href={item.artist.href}
					rel={item.key === "previous" ? "prev" : "next"}
				>
					<span className="atl-kicker">{item.label}</span>
					<span className="atl-neighbour-name" dir="auto">
						{item.artist.name}
					</span>
				</RouterAnchor>
			))}
		</nav>
	);
}
