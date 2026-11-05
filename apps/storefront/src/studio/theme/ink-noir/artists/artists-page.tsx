import type { Shell } from "../../../components/shell.tsx";
import type { ArtistsPageData } from "../../../loaders.ts";
import { FinalBookingCta } from "../home/final-booking-cta.tsx";
import { InkNoirShell } from "../shell.tsx";
import { ArtistDirectory } from "./artist-directory.tsx";
import { ArtistFilters } from "./artist-filters.tsx";
import { ArtistsHero } from "./artists-hero.tsx";
import { inkNoirArtistsCopy } from "./copy.ts";

/**
 * Ink Noir's artists directory (`/artists`): the editorial opening, the style
 * filter while it can narrow anything, the artists (a grid, or one artist as
 * a feature) and the closing invitation, "Found your artist?", which asks a
 * lone artist by name. The same data any theme gets (loadArtistsPage); props
 * only, so `react-dom/server` tests render it on its own. There is no
 * featured-artist section: the studio's data marks no artist as featured.
 */
export function InkNoirArtistsPage({
	data,
	Shell = InkNoirShell,
}: {
	data: ArtistsPageData;
	Shell?: Shell;
}) {
	const { studio, theme, directory } = data;
	const one = directory.artists.length === 1;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artists"
			artistsShown={directory.artists.length > 0}
			mainClassName="ink-home ink-dir"
		>
			<ArtistsHero one={one} />
			{directory.filterable ? <ArtistFilters directory={directory} /> : null}
			<section className="ink-dir-list" aria-labelledby="dir-title">
				<h2 id="dir-title" className="sr-only">
					{one
						? inkNoirArtistsCopy.hero.label.one
						: inkNoirArtistsCopy.hero.label.many}
				</h2>
				<ArtistDirectory directory={directory} />
			</section>
			<FinalBookingCta
				state={data.inquiry}
				requestLink={data.ctaLink}
				artistsShown={false}
				invite={
					directory.artists.length > 0 ? inkNoirArtistsCopy.cta : undefined
				}
			/>
		</Shell>
	);
}
