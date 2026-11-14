import { BrandLogo } from "../../components/brand.tsx";
import { GoodToKnowSection } from "../../components/good-to-know.tsx";
import { RequestInvite } from "../../components/inquiry.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import { goodToKnowIsEmpty } from "../../good-to-know.ts";
import { flashHref, isAllowedHref, workHref } from "../../links.ts";
import type { StudioPageData } from "../../loaders.ts";
import { OpenNow } from "../../open-now.tsx";
import { logoSizes } from "../../srcset.ts";
import type { SectionKey } from "../config.ts";
import { ArtistGrid } from "./artist-index.tsx";
import { FlashParlourFreshInk, FlashParlourReviews } from "./clients.tsx";
import { flashParlourCopy } from "./copy.ts";
import { FlashSheet } from "./flash-sheet.tsx";
import {
	type FlashParlourHome,
	type FlashParlourLead,
	flashParlourHome,
} from "./home-view.ts";
import { RibbonTitle, Star, StarRow } from "./ornaments.tsx";
import { FlashParlourPieces } from "./pieces.tsx";
import { FlashParlourShell } from "./shell.tsx";
import { leadSizes } from "./sizes.ts";

const copy = flashParlourCopy.home;

/**
 * The wall's first six, loaded at once (a phone shows six; React preloads
 * each); the rest are lazy, which still loads those on a wide first screen.
 */
const EAGER_WALL = 6;

/**
 * Flash Parlour's studio page (`/`): the same data as every theme's
 * (loadStudioPage; this theme's home reads twelve available designs instead
 * of six, homeFlashCount). It opens with the shop's sign, one short band:
 * its kind and place, its name (the page's h1), the hours line and the way
 * to book; right under it, the studio's available flash pinned up as a wall,
 * each design on its sheet with its name, size and price, and "Request this
 * design" into the flash request flow. A studio with no flash to show (none, Flash hidden in Page look,
 * or a failed read) leads with its work instead (its cover, else its largest
 * piece, else type alone on a star), never with a made-up design. Then its
 * introduction and its sections in its Page look order, each as Flash
 * Parlour draws it (`flash` already leads, so it isn't drawn twice). Props
 * only, so `react-dom/server` tests render it on its own.
 */
export function FlashParlourStudioPage({
	data,
	Shell = FlashParlourShell,
}: {
	data: StudioPageData;
	Shell?: Shell;
}) {
	const home = flashParlourHome(data);
	const { studio, theme } = data;
	const walled = home.wall.length > 0;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="home"
			artistsShown={data.artists.length > 0}
			mainClassName="fp-main fp-home"
		>
			{walled ? (
				<>
					<ShopSign data={data} />
					<section id="flash" className="fp-wall" aria-labelledby="flash-title">
						<div className="fp-container">
							<div className="fp-wall-head">
								<RibbonTitle id="flash-title">
									{flashParlourCopy.wall.title}
								</RibbonTitle>
								<p className="fp-wall-line">{flashParlourCopy.wall.line}</p>
							</div>
							<FlashSheet
								designs={home.wall}
								artists={data.artists}
								wall
								eager={EAGER_WALL}
							/>
							<p className="fp-wall-all">
								<RouterAnchor className="fp-button" href={flashHref({})}>
									{flashParlourCopy.wall.all}
								</RouterAnchor>
							</p>
						</div>
					</section>
				</>
			) : (
				<header className="fp-hero">
					<div
						className={
							home.lead
								? "fp-container fp-hero-grid"
								: "fp-container fp-hero-sign"
						}
					>
						{home.lead ? <LeadFigure lead={home.lead} /> : null}
						<div className="fp-hero-text">
							{theme.logo ? (
								<BrandLogo
									image={theme.logo}
									className="profile-logo"
									sizes={logoSizes(theme.logo, "hero")}
								/>
							) : null}
							{home.lead ? null : (
								<div className="fp-hero-ornament" aria-hidden="true">
									<Star tone="red" />
									<Star tone="mustard" className="fp-star-large" />
									<Star tone="green" />
								</div>
							)}
							<p className="fp-kicker user-text" dir="auto">
								{kickerOf(data)}
							</p>
							<h1 className="fp-hero-name" dir="auto">
								{studio.name}
							</h1>
							{data.openNow ? <OpenNow view={data.openNow} /> : null}
							<HeroActions data={data} className="fp-hero-actions" />
						</div>
					</div>
				</header>
			)}
			{studio.intro ? (
				<section
					className="fp-section fp-intro"
					aria-labelledby="fp-intro-title"
				>
					<div className="fp-container fp-intro-body">
						<h2 id="fp-intro-title" className="fp-label">
							{copy.about}
						</h2>
						<p className="fp-intro-text user-text" dir="auto">
							{studio.intro}
						</p>
					</div>
				</section>
			) : null}
			{theme.sections.map((section) => (
				<HomeSection key={section} section={section} data={data} home={home} />
			))}
		</Shell>
	);
}

/** The studio's kind and place, on one line. */
function kickerOf(data: StudioPageData): string {
	const { studio } = data;
	return studio.location
		? `${studio.typeLabel} · ${studio.location}`
		: studio.typeLabel;
}

/** The way to book (or the closed line) and, while there is work, the way to the gallery. */
function HeroActions({
	data,
	className,
}: {
	data: StudioPageData;
	className: string;
}) {
	return (
		<div className={className}>
			{data.requestLink ? (
				<BookingCta link={data.requestLink} className="fp-cta" />
			) : (
				<p className="fp-status fp-status-closed">{studioCopy.notTaking}</p>
			)}
			{data.recentWork.photos.length > 0 ? (
				<RouterAnchor className="fp-button" href={workHref({})}>
					{copy.viewGallery}
				</RouterAnchor>
			) : null}
		</div>
	);
}

/**
 * The shop's sign over the wall: the studio's kind and place, its name (the
 * page's h1, compact in the display face), the hours line and the way to
 * book, in one short band, so the flash is right under it at every width.
 */
function ShopSign({ data }: { data: StudioPageData }) {
	return (
		<header className="fp-sign">
			<div className="fp-container fp-sign-inner">
				<div className="fp-sign-text">
					<p className="fp-kicker user-text" dir="auto">
						{kickerOf(data)}
					</p>
					<h1 className="fp-sign-name" dir="auto">
						{data.studio.name}
					</h1>
					{data.openNow ? <OpenNow view={data.openNow} /> : null}
				</div>
				<HeroActions data={data} className="fp-hero-actions fp-sign-actions" />
			</div>
		</header>
	);
}

/** The first screen's photo when there is no flash, whole, eager and high priority: the page's main image. */
function LeadFigure({ lead }: { lead: FlashParlourLead }) {
	return (
		<figure className="fp-plate fp-hero-plate">
			<img
				className="fp-plate-photo"
				src={lead.src}
				srcSet={lead.srcSet}
				sizes={lead.srcSet ? leadSizes(lead) : undefined}
				width={lead.width}
				height={lead.height}
				alt={lead.alt}
				loading="eager"
				decoding="async"
				fetchPriority="high"
			/>
			{lead.source === "work" ? (
				<figcaption className="fp-plate-caption">
					{lead.href && isAllowedHref(lead.href) ? (
						<RouterAnchor className="fp-link" href={lead.href}>
							{copy.heroPiece}
						</RouterAnchor>
					) : (
						copy.heroPiece
					)}
				</figcaption>
			) : null}
		</figure>
	);
}

function HomeSection({
	section,
	data,
	home,
}: {
	section: SectionKey;
	data: StudioPageData;
	home: FlashParlourHome;
}) {
	switch (section) {
		case "work":
			return <WorkSection data={data} home={home} />;
		case "artists":
			if (!home.artistsShown) return null;
			return (
				<section
					id="artists"
					className="fp-section fp-home-artists"
					aria-labelledby="artists-title"
				>
					<div className="fp-container">
						<div className="fp-section-head">
							<RibbonTitle id="artists-title">
								{data.artists.length === 1 ? copy.artistsLone : copy.artists}
							</RibbonTitle>
						</div>
						<ArtistGrid artists={data.artists} headingLevel={3} />
					</div>
				</section>
			);
		case "flash":
			// The wall opened the page; with no wall there is no flash to show.
			return null;
		case "fresh_ink":
			return <FlashParlourFreshInk view={data.freshInk} />;
		case "reviews":
			return (
				<FlashParlourReviews
					view={data.reviews}
					studioName={data.studio.name}
				/>
			);
		case "info":
			// GoodToKnowSection renders nothing for a studio that filled nothing in: then no wrapper either.
			return goodToKnowIsEmpty(data.goodToKnow) ? null : (
				<div className="fp-container fp-shared">
					<GoodToKnowSection view={data.goodToKnow} />
				</div>
			);
		case "inquiry":
			return (
				<div className="fp-band">
					<div className="fp-container fp-shared">
						<StarRow />
						<RequestInvite state={data.inquiry} />
					</div>
				</div>
			);
	}
}

/**
 * The work: up to six of the newest tattoos after the one the first screen
 * shows, whole, and the way to the gallery. With no photos the section says
 * there are none to show here (never that the studio has published none: a
 * failed read looks the same); when the first screen's piece is the only one,
 * the section is left out (the piece is already shown).
 */
function WorkSection({
	data,
	home,
}: {
	data: StudioPageData;
	home: FlashParlourHome;
}) {
	const anyWork =
		data.recentWork.photos.length > 0 || home.lead?.source === "work";
	if (home.work.length === 0 && anyWork) return null;
	return (
		<section
			id="recent-work"
			className="fp-section fp-home-work"
			aria-labelledby="recent-work-title"
		>
			<div className="fp-container">
				<div className="fp-section-head">
					<RibbonTitle id="recent-work-title">{copy.work}</RibbonTitle>
					{home.work.length > 0 ? (
						<RouterAnchor className="fp-link" href={workHref({})}>
							{copy.allWork}
						</RouterAnchor>
					) : null}
				</div>
				{home.work.length > 0 ? (
					<FlashParlourPieces photos={home.work} withIds={false} />
				) : (
					<p className="fp-empty">{copy.noWork}</p>
				)}
			</div>
		</section>
	);
}
