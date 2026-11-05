import { ArtistFlash } from "../../../components/flash.tsx";
import type { Shell } from "../../../components/shell.tsx";
import type { ArtistPageData } from "../../../loaders.ts";
import type { MoreWork } from "../../../paging.tsx";
import { InkNoirShell } from "../shell.tsx";
import { ArtistHero } from "./artist-hero.tsx";
import { ArtistPortfolio } from "./artist-portfolio.tsx";
import {
	ArtistAbout,
	ArtistBooking,
	ArtistNeighbours,
	ArtistSpecialties,
} from "./artist-sections.tsx";

/**
 * Ink Noir's artist page (`/artists/$slug`): the artist as a portfolio
 * feature. The opening (portrait, name, where they work, booking), their own
 * bio, their whole portfolio (the shared paged gallery, as an uncropped
 * masonry), their flash (the shared section), the styles they list (each a
 * link to the gallery filtered by it), the invitation to book, and the
 * artists before and after them. The same data every theme gets
 * (loadArtistPage: the artist found by exact slug in the studio's own visible
 * list, a not-found otherwise); props only, so `react-dom/server` tests render
 * it on its own. A part without data is left out.
 */
export function InkNoirArtistPage({
	data,
	more,
	Shell = InkNoirShell,
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
			artistsShown
			mainClassName="ink-home ink-artist-page"
		>
			<ArtistHero
				artist={artist}
				studio={studio}
				styles={data.styles}
				hasWork={portfolio.gallery.photos.length > 0}
			/>
			<ArtistAbout artist={artist} />
			<ArtistPortfolio
				artist={artist}
				gallery={portfolio.gallery}
				search={portfolio.search}
				more={more}
			/>
			{data.flash.designs.length > 0 ? (
				<div className="ink-container ink-flash">
					<ArtistFlash artist={artist} list={data.flash} />
				</div>
			) : null}
			<ArtistSpecialties artist={artist} styles={data.styles} />
			<ArtistBooking
				artist={artist}
				studio={studio}
				requestLink={data.requestLink}
			/>
			<ArtistNeighbours
				previous={data.neighbours.previous}
				next={data.neighbours.next}
			/>
		</Shell>
	);
}
