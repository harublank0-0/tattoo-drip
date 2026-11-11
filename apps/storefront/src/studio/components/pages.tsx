import { useLocation } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { Fill } from "../../intake/components/fill.tsx";
import { artworkTitle } from "../artwork.ts";
import { studioCopy } from "../copy.ts";
import {
	flashHref,
	isAllowedHref,
	linkRel,
	portfolioHref,
	requestHref,
	workHref,
} from "../links.ts";
import type {
	ArtistPageData,
	ArtistsPageData,
	ArtworkPageData,
	FlashDesignPageData,
	FlashPageData,
	RequestPageData,
	StudioPageData,
	WorkPageData,
} from "../loaders.ts";
import { OpenNow } from "../open-now.tsx";
import { type MoreWork, PagedGallery } from "../paging.tsx";
import { flashDesignSizes, logoSizes, workGridSizes } from "../srcset.ts";
import { challengeThemeFor } from "../theme/branding.ts";
import type { SectionKey } from "../theme/config.ts";
import type { StudioView } from "../view-model.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { BrandCover, BrandLogo } from "./brand.tsx";
import { ContactBlock } from "./contact.tsx";
import {
	ArtistFlash,
	FlashGrid,
	FlashSection,
	FlashSummary,
} from "./flash.tsx";
import {
	ArtworkFigure,
	HealedFilter,
	RecentWork,
	WorkFilters,
} from "./gallery.tsx";
import { GoodToKnowSection } from "./good-to-know.tsx";
import { InquirySection, RequestInvite } from "./inquiry.tsx";
import { type Shell, StencilShell } from "./shell.tsx";
import { BookingStrip } from "./steps.tsx";

/**
 * The studio page's two pages and its status pages (TAT-48). Props only and
 * plain anchors: no router or query hooks (except RouteErrorPage, the
 * router's glue), so test/studio/render.test.ts renders them on their own.
 */

export function StudioPage({
	data,
	Shell = StencilShell,
}: {
	data: StudioPageData;
	/** The theme's frame around the page (header, footer); Stencil & Ink's by default. */
	Shell?: Shell;
}) {
	const { studio, theme } = data;
	// The hero's WhatsApp button is the plain chat link the Chat group lists.
	const whatsapp = studio.links.find(
		(link) => link.kind === "whatsapp" && isAllowedHref(link.href),
	);
	const heading = (
		<div className="profile-heading">
			{theme.logo ? (
				<BrandLogo
					image={theme.logo}
					className="profile-logo"
					sizes={logoSizes(theme.logo, "hero")}
				/>
			) : null}
			<h1 className="profile-name" dir="auto">
				{studio.name}
			</h1>
			<p className="profile-location user-text" dir="auto">
				{studio.location ?? studio.typeLabel}
			</p>
			{data.openNow ? <OpenNow view={data.openNow} /> : null}
		</div>
	);
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="home"
			artistsShown={data.artists.length > 0}
		>
			<header className="profile">
				{theme.heroImage ? (
					<BrandCover image={theme.heroImage}>{heading}</BrandCover>
				) : (
					heading
				)}
				<div className="profile-actions">
					{studio.accepting ? (
						<div className="actions">
							<a className="action action-primary" href={requestHref({})}>
								{studioCopy.sendIdea}
							</a>
							{whatsapp ? (
								<a
									className="action action-secondary"
									href={whatsapp.href}
									rel={linkRel(whatsapp.href)}
								>
									<MessageCircle aria-hidden="true" />
									<span>{studioCopy.whatsapp}</span>
								</a>
							) : null}
						</div>
					) : (
						<p className="status status-closed">{studioCopy.notTaking}</p>
					)}
				</div>
				{studio.accepting ? <BookingStrip studioName={studio.name} /> : null}
				{studio.intro ? (
					<p className="profile-intro user-text measure" dir="auto">
						{studio.intro}
					</p>
				) : null}
				<ContactBlock studio={studio} />
			</header>
			{theme.sections.map((section) => (
				<StudioSection key={section} section={section} data={data} />
			))}
		</Shell>
	);
}

/**
 * One of the studio page's sections, in the order the theme's config gives
 * (TAT-54): Recent work (TAT-126), the artists, Flash (TAT-129, which renders
 * nothing until an artist adds a design), Good to know (TAT-128, which
 * renders nothing until the studio filled something in) and the inquiry
 * section, which is always one of them (readSections) and, since TAT-127, only
 * invites: the form is on /request.
 */
function StudioSection({
	section,
	data,
}: {
	section: SectionKey;
	data: StudioPageData;
}) {
	switch (section) {
		case "work":
			return <RecentWork gallery={data.recentWork} />;
		case "artists":
			return (
				<ArtistRoster
					artists={data.artists}
					studioAccepting={data.studio.accepting}
				/>
			);
		case "flash":
			return <FlashSection list={data.flash} artists={data.artists} />;
		case "info":
			return <GoodToKnowSection view={data.goodToKnow} />;
		case "inquiry":
			return <RequestInvite state={data.inquiry} />;
	}
}

export function ArtistPage({
	data,
	more,
	Shell = StencilShell,
}: {
	data: ArtistPageData;
	/** The browser's "Show more" (TAT-126); without it the link loads the next page. */
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, artist, theme, portfolio } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artist"
			artistsShown={true}
		>
			<ArtistProfile artist={artist} studio={studio} />
			<PortfolioSection
				slug={artist.slug}
				gallery={portfolio.gallery}
				search={portfolio.search}
				more={more}
			/>
			<ArtistFlash artist={artist} list={data.flash} />
			<StudioAside studio={studio} />
		</Shell>
	);
}

/**
 * `/artists` in Stencil & Ink: the roster as the page, every visible artist
 * (its h1 the roster's title), then the "Got an idea?" invitation. Stencil &
 * Ink's navigation is its site bar, which has no directory link; the page is
 * there for an address that names it. The style filter is Ink Noir's.
 */
export function ArtistsPage({
	data,
	Shell = StencilShell,
}: {
	data: ArtistsPageData;
	Shell?: Shell;
}) {
	const { studio, theme, directory } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artists"
			artistsShown={directory.artists.length > 0}
		>
			{directory.artists.length > 0 ? (
				<ArtistRoster
					artists={directory.artists}
					studioAccepting={studio.accepting}
					asPage
				/>
			) : (
				<section className="section" aria-labelledby="artists-title">
					<h1 id="artists-title" className="section-title">
						Artists
					</h1>
					<p>{studioCopy.artistsEmpty}</p>
				</section>
			)}
			<RequestInvite state={data.inquiry} />
		</Shell>
	);
}

/**
 * `/book` (TAT-127, Prompt 6): the request flow on a page of its own, with "How
 * booking works" above it on a phone and beside it from 60rem. The section's
 * heading is the page's h1; the studio's contacts follow, so a closed
 * artist's or studio's page still says what is possible. The site bar and the
 * studio block are the artist page's.
 */
export function RequestPage({
	data,
	challengeSiteKey = null,
	Shell = StencilShell,
}: {
	data: RequestPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
	Shell?: Shell;
}) {
	const { studio, theme, inquiry, channels } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={null}
			chat={data.chat}
			page="request"
			artistsShown={data.hasArtists}
			mainClassName="page request-page"
		>
			<InquirySection
				state={inquiry}
				channels={channels}
				challengeSiteKey={challengeSiteKey}
				challengeTheme={challengeThemeFor(theme.key)}
				booking={data.booking}
				intro={
					data.flash ? (
						<FlashSummary request={data.flash} studioName={studio.name} />
					) : null
				}
			/>
			<StudioAside studio={studio} />
		</Shell>
	);
}

/**
 * An artist's whole portfolio (TAT-126): the Work section after their
 * profile. All and Healed when some photo has healed (or the address asked for
 * Healed, so it can be left), the photos a page at a time, and the way back
 * to the newest from a later page. Nothing for an artist with no photos and no
 * filter or page asked for, and nothing when the portfolio could not be read
 * (the loader then hands over an empty gallery and no filters).
 */
function PortfolioSection({
	slug,
	gallery,
	search,
	more,
}: {
	slug: string;
	gallery: ArtistPageData["portfolio"]["gallery"];
	search: ArtistPageData["portfolio"]["search"];
	more: MoreWork | undefined;
}) {
	const healed = search.healed === true;
	if (gallery.photos.length === 0 && !healed && search.cursor === undefined) {
		return null;
	}
	const filter = healed ? { healed: true as const } : {};
	return (
		<section id="work" className="section" aria-labelledby="work-title">
			<h2 id="work-title" className="section-title">
				{studioCopy.work.title}
			</h2>
			{gallery.healed || healed ? (
				<HealedFilter
					allHref={portfolioHref(slug, {})}
					healedHref={portfolioHref(slug, { healed: true })}
					healed={healed}
				/>
			) : null}
			{search.cursor !== undefined ? (
				<p className="work-newest">
					<a className="text-link" href={portfolioHref(slug, filter)}>
						{studioCopy.work.newest}
					</a>
				</p>
			) : null}
			{gallery.photos.length > 0 ? (
				<PagedGallery
					key={portfolioHref(slug, search)}
					first={gallery}
					showArtist={false}
					moreHref={(cursor) => portfolioHref(slug, { ...filter, cursor })}
					more={more}
				/>
			) : healed ? (
				<p>{studioCopy.work.noHealed}</p>
			) : null}
		</section>
	);
}

/**
 * `/gallery` (TAT-126): every visible artist's photos, newest first, narrowed by
 * the address (artist, style, healed) and shown a page at a time. The site bar
 * and the studio block are the artist page's.
 */
export function WorkPage({
	data,
	more,
	Shell = StencilShell,
}: {
	data: WorkPageData;
	/** The browser's "Show more"; without it the link loads the next page. */
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, theme, artists, search, gallery } = data;
	const { cursor: _page, ...firstPage } = search;
	const filtered = Boolean(
		search.artist || search.style || search.healed === true,
	);
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
		>
			<section aria-labelledby="work-page-title">
				<h1 id="work-page-title" className="section-title">
					{studioCopy.work.pageTitle}
				</h1>
				<WorkFilters artists={artists} gallery={gallery} search={search} />
				{search.cursor !== undefined ? (
					<p className="work-newest">
						<a className="text-link" href={workHref(firstPage)}>
							{studioCopy.work.newest}
						</a>
					</p>
				) : null}
				{gallery.photos.length > 0 ? (
					<PagedGallery
						key={workHref(search)}
						first={gallery}
						showArtist
						moreHref={(cursor) => workHref({ ...search, cursor })}
						more={more}
					/>
				) : (
					<div className="stack">
						<p>{filtered ? studioCopy.work.noMatch : studioCopy.work.empty}</p>
						{filtered ? (
							<a className="text-link" href={workHref({})}>
								{studioCopy.work.showAll}
							</a>
						) : null}
					</div>
				)}
			</section>
			<StudioAside studio={studio} />
		</Shell>
	);
}

/**
 * `/flash` (TAT-129): every shown design of the visible artists, newest first,
 * narrowed to one artist by the address and shown a page at a time ("Show
 * more" is a plain link to the next page, so it works without JavaScript).
 * The artist filter shows only when two or more artists have a design. The
 * site bar's Request button is the studio's general one.
 */
export function FlashPage({
	data,
	Shell = StencilShell,
}: {
	data: FlashPageData;
	Shell?: Shell;
}) {
	const { studio, theme, artists, search, list } = data;
	const filtered = search.artist !== undefined;
	const firstPage = filtered ? { artist: search.artist } : {};
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="flash"
			artistsShown={data.artists.length > 0}
		>
			<section aria-labelledby="flash-page-title">
				<h1 id="flash-page-title" className="section-title">
					{studioCopy.flash.pageTitle}
				</h1>
				{list.artists.length >= 2 ? (
					<nav
						aria-label={studioCopy.flash.filterNav}
						className="work-filter-nav"
					>
						<a
							href={flashHref({})}
							aria-current={filtered ? undefined : "page"}
						>
							{studioCopy.flash.all}
						</a>
						{list.artists.map((artist) => (
							<a
								key={artist.slug}
								href={flashHref({ artist: artist.slug })}
								aria-current={
									search.artist === artist.slug ? "page" : undefined
								}
							>
								<bdi>{artist.name}</bdi>
							</a>
						))}
					</nav>
				) : null}
				{search.cursor !== undefined ? (
					<p className="work-newest">
						<a className="text-link" href={flashHref(firstPage)}>
							{studioCopy.flash.newest}
						</a>
					</p>
				) : null}
				{list.designs.length > 0 ? (
					<>
						<FlashGrid designs={list.designs} showArtist artists={artists} />
						{list.nextCursor !== null ? (
							<p className="flash-more-bar">
								<a
									className="action action-secondary flash-more"
									href={flashHref({ ...firstPage, cursor: list.nextCursor })}
								>
									{studioCopy.flash.showMore}
								</a>
							</p>
						) : null}
					</>
				) : (
					<div className="stack">
						<p>
							{filtered ? studioCopy.flash.noMatch : studioCopy.flash.empty}
						</p>
						{filtered ? (
							<a className="text-link" href={flashHref({})}>
								{studioCopy.flash.showAll}
							</a>
						) : (
							<a className="text-link" href="/">
								{studioCopy.goToStudio}
							</a>
						)}
					</div>
				)}
			</section>
			<StudioAside studio={studio} />
		</Shell>
	);
}

/** The words before the artist's name in "by {name}": the name itself is a link on a design's page. */
const BY = studioCopy.flash.by.replace("{name}", "");

/**
 * One flash design's page (TAT-129): the picture whole and large, its name,
 * the artist, the size, the price when the studio set one and the status
 * ("Available", or why it can't be requested now), and Request this design
 * while it can be. The site bar's Request button is the studio's general one.
 */
export function FlashDesignPage({
	data,
	Shell = StencilShell,
}: {
	data: FlashDesignPageData;
	Shell?: Shell;
}) {
	const { studio, theme, design, closedNote, similar } = data;
	const artist = design.artist;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="flash-design"
			artistsShown={data.hasArtists}
		>
			<article className="flash-design" aria-labelledby="flash-design-title">
				<img
					className="flash-design-picture"
					src={design.largeSrc}
					srcSet={design.image.srcSet}
					sizes={design.image.srcSet ? flashDesignSizes() : undefined}
					width={design.image.width}
					height={design.image.height}
					alt={design.alt}
					loading="eager"
					decoding="async"
					fetchPriority="high"
				/>
				<div className="flash-design-body">
					<h1
						id="flash-design-title"
						className="section-title user-text"
						dir="auto"
					>
						{design.name}
					</h1>
					{artist ? (
						<p className="flash-design-by">
							{BY}
							<a className="text-link" href={artist.href}>
								<bdi>{artist.name}</bdi>
							</a>
						</p>
					) : null}
					<dl className="flash-facts">
						<div>
							<dt>{studioCopy.flash.size}</dt>
							<dd className="user-text" dir="auto">
								{design.size}
							</dd>
						</div>
						{design.priceText ? (
							<div>
								<dt>{studioCopy.flash.price}</dt>
								<dd>{design.priceText}</dd>
							</div>
						) : null}
						<div>
							<dt>{studioCopy.flash.status}</dt>
							<dd className="user-text" dir="auto">
								{design.claimed
									? studioCopy.flash.claimed
									: (closedNote ?? studioCopy.flash.available)}
							</dd>
						</div>
					</dl>
					{design.claimed ? (
						// Taken: ask the artist for something like it, else the studio.
						similar === "artist" ? (
							<a className="action action-primary" href={design.requestHref}>
								{studioCopy.flash.similar}
							</a>
						) : similar === "studio" ? (
							<a className="action action-primary" href={requestHref({})}>
								{studioCopy.sendIdea}
							</a>
						) : null
					) : closedNote === null ? (
						<a className="action action-primary" href={design.requestHref}>
							{studioCopy.flash.request}
						</a>
					) : null}
					{artist ? (
						<p>
							<a
								className="text-link"
								href={flashHref({ artist: artist.slug })}
							>
								<span>
									<Fill
										template={studioCopy.flash.allBy}
										values={{ name: artist.name }}
									/>
								</span>
							</a>
						</p>
					) : null}
				</div>
			</article>
			<StudioAside studio={studio} />
		</Shell>
	);
}

/**
 * One tattoo's page (Prompt 5): the photo large (it opens the viewer), its
 * title, whose it is, its styles and healed mark, "Request a similar tattoo"
 * while someone takes new work, and up to six related pieces, each a link to
 * its own page. Only what the API knows of the piece: no placement,
 * technique or date.
 */
export function ArtworkPage({
	data,
	Shell = StencilShell,
}: {
	data: ArtworkPageData;
	Shell?: Shell;
}) {
	const { studio, theme, artwork, similar, related } = data;
	const words = studioCopy.artwork;
	const photo = artwork.photo;
	const artist =
		photo.artist && isAllowedHref(photo.artist.href) ? photo.artist : null;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
		>
			<article className="artwork" aria-labelledby="artwork-title">
				<p>
					<a className="text-link" href={workHref({})}>
						{words.back}
					</a>
				</p>
				<ArtworkFigure
					photo={photo}
					sizes={flashDesignSizes()}
					className="artwork-figure"
				/>
				<div className="flash-design-body">
					<h1 id="artwork-title" className="section-title user-text" dir="auto">
						{artwork.title}
					</h1>
					<dl className="flash-facts">
						{artist ? (
							<div>
								<dt>{words.artist}</dt>
								<dd>
									<a className="text-link" href={artist.href}>
										<bdi>{artist.name}</bdi>
									</a>
								</dd>
							</div>
						) : null}
						{photo.styles.length > 0 ? (
							<div>
								<dt>{words.styles}</dt>
								<dd>{photo.styles.join(" · ")}</dd>
							</div>
						) : null}
						{photo.healed ? (
							<div>
								<dt>{studioCopy.work.healed}</dt>
								<dd>{words.healed}</dd>
							</div>
						) : null}
					</dl>
					{similar && isAllowedHref(similar.href) ? (
						<div className="stack">
							<p>{words.inspired}</p>
							<a className="action action-primary" href={similar.href}>
								{words.similar}
							</a>
						</div>
					) : null}
				</div>
			</article>
			{related.length > 0 ? (
				<section className="section" aria-labelledby="artwork-related-title">
					<h2 id="artwork-related-title" className="section-title">
						{words.related}
					</h2>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						className="artwork-related"
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{related.map((piece) =>
							piece.href ? (
								<li key={piece.href}>
									<a className="work-link" href={piece.href}>
										<img
											className="work-thumb"
											src={piece.src}
											srcSet={piece.srcSet}
											sizes={piece.srcSet ? workGridSizes(piece) : undefined}
											width={piece.width}
											height={piece.height}
											alt=""
											loading="lazy"
											decoding="async"
										/>
										<span className="work-link-text user-text" dir="auto">
											{artworkTitle(piece)}
										</span>
									</a>
								</li>
							) : null,
						)}
					</ul>
					<p className="work-all">
						<a className="text-link" href={workHref({})}>
							{words.viewAll}
						</a>
					</p>
				</section>
			) : null}
			<StudioAside studio={studio} />
		</Shell>
	);
}

/** The studio under an artist's page and the All work page: its contacts and the way to its page. */
function StudioAside({ studio }: { studio: StudioView }) {
	return (
		<section className="section" aria-labelledby="studio-title">
			<h2 id="studio-title" className="section-title" dir="auto">
				{studio.name}
			</h2>
			<div className="stack">
				<p className="profile-type">{studio.typeLabel}</p>
				<ContactBlock studio={studio} />
				<a className="text-link" href="/">
					See the studio page
				</a>
			</div>
		</section>
	);
}

/** The router's not-found page: an unknown path, or a hidden or unknown artist. */
export function NotFoundPage() {
	return (
		<main className="page status-page">
			<h1 className="section-title">Page not found</h1>
			<p>This page doesn't exist. The link may be old or mistyped.</p>
			<a className="text-link" href="/">
				{studioCopy.goToStudio}
			</a>
		</main>
	);
}

/** One of the page's own paths: "/…", never "//…" or "/\\…". */
const OWN_PATH = /^\/(?![/\\])/;

/**
 * A page whose data failed to load. Never shows the error itself. "Try again"
 * is a link to the same path, without any fragment (a deposit link's token
 * lives there, and nothing may copy it into markup); where the browser can,
 * `reload` runs instead, which keeps the address as it is, fragment and all.
 */
export function ErrorPage({
	retryHref,
	reload,
}: {
	retryHref: string;
	reload?: () => void;
}) {
	const href = OWN_PATH.test(retryHref) ? retryHref.split("#", 1)[0] : "/";
	return (
		<main className="page status-page">
			<h1 className="section-title">This page can't load right now</h1>
			<p>Please try again in a minute.</p>
			<a
				className="text-link"
				href={href}
				onClick={
					reload
						? (event) => {
								event.preventDefault();
								reload();
							}
						: undefined
				}
			>
				Try again
			</a>
		</main>
	);
}

/** The router's error component: "Try again" loads the same address again. */
export function RouteErrorPage() {
	const href = useLocation({ select: (location) => location.href });
	return <ErrorPage retryHref={href} reload={() => window.location.reload()} />;
}
