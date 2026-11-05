import { Fill } from "../../../../intake/components/fill.tsx";
import type { StudioView } from "../../../view-model.ts";
import { Lines } from "../home/parts.tsx";
import { inkNoirGalleryCopy } from "./copy.ts";

const copy = inkNoirGalleryCopy.intro;

/**
 * The gallery's opening: the label and an oversized headline on the left,
 * whose work it is set lower on the right (beneath it on a phone), over a
 * hairline, as the artists directory opens. Not the home page's full-screen
 * hero: it introduces the collection and hands over to it. The page's one
 * h1. The line names the studio's artists, or the artist working alone.
 */
export function GalleryIntro({ studio }: { studio: StudioView }) {
	return (
		<header className="ink-dir-hero ink-gallery-intro">
			<div className="ink-container ink-dir-hero-grid">
				<p className="ink-label">{copy.label}</p>
				<h1 className="ink-dir-title">
					<Lines lines={copy.lines} />
				</h1>
				<p className="ink-dir-lede">
					{studio.type === "independent" ? (
						<Fill template={copy.description} values={{ who: studio.name }} />
					) : (
						<Fill
							template={copy.description.replace("{who}", copy.studioArtists)}
							values={{ name: studio.name }}
						/>
					)}
				</p>
			</div>
		</header>
	);
}
