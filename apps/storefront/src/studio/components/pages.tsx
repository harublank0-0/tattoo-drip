import { useLocation } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { studioCopy } from "../copy.ts";
import { isAllowedHref, linkRel, portfolioHref, workHref } from "../links.ts";
import type {
	ArtistPageData,
	StudioPageData,
	WorkPageData,
} from "../loaders.ts";
import { OpenNow } from "../open-now.tsx";
import { type MoreWork, PagedGallery } from "../paging.tsx";
import { logoSizes } from "../srcset.ts";
import type { SectionKey, ThemeConfig } from "../theme/config.ts";
import type { StudioView } from "../view-model.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { BrandCover, BrandLogo } from "./brand.tsx";
import { ContactBlock } from "./contact.tsx";
import { HealedFilter, RecentWork, WorkFilters } from "./gallery.tsx";
import { InquirySection } from "./inquiry.tsx";
import { BookingStrip } from "./steps.tsx";

/**
 * The studio page's two pages and its status pages (TAT-48). Props only and
 * plain anchors: no router or query hooks (except RouteErrorPage, the
 * router's glue), so test/studio/render.test.ts renders them on their own.
 */

export function StudioPage({
	data,
	challengeSiteKey = null,
}: {
	data: StudioPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
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
		<>
			<main className="page">
				<header className="profile">
					{theme.heroImage ? (
						<BrandCover image={theme.heroImage}>{heading}</BrandCover>
					) : (
						heading
					)}
					<div className="profile-actions">
						{studio.accepting ? (
							<div className="actions">
								<a className="action action-primary" href="#inquiry">
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
					<StudioSection
						key={section}
						section={section}
						data={data}
						challengeSiteKey={challengeSiteKey}
					/>
				))}
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

/**
 * One of the studio page's sections, in the order the theme's config gives
 * (TAT-54): Recent work (TAT-126), the artists and the inquiry section, which
 * is always one of them (readSections).
 */
function StudioSection({
	section,
	data,
	challengeSiteKey,
}: {
	section: SectionKey;
	data: StudioPageData;
	challengeSiteKey: string | null;
}) {
	switch (section) {
		case "work":
			return <RecentWork gallery={data.recentWork} />;
		case "artists":
			return <ArtistRoster artists={data.artists} />;
		case "inquiry":
			return (
				<InquirySection
					state={data.inquiry}
					channels={data.channels}
					challengeSiteKey={challengeSiteKey}
				/>
			);
	}
}

export function ArtistPage({
	data,
	challengeSiteKey = null,
	more,
}: {
	data: ArtistPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
	/** The browser's "Show more" (TAT-126); without it the link loads the next page. */
	more?: MoreWork;
}) {
	const { studio, artist, inquiry, channels, theme, portfolio } = data;
	return (
		<>
			<SiteBar studio={studio} theme={theme} />
			<main className="page">
				<ArtistProfile artist={artist} studio={studio} />
				<PortfolioSection
					slug={artist.slug}
					gallery={portfolio.gallery}
					search={portfolio.search}
					more={more}
				/>
				<InquirySection
					state={inquiry}
					channels={channels}
					challengeSiteKey={challengeSiteKey}
					stripAbove
				/>
				<StudioAside studio={studio} />
			</main>
			<SiteFooter studioName={studio.name} />
		</>
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
 * `/work` (TAT-126): every visible artist's photos, newest first, narrowed by
 * the address (artist, style, healed) and shown a page at a time. The site bar
 * and the studio block are the artist page's.
 */
export function WorkPage({
	data,
	more,
}: {
	data: WorkPageData;
	/** The browser's "Show more"; without it the link loads the next page. */
	more?: MoreWork;
}) {
	const { studio, theme, artists, search, gallery } = data;
	const { cursor: _page, ...firstPage } = search;
	const filtered = Boolean(
		search.artist || search.style || search.healed === true,
	);
	return (
		<>
			<SiteBar studio={studio} theme={theme} />
			<main className="page">
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
							<p>
								{filtered ? studioCopy.work.noMatch : studioCopy.work.empty}
							</p>
							{filtered ? (
								<a className="text-link" href={workHref({})}>
									{studioCopy.work.showAll}
								</a>
							) : null}
						</div>
					)}
				</section>
				<StudioAside studio={studio} />
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

/** The slim bar above the artist page and the All work page: the studio's name (and logo), back to its page. */
function SiteBar({
	studio,
	theme,
}: {
	studio: StudioView;
	theme: ThemeConfig;
}) {
	return (
		<header className="site-bar">
			<a href="/" dir="auto">
				{theme.logo ? (
					<>
						<BrandLogo
							image={theme.logo}
							className="site-bar-logo"
							sizes={logoSizes(theme.logo, "siteBar")}
						/>
						<span>{studio.name}</span>
					</>
				) : (
					studio.name
				)}
			</a>
		</header>
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

/** Who runs the page clients' details go through (no link until a marketing site exists). */
export function SiteFooter({ studioName }: { studioName: string }) {
	return (
		<footer className="site-footer">
			<p dir="auto">{studioName}</p>
			<p>Studio page by Tattoo Drip</p>
		</footer>
	);
}

/** The router's not-found page: an unknown path, or a hidden or unknown artist. */
export function NotFoundPage() {
	return (
		<main className="page status-page">
			<h1 className="section-title">Page not found</h1>
			<p>This page doesn't exist. The link may be old or mistyped.</p>
			<a className="text-link" href="/">
				Go to the studio page
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
