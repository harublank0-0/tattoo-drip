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
import { irezumiCopy } from "./copy.ts";
import {
	type IrezumiHome,
	type IrezumiLead,
	irezumiHome,
} from "./home-view.ts";
import { IrezumiPieces } from "./pieces.tsx";
import { IrezumiShell } from "./shell.tsx";
import { leadSizes } from "./sizes.ts";

const copy = irezumiCopy.home;

/**
 * Irezumi's studio page (`/`): the same data as every theme's
 * (loadStudioPage, no read of its own). The first screen gives the studio's
 * name and the way to book the clearest place, beside one strong photo shown
 * whole (the cover, else the studio's largest piece of work, else type alone
 * on an ink-wash ground); then the studio's own introduction, and its
 * sections in its Page look order, each as Irezumi draws it. A hidden
 * section is left out; a shown one without data says so only where that
 * helps (the selected work), never with anything made up. Props only, so
 * `react-dom/server` tests render it on its own.
 */
export function IrezumiStudioPage({
	data,
	Shell = IrezumiShell,
}: {
	data: StudioPageData;
	Shell?: Shell;
}) {
	const home = irezumiHome(data);
	const { studio, theme } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="home"
			artistsShown={data.artists.length > 0}
			mainClassName="irz-main irz-home"
		>
			<header className="irz-hero">
				<div className="irz-container irz-hero-grid">
					<div className="irz-hero-text">
						{theme.logo ? (
							<BrandLogo
								image={theme.logo}
								className="profile-logo"
								sizes={logoSizes(theme.logo, "hero")}
							/>
						) : null}
						<p className="irz-kicker user-text" dir="auto">
							{studio.location
								? `${studio.typeLabel} · ${studio.location}`
								: studio.typeLabel}
						</p>
						<h1 className="irz-hero-name" dir="auto">
							{studio.name}
						</h1>
						{data.openNow ? <OpenNow view={data.openNow} /> : null}
						<div className="irz-hero-actions">
							{data.requestLink ? (
								<BookingCta link={data.requestLink} className="irz-cta" />
							) : (
								<p className="irz-status irz-status-closed">
									{studioCopy.notTaking}
								</p>
							)}
							{data.recentWork.photos.length > 0 ? (
								<RouterAnchor
									className="action irz-action-quiet"
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
						<div className="irz-hero-wash" aria-hidden="true" />
					)}
				</div>
			</header>
			{studio.intro ? (
				<section
					className="irz-section irz-intro"
					aria-labelledby="irz-intro-title"
				>
					<div className="irz-container irz-split">
						<h2 id="irz-intro-title" className="irz-label">
							{copy.about}
						</h2>
						<p className="irz-intro-text user-text" dir="auto">
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
function LeadFigure({ lead }: { lead: IrezumiLead }) {
	const image = (
		<img
			className="irz-hero-photo"
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
		<figure className="irz-hero-figure">
			{image}
			{lead.source === "work" ? (
				<figcaption className="irz-hero-caption">
					{lead.href && isAllowedHref(lead.href) ? (
						<RouterAnchor className="irz-link" href={lead.href}>
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
	home: IrezumiHome;
}) {
	switch (section) {
		case "work":
			return <SelectedWork data={data} home={home} />;
		case "artists":
			if (!home.artistsShown) return null;
			return (
				<section
					id="artists"
					className="irz-section irz-home-artists"
					aria-labelledby="artists-title"
				>
					<div className="irz-container">
						<h2 id="artists-title" className="irz-section-title">
							{data.artists.length === 1 ? copy.artistsLone : copy.artists}
						</h2>
						<ArtistIndex artists={data.artists} headingLevel={3} />
					</div>
				</section>
			);
		case "flash":
			return data.flash.designs.length === 0 ? null : (
				<div className="irz-container irz-shared">
					<FlashSection list={data.flash} artists={data.artists} />
				</div>
			);
		case "info":
			// GoodToKnowSection renders nothing for a studio that filled nothing in: then no wrapper either.
			return goodToKnowIsEmpty(data.goodToKnow) ? null : (
				<div className="irz-container irz-shared">
					<GoodToKnowSection view={data.goodToKnow} />
				</div>
			);
		case "inquiry":
			return (
				<div className="irz-band">
					<div className="irz-container irz-shared">
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
	home: IrezumiHome;
}) {
	const anyWork =
		data.recentWork.photos.length > 0 || home.lead?.source === "work";
	if (home.selected.length === 0 && anyWork) return null;
	return (
		<section
			id="recent-work"
			className="irz-section irz-selected"
			aria-labelledby="recent-work-title"
		>
			<div className="irz-container">
				<div className="irz-section-head">
					<h2 id="recent-work-title" className="irz-section-title">
						{copy.selectedWork}
					</h2>
					{home.selected.length > 0 ? (
						<RouterAnchor className="irz-link" href={workHref({})}>
							{copy.allWork}
						</RouterAnchor>
					) : null}
				</div>
				{home.selected.length > 0 ? (
					<IrezumiPieces photos={home.selected} withIds={false} />
				) : (
					<p className="irz-empty">{copy.noWork}</p>
				)}
			</div>
		</section>
	);
}
