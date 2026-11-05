import type { Shell } from "../../../components/shell.tsx";
import type { ArtworkPageData } from "../../../loaders.ts";
import { InkNoirShell } from "../shell.tsx";
import {
	ArtworkArtist,
	ArtworkBooking,
	ArtworkHero,
	RelatedArtwork,
} from "./artwork-sections.tsx";

/**
 * Ink Noir's tattoo page (`/gallery/$photo`): one piece as a featured work.
 * The piece and what is known of it, its artist, the invitation to ask for
 * something like it, and related pieces. The same data every theme gets
 * (loadArtworkPage); props only, so `react-dom/server` tests render it alone.
 */
export function InkNoirArtworkPage({
	data,
	Shell = InkNoirShell,
}: {
	data: ArtworkPageData;
	Shell?: Shell;
}) {
	const { studio, theme, artwork, similar } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
			mainClassName="ink-home ink-artwork-page"
		>
			<ArtworkHero artwork={artwork} studio={studio} similar={similar} />
			<ArtworkArtist artist={artwork.artist} />
			<ArtworkBooking
				similar={similar}
				artist={artwork.artist}
				studio={studio}
			/>
			<RelatedArtwork related={data.related} />
		</Shell>
	);
}
