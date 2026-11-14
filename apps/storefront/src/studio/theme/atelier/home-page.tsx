import { BrandLogo } from "../../components/brand.tsx";
import { FlashSection } from "../../components/flash.tsx";
import { GoodToKnowSection } from "../../components/good-to-know.tsx";
import { RequestInvite } from "../../components/inquiry.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import { goodToKnowIsEmpty } from "../../good-to-know.ts";
import { isAllowedHref, workHref } from "../../links.ts";
import type { StudioPageData } from "../../loaders.ts";
import { OpenNow } from "../../open-now.tsx";
import { logoSizes } from "../../srcset.ts";
import type { SectionKey } from "../config.ts";
import { ArtistIndex } from "./artist-index.tsx";
import { AtelierFreshInk, AtelierReviews } from "./clients.tsx";
import { atelierCopy } from "./copy.ts";
import {
	type AtelierHome,
	type AtelierLead,
	atelierHome,
} from "./home-view.ts";
import { AtelierPieces } from "./pieces.tsx";
import { AtelierShell } from "./shell.tsx";
import { leadSizes } from "./sizes.ts";

const copy = atelierCopy.home;

/**
 * Atelier's studio page (`/`): the same data as every theme's
 * (loadStudioPage, no read of its own). A centred first screen: the studio's
 * kind and place, its name in Bodoni, a brass rule and the way to book; then
 * one strong photo whole on a white plate (the cover, else the studio's
 * largest piece of work, else a brass ornament alone); then the studio's own introduction, and its
 * sections in its Page look order, each as Atelier draws it. A hidden
 * section is left out; a shown one without data says so only where that
 * helps (the selected work), never with anything made up. Props only, so
 * `react-dom/server` tests render it on its own.
 */
export function AtelierStudioPage({
	data,
	Shell = AtelierShell,
}: {
	data: StudioPageData;
	Shell?: Shell;
}) {
	const home = atelierHome(data);
	const { studio, theme } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="home"
			artistsShown={data.artists.length > 0}
			mainClassName="atl-main atl-home"
		>
			<header className="atl-hero">
				<div className="atl-container atl-hero-grid">
					<div className="atl-hero-text">
						{theme.logo ? (
							<BrandLogo
								image={theme.logo}
								className="profile-logo"
								sizes={logoSizes(theme.logo, "hero")}
							/>
						) : null}
						<p className="atl-kicker user-text" dir="auto">
							{studio.location
								? `${studio.typeLabel} · ${studio.location}`
								: studio.typeLabel}
						</p>
						<h1 className="atl-hero-name" dir="auto">
							{studio.name}
						</h1>
						{data.openNow ? <OpenNow view={data.openNow} /> : null}
						<div className="atl-hero-actions">
							{data.requestLink ? (
								<BookingCta link={data.requestLink} className="atl-cta" />
							) : (
								<p className="atl-status atl-status-closed">
									{studioCopy.notTaking}
								</p>
							)}
							{data.recentWork.photos.length > 0 ? (
								<RouterAnchor
									className="action atl-action-quiet"
									href={workHref({})}
								>
									{copy.viewGallery}
								</RouterAnchor>
							) : null}
						</div>
					</div>
					{home.lead ? (
						<LeadFigure lead={home.lead} />
					) : (
						<div className="atl-hero-ornament" aria-hidden="true" />
					)}
				</div>
			</header>
			{studio.intro ? (
				<section
					className="atl-section atl-intro"
					aria-labelledby="atl-intro-title"
				>
					<div className="atl-container atl-split">
						<h2 id="atl-intro-title" className="atl-label">
							{copy.about}
						</h2>
						<p className="atl-intro-text user-text" dir="auto">
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

/** The first screen's photo, whole, eager and high priority: the page's main image. */
function LeadFigure({ lead }: { lead: AtelierLead }) {
	const image = (
		<img
			className="atl-plate-photo"
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
	);
	return (
		<figure className="atl-plate atl-hero-plate">
			{image}
			{lead.source === "work" ? (
				<figcaption className="atl-plate-caption">
					{lead.href && isAllowedHref(lead.href) ? (
						<RouterAnchor className="atl-link" href={lead.href}>
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
	home: AtelierHome;
}) {
	switch (section) {
		case "work":
			return <SelectedWork data={data} home={home} />;
		case "artists":
			if (!home.artistsShown) return null;
			return (
				<section
					id="artists"
					className="atl-section atl-home-artists"
					aria-labelledby="artists-title"
				>
					<div className="atl-container">
						<h2 id="artists-title" className="atl-section-title">
							{data.artists.length === 1 ? copy.artistsLone : copy.artists}
						</h2>
						<ArtistIndex artists={data.artists} headingLevel={3} />
					</div>
				</section>
			);
		case "flash":
			return data.flash.designs.length === 0 ? null : (
				<div className="atl-container atl-shared">
					<FlashSection list={data.flash} artists={data.artists} />
				</div>
			);
		case "fresh_ink":
			return <AtelierFreshInk view={data.freshInk} />;
		case "reviews":
			return (
				<AtelierReviews view={data.reviews} studioName={data.studio.name} />
			);
		case "info":
			// GoodToKnowSection renders nothing for a studio that filled nothing in: then no wrapper either.
			return goodToKnowIsEmpty(data.goodToKnow) ? null : (
				<div className="atl-container atl-shared">
					<GoodToKnowSection view={data.goodToKnow} />
				</div>
			);
		case "inquiry":
			return (
				<div className="atl-band">
					<div className="atl-container atl-shared">
						<RequestInvite state={data.inquiry} />
					</div>
				</div>
			);
	}
}

/**
 * The selected work: up to six of the newest pieces after the one the first
 * screen shows, whole, and the way to the gallery. With no photos the section
 * says there are none to show here (never that the studio has published none:
 * a failed read looks the same); when the first screen's piece is the only
 * one, the section is left out (the piece is already shown).
 */
function SelectedWork({
	data,
	home,
}: {
	data: StudioPageData;
	home: AtelierHome;
}) {
	const anyWork =
		data.recentWork.photos.length > 0 || home.lead?.source === "work";
	if (home.selected.length === 0 && anyWork) return null;
	return (
		<section
			id="recent-work"
			className="atl-section atl-selected"
			aria-labelledby="recent-work-title"
		>
			<div className="atl-container">
				<div className="atl-section-head">
					<h2 id="recent-work-title" className="atl-section-title">
						{copy.selectedWork}
					</h2>
					{home.selected.length > 0 ? (
						<RouterAnchor className="atl-link" href={workHref({})}>
							{copy.allWork}
						</RouterAnchor>
					) : null}
				</div>
				{home.selected.length > 0 ? (
					<AtelierPieces photos={home.selected} withIds={false} />
				) : (
					<p className="atl-empty">{copy.noWork}</p>
				)}
			</div>
		</section>
	);
}
