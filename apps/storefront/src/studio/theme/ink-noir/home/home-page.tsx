import { FlashSection } from "../../../components/flash.tsx";
import type { Shell } from "../../../components/shell.tsx";
import { goodToKnowIsEmpty } from "../../../good-to-know.ts";
import type { StudioPageData } from "../../../loaders.ts";
import { InkNoirShell } from "../shell.tsx";
import { CinematicHero } from "./cinematic-hero.tsx";
import { inkNoirHomeCopy } from "./copy.ts";
import { FeaturedArtists } from "./featured-artists.tsx";
import { FeaturedWork } from "./featured-work.tsx";
import { FinalBookingCta } from "./final-booking-cta.tsx";
import {
	type HomeSection,
	type InkNoirHome,
	inkNoirHome,
} from "./home-view.ts";
import { StudioExperience } from "./studio-experience.tsx";
import { StudioIntroduction } from "./studio-introduction.tsx";
import { TattooStyles } from "./tattoo-styles.tsx";

/**
 * Ink Noir's studio page (`/`): the same data as every theme's
 * (loadStudioPage, no read of its own), laid out as an editorial portfolio.
 * The hero and the introduction (when the studio has something to say in
 * it) open it; then the studio's sections in the
 * order it set in Page look, each as Ink Noir draws it, with the styles
 * index after the work and the artists it is made of. A hidden section is
 * left out, and so is a section with nothing to show (except the featured
 * work, which says it has none). Props only, like the shared pages, so
 * `react-dom/server` tests render it on its own.
 */
export function InkNoirStudioPage({
	data,
	Shell = InkNoirShell,
}: {
	data: StudioPageData;
	Shell?: Shell;
}) {
	const home = inkNoirHome(data);
	const { studio, theme } = data;
	const artistCount = artistsShown(data) ? data.artists.length : 0;
	// A heading alone is no introduction: it needs the studio's words, a
	// photo or a fact (where it is, its artists) under it.
	const introShown =
		studio.intro !== null ||
		home.introPhoto !== null ||
		studio.location !== null ||
		artistCount > 1;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="home"
			artistsShown={data.artists.length > 0}
			mainClassName="ink-home"
		>
			<CinematicHero
				data={data}
				image={home.hero}
				scrollTo={introShown ? "#studio" : null}
			/>
			{introShown ? (
				<StudioIntroduction
					studio={studio}
					photo={home.introPhoto}
					artistCount={artistCount}
					next={introNext(data, home)}
				/>
			) : null}
			{home.sections.map((section) => (
				<HomeSectionView
					key={section}
					section={section}
					data={data}
					home={home}
				/>
			))}
		</Shell>
	);
}

function HomeSectionView({
	section,
	data,
	home,
}: {
	section: HomeSection;
	data: StudioPageData;
	home: InkNoirHome;
}) {
	switch (section) {
		case "work":
			return <FeaturedWork photos={home.featured} studio={data.studio} />;
		case "artists":
			return (
				<FeaturedArtists
					artists={data.artists}
					studioAccepting={data.studio.accepting}
				/>
			);
		case "styles":
			return <TattooStyles styles={home.styles} />;
		case "flash":
			// FlashSection renders nothing without designs: then no empty wrapper either.
			return data.flash.designs.length === 0 ? null : (
				<div className="ink-container ink-flash">
					<FlashSection list={data.flash} artists={data.artists} />
				</div>
			);
		case "info":
			return <StudioExperience view={data.goodToKnow} studio={data.studio} />;
		case "inquiry":
			return (
				<FinalBookingCta
					state={data.inquiry}
					requestLink={data.requestLink}
					artistsShown={artistsShown(data)}
				/>
			);
	}
}

function artistsShown(data: StudioPageData): boolean {
	return data.theme.sections.includes("artists") && data.artists.length > 0;
}

/**
 * Where the introduction's link goes: the visit when it is shown, else the
 * artists, else nowhere (no link that lands on nothing).
 */
function introNext(
	data: StudioPageData,
	home: InkNoirHome,
): { href: string; label: string } | null {
	const copy = inkNoirHomeCopy.intro;
	const visitShown =
		home.sections.includes("info") &&
		(!goodToKnowIsEmpty(data.goodToKnow) || data.studio.address !== null);
	if (visitShown) return { href: "#good-to-know", label: copy.planVisit };
	if (artistsShown(data)) {
		return {
			href: "#artists",
			label: data.artists.length === 1 ? copy.meetArtist : copy.meetArtists,
		};
	}
	return null;
}
